import { expect, it, vi } from "vitest";
import { z } from "zod";
import { analysisBatches, ANALYSIS_BATCH_BYTES, analyzeLongSource, sourceNoteSchema, sourceSelectionSchema, type LongAnalysisOptions, type CitationSegment } from "@/server/long-analysis";
import { studioInputs } from "@/domain/studio";
import { ANALYSIS_CALL_BYTES } from "@/domain/analysis-limits";
type Note = z.infer<typeof sourceNoteSchema>;
type Payload = { segments?: CitationSegment[]; notes?: { sourceRefs: { citationId: string; quote: string }[] }[] };
const documents = () => Array.from({ length: 4 }, (_, i) => ({ id: `d${i}`, name: `角色${i}.txt`, text: `角色${i}的开篇。` + "中文与😀换行\n引号\"\\".repeat(14000) + `角色${i}的结尾。` }));
function ids(payload: unknown) { const data = payload as Payload; return data.segments ? data.segments.flatMap(s => s.passages.filter(p => p.text.trim()).map(p => p.citationId)) : data.notes!.flatMap(n => n.sourceRefs.map(r => r.citationId)); }
function response(payload: unknown, schema: z.ZodType) {
  const sourceRefIds = [ids(payload)[0]];
  return schema === sourceSelectionSchema ? { summary: "事实与线索的分段测试摘要，跨角色关系待核对。", sourceRefIds, unknowns: ["测试未确认项"] } : { outline: "汇总后的统一大纲", directions: ["a", "b"].map(id => ({ id, title: id, summary: "原创方向", outline: "起因到选择", risk: "待试玩" })), sourceRefIds, unknowns: [] };
}
function caller() { return vi.fn(async (_prompt: string, payload: unknown, schema: z.ZodType) => schema.parse(response(payload, schema))); }
it("入口保留原文首尾空白，字符定位不因校验trim偏移", () => {
  const raw = "\n  原始正文。 \n";
  expect(studioInputs.analyze.parse({ documents: [{ id: "d", name: "角色", text: raw }] }).documents[0].text).toBe(raw);
  expect(studioInputs.analyze.safeParse({ documents: [{ id: "d", name: "角色", text: " \n" }] }).success).toBe(false);
});
it("中文、emoji、换行及转义原文分段无损，不切代理对，编号目录也算入60KB合批", async () => {
  const docs = documents(); const batches = analysisBatches(docs); const call = caller();
  for (const doc of docs) {
    const segments = batches.flat().filter(s => s.documentId === doc.id);
    expect(segments.map(s => s.text).join("")).toBe(doc.text);
    segments.forEach((s, i) => { expect(s.text).toBe(doc.text.slice(s.start, s.end)); if (i) expect(s.start).toBe(segments[i - 1].end); expect(s.text.startsWith("\ude00")).toBe(false); });
  }
  const result = await analyzeLongSource({ documents: docs, instructions: "保留悬疑体验" }, { call: call as LongAnalysisOptions["call"], phase: vi.fn(), modelIdentity: "test" });
  const inputs = call.mock.calls.map(([, p]) => p as Payload).filter(p => p.segments);
  const sent = inputs.flatMap(p => p.segments!);
  for (const doc of docs) expect(sent.filter(s => s.documentId === doc.id).flatMap(s => s.passages.map(p => p.text)).join("")).toBe(doc.text);
  for (const input of inputs) expect(Buffer.byteLength(JSON.stringify(input.segments))).toBeLessThanOrEqual(ANALYSIS_BATCH_BYTES);
  const allIds = sent.flatMap(s => s.passages.map(p => p.citationId)); expect(new Set(allIds).size).toBe(allIds.length);
  sent.flatMap(s => s.passages).forEach(p => expect(p.text.startsWith("\ude00")).toBe(false));
  expect(call.mock.calls.some(([p]) => p.includes("合并以下全部"))).toBe(true);
  expect(result.coverage).toEqual({ method: "segmented", documents: 4, parts: batches.length });
  expect(result.unknowns).toContain("测试未确认项"); expect(result.unknowns.join("")).toContain("仍需结合原文复核");
  for (const ref of result.sourceRefs) expect(docs.find(d => d.id === ref.documentId)!.text).toContain(ref.quote);
});
it("重复摘录可指定后一次真实位置，模型无需复写UUID、空白或摘录", async () => {
  const repeated = "相同证言\r\n".padEnd(160, " "); const doc = { id: "11111111-1111-4111-8111-111111111111", name: "角色本", text: repeated + repeated };
  const call: LongAnalysisOptions["call"] = async (_prompt, payload, schema) => { const value = response(payload, schema); value.sourceRefIds = [(payload as Payload).segments ? ids(payload)[1] : ids(payload)[0]]; return schema.parse(value); };
  const result = await analyzeLongSource({ documents: [doc], instructions: "" }, { call, phase: () => {}, modelIdentity: "test" });
  expect(result.sourceRefs).toEqual([{ documentId: doc.id, location: "字符 161–164", quote: "相同证言" }]);
});
it("中途失败不继续，重试复用已完成原文摘要，创作要求改变缓存失效", async () => {
  const docs = documents(); const cache = new Map<string, unknown>(); let count = 0;
  const failed = vi.fn(async (_prompt: string, payload: unknown, schema: z.ZodType) => { if (++count === 2) throw new Error("测试上游失败"); return schema.parse(response(payload, schema)); });
  const options = { call: failed as LongAnalysisOptions["call"], phase: vi.fn(), modelIdentity: "model-test", readCheckpoint: (key: string) => cache.get(key), writeCheckpoint: (key: string, note: Note) => { cache.set(key, note); } };
  await expect(analyzeLongSource({ documents: docs, instructions: "" }, options)).rejects.toThrow("测试上游失败"); expect(cache.size).toBe(1); expect(failed).toHaveBeenCalledTimes(2);
  const retry = caller(); await analyzeLongSource({ documents: docs, instructions: "" }, { ...options, call: retry as LongAnalysisOptions["call"] });
  expect(retry.mock.calls.filter(([, p]) => (p as Payload).segments)).toHaveLength(analysisBatches(docs).length - 1);
  const changed = caller(); await analyzeLongSource({ documents: docs, instructions: "改为四人" }, { ...options, call: changed as LongAnalysisOptions["call"] });
  expect(changed.mock.calls.filter(([, p]) => (p as Payload).segments)).toHaveLength(analysisBatches(docs).length);
});
it.each(["part", "merge", "final"])("%s只接受本次输入可用编号，未知编号不会被第一条来源替代", async stage => {
  const writeCheckpoint = vi.fn();
  const call: LongAnalysisOptions["call"] = async (prompt, payload, schema) => {
    const value = response(payload, schema);
    const current = (payload as Payload).segments ? "part" : prompt.includes("合并以下全部") ? "merge" : "final";
    if (stage === current) value.sourceRefIds = ["D999P999"];
    return schema.parse(value);
  };
  await expect(analyzeLongSource({ documents: documents(), instructions: "" }, { call, phase: () => {}, modelIdentity: "test", writeCheckpoint })).rejects.toThrow("不在本次输入");
  if (stage === "part") expect(writeCheckpoint).not.toHaveBeenCalled();
});
it("真实存在但未被输入摘要选中的编号，也不能在最终汇总越权取用", async () => {
  let unselected = "";
  const call: LongAnalysisOptions["call"] = async (_prompt, payload, schema) => {
    const value = response(payload, schema);
    if ((payload as Payload).segments) unselected = ids(payload)[1]; else value.sourceRefIds = [unselected];
    return schema.parse(value);
  };
  await expect(analyzeLongSource({ documents: [{ id: "d", name: "本", text: "原".repeat(320) }], instructions: "" }, { call, phase: () => {}, modelIdentity: "test" })).rejects.toThrow("不在本次输入");
});
it("缓存引用仍核对当前位置与原文，不接受污染或旧契约缓存", async () => {
  const call = caller();
  await expect(analyzeLongSource({ documents: [{ id: "d", name: "本", text: "原文" }], instructions: "" }, { call: call as LongAnalysisOptions["call"], phase: () => {}, modelIdentity: "test", readCheckpoint: () => ({ summary: "污染", sourceRefs: [{ documentId: "d", location: "字符 1–2", quote: "伪造" }], unknowns: [] }) })).rejects.toThrow("引用无法");
  expect(call).not.toHaveBeenCalled();
});
it("近上限摘要与最坏转义创作要求仍按完整载荷组包", async () => {
  const docs = Array.from({ length: 4 }, (_, i) => ({ id: `d${i}`, name: `角色${i}`, text: `角色${i}` + "\u0001".repeat(10000) }));
  const call: LongAnalysisOptions["call"] = async (_prompt, payload, schema) => {
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(ANALYSIS_CALL_BYTES);
    const value = response(payload, schema);
    if ((schema as z.ZodType) === sourceSelectionSchema) return schema.parse({ ...value, summary: "\u0001".repeat(2500), sourceRefIds: ids(payload).slice(0, 4), unknowns: Array.from({ length: 4 }, () => "\u0001".repeat(160)) });
    return schema.parse(value);
  };
  const result = await analyzeLongSource({ documents: docs, instructions: "\u0001".repeat(10000) }, { call, phase: () => {}, modelIdentity: "bounded-test" });
  expect(result.coverage?.documents).toBe(4);
});
it("纯空白批次由程序核对，不要求模型伪造非空引用，也不额外调用", async () => {
  const doc = { id: "d", name: "带页间空白", text: " ".repeat(100000) + "有效原文" };
  expect(analysisBatches([doc]).flat().map(s => s.text).join("")).toBe(doc.text);
  const call = caller();
  const result = await analyzeLongSource({ documents: [doc], instructions: "" }, { call: call as LongAnalysisOptions["call"], phase: () => {}, modelIdentity: "blank-test" });
  const sourceCalls = call.mock.calls.filter(([, p]) => (p as Payload).segments);
  expect(sourceCalls.length).toBeLessThan(analysisBatches([doc]).length);
  sourceCalls.forEach(([, p]) => expect(ids(p).length).toBeGreaterThan(0));
  expect(result.sourceRefs[0].quote).toBe("有效原文"); expect(result.sourceRefs[0].location).toBe("字符 100001–100004");
  expect(result.unknowns.join("")).toContain("空白批次");
});
