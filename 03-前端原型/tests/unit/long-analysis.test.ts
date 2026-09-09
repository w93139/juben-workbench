import { expect, it, vi } from "vitest";
import { z } from "zod";
import { analysisBatches, ANALYSIS_BATCH_BYTES, analyzeLongSource, sourceNoteSchema, type LongAnalysisOptions, type Segment } from "@/server/long-analysis";
import { studioInputs } from "@/domain/studio";
const documents = () => Array.from({ length: 4 }, (_, i) => ({ id: `d${i}`, name: `角色${i}.txt`, text: `角色${i}的开篇。` + "中文与😀换行\n引号\"\\".repeat(14000) + `角色${i}的结尾。` }));
it("入口保留原文首尾空白，字符定位不因校验trim偏移", () => {
  const raw = "\n  原始正文。 \n";
  const parsed = studioInputs.analyze.parse({ documents: [{ id: "d", name: "角色", text: raw }] });
  expect(parsed.documents[0].text).toBe(raw);
  expect(studioInputs.analyze.safeParse({ documents: [{ id: "d", name: "角色", text: " \n" }] }).success).toBe(false);
});
type Note = z.infer<typeof sourceNoteSchema>;
function response(payload: unknown, schema: z.ZodType) {
  const data = payload as { segments?: Segment[]; notes?: Note[] };
  const ref = data.segments ? { documentId: data.segments[0].documentId, location: `字符${data.segments[0].start}-${data.segments[0].end}`, quote: data.segments[0].text.slice(0, 12).trim() } : data.notes![0].sourceRefs[0];
  if (schema === sourceNoteSchema) return { summary: "事实与线索的分段测试摘要，跨角色关系待核对。", sourceRefs: [ref], unknowns: ["测试未确认项"] };
  return { outline: "汇总后的统一大纲", directions: ["a", "b"].map(id => ({ id, title: id, summary: "原创方向", outline: "起因到选择", risk: "待试玩" })), sourceRefs: [ref], unknowns: [] };
}
function caller() { return vi.fn(async (_prompt: string, payload: unknown, schema: z.ZodType) => schema.parse(response(payload, schema))); }
it("中文、emoji、换行及转义字符分段无损，每批JSON大小可控", () => {
  const docs = documents(); const batches = analysisBatches(docs);
  expect(batches.length).toBeGreaterThan(4);
  for (const batch of batches) expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThanOrEqual(ANALYSIS_BATCH_BYTES);
  for (const doc of docs) {
    const segments = batches.flat().filter(s => s.documentId === doc.id);
    expect(segments.map(s => s.text).join("")).toBe(doc.text);
    expect(segments[0].start).toBe(0); expect(segments.at(-1)?.end).toBe(doc.text.length);
    segments.forEach((s, i) => { expect(s.text).toBe(doc.text.slice(s.start, s.end)); if (i) expect(s.start).toBe(segments[i - 1].end); expect(s.text.startsWith("\ude00")).toBe(false); });
  }
});
it("许多小文件合批读取，全部段发送后分层汇总，最终覆盖标记与来源可核对", async () => {
  const docs = documents(); const call = caller(); const phase = vi.fn();
  const result = await analyzeLongSource({ documents: docs, instructions: "保留悬疑体验" }, { call: call as LongAnalysisOptions["call"], phase, modelIdentity: "test" });
  const sourceCalls = call.mock.calls.filter(([, p]) => !!(p as { segments?: unknown }).segments);
  const sent = sourceCalls.flatMap(([, p]) => (p as { segments: Segment[] }).segments);
  for (const doc of docs) expect(sent.filter(s => s.documentId === doc.id).map(s => s.text).join("")).toBe(doc.text);
  expect(call.mock.calls.some(([p]) => p.includes("合并以下全部"))).toBe(true);
  call.mock.calls.forEach(([, p]) => expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(600000));
  expect(result.coverage).toEqual({ method: "segmented", documents: 4, parts: sourceCalls.length });
  expect(result.unknowns.join("")).toContain("仍需结合原文复核");
  expect(result.unknowns).toContain("测试未确认项");
  expect(phase.mock.calls.at(-1)?.[0]).toContain("正在生成统一大纲");
  expect(analysisBatches(Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}`, name: "线索", text: "短线索" }))).length).toBeLessThan(10);
});
it("真实摘录配伪造位置时由原文偏移纠正，下游不会沿用模型编造的页码", async () => {
  const call: LongAnalysisOptions["call"] = async (_prompt, payload, schema) => {
    const value = response(payload, schema);
    if ((payload as { segments?: unknown }).segments) value.sourceRefs[0].location = "不存在的第999页";
    else expect((payload as { notes: Note[] }).notes[0].sourceRefs[0].location).toBe("字符 1–4");
    return schema.parse(value);
  };
  const result = await analyzeLongSource({ documents: [{ id: "d", name: "测试", text: "真实原文" }], instructions: "" }, { call, phase: () => {}, modelIdentity: "test" });
  expect(result.sourceRefs[0].location).toBe("字符 1–4");
});
it("片段失败不会继续或生成整体通过结果，重试复用已完成摘要且创作要求改变会失效", async () => {
  const docs = documents(); const cache = new Map<string, unknown>(); let count = 0;
  const failedCall = vi.fn(async (_prompt: string, payload: unknown, schema: z.ZodType) => { if (++count === 2) throw new Error("测试上游失败"); return schema.parse(response(payload, schema)); });
  const options = { call: failedCall as LongAnalysisOptions["call"], phase: vi.fn(), modelIdentity: "model-test", readCheckpoint: (key: string) => cache.get(key), writeCheckpoint: (key: string, note: Note) => { cache.set(key, note); } };
  await expect(analyzeLongSource({ documents: docs, instructions: "" }, options)).rejects.toThrow("测试上游失败");
  expect(cache.size).toBe(1); expect(failedCall).toHaveBeenCalledTimes(2);
  const retry = caller(); await analyzeLongSource({ documents: docs, instructions: "" }, { ...options, call: retry as LongAnalysisOptions["call"] });
  const sourceCalls = retry.mock.calls.filter(([, p]) => !!(p as { segments?: unknown }).segments);
  expect(sourceCalls.length).toBe(analysisBatches(docs).length - 1);
  const changed = caller(); await analyzeLongSource({ documents: docs, instructions: "改为四人" }, { ...options, call: changed as LongAnalysisOptions["call"] });
  expect(changed.mock.calls.filter(([, p]) => !!(p as { segments?: unknown }).segments)).toHaveLength(analysisBatches(docs).length);
});
it("片段或最终汇总伪造原文引用均拒绝，不保存污染摘要", async () => {
  const doc = [{ id: "d", name: "测试", text: "真实原文" }]; const writeCheckpoint = vi.fn();
  const forged = (finalOnly: boolean): LongAnalysisOptions["call"] => async (_prompt, payload, schema) => {
    const value = response(payload, schema);
    if (!finalOnly || (schema as z.ZodType) !== sourceNoteSchema) value.sourceRefs[0] = { documentId: "d", location: "原文", quote: "不存在的引用" };
    return schema.parse(value);
  };
  await expect(analyzeLongSource({ documents: doc, instructions: "" }, { call: forged(false), phase: () => {}, modelIdentity: "test", writeCheckpoint })).rejects.toThrow("引用无法");
  expect(writeCheckpoint).not.toHaveBeenCalled();
  await expect(analyzeLongSource({ documents: doc, instructions: "" }, { call: forged(true), phase: () => {}, modelIdentity: "test" })).rejects.toThrow("来源引用");
});
