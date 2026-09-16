import { studioInputs } from "@/domain/studio";
import type { AnalysisPlan } from "@/domain/analysis-diagnostics";
import { ANALYSIS_DIRECT_BYTES, ANALYSIS_INPUT_BYTES } from "@/domain/analysis-limits";
import { evaluationResponseProfile } from "@/domain/model-evaluation";
import { analysisBatches, analysisCacheKey, citationSegments, sourceNoteSchema, validateNote } from "./long-analysis";
import { analysisParameters, DEFAULT_ANALYSIS_CALL_LIMIT, FINAL_OUTPUT_TOKENS, hash, PART_OUTPUT_TOKENS } from "./analysis-observation";

export function analysisCallLimit(value: unknown = process.env.STUDIO_ANALYSIS_MAX_CALLS): number {
  if (value === undefined) return DEFAULT_ANALYSIS_CALL_LIMIT;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 1024) throw new Error("拆解调用上限必须为 1–1024 的整数，未发起请求。");
  return number;
}
export const analysisModelIdentity = (baseUrl: string, model: string) => JSON.stringify({ baseUrl, model, profile: evaluationResponseProfile(model) });

/** Pure planning: readers must SELECT only; no model, task creation or cache cleanup. */
export function planAnalysis(input: unknown, options: { baseUrl: string; model: string; callLimit?: number; readCheckpoint?: (key: string) => unknown }): AnalysisPlan {
  const data = studioInputs.analyze.parse(input), inputBytes = Buffer.byteLength(JSON.stringify(data));
  if (inputBytes > ANALYSIS_INPUT_BYTES) throw new Error("拆解材料超过 12 MB，未发起请求。");
  const segmented = inputBytes > ANALYSIS_DIRECT_BYTES;
  const batches = segmented ? analysisBatches(data.documents) : [];
  const numbers = new Map(data.documents.map((doc, index) => [doc.id, index + 1]));
  if (numbers.size !== data.documents.length) throw new Error("材料编号重复，未发起请求。");
  let hits = 0, blank = 0;
  for (const batch of batches) {
    const source = citationSegments(batch, numbers);
    if (!source.catalog.size) { blank++; continue; }
    const key = analysisCacheKey(analysisModelIdentity(options.baseUrl, options.model), "part", data.instructions, { segments: source.input });
    const cached = options.readCheckpoint?.(key);
    if (cached != null) {
      const note = sourceNoteSchema.parse(cached);
      const refs = new Set([...source.catalog.values()].map(ref => JSON.stringify([ref.documentId, ref.location, ref.quote])));
      validateNote(note, ref => refs.has(JSON.stringify([ref.documentId, ref.location, ref.quote])));
      hits++;
    }
  }
  const parts = batches.length, effective = parts - blank, misses = effective - hits;
  const levels: number[] = [];
  for (let n = effective; n > 4; n = Math.ceil(n / 4)) levels.push(Math.floor(n / 4) + (n % 4 > 1 ? 1 : 0));
  return {
    fingerprint: hash(data), documents: data.documents.length, inputBytes, mode: segmented ? "segmented" : "direct",
    parts: segmented ? parts : 1, blankParts: blank, partCacheHits: hits, partCacheMisses: segmented ? misses : 0,
    nominalMergeCallsByLevel: levels, newCallsMinimum: segmented ? misses + 1 : 1,
    newCallsMaximum: segmented ? misses + Math.max(0, effective - 1) + 1 : 1, mergeCacheKnown: false,
    uncertainty: ["上下界以所有请求成功为条件；未来摘要大小、合并缓存及失败会改变实际调用数量。", "缓存按检查时的有效期读取，实际执行前仍会核对。", "费用与缺失的供应商用量未知；调用次数上限不等于金额上限。"],
    callLimit: analysisCallLimit(options.callLimit),
    parameters: { direct: analysisParameters(options.model), part: analysisParameters(options.model, PART_OUTPUT_TOKENS), merge: analysisParameters(options.model, PART_OUTPUT_TOKENS), final: analysisParameters(options.model, FINAL_OUTPUT_TOKENS) },
    timeoutMs: evaluationResponseProfile(options.model).timeoutMs, cost: { status: "unknown", estimatedFen: null, actualFen: null },
  };
}
