import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { emptyWorkbench, materialSchema, reviewCurrent, workbenchSchema } from "@/domain/workbench";
import { applyStudioJobView } from "@/domain/studio-job-update";
import { applyBlueprintDraft, putBlueprintDraft } from "@/domain/blueprint-drafts";
import { createProjectBackup, parseProjectBackup, restoredProject, serializeProjectBackup } from "@/domain/project-backup";
import { studioInputs, studioJobViewSchema, type StudioOperation } from "@/domain/studio";
import { studioCostPreviewSchema } from "@/domain/studio-budget";
import { studioJobInput } from "@/services/studio-client";
import { plannedArtifact, reviewAudit, reviewBlueprint } from "../fixtures/studio-review";
import { backupFixture } from "../fixtures/project-backup";
import type { StudioJobStore } from "@/server/studio-job-store";

let root: string | undefined, store: StudioJobStore | undefined;
afterEach(() => {
  store?.close(); store = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  if (root) rmSync(root, { recursive: true, force: true });
});
const origin = "http://127.0.0.1:3107";
function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { host: "127.0.0.1:3107", origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

// Real route handlers, transport, ledger, file database, domain transitions and ZIP writer.
// This deliberately does not claim to exercise HTTP routing or browser IndexedDB.
it("同一TXT经分析、蓝图修订、长篇中断重启、完整审查、实际ZIP与备份恢复贯通", async () => {
  root = mkdtempSync(join(tmpdir(), "juben-material-to-zip-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  const config = { baseUrl: "https://maas-api.antdigital.com/v1", apiKey: "test-synthetic-only", mainModel: "main", reviewA: "review-a", reviewB: "review-b" };
  for (const [key, value] of Object.entries({ STUDIO_API_BASE_URL: config.baseUrl, STUDIO_API_KEY: config.apiKey, STUDIO_MAIN_MODEL: config.mainModel, STUDIO_REVIEW_A_MODEL: config.reviewA, STUDIO_REVIEW_B_MODEL: config.reviewB })) vi.stubEnv(key, value);
  const { StudioEngine, openAITransport, readStudioConfig } = await import("@/server/studio-models");
  const { StudioJobStore } = await import("@/server/studio-job-store");
  const { StudioBilling } = await import("@/server/studio-billing");
  const { StudioPrices } = await import("@/server/studio-pricing");
  const jobs = await import("@/app/api/studio/[operation]/route");
  const budgets = await import("@/app/api/studio/budget/route");
  const materials = await import("@/app/api/local/materials/read/route");
  const directories = await import("@/server/local-directories");
  const exports = await import("@/app/api/local/directories/write/route");
  const prices = new StudioPrices(vi.fn<typeof fetch>(async () => Response.json({ success: true, data: { items: ["main", "review-a", "review-b"].map(name => ({ name, inPrice: "¥1/M", outPrice: "¥2/M", status: "RELEASED", type: "TEXT_GENERATE", offShelfFlag: 0, modelProtocolCompatibility: { openai_chat_completions: true }, protocolParameters: [{ protocolName: "openai_chat_completions", parameters: { response_format: true } }] })) } })));
  const dbPath = join(root, "jobs.sqlite");
  function boot() {
    store = new StudioJobStore(dbPath);
    const engine = new StudioEngine(readStudioConfig, openAITransport, Date.now, store, async () => ({ assertActive() {}, async release() {} }), new StudioBilling(store.budget, prices));
    vi.stubGlobal("__studioEngine", engine); return engine;
  }
  let engine = boot();
  let state = emptyWorkbench();
  const projectId = "material-to-zip", source = "自造原文：甲隐去档案，乙决定核对记录。";
  const form = new FormData(); form.set("file", new File([source], "自造材料.txt", { type: "text/plain" }));
  const read = await materials.POST(new Request(origin + "/api/local/materials/read", { method: "POST", headers: { host: "127.0.0.1:3107", origin }, body: form }));
  expect(read.status).toBe(200);
  state.documents = [materialSchema.parse({ id: randomUUID(), name: "自造材料.txt", size: Buffer.byteLength(source), ...await read.json() })];
  expect(state.documents[0].text).toBe(source); state.sourceRevision++;
  state.instructions = "保留核对记录的选择";
  let failOnce = true, firstScope: string | undefined;
  const calls: { model: string; scope?: string; independent: boolean; artifact?: string }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toBe(config.baseUrl + "/chat/completions");
    const body = JSON.parse(String(init?.body)), payload = JSON.parse(body.messages[1].content);
    const independent = body.messages[0].content.includes("独立审核");
    calls.push({ model: body.model, scope: payload.scope?.id, independent, artifact: payload.target?.id });
    let output: unknown;
    if (payload.documents) {
      expect(payload).toEqual(studioInputs.analyze.parse(studioJobInput(state, "analyze")));
      output = { outline: "明确事实：隐档与核对；原创方向见下；体验待定。", directions: ["核对", "公开"].map(id => ({ id, title: id, summary: "重建档案因果", outline: "发现缺页、核对与选择公开", risk: "待真人试玩" })), sourceRefs: [{ documentId: payload.documents[0].id, location: "首段", quote: source }], unknowns: ["真人体验未验收"] };
    } else if (payload.analysis) {
      expect(payload.analysis).toEqual(state.analysis); expect(payload.choiceId).toBe(state.analysis!.directions[0].id);
      output = reviewBlueprint();
    } else {
      expect(payload.blueprint).toEqual(state.blueprint);
      if (payload.target) {
        output = { ...plannedArtifact(payload), content: `${payload.target.id}\n${payload.target.audience === "host" ? "仅主持可读的测试标记" : "玩家段落"}\n` + "自造完整正文🙂核对记录。".repeat(2200) };
      } else {
        const audit = reviewAudit();
        audit.evidence = [{ location: "正式大纲", quote: state.blueprint!.premise, conclusion: "检查当前修订内容" }];
        output = { ...audit, ...(payload.sources ? { coverage: payload.sources.map((part: { partId: string; hash: string; content: string }) => ({ partId: part.partId, hash: part.hash, quote: part.content.slice(0, 12) })) } : {}) };
      }
    }
    if (payload.scope) firstScope ??= payload.scope.id;
    const fail = failOnce && payload.scope?.id === firstScope && body.model === config.reviewB && independent;
    if (fail) failOnce = false;
    // Even this failed provider response carries known usage, and must be charged once.
    return Response.json({ model: body.model, usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] }, { status: fail ? 503 : 200 });
  }); vi.stubGlobal("fetch", fetcher);
  const configured = await budgets.POST(request("/api/studio/budget", { action: "configure", projectId, revision: 0, capFen: 1000000 }));
  expect(configured.status).toBe(200);
  async function preview(operation: StudioOperation) {
    const response = await budgets.POST(request("/api/studio/budget", { action: "preview", projectId, operation, input: studioJobInput(state, operation) }));
    expect(response.status).toBe(200); return studioCostPreviewSchema.parse(await response.json());
  }
  async function start(operation: StudioOperation, previewId: string, expectedStatus = 202) {
    const jobId = randomUUID();
    const response = await jobs.POST(request(`/api/studio/${operation}`, studioJobInput(state, operation), { "X-Studio-Request-Id": jobId, "X-Studio-Project-Id": projectId, "X-Studio-Budget-Revision": "1", "X-Studio-Budget-Preview": previewId }), { params: Promise.resolve({ operation }) });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(expectedStatus);
    if (expectedStatus === 202) state.job = { jobId, operation, phase: "提交", sourceRevision: state.sourceRevision, blueprintRevision: state.blueprintRevision };
    return jobId;
  }
  async function settle(jobId: string) {
    for (let index = 0; index < 5000; index++) {
      if (engine.get(jobId).status !== "running") {
        const response = await jobs.GET(request(`/api/studio/status?jobId=${jobId}`), { params: Promise.resolve({ operation: "status" }) });
        expect(response.status).toBe(200);
        const job = studioJobViewSchema.parse(await response.json());
        expect(applyStudioJobView(state, job)).toBe(true); state = workbenchSchema.parse(state); return job;
      }
      await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error("job did not settle");
  }
  expect((await settle(await start("analyze", (await preview("analyze")).previewId))).status).toBe("completed");
  expect(state.analysis!.sourceRefs[0].documentId).toBe(state.documents[0].id);
  state.choiceId = state.analysis!.directions[0].id;
  expect((await settle(await start("blueprint", (await preview("blueprint")).previewId))).status).toBe("completed");
  function editPremise(premise: string) {
    const draft = { id: randomUUID(), revision: 1, baseRevision: state.revision, baseBlueprintRevision: state.blueprintRevision, updatedAt: new Date().toISOString(), data: { ...state.blueprint!, premise } };
    putBlueprintDraft(state, draft, null); applyBlueprintDraft(state, draft.id, 1);
  }
  editPremise("同一材料贯通测试：正式修订后的档案馆");
  expect(state.blueprintRevision).toBe(2);
  const old = await preview("review");
  const generated = await settle(await start("review", (await preview("review")).previewId));
  expect(generated.error?.code).toBe("REVIEW_PLAN_READY"); expect(reviewCurrent(state)).toBe(false);
  const original = structuredClone(state.review!.artifacts);
  expect(Buffer.byteLength(JSON.stringify(original))).toBeGreaterThan(600000);
  const beforeStale = calls.length;
  await start("review", old.previewId, 409); expect(calls).toHaveLength(beforeStale);
  const segmented = await preview("review"); expect(segmented.reviewMode).toBe("segmented");
  const interrupted = await settle(await start("review", segmented.previewId));
  expect(interrupted.status).toBe("failed");
  expect(state.review!.segmented!.units.slice(0, 2).map(unit => unit.state)).toEqual(["saved", "interrupted"]);
  expect(reviewCurrent(state)).toBe(false);
  const beforeRestart = calls.length, chargedBeforeRestart = store!.budget.snapshot(projectId)!.spentFen;
  const checkpoint = structuredClone(state.reviewProgress);
  store!.close(); engine = boot();
  expect(engine.get(interrupted.jobId).reviewProgress).toEqual(checkpoint!.checkpoint);
  expect(store!.budget.snapshot(projectId)!.spentFen).toBe(chargedBeforeRestart); expect(calls).toHaveLength(beforeRestart);
  const complete = await settle(await start("review", (await preview("review")).previewId));
  expect(complete.status, JSON.stringify(complete.error)).toBe("completed"); expect(reviewCurrent(state)).toBe(true);
  const review = state.review!;
  expect(review.artifacts).toEqual(original); expect(review.segmented!.units.every(unit => unit.state === "saved")).toBe(true);
  expect(calls.slice(beforeRestart).some(call => call.artifact)).toBe(false);
  expect(calls.filter(call => call.scope === firstScope && call.model === config.reviewA && call.independent)).toHaveLength(1);
  expect(calls.filter(call => call.scope === firstScope && call.model === config.reviewB && call.independent)).toHaveLength(2);
  const budgetResponse = await budgets.GET(request(`/api/studio/budget?projectId=${projectId}`));
  const budget = (await budgetResponse.json()).budget;
  expect(budget).toMatchObject({ totalCalls: calls.length, spentFen: calls.length, uncertainCalls: 0, reservedFen: 0 });
  expect(calls.length).toBe(segmented.callsMax + 3); // analyze + blueprint + failed B retry
  expect(() => engine.getValidated(review.validationId!, "0".repeat(64))).toThrow("蓝图");
  const output = join(root, "selected-output"); mkdirSync(output);
  const selected = await directories.registerChosenDirectory(output);
  const exportBody = { directoryId: selected.id, validationId: review.validationId, title: "贯通测试" };
  const exported = await exports.POST(request("/api/local/directories/write", exportBody));
  expect(exported.status).toBe(200); const filename = (await exported.json()).filename;
  const zipPath = join(output, filename), zipBytes = readFileSync(zipPath);
  // Independent standard-library reader checks CRCs and central-directory integrity.
  const unpacked = spawnSync("python3", ["-c", "import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None\n assert len(z.namelist()) == len(set(z.namelist()))\n print(json.dumps({n:z.read(n).decode('utf-8') for n in z.namelist()}))", zipPath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  expect(unpacked.status, unpacked.stderr).toBe(0);
  const files: Record<string, string> = JSON.parse(unpacked.stdout);
  expect(Object.keys(files)).toHaveLength(original.length + 4);
  expect(JSON.parse(files["主持材料-含谜底/原创设计蓝图.json"])).toEqual(state.blueprint);
  expect(JSON.parse(files["主持材料-含谜底/分段审查原始报告与覆盖.json"])).toEqual(review.segmented);
  const manifest = JSON.parse(files["主持材料-含谜底/审查与版本清单.json"]);
  expect(manifest).toMatchObject({ validationId: review.validationId, blueprintFingerprint: review.blueprintFingerprint, reports: review.reports, humanPlaytest: "not-run" });
  const characterIds = [...new Set(original.flatMap(artifact => artifact.characterId ? [artifact.characterId] : []))].sort();
  for (const artifact of original) {
    const matches = Object.entries(files).filter(([, content]) => content === artifact.content);
    expect(matches).toHaveLength(1);
    expect(matches[0][0].startsWith(artifact.audience === "host" ? "主持材料-含谜底/" : "玩家材料/")).toBe(true);
    if (artifact.audience === "player") {
      expect(matches[0][1]).not.toContain("仅主持可读的测试标记");
      const folder = artifact.characterId ? `角色-${String(characterIds.indexOf(artifact.characterId) + 1).padStart(4, "0")}-${artifact.characterId}` : "公共材料";
      expect(matches[0][0].startsWith(`玩家材料/${folder}/`)).toBe(true);
    }
    expect(manifest.materials.find((item: { id: string }) => item.id === artifact.id).sourceIds).toEqual(artifact.sourceIds);
  }
  expect(files["00-使用说明.md"]).toContain("尚未真人试玩");
  expect((await exports.POST(request("/api/local/directories/write", exportBody))).status).toBe(409);
  expect(readFileSync(zipPath)).toEqual(zipBytes);
  const project = backupFixture().project; project.id = projectId; project.outputSettings.rootPath = ""; project.outputSettings.directory = selected;
  const backup = parseProjectBackup(serializeProjectBackup(createProjectBackup(project, state, true)));
  expect(backup.schemaVersion).toBe(4);
  const restored = restoredProject(backup, randomUUID(), "a".repeat(64), new Date().toISOString());
  expect(restored.workbench.reviewArchives.at(-1)!.review).toEqual((({ validationId: _id, ...value }) => { void _id; return value; })(review));
  expect(restored.workbench.documents).toEqual(state.documents); expect(restored.workbench.job).toBeNull();
  expect(restored.project.outputSettings.directory).toBeNull(); expect(store!.budget.snapshot(restored.project.id)).toBeNull();
  expect(reviewCurrent(restored.workbench)).toBe(false);
  const beforeOffline = calls.length;
  editPremise("新正式版本使旧通过记录不能用于当前导出");
  expect(reviewCurrent(state)).toBe(false); expect(calls).toHaveLength(beforeOffline);
}, 60000);
