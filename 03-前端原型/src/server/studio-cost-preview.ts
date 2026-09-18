import { ANALYSIS_CALL_BYTES, ANALYSIS_DIRECT_BYTES, ANALYSIS_INPUT_BYTES, SINGLE_CONTEXT_BYTES } from "@/domain/analysis-limits";
import { evaluationResponseProfile } from "@/domain/model-evaluation";
import { studioInputs, studioAnalysisSchema, studioAuditSchema, type StudioOperation } from "@/domain/studio";
import { blueprintDataSchema } from "@/domain/blueprint";
import { studioCostPreviewSchema } from "@/domain/studio-budget";
import { analysisBatches, analysisSelectionSchema, sourceSelectionSchema } from "./long-analysis";
import { StudioBilling, studioConfigFingerprint, studioInputFingerprint } from "./studio-billing";
import { artifactBundleSchema, studioRequestBytesCeiling, type StudioConfig } from "./studio-models";
import { LocalApiError } from "./local-security";
import { reserveQuotedFen } from "./studio-pricing";

/** Budget ceiling planning, not a forecast of semantic work or an invoice. Execution reserves exact requests. */
export async function previewStudioCost(billing: StudioBilling, config: StudioConfig, projectId: string, operation: StudioOperation, input: unknown) {
  const parsed = studioInputs[operation].safeParse(input);
  if (!parsed.success) throw new LocalApiError(400, "当前资料不完整，无法估算本步骤。");
  const inputBytes = Buffer.byteLength(JSON.stringify(parsed.data));
  if (inputBytes > (operation === "analyze" ? ANALYSIS_INPUT_BYTES : SINGLE_CONTEXT_BYTES)) throw new LocalApiError(413, "输入超过本步骤容量，未发起模型调用。");
  const budget = billing.ledger.snapshot(projectId);
  if (!budget) throw new LocalApiError(409, "请先设置本项目的创作预算。");
  if (budget.uncertainCalls || budget.overrunFen) throw new LocalApiError(409, "项目存在待核对或超额费用，请先处理费用记录。");
  const models = operation === "review" ? [config.mainModel, config.reviewA, config.reviewB] : [config.mainModel];
  const quotes = await billing.prices.get(config.baseUrl, models);
  let callsMax = operation === "review" ? 7 : 1;
  let contextLimit = operation === "review" ? SINGLE_CONTEXT_BYTES : inputBytes;
  if (operation === "analyze" && inputBytes > ANALYSIS_DIRECT_BYTES) {
    const count = analysisBatches(studioInputs.analyze.parse(input).documents).length;
    // Each merge must reduce the note count. At most N-1 merges plus a final call.
    callsMax = Math.max(1, count * 2); contextLimit = ANALYSIS_CALL_BYTES;
  }
  const schemas = operation === "analyze" ? [studioAnalysisSchema, sourceSelectionSchema, analysisSelectionSchema]
    : operation === "blueprint" ? [blueprintDataSchema] : [studioAuditSchema, artifactBundleSchema];
  const requestCeiling = studioRequestBytesCeiling(contextLimit, schemas);
  const perModel = quotes.map(quote => reserveQuotedFen(quote, requestCeiling, Math.max(evaluationResponseProfile(quote.modelId).maxTokens, operation === "analyze" ? 8192 : 0)));
  const estimateFen = operation === "review" ? perModel[0] * 3 + perModel[1] * 2 + perModel[2] * 2 : perModel[0] * callsMax;
  const previewId = billing.ledger.preparePreview(projectId, budget.revision, studioInputFingerprint(projectId, operation, JSON.stringify(parsed.data)), studioConfigFingerprint(config));
  return studioCostPreviewSchema.parse({ projectId, operation, budget, quotes, callsMax, estimateFen, previewId });
}
