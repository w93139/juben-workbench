import { createHash } from "node:crypto";
import { z } from "zod";
import { studioAnalysisSchema, type StudioAnalysis } from "@/domain/studio";
import { ANALYSIS_BATCH_BYTES, ANALYSIS_SEGMENT_BYTES, ANALYSIS_MAX_BATCHES, ANALYSIS_CALL_BYTES } from "@/domain/analysis-limits";

export { ANALYSIS_BATCH_BYTES } from "@/domain/analysis-limits";
const SEGMENT_BYTES = ANALYSIS_SEGMENT_BYTES;
const NOTE_BYTES = 32000;
const VERSION = "source-analysis/3-citation-selection";
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
type Document = { id: string; name: string; text: string };
export type Segment = { documentId: string; name: string; start: number; end: number; text: string };
export const sourceNoteSchema = z.object({
  summary: z.string().trim().min(1).max(2500),
  sourceRefs: z.array(z.object({ documentId: z.string().min(1).max(120), location: z.string().min(1).max(100), quote: z.string().trim().min(1).max(160) }).strip()).min(1).max(4),
  unknowns: z.array(z.string().min(1).max(160)).max(8),
}).strip();
export const sourceSelectionSchema = sourceNoteSchema.omit({ sourceRefs: true }).extend({ sourceRefIds: z.array(z.string().min(1).max(40)).min(1).max(4) }).strip();
export const analysisSelectionSchema = studioAnalysisSchema.omit({ sourceRefs: true, coverage: true }).extend({ sourceRefIds: z.array(z.string().min(1).max(40)).min(1).max(100) }).strip();
type Note = z.infer<typeof sourceNoteSchema>;
type Reference = Note["sourceRefs"][number];
export type CitationSegment = Omit<Segment, "text"> & { passages: { citationId: string; text: string }[] };
const refKey = (ref: Reference) => JSON.stringify([ref.documentId, ref.location, ref.quote]);
function citationSegments(segments: Segment[], documentNumbers: Map<string, number>) {
  const catalog = new Map<string, Reference>();
  const input: CitationSegment[] = segments.map(({ text, ...segment }) => {
    const passages: CitationSegment["passages"] = [];
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + 160, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
      const value = text.slice(start, end);
      const citationId = `D${documentNumbers.get(segment.documentId)}P${segment.start + start}`;
      const quote = value.trim();
      passages.push({ citationId: quote ? citationId : "", text: value });
      if (quote) {
        const offset = segment.start + start + value.length - value.trimStart().length;
        catalog.set(citationId, { documentId: segment.documentId, location: `字符 ${offset + 1}–${offset + quote.length}`, quote });
      }
      start = end;
    }
    return { ...segment, passages };
  });
  return { input, catalog };
}
function selectedReferences(ids: string[], catalog: Map<string, Reference>): Reference[] {
  if (ids.some(id => !catalog.has(id))) throw new LongAnalysisError("模型选择了不在本次输入中的来源编号，结果未采纳；材料和已完成分段保留，没有自动重试。");
  return [...new Set(ids)].map(id => ({ ...catalog.get(id)! }));
}
export class LongAnalysisError extends Error {}

/** Exact UTF-16 source ranges; never split a surrogate pair or remove whitespace. */
export function analysisBatches(documents: Document[]): Segment[][] {
  const batches: Segment[][] = []; let batch: Segment[] = []; let batchBytes = 2;
  const documentNumbers = new Map(documents.map((doc, i) => [doc.id, i + 1]));
  if (documentNumbers.size !== documents.length) throw new LongAnalysisError("材料编号重复，无法建立唯一来源，未调用模型。");
  for (const document of documents) {
    let start = 0;
    while (start < document.text.length) {
      let low = 1; let high = document.text.length - start;
      while (low < high) {
        const count = Math.ceil((low + high) / 2);
        if (size(document.text.slice(start, start + count)) <= SEGMENT_BYTES) low = count; else high = count - 1;
      }
      let end = start + low;
      if (end < document.text.length && /[\uD800-\uDBFF]/.test(document.text[end - 1]) && /[\uDC00-\uDFFF]/.test(document.text[end])) end--;
      const segment = { documentId: document.id, name: document.name, start, end, text: document.text.slice(start, end) };
      const segmentBytes = size(citationSegments([segment], documentNumbers).input[0]);
      if (segmentBytes + 2 > ANALYSIS_BATCH_BYTES) throw new LongAnalysisError("单个原文片段超过编号载荷预算，未调用模型。");
      if (batch.length && batchBytes + 1 + segmentBytes > ANALYSIS_BATCH_BYTES) { batches.push(batch); batch = []; batchBytes = 2; }
      batchBytes += (batch.length ? 1 : 0) + segmentBytes;
      batch.push(segment); start = end;
    }
  }
  if (batch.length) batches.push(batch);
  if (batches.length > ANALYSIS_MAX_BATCHES) throw new LongAnalysisError("材料分段数量超过本轮处理上限，尚未调用模型。请联系维护者调整长剧本处理方案。");
  return batches;
}

type Call = <T>(instructions: string, payload: unknown, schema: z.ZodType<T>, maxTokens?: number) => Promise<T>;
export interface LongAnalysisOptions {
  call: Call;
  phase: (message: string) => void;
  modelIdentity: string;
  readCheckpoint?: (key: string) => unknown;
  writeCheckpoint?: (key: string, note: Note) => void;
}
function validateNote(note: Note, refs: (ref: Note["sourceRefs"][number]) => boolean) {
  if (size(note) > NOTE_BYTES || !note.sourceRefs.every(refs)) throw new LongAnalysisError("分段摘要的引用无法在对应原文核对，已停止汇总；已有材料和完成的分段保留。");
}

export async function analyzeLongSource(data: { documents: Document[]; instructions: string }, options: LongAnalysisOptions): Promise<StudioAnalysis> {
  const batches = analysisBatches(data.documents);
  const documentNumbers = new Map(data.documents.map((doc, i) => [doc.id, i + 1]));
  const citationIds = new Map<string, string>();
  let notes: Note[] = [];
  const sourceUnknowns = new Set<string>();
  function noteInput(items: Note[]) {
    return items.map(note => ({ ...note, sourceRefs: note.sourceRefs.map(ref => ({ citationId: citationIds.get(refKey(ref))!, ...ref })) }));
  }
  function noteCatalog(items: Note[]) {
    const catalog = new Map<string, Reference>();
    for (const note of items) for (const ref of note.sourceRefs) {
      const id = citationIds.get(refKey(ref));
      if (!id) throw new LongAnalysisError("已保存摘要的来源编号缺失，未发起汇总请求。");
      catalog.set(id, ref);
    }
    return catalog;
  }
  const payloadSize = (items: Note[]) => size({ notes: noteInput(items), instructions: data.instructions });
  const boundedCall: Call = (instructions, payload, schema, maxTokens) => {
    if (size(payload) > ANALYSIS_CALL_BYTES) throw new LongAnalysisError("当前分段或汇总超过处理预算，未发起本次请求；已完成摘要保留。");
    return options.call(instructions, payload, schema, maxTokens);
  };
  async function extract(kind: "part" | "merge", payload: unknown, catalog: Map<string, Reference>) {
    const key = createHash("sha256").update(JSON.stringify({ version: VERSION, model: options.modelIdentity, kind, instructions: data.instructions, payload })).digest("hex");
    const validRefs = new Set([...catalog.values()].map(refKey));
    const cached = options.readCheckpoint?.(key);
    if (cached != null) {
      const parsed = sourceNoteSchema.safeParse(cached);
      if (!parsed.success) throw new LongAnalysisError("已保存的分段摘要无法读取，未重复调用模型。请检查本机任务记录。");
      validateNote(parsed.data, ref => validRefs.has(refKey(ref))); return parsed.data;
    }
    const prompt = kind === "part"
      ? "这是完整原剧本的一批原文片段，不是全部故事。每个segment的passages按顺序拼接就是原文，必须读完全部passages。summary保留真相/时间因果、角色关系与私人认知、关键线索、轮次机制和跨片段待核对关系，区分明确事实与推断。不要提出原创方向。unknowns保留矛盾、缺失和暂不能确定的事项。"
      : "合并以下全部分段研究摘要，不是重新阅读全部原文。保留人物同一性、事件先后与因果、信息差、线索到结论、轮次节奏及跨片段矛盾；不能用后出现的断言静默覆盖旧矛盾。区分原文事实与推断，丢失细节或冲突写unknowns。不要提出原创方向。";
    const selected = await boundedCall(prompt + " sourceRefIds只选择本次输入明确列出的citationId，不能自己写编号、摘录或位置；摘录由程序从所选编号对应的原文精确回填。摘要不超过2500字，最多4个来源编号与4条待定事项；未能保留的关键关系列为待核对。", { ...payload as object, instructions: data.instructions }, sourceSelectionSchema, 4096);
    const { sourceRefIds, ...content } = selected;
    const note: Note = { ...content, sourceRefs: selectedReferences(sourceRefIds, catalog) };
    validateNote(note, ref => validRefs.has(refKey(ref)));
    options.writeCheckpoint?.(key, note);
    return note;
  }
  for (let index = 0; index < batches.length; index++) {
    options.phase(`正在分段读取 ${index + 1}/${batches.length} · 已完成 ${index} 批`);
    const source = citationSegments(batches[index], documentNumbers);
    if (!source.catalog.size) { sourceUnknowns.add("仅含空白的原文批次已由程序核对，没有为该批调用模型；覆盖数量包含这类空白批次。"); continue; }
    for (const [id, ref] of source.catalog) citationIds.set(refKey(ref), id);
    const note = await extract("part", { segments: source.input }, source.catalog);
    note.unknowns.forEach(item => sourceUnknowns.add(item)); notes.push(note);
  }
  let level = 1;
  while (notes.length > 4 || payloadSize(notes) > ANALYSIS_CALL_BYTES) {
    const groups: Note[][] = []; let group: Note[] = [];
    for (const note of notes) {
      if (group.length && (group.length === 4 || payloadSize([...group, note]) > ANALYSIS_CALL_BYTES)) { groups.push(group); group = []; }
      group.push(note);
    }
    if (group.length) groups.push(group);
    if (groups.length >= notes.length) throw new LongAnalysisError("摘要无法在处理预算内继续合并，已停止且保留完成摘要。");
    const merged: Note[] = [];
    for (let index = 0; index < groups.length; index++) {
      options.phase(`原文分段已完成 · 正在汇总第 ${level} 层 ${index + 1}/${groups.length}`);
      const group = groups[index];
      if (group.length === 1) { merged.push(group[0]); continue; }
      const note = await extract("merge", { notes: noteInput(group) }, noteCatalog(group));
      note.unknowns.forEach(item => sourceUnknowns.add(item));
      merged.push(note);
    }
    notes = merged; level++;
  }
  options.phase(`已完成 ${batches.length}/${batches.length} 批原文读取 · 正在生成统一大纲与方向`);
  const finalCatalog = noteCatalog(notes);
  const selected = await boundedCall("根据全部分段提取并逐层合并的研究摘要形成统一拆解大纲和2至5个原创方向。你看到的是摘要，不得声称自己直接逐字读过全部原文。outline包括真相、因果时间线、人物关系、信息分配、证据链、轮次节奏，区分明确事实、分析推断与待定事项。跨片段矛盾保留为unknowns，方向重建人物、动机、事件因果和线索，不只换名。sourceRefIds只选择本次输入摘要已有的citationId；不输出摘录与位置，程序将精确回填。", { notes: noteInput(notes), instructions: data.instructions }, analysisSelectionSchema, 8192);
  const { sourceRefIds, ...content } = selected;
  const analysis: StudioAnalysis = { ...content, sourceRefs: selectedReferences(sourceRefIds, finalCatalog) };
  // Coverage describes submitted source coverage, never semantic correctness or playtest validation.
  const unknowns = [...new Set([...analysis.unknowns, ...sourceUnknowns])];
  return { ...analysis, unknowns: [...unknowns.slice(0, 99), `本大纲通过分段提取和摘要汇总形成，跨角色关联与细节仍需结合原文复核。${unknowns.length > 99 ? `另有${unknowns.length - 99}项分段待核对事项未在此展开，不能据此认定问题已解决。` : ""}`], coverage: { method: "segmented", documents: data.documents.length, parts: batches.length } };
}
