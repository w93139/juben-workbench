import { ANALYSIS_CALL_BYTES, ANALYSIS_DIRECT_BYTES, ANALYSIS_EXTRACT_TOKENS, ANALYSIS_INPUT_BYTES, SINGLE_CONTEXT_BYTES } from "@/domain/analysis-limits";
import { evaluationResponseProfile } from "@/domain/model-evaluation";
import { studioInputs, studioAnalysisSchema, studioAuditSchema, studioArtifactSchema, studioScopedAuditSchema, type StudioOperation } from "@/domain/studio";
import { blueprintDataSchema } from "@/domain/blueprint";
import { studioCostPreviewSchema } from "@/domain/studio-budget";
import { analysisBatches, analysisSelectionSchema, sourceSelectionSchema } from "./long-analysis";
import { StudioBilling, studioExecutionFingerprint, studioInputFingerprint, studioProductionKey } from "./studio-billing";
import type { StudioProductionStore } from "./studio-production-store";
import { buildArtifactPlan, artifactPlanDigest } from "./artifact-plan";
import { inspectProductionReuse } from "./studio-review-requests";
import { studioRequestBytesCeiling, type StudioConfig } from "./studio-models";
import { LocalApiError } from "./local-security";
import { reserveQuotedFen } from "./studio-pricing";
import { reviewPlanDigest } from "./review-plan";
import { reviewApprovalFingerprint } from "./segmented-review";

/** Budget ceiling planning, not a forecast of semantic work or an invoice. Execution reserves exact requests. */
export async function previewStudioCost(billing: StudioBilling, config: StudioConfig, projectId: string, operation: StudioOperation, input: unknown, production?: StudioProductionStore) {
  const parsed = studioInputs[operation].safeParse(input);
  if (!parsed.success) throw new LocalApiError(400, "当前资料不完整，无法估算本步骤。");
  const inputBytes = Buffer.byteLength(JSON.stringify(parsed.data));
  if (inputBytes > (operation === "analyze" ? ANALYSIS_INPUT_BYTES : SINGLE_CONTEXT_BYTES)) throw new LocalApiError(413, "输入超过本步骤容量，未发起模型调用。");
  const plan = operation === "review" ? buildArtifactPlan(studioInputs.review.parse(parsed.data).blueprint) : undefined;
  const budget = billing.ledger.snapshot(projectId);
  if (!budget) throw new LocalApiError(409, "请先设置本项目的创作预算。");
  if (budget.uncertainCalls || budget.overrunFen) throw new LocalApiError(409, "项目存在待核对或超额费用，请先处理费用记录。");
  const models = operation === "review" ? [config.mainModel, config.reviewA, config.reviewB] : [config.mainModel];
  const quotes = await billing.prices.get(config.baseUrl, models);
  const inputFingerprint = studioInputFingerprint(projectId, operation, JSON.stringify(parsed.data));
  const executionFingerprint = studioExecutionFingerprint(config, operation, plan ? artifactPlanDigest(plan) : "");
  const saved = operation === "review" ? production?.find(studioProductionKey(inputFingerprint, executionFingerprint)) : undefined;
  const scopes = saved?.reviewPlan ? saved.reviewPlan.callsMax / 5 : undefined;
  let callsMax = operation === "review" ? plan!.targets.length + (scopes === undefined ? 6 : 1 + scopes * 5) : 1;
  let contextLimit = operation === "review" ? SINGLE_CONTEXT_BYTES : inputBytes;
  if (operation === "analyze" && inputBytes > ANALYSIS_DIRECT_BYTES) {
    const count = analysisBatches(studioInputs.analyze.parse(input).documents).length;
    // Each merge must reduce the note count. At most N-1 merges plus a final call.
    callsMax = Math.max(1, count * 2); contextLimit = ANALYSIS_CALL_BYTES;
  }
  const schemas = operation === "analyze" ? [studioAnalysisSchema, sourceSelectionSchema, analysisSelectionSchema]
    : operation === "blueprint" ? [blueprintDataSchema] : [studioAuditSchema, studioArtifactSchema, studioScopedAuditSchema];
  const requestCeiling = studioRequestBytesCeiling(contextLimit, schemas);
  const perModel = quotes.map(quote => reserveQuotedFen(quote, requestCeiling, Math.max(evaluationResponseProfile(quote.modelId).maxTokens, operation === "analyze" ? ANALYSIS_EXTRACT_TOKENS : 0)));
  const estimateFen = operation === "review" ? perModel[0] * (plan!.targets.length + (scopes === undefined ? 2 : 1 + scopes)) + perModel[1] * (scopes === undefined ? 2 : scopes * 2) + perModel[2] * (scopes === undefined ? 2 : scopes * 2) : perModel[0] * callsMax;
  const checkpoint = plan ? inspectProductionReuse(plan, saved, studioInputs.review.parse(parsed.data).blueprint, config) : undefined;
  const previewId = billing.ledger.preparePreview(projectId, budget.revision, inputFingerprint, reviewApprovalFingerprint(executionFingerprint, saved?.reviewPlan ? reviewPlanDigest(saved.reviewPlan) : undefined));
  return studioCostPreviewSchema.parse({ projectId, operation, budget, quotes, callsMax, estimateFen, previewId, ...(operation === "review" ? { reviewMode: saved?.reviewPlan ? "segmented" : "generation" } : {}), ...(checkpoint ? { checkpoint } : {}) });
}
