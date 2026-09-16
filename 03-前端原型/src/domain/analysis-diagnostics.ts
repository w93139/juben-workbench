import { z } from "zod";

const count = z.number().int().nonnegative();
export const analysisStepSchema = z.object({
  stage: z.enum(["direct", "part", "merge", "final"]),
  index: count, total: count, level: count,
}).strict();
export type AnalysisStep = z.infer<typeof analysisStepSchema>;
export const analysisParametersSchema = z.object({
  model: z.string().max(200), max_tokens: z.number().int().positive(),
  response_format: z.object({ type: z.literal("json_object") }).strict(),
  reasoning_effort: z.literal("low").optional(),
}).strict();
export type AnalysisParameters = z.infer<typeof analysisParametersSchema>;
export const analysisUsageSchema = z.object({
  promptTokens: count.nullable(), completionTokens: count.nullable(), totalTokens: count.nullable(), reasoningTokens: count.nullable(),
}).strict();
export const analysisCallSchema = z.object({
  jobId: z.string().uuid(), sequence: count, step: analysisStepSchema,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/), parameters: analysisParametersSchema,
  returnedModel: z.string().max(200).nullable(), requestBytes: count,
  startedAt: count, elapsedMs: count, timeoutMs: count,
  status: z.enum(["reserved", "completed", "failed"]),
  httpStatus: count.nullable(), providerRequestId: z.string().max(200).nullable(),
  finishReason: z.enum(["stop", "length", "content_filter", "tool_calls", "function_call", "other"]).nullable(),
  responseBodyBytes: count.nullable(), contentCharacters: count.nullable(),
  usage: analysisUsageSchema,
  failure: z.enum(["http", "timeout", "incomplete", "response_json", "envelope", "empty_content", "content_json", "schema", "reference", "response_limit", "network", "host", "persistence", "other"]).nullable(),
  issues: z.array(z.object({ path: z.string().max(200), code: z.string().max(80) }).strict()).max(8),
}).strict();
export type AnalysisCallDiagnostic = z.infer<typeof analysisCallSchema>;
const metric = z.object({ known: count, missingCalls: count }).strict();
export const analysisPlanSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), documents: count, inputBytes: count,
  mode: z.enum(["direct", "segmented"]), parts: count, blankParts: count,
  partCacheHits: count, partCacheMisses: count,
  nominalMergeCallsByLevel: z.array(count),
  newCallsMinimum: count, newCallsMaximum: count, mergeCacheKnown: z.literal(false),
  uncertainty: z.array(z.string().max(300)).max(8),
  callLimit: z.number().int().min(1).max(1024),
  parameters: z.object({ direct: analysisParametersSchema, part: analysisParametersSchema, merge: analysisParametersSchema, final: analysisParametersSchema }).strict(),
  timeoutMs: count,
  cost: z.object({ status: z.literal("unknown"), estimatedFen: z.null(), actualFen: z.null() }).strict(),
}).strict();
export type AnalysisPlan = z.infer<typeof analysisPlanSchema>;
export const analysisDiagnosticsSchema = z.object({
  version: z.literal(1), plan: analysisPlanSchema,
  calls: z.array(analysisCallSchema).max(1024),
  cacheHits: z.array(analysisStepSchema).max(2048),
  usage: z.object({ promptTokens: metric, completionTokens: metric, totalTokens: metric, reasoningTokens: metric }).strict(),
  persistenceWarning: z.boolean(),
}).strict();
export type AnalysisDiagnostics = z.infer<typeof analysisDiagnosticsSchema>;
