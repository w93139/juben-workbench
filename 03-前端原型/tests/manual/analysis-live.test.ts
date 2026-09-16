/** Default is strictly offline planning. A paid single-batch run requires a reviewed, short-lived approval. */
import { it } from "vitest";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { studioInputs } from "@/domain/studio";
import { analysisCallSchema, type AnalysisCallDiagnostic } from "@/domain/analysis-diagnostics";
import { modelRequest, openAITransport, StudioError } from "@/server/studio-models";
import { StudioSettingsStore } from "@/server/studio-settings";
import { openAnalysisCacheReadOnly } from "@/server/studio-job-store";
import { planAnalysis } from "@/server/analysis-plan";
import { analysisBatches, citationSegments, extractionPrompt, selectedReferences, sourceSelectionSchema } from "@/server/long-analysis";
import { analysisParameters, emptyUsage, hash, safeIssues } from "@/server/analysis-observation";
import { guardedVerificationFetch, preflightVerificationApproval, readApprovedVerificationConfig, verificationCostSummary, estimateRequestFen, ANT_PRICE_SOURCE, VerificationGuardError } from "./live-analysis-guard";

it("拆解计划 dry-run；显式授权后只诊断指定一批，不继续合并或整本", async () => {
  const network = globalThis.fetch;
  // Installed BEFORE reading inputs/config/cache. Dry-run is incapable of network access.
  globalThis.fetch = async () => { throw new Error("dry-run 禁止网络"); };
  let cache: ReturnType<typeof openAnalysisCacheReadOnly> | undefined;
  try {
    const liveRequested = process.env.STUDIO_LIVE_VERIFY === "1";
    const approvalPath = process.env.STUDIO_VERIFY_APPROVAL;
    // An unconfirmed rotation must stop before opening a settings file, not just before fetch.
    const approval = liveRequested ? preflightVerificationApproval(approvalPath ? JSON.parse(readFileSync(approvalPath, "utf8")) : null) : null;
    const inputPath = process.env.STUDIO_ANALYSIS_INPUT;
    const raw = inputPath ? readFileSync(inputPath, "utf8") : null;
    if (raw && Buffer.byteLength(raw) > 12000000) throw new Error("输入超出检查容量。");
    const data = studioInputs.analyze.parse(raw ? JSON.parse(raw) : {
      documents: Array.from({ length: 10 }, (_, i) => ({ id: `fixture-${i}`, name: `自有样例${i}.txt`, text: `自有验证角色${i}，记录只证明顺序，不能单独证明动机。`.repeat(120) })), instructions: "自有合成样例，不代表原始失败输入。",
    });
    // Dry-run only accepts nonsecret parameters. It never opens STUDIO_LIVE_SETTINGS_ROOT.
    const model = process.env.STUDIO_ANALYSIS_MODEL ?? "deepseek-v4-pro-0813", baseUrl = process.env.STUDIO_ANALYSIS_BASE_URL ?? "https://maas-api.antdigital.com/v1";
    if (baseUrl !== "https://maas-api.antdigital.com/v1" || model !== "deepseek-v4-pro-0813") throw new Error("本次验证只准备已审核的蚂蚁接口和模型，零外呼。");
    if (process.env.STUDIO_ANALYSIS_CACHE) cache = openAnalysisCacheReadOnly(process.env.STUDIO_ANALYSIS_CACHE);
    const plan = planAnalysis(data, { baseUrl, model, readCheckpoint: cache?.read });
    const batches = analysisBatches(data.documents);
    const batch = Number(process.env.STUDIO_ANALYSIS_BATCH ?? 1);
    if (!Number.isSafeInteger(batch) || batch < 1 || batch > batches.length) throw new Error("指定批次不存在，零外呼。");
    const source = citationSegments(batches[batch - 1], new Map(data.documents.map((d, i) => [d.id, i + 1])));
    if (!source.catalog.size) throw new Error("指定批次仅有空白，无需模型。");
    const prompt = extractionPrompt("part"), payload = { segments: source.input, instructions: data.instructions };
    const request = modelRequest(model, prompt, payload, sourceSelectionSchema, 4096);
    const requestHash = hash({ baseUrl, request });
    const preview = {
      inputSource: inputPath ? process.env.STUDIO_ANALYSIS_INPUT_KIND === "synthetic-substitute" ? "synthetic-substitute; NOT-original-failure" : "explicit-input-file; original-identity-requires-comparison" : "synthetic-fixture; NOT-original-failure",
      configurationSource: process.env.STUDIO_ANALYSIS_MODEL || process.env.STUDIO_ANALYSIS_BASE_URL ? "explicit-nonsecret-parameters" : "documented-default; NOT-live-configuration",
      documents: data.documents.map(d => ({ identity: hash({ id: d.id, name: d.name, text: d.text }), characters: d.text.length, bytes: Buffer.byteLength(d.text) })),
      plan, singleBatch: { batch, of: batches.length, requestHash, inputFingerprint: plan.fingerprint,
        sourceRanges: batches[batch - 1].map(s => ({ documentIdentity: hash(s.documentId), start: s.start, end: s.end })),
        parameters: analysisParameters(model, 4096), payloadBytes: Buffer.byteLength(JSON.stringify(payload)), requestBytes: Buffer.byteLength(JSON.stringify(request)), timeoutMs: 240000, maximumCalls: 1,
        stop: "一次发送后无论成功失败都结束；不合并、不自动重试。供应商内部执行次数未知。", cost: { actualFen: null, estimateFen: estimateRequestFen(Buffer.byteLength(JSON.stringify(request)), 4096, 9, 27), hardMoneyCap: false, priceSource: ANT_PRICE_SOURCE, basis: "9/27 CNY per million; bytes+2048;20% margin; fresh quote required before approval" } },
    };
    console.info(JSON.stringify(preview, null, 2));
    if (!liveRequested || !approval) return;
    const settingsRoot = process.env.STUDIO_LIVE_SETTINGS_ROOT;
    if (!inputPath || !settingsRoot || !isAbsolute(settingsRoot)) throw new Error("真实验证要求明确输入和新密钥配置的绝对目录，未读取密钥。");
    if (approval.requestHash !== requestHash || approval.inputFingerprint !== plan.fingerprint || approval.model !== model) throw new VerificationGuardError("REQUEST_MISMATCH");
    const configured = readApprovedVerificationConfig(approval, () => new StudioSettingsStore(settingsRoot).config({}));
    if (!configured || configured.baseUrl !== baseUrl || configured.mainModel !== model) throw new Error("新凭据配置与本次计划不符，未调用模型。");
    const folder = process.env.STUDIO_VERIFY_RECORD_DIR;
    if (!folder || !isAbsolute(folder)) throw new Error("必须指定独立、绝对路径的受限验证记录目录。");
    const diagnostic: AnalysisCallDiagnostic = {
      jobId: randomUUID(), sequence: 1, step: { stage: "part", index: batch, total: batches.length, level: 0 }, requestHash,
      parameters: analysisParameters(model, 4096), returnedModel: null, requestBytes: Buffer.byteLength(JSON.stringify(request)),
      startedAt: Date.now(), elapsedMs: 0, timeoutMs: 240000, status: "reserved", httpStatus: null, providerRequestId: null,
      finishReason: null, responseBodyBytes: null, contentCharacters: null, usage: emptyUsage(), failure: null, issues: [],
    };
    const file = join(resolve(folder), requestHash + ".json"); let reserved = false;
    const report = () => JSON.stringify({ inputFingerprint: plan.fingerprint, diagnostic: analysisCallSchema.parse(diagnostic), cost: verificationCostSummary(approval) }, null, 2);
    globalThis.fetch = guardedVerificationFetch({ network, baseUrl, model, requestHash, inputFingerprint: plan.fingerprint,
      connectionHash: hash({ baseUrl, apiKey: configured.apiKey }), approval,
      reserve() {
        mkdirSync(folder, { recursive: true, mode: 0o700 }); const dir = lstatSync(folder);
        if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077)) throw new Error("验证目录权限不安全。");
        const fd = openSync(file, "wx", 0o600);
        try { writeFileSync(fd, report()); fsyncSync(fd); reserved = true; } finally { closeSync(fd); }
      },
    });
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new StudioError("MODEL_TIMEOUT", "单批验证超时。")); }, 240000); });
      const rawResult = await Promise.race([openAITransport(configured, model, prompt, payload, sourceSelectionSchema, controller.signal, { maxTokens: 4096, observe: observation => Object.assign(diagnostic, observation) }), timeout]);
      const parsed = sourceSelectionSchema.safeParse(rawResult);
      if (!parsed.success) { diagnostic.failure = "schema"; diagnostic.issues = safeIssues(parsed.error.issues); throw new Error("字段校验失败"); }
      try { selectedReferences(parsed.data.sourceRefIds, source.catalog); } catch { diagnostic.failure = "reference"; diagnostic.issues = [{ path: "sourceRefIds", code: "invalid_reference" }]; throw new Error("引用校验失败"); }
      diagnostic.status = "completed";
    } catch (error) {
      if (!reserved && error instanceof VerificationGuardError) {
        // Local pre-send rejection is not a provider/network failure. Its messages are fixed, never upstream content.
        diagnostic.status = "failed"; diagnostic.failure = "other";
        throw error;
      }
      diagnostic.status = "failed"; diagnostic.failure = error instanceof StudioError && error.code === "MODEL_TIMEOUT" ? "timeout" : diagnostic.failure ?? "other";
      throw new Error(`单批验证停止：${diagnostic.failure}；不自动重试。`);
    } finally {
      if (timer) clearTimeout(timer); diagnostic.elapsedMs = Date.now() - diagnostic.startedAt;
      if (reserved) {
        // Keep the pre-send reservation if a diagnostic update fails; it still prevents a duplicate request.
        try { const temporary = file + ".tmp"; const fd = openSync(temporary, "wx", 0o600); try { writeFileSync(fd, report()); fsyncSync(fd); } finally { closeSync(fd); } renameSync(temporary, file); }
        catch { console.warn("验证诊断更新失败；原预留记录保留，禁止重复发送。"); }
      }
    }
  } finally { cache?.close(); globalThis.fetch = network; }
});
