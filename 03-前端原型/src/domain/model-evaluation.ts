import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
export const modelCandidateSchema = z.object({
  id: text(200), displayName: text(300), provider: text(120), contextLength: z.number().int().nonnegative().nullable(),
  inputPriceMicroCnyPerMillion: z.number().int().nonnegative(), outputPriceMicroCnyPerMillion: z.number().int().nonnegative(),
}).strict();
export type ModelCandidate = z.infer<typeof modelCandidateSchema>;

export const modelScoreSchema = z.object({
  modelId: text(200), total: z.number().int().min(0).max(100), structure: z.number().int().min(0).max(100),
  evidence: z.number().int().min(0).max(100), originality: z.number().int().min(0).max(100), format: z.number().int().min(0).max(100),
  latencyMs: z.number().int().nonnegative(), promptTokens: z.number().int().nonnegative(), completionTokens: z.number().int().nonnegative(),
  costFen: z.number().int().nonnegative(), usageEstimated: z.boolean().default(false), notes: z.array(text(500)).max(20),
}).strict();
export type ModelScore = z.infer<typeof modelScoreSchema>;

export const taskEvaluationResultSchema = z.object({
  modelId: text(200), taskIndex: z.number().int().min(0).max(2), structure: z.number().int().min(0).max(100),
  evidence: z.number().int().min(0).max(100), originality: z.number().int().min(0).max(100), format: z.number().int().min(0).max(100),
  latencyMs: z.number().int().nonnegative(), promptTokens: z.number().int().nonnegative(), completionTokens: z.number().int().nonnegative(),
  costFen: z.number().int().nonnegative(), usageEstimated: z.boolean(), notes: z.array(text(500)).max(20),
}).strict();
export type TaskEvaluationResult = z.infer<typeof taskEvaluationResultSchema>;

export const modelAllocationSchema = z.object({ mainModel: text(200), reviewA: text(200), reviewB: text(200) }).strict()
  .refine(value => new Set([value.mainModel, value.reviewA, value.reviewB]).size === 3, "三个创作角色必须使用不同模型");
export type ModelAllocation = z.infer<typeof modelAllocationSchema>;

export const excludedModelSchema = z.object({ modelId: text(200), displayName: text(300), reason: text(500), costFen: z.number().int().nonnegative().nullable(), usageEstimated: z.boolean(), occurredAt: z.number().int().nonnegative() }).strict();
export type ExcludedModel = z.infer<typeof excludedModelSchema>;

export const evaluationViewSchema = z.object({
  status: z.enum(["idle", "discovered", "running", "cancelling", "completed", "cancelled", "blocked", "failed"]),
  phase: z.string().max(1000), connectionRevision: z.number().int().nonnegative(), priceCheckedAt: z.number().int().nonnegative().nullable(), updatedAt: z.number().int().nonnegative(), budgetCapFen: z.literal(1000), spentFen: z.number().int().nonnegative(),
  reservedFen: z.number().int().nonnegative(), uncertainFen: z.number().int().nonnegative(),
  candidates: z.array(modelCandidateSchema).max(4), scores: z.array(modelScoreSchema).max(4), taskResults: z.array(taskEvaluationResultSchema).max(48).default([]).refine(items => new Set(items.map(item => `${item.modelId}:${item.taskIndex}`)).size === items.length, "测评题目结果不能重复"), excludedModels: z.array(excludedModelSchema).max(16).default([]).refine(items => new Set(items.map(item => item.modelId)).size === items.length, "排除模型不能重复"), allocation: modelAllocationSchema.nullable(),
  completedCalls: z.number().int().nonnegative(), maximumCalls: z.number().int().nonnegative(), plannedMaximumFen: z.number().int().nonnegative(), resumeCount: z.number().int().nonnegative().default(0), resumeAllowed: z.boolean().default(true), viewRevision: z.number().int().nonnegative().default(0),
  taskVersion: z.string().trim().min(1).max(100).nullable().default(null), startedAt: z.number().int().nonnegative().nullable().default(null), finishedAt: z.number().int().nonnegative().nullable().default(null),
  lastFailure: z.object({ modelId: text(200).nullable(), taskIndex: z.number().int().min(0).max(2).nullable(), category: z.enum(["service", "response", "usage", "budget"]), occurredAt: z.number().int().nonnegative() }).strict().nullable().default(null),
  error: z.string().max(2000).nullable(),
});
export type EvaluationView = z.infer<typeof evaluationViewSchema>;

export function priceLabel(microCnyPerMillion: number) { return `¥${(microCnyPerMillion / 1_000_000).toFixed(2)}/百万Token`; }
