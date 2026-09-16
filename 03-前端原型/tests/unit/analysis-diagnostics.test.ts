import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { StudioEngine, openAITransport, type ModelTransport } from "@/server/studio-models";
import { StudioJobStore, openAnalysisCacheReadOnly } from "@/server/studio-job-store";
import { planAnalysis, analysisModelIdentity } from "@/server/analysis-plan";
import { analysisBatches, analysisCacheKey, citationSegments, sourceSelectionSchema, type CitationSegment } from "@/server/long-analysis";
import { studioJobViewSchema } from "@/domain/studio";
const config = { baseUrl: "https://model.invalid/v1", apiKey: "test-private-credential", mainModel: "deepseek-v4-pro-0813", reviewA: "a", reviewB: "b" };
const power = async () => ({ assertActive() {}, async release() {} });
const input = { documents: [{ id: "d", name: "test", text: "自有原文" }], instructions: "" };
const result = { outline: "测试", directions: ["a", "b"].map(id => ({ id, title: id, summary: "方向", outline: "结构", risk: "待核对" })), sourceRefs: [{ documentId: "d", location: "正文", quote: "自有原文" }], unknowns: [] };
const longInput = { documents: [{ id: "d", name: "test", text: "自有原文".repeat(10000) }], instructions: "" };
const envelope = (content: unknown = result, extra = {}) => ({ model: config.mainModel, id: "req-123", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], ...extra });
const stores: StudioJobStore[] = [];
const store = () => { const s = new StudioJobStore(":memory:"); stores.push(s); return s; };
async function done(engine: StudioEngine, id: string) {
  for (let i = 0; i < 150; i++) { const state = engine.get(id); if (state.status !== "running") return state; await new Promise(resolve => setImmediate(resolve)); }
  throw new Error("not settled");
}
afterEach(() => { stores.splice(0).forEach(s => s.close()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([
  ["length", () => Response.json(envelope(null, { usage: { prompt_tokens: 25, completion_tokens: 4096, total_tokens: 4121, completion_tokens_details: { reasoning_tokens: 4000 } }, choices: [{ finish_reason: "length", message: { content: "{", reasoning_content: "private-thinking" } }] })), "incomplete", "MODEL_RESPONSE_INCOMPLETE"],
  ["schema", () => Response.json(envelope({ ...result, directions: [{ secret: "nested-private" }] })), "schema", "MODEL_RESPONSE_INVALID"],
  ["reference", () => Response.json(envelope({ ...result, sourceRefs: [{ documentId: "d", location: "x", quote: "不存在" }] })), "reference", "SOURCE_REFERENCE_INVALID"],
  ["http", () => Response.json({ error: { Authorization: config.apiKey, nested: { body: "原稿全文" } } }, { status: 429, headers: { "x-request-id": "req-http" } }), "http", "MODEL_REQUEST_FAILED"],
  ["content-json", () => Response.json(envelope(null, { choices: [{ finish_reason: "stop", message: { content: "invalid-json-private" } }] })), "content_json", "MODEL_RESPONSE_INVALID"],
  ["response-json", () => new Response("not-json-private"), "response_json", "MODEL_RESPONSE_INVALID"],
] as const)("%s 分类持久化，原始正文和嵌套敏感内容不落诊断", async (_name, response, failure, code) => {
  const s = store(); vi.stubGlobal("fetch", vi.fn(async () => response()));
  const engine = new StudioEngine(() => config, openAITransport, Date.now, s, power);
  const state = await done(engine, (await engine.start("analyze", input)).jobId);
  expect(state.error?.code).toBe(code); expect(state.analysis?.calls[0].failure).toBe(failure);
  expect(s.read(state.jobId)?.view).toEqual(state);
  const diagnostic = JSON.stringify(state.analysis);
  for (const secret of [config.apiKey, "nested-private", "private-thinking", "原稿全文", "invalid-json-private", "not-json-private", input.documents[0].text]) expect(diagnostic).not.toContain(secret);
  if (_name === "length") expect(state.analysis?.calls[0]).toMatchObject({ finishReason: "length", usage: { promptTokens: 25, completionTokens: 4096, reasoningTokens: 4000 }, httpStatus: 200, providerRequestId: "req-123" });
  if (_name === "schema") expect(state.analysis?.calls[0].issues[0]).toMatchObject({ path: "directions.0.id", code: "invalid_type" });
});
it("缺失 usage 保持未知；不从总量推测推理用量", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(envelope())));
  const engine = new StudioEngine(() => config, openAITransport, Date.now, store(), power);
  const state = await done(engine, (await engine.start("analyze", input)).jobId);
  expect(state.status).toBe("completed");
  expect(state.analysis?.calls[0].usage).toEqual({ promptTokens: null, completionTokens: null, totalTokens: null, reasoningTokens: null });
  expect(state.analysis?.usage.reasoningTokens).toEqual({ known: 0, missingCalls: 1 });
});
it("超时记录持久化，重启后相同请求零发送", async () => {
  vi.useFakeTimers(); const s = store(), network = vi.fn(() => new Promise<never>(() => {}));
  const engine = new StudioEngine(() => config, network, Date.now, s, power);
  const task = await engine.start("analyze", input); await vi.advanceTimersByTimeAsync(240001);
  expect(s.read(task.jobId)?.view.analysis?.calls[0].failure).toBe("timeout");
  const restarted = new StudioEngine(() => config, network, Date.now, s, power);
  const next = await restarted.start("analyze", input); await vi.advanceTimersByTimeAsync(0);
  expect(restarted.get(next.jobId).error?.code).toBe("ANALYSIS_REPEAT_BLOCKED"); expect(network).toHaveBeenCalledTimes(1);
});
const successful: ModelTransport = async (_c, _m, _i, payload, schema) => {
  const p = payload as { segments?: CitationSegment[]; notes?: { sourceRefs: { citationId: string }[] }[] };
  const id = p.segments?.[0].passages.find(p => p.citationId)?.citationId ?? p.notes![0].sourceRefs[0].citationId;
  return schema === sourceSelectionSchema ? { summary: "摘要", sourceRefIds: [id], unknowns: [] } : { outline: result.outline, directions: result.directions, unknowns: [], sourceRefIds: [id] };
};
it("分段、合并4096和最终8192覆盖16384默认值，全部调用计数且上限阻断下一次", async () => {
  const transport = vi.fn(successful), s = store();
  const engine = new StudioEngine(() => config, transport, Date.now, s, power, { maxCalls: 2 });
  const state = await done(engine, (await engine.start("analyze", longInput)).jobId);
  expect(state.error?.code).toBe("ANALYSIS_CALL_LIMIT"); expect(transport).toHaveBeenCalledTimes(2);
  expect(state.analysis?.calls.map(c => c.parameters.max_tokens)).toEqual([4096, 4096]);
  const resumed = new StudioEngine(() => config, transport, Date.now, s, power, { maxCalls: 64 });
  const complete = await done(resumed, (await resumed.start("analyze", longInput)).jobId);
  expect(complete.status).toBe("completed"); expect(complete.analysis?.cacheHits).toHaveLength(2);
  expect(complete.analysis?.calls.some(c => c.step.stage === "merge" && c.parameters.max_tokens === 4096)).toBe(true);
  expect(complete.analysis?.calls.at(-1)).toMatchObject({ step: { stage: "final" }, parameters: { max_tokens: 8192 } });
  for (const [,,,,,, overrides] of transport.mock.calls) expect([4096, 8192]).toContain(overrides?.maxTokens);
});
it("分段非法引用在对应调用上标记且不继续", async () => {
  const transport = vi.fn(async () => ({ summary: "摘要", sourceRefIds: ["D999P0"], unknowns: [] }));
  const engine = new StudioEngine(() => config, transport, Date.now, store(), power);
  const state = await done(engine, (await engine.start("analyze", longInput)).jobId);
  expect(state.analysis?.calls[0]).toMatchObject({ failure: "reference", status: "failed", step: { stage: "part", index: 1 } });
  expect(transport).toHaveBeenCalledTimes(1);
});
it("诊断写入失败不覆盖 length 原因，发送前写入失败零外呼", async () => {
  const s = store(); const save = vi.spyOn(s, "saveAnalysisCall");
  vi.stubGlobal("fetch", vi.fn(async () => { save.mockImplementation(() => { throw new Error("private disk error"); }); return Response.json(envelope(null, { choices: [{ finish_reason: "length", message: { content: "{" } }] })); }));
  const engine = new StudioEngine(() => config, openAITransport, Date.now, s, power);
  const state = await done(engine, (await engine.start("analyze", input)).jobId);
  expect(state.error?.code).toBe("MODEL_RESPONSE_INCOMPLETE"); expect(state.analysis?.persistenceWarning).toBe(true);
  const other = store(), transport = vi.fn(); vi.spyOn(other, "reserveAnalysisCall").mockImplementation(() => { throw new Error("disk error"); });
  const before = new StudioEngine(() => config, transport, Date.now, other, power);
  expect((await done(before, (await before.start("analyze", input)).jobId)).error?.code).toBe("ANALYSIS_DIAGNOSTIC_SAVE_FAILED"); expect(transport).not.toHaveBeenCalled();
});
it("旧任务可读；dry-run 读取有效旧缓存，忽略但不删除过期缓存，无网络或文件变化", () => {
  const folder = mkdtempSync(join(tmpdir(), "analysis-readonly-")), file = join(folder, "jobs.sqlite");
  const s = new StudioJobStore(file, () => 1000), jobId = randomUUID();
  const legacy = { jobId, status: "running" as const, phase: "旧任务" };
  s.claim(legacy, "old"); s.save({ jobId, status: "failed", phase: "旧故障", error: { code: "OLD", message: "旧错误" } });
  expect(studioJobViewSchema.parse(s.read(jobId)?.view).analysis).toBeUndefined();
  const source = citationSegments(analysisBatches(longInput.documents)[0], new Map([["d", 1]]));
  const key = analysisCacheKey(analysisModelIdentity(config.baseUrl, config.mainModel), "part", "", { segments: source.input });
  s.saveAnalysisNote(key, { summary: "旧摘要", sourceRefs: [[...source.catalog.values()][0]], unknowns: [] }); s.close();
  const db = new DatabaseSync(file); db.prepare("INSERT INTO studio_analysis_notes VALUES (?, ?, ?)").run("expired", "{}", 0); db.close();
  const before = readFileSync(file); const cache = openAnalysisCacheReadOnly(file, () => 1000);
  const network = vi.fn(() => { throw new Error("network forbidden"); }); vi.stubGlobal("fetch", network);
  try {
    const plan = planAnalysis(longInput, { baseUrl: config.baseUrl, model: config.mainModel, readCheckpoint: cache.read });
    expect(plan.partCacheHits).toBe(1); expect(cache.read("expired")).toBeNull(); expect(network).not.toHaveBeenCalled();
  } finally { cache.close(); }
  expect(readFileSync(file)).toEqual(before);
  const check = new DatabaseSync(file, { readOnly: true }); expect(check.prepare("SELECT COUNT(*) AS n FROM studio_analysis_notes").get()?.n).toBe(2); check.close();
  rmSync(folder, { recursive: true });
});
