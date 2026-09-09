import { z } from "zod";

export const MODEL_RESPONSE_POLICY_VERSION = "openai-json/3-model-limits";
export const MODEL_EVALUATION_TASK_VERSION = "juben-model-eval/1.1";

export const responseDiagnosticSchema = z.object({
  finishReason: z.enum(["stop", "length", "other", "missing"]),
  contentCharacters: z.number().int().nonnegative(),
  reasoningCharacters: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  requestedOutputTokens: z.number().int().positive(),
  reasoningEffort: z.literal("low").optional(),
  timeoutMs: z.number().int().positive().optional(),
}).strict();

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
  responseDiagnostic: responseDiagnosticSchema.optional(),
}).strict();
export type TaskEvaluationResult = z.infer<typeof taskEvaluationResultSchema>;

export const modelAllocationSchema = z.object({ mainModel: text(200), reviewA: text(200), reviewB: text(200) }).strict()
  .refine(value => new Set([value.mainModel, value.reviewA, value.reviewB]).size === 3, "三个创作角色必须使用不同模型");
export type ModelAllocation = z.infer<typeof modelAllocationSchema>;

export const excludedModelSchema = z.object({ modelId: text(200), displayName: text(300), reason: text(500), costFen: z.number().int().nonnegative().nullable(), usageEstimated: z.boolean(), occurredAt: z.number().int().nonnegative(), responseDiagnostic: responseDiagnosticSchema.optional() }).strict();
export type ExcludedModel = z.infer<typeof excludedModelSchema>;

export const evaluationViewSchema = z.object({
  status: z.enum(["idle", "discovered", "running", "cancelling", "completed", "cancelled", "blocked", "failed"]),
  phase: z.string().max(1000), connectionRevision: z.number().int().nonnegative(), priceCheckedAt: z.number().int().nonnegative().nullable(), updatedAt: z.number().int().nonnegative(), budgetCapFen: z.literal(1000), spentFen: z.number().int().nonnegative(),
  reservedFen: z.number().int().nonnegative(), uncertainFen: z.number().int().nonnegative(),
  candidates: z.array(modelCandidateSchema).max(4), scores: z.array(modelScoreSchema).max(4), taskResults: z.array(taskEvaluationResultSchema).max(48).default([]).refine(items => new Set(items.map(item => `${item.modelId}:${item.taskIndex}`)).size === items.length, "测评题目结果不能重复"), excludedModels: z.array(excludedModelSchema).max(16).default([]).refine(items => new Set(items.map(item => item.modelId)).size === items.length, "排除模型不能重复"), allocation: modelAllocationSchema.nullable(),
  completedCalls: z.number().int().nonnegative(), maximumCalls: z.number().int().nonnegative(), plannedMaximumFen: z.number().int().nonnegative(), resumeCount: z.number().int().nonnegative().default(0), resumeAllowed: z.boolean().default(true), viewRevision: z.number().int().nonnegative().default(0),
  taskVersion: z.string().trim().min(1).max(100).nullable().default(null), startedAt: z.number().int().nonnegative().nullable().default(null), finishedAt: z.number().int().nonnegative().nullable().default(null),
  candidatePolicyVersion: z.string().trim().min(1).max(100).nullable().default(null),
  responsePolicyVersion: z.string().trim().min(1).max(100).nullable().default(null),
  archivedViewRevision: z.number().int().nonnegative().nullable().default(null),
  carriedBudget: z.object({ spentFen: z.number().int().nonnegative(), uncertainFen: z.number().int().nonnegative() }).strict().nullable().default(null),
  activeRequest: z.object({ modelId: text(200), startedAt: z.number().int().nonnegative(), timeoutMs: z.number().int().positive() }).strict().nullable().optional(),
  lastFailure: z.object({ modelId: text(200).nullable(), taskIndex: z.number().int().min(0).max(2).nullable(), category: z.enum(["service", "response", "usage", "budget"]), code: z.enum(["local", "timeout", "network", "auth", "rate_limit", "upstream", "request", "response", "cancelled"]).optional(), elapsedMs: z.number().int().nonnegative().optional(), occurredAt: z.number().int().nonnegative() }).strict().nullable().default(null),
  error: z.string().max(2000).nullable(),
});
export type EvaluationView = z.infer<typeof evaluationViewSchema>;

export function evaluationSummary(view: EvaluationView) {
  if (view.status === "running" || view.status === "cancelling") return view.phase;
  if (view.status === "completed" && view.allocation) return "测评完成，三个模型已分配";
  if (view.status === "blocked") return `本轮已停止；${view.scores.length}个模型完成三题，尚未完成模型分配`;
  if (view.status === "cancelled") return "本轮已取消，结果已保留";
  return view.phase;
}

export function exclusionExplanation(item: ExcludedModel, view: EvaluationView) {
  if (item.reason.includes("旧版严格解析")) return "历史记录：旧版解析失败；未保存具体字段，不能确定模型本身是否不兼容";
  if (/自动替补候选|等待新版分批/.test(item.reason)) return view.status === "running"
    ? "历史回答曾被截断，暂列替补；只有需要替补时才会测试"
    : "历史回答曾被截断；本轮已经停止，不会自动再测";
  if (/最多比较4个模型|已取得三个合格模型/.test(item.reason)) return item.reason.replace("length", "长度");
  if (/length|被截断/.test(item.reason)) return item.responseDiagnostic
    ? `回答达到长度限制而被截断（本次上限${item.responseDiagnostic.requestedOutputTokens} Token）；未取得完整答案`
    : view.responsePolicyVersion === MODEL_RESPONSE_POLICY_VERSION
      ? "回答被截断；旧记录未保存本次请求上限，不能确定属于哪次长度设置"
      : "回答达到旧版长度上限，正文被截断；不是模型损坏";
  if (item.reason.includes("没有返回可评分")) return "服务返回了结果，但最终答案为空；本题无法评分";
  return item.reason;
}

export function priceLabel(microCnyPerMillion: number) { return `¥${(microCnyPerMillion / 1_000_000).toFixed(2)}/百万Token`; }

// These are request settings, not an assertion of model quality or provider availability.
export function evaluationResponseProfile(modelId: string) {
  if (modelId === "deepseek-v4-pro-0813") return { maxTokens: 16384, timeoutMs: 240000 };
  if (modelId === "kimi-k3") return { maxTokens: 8192, timeoutMs: 240000, reasoningEffort: "low" as const };
  return { maxTokens: 4096, timeoutMs: 90000 };
}
export function responseRepairModelIds(view: EvaluationView): string[] {
  if (view.responsePolicyVersion !== "openai-json/2-4096" || view.taskVersion !== MODEL_EVALUATION_TASK_VERSION ||
    !["blocked", "failed", "cancelled"].includes(view.status) || view.reservedFen !== 0 ||
    ["usage", "budget"].includes(view.lastFailure?.category ?? "")) return [];
  return ["deepseek-v4-pro-0813", "kimi-k3"].filter(id => !view.scores.some(score => score.modelId === id) && (
    view.excludedModels.some(item => item.modelId === id && item.costFen != null && /length|被截断/.test(item.reason)) ||
    view.lastFailure?.modelId === id && view.lastFailure.category === "service"
  ));
}
export function evaluationErrorMessage(view: EvaluationView) {
  if (view.error?.includes("请检查蚂蚁平台额度和模型权限") && !view.lastFailure?.code)
    return "上次请求未完整返回；旧记录未保存具体异常，无法据此判断余额或权限问题。";
  return view.error;
}
