import { createHash } from "node:crypto";
import { z } from "zod";
import { studioAnalysisSchema, type StudioAnalysis } from "@/domain/studio";

export const ANALYSIS_BATCH_BYTES = 180000;
const SEGMENT_BYTES = 120000;
const NOTE_BYTES = 90000;
const VERSION = "source-analysis/1";
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
type Document = { id: string; name: string; text: string };
export type Segment = { documentId: string; name: string; start: number; end: number; text: string };
export const sourceNoteSchema = z.object({
  summary: z.string().trim().min(1).max(8000),
  sourceRefs: z.array(z.object({ documentId: z.string().min(1).max(120), location: z.string().min(1).max(300), quote: z.string().trim().min(1).max(600) }).strict()).min(1).max(8),
  unknowns: z.array(z.string().min(1).max(600)).max(8),
}).strict();
type Note = z.infer<typeof sourceNoteSchema>;
export class LongAnalysisError extends Error {}

/** Exact UTF-16 source ranges; never split a surrogate pair or remove whitespace. */
export function analysisBatches(documents: Document[]): Segment[][] {
  const batches: Segment[][] = []; let batch: Segment[] = [];
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
      if (batch.length && size([...batch, segment]) > ANALYSIS_BATCH_BYTES) { batches.push(batch); batch = []; }
      batch.push(segment); start = end;
    }
  }
  if (batch.length) batches.push(batch);
  if (batches.length > 128) throw new LongAnalysisError("材料分段数量超过本轮处理上限，尚未调用模型。请联系维护者调整长剧本处理方案。");
  return batches;
}

type Call = <T>(instructions: string, payload: unknown, schema: z.ZodType<T>) => Promise<T>;
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
  let notes: Note[] = [];
  const sourceUnknowns = new Set<string>();
  async function extract(kind: "part" | "merge", payload: unknown, references: (ref: Note["sourceRefs"][number]) => boolean) {
    const key = createHash("sha256").update(JSON.stringify({ version: VERSION, model: options.modelIdentity, kind, instructions: data.instructions, payload })).digest("hex");
    const cached = options.readCheckpoint?.(key);
    if (cached != null) {
      const parsed = sourceNoteSchema.safeParse(cached);
      if (!parsed.success) throw new LongAnalysisError("已保存的分段摘要无法读取，未重复调用模型。请检查本机任务记录。");
      validateNote(parsed.data, references); return parsed.data;
    }
    const prompt = kind === "part"
      ? "这是完整原剧本的一批原文片段，不是全部故事。逐段读取，不把缺少后文当作故事事实。summary保留真相/时间因果、角色关系与私人认知、关键线索、轮次机制和跨片段待核对关系，区分明确事实与推断。不要提出原创方向。sourceRefs摘录此批原文并使用原始documentId，location注明文件与start/end字符范围。unknowns保留矛盾、缺失和暂不能确定的事项。只输出紧凑JSON摘要，不复制整段原文。"
      : "合并以下全部分段研究摘要，不是重新阅读全部原文。保留人物同一性、事件先后与因果、信息差、线索到结论、轮次节奏及跨片段矛盾；不能用后出现的断言静默覆盖旧矛盾。区分原文事实与推断，丢失细节或冲突写unknowns。sourceRefs只能原样选用输入已有documentId、quote和location，不编造引用。不要提出原创方向。输出紧凑JSON摘要。";
    const note = await options.call(prompt, { ...payload as object, instructions: data.instructions }, sourceNoteSchema);
    validateNote(note, references);
    options.writeCheckpoint?.(key, note);
    return note;
  }
  for (let index = 0; index < batches.length; index++) {
    options.phase(`正在分段读取 ${index + 1}/${batches.length} · 已完成 ${index} 批`);
    const segments = batches[index];
    const note = await extract("part", { segments }, ref => segments.some(segment => segment.documentId === ref.documentId && segment.text.includes(ref.quote)));
    note.unknowns.forEach(item => sourceUnknowns.add(item));
    notes.push({ ...note, sourceRefs: note.sourceRefs.map(ref => {
      const segment = segments.find(item => item.documentId === ref.documentId && item.text.includes(ref.quote))!;
      const start = segment.start + segment.text.indexOf(ref.quote);
      return { ...ref, location: `字符 ${start + 1}–${start + ref.quote.length}` };
    }) });
  }
  let level = 1;
  while (notes.length > 4) {
    const merged: Note[] = [];
    for (let offset = 0; offset < notes.length; offset += 4) {
      options.phase(`原文分段已完成 · 正在汇总第 ${level} 层 ${Math.floor(offset / 4) + 1}/${Math.ceil(notes.length / 4)}`);
      const group = notes.slice(offset, offset + 4);
      if (group.length === 1) { merged.push(group[0]); continue; }
      const note = await extract("merge", { notes: group }, ref => group.some(item => item.sourceRefs.some(original => original.documentId === ref.documentId && original.quote === ref.quote && original.location === ref.location)));
      note.unknowns.forEach(item => sourceUnknowns.add(item));
      merged.push(note);
    }
    notes = merged; level++;
  }
  options.phase(`已完成 ${batches.length}/${batches.length} 批原文读取 · 正在生成统一大纲与方向`);
  const analysis = await options.call("根据全部分段提取并逐层合并的研究摘要形成统一拆解大纲和2至5个原创方向。你看到的是摘要，不得声称自己直接逐字读过全部原文。outline包括真相、因果时间线、人物关系、信息分配、证据链、轮次节奏，区分明确事实、分析推断与待定事项。跨片段矛盾保留为unknowns，方向重建人物、动机、事件因果和线索，不只换名。sourceRefs只能使用输入摘要已有documentId/quote/location。", { notes, instructions: data.instructions }, studioAnalysisSchema);
  if (!analysis.sourceRefs.every(ref => notes.some(note => note.sourceRefs.some(original => original.documentId === ref.documentId && original.quote === ref.quote && original.location === ref.location)))) throw new LongAnalysisError("汇总大纲的来源引用与分段摘要不一致，结果未采纳；已完成的摘要保留。");
  // Coverage describes submitted source coverage, never semantic correctness or playtest validation.
  const unknowns = [...new Set([...analysis.unknowns, ...sourceUnknowns])];
  return { ...analysis, unknowns: [...unknowns.slice(0, 99), `本大纲通过分段提取和摘要汇总形成，跨角色关联与细节仍需结合原文复核。${unknowns.length > 99 ? `另有${unknowns.length - 99}项分段待核对事项未在此展开，不能据此认定问题已解决。` : ""}`], coverage: { method: "segmented", documents: data.documents.length, parts: batches.length } };
}
