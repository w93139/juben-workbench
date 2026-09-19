import type { BlueprintData } from "@/domain/blueprint";
import { scopedStages, scopedUnitId, type ReviewPlan } from "@/domain/review-plan";
import type { StudioArtifact, StudioAudit } from "@/domain/studio";
import { LocalApiError } from "./local-security";
import { SCOPED_REPORT_BYTES } from "./segmented-review";
import { SEGMENTED_REPORT_PATH, STUDIO_ZIP_BYTES, studioExportFiles, studioZipBytes } from "./studio-export-files";

export function reviewDeliveryUpperBound(plan: ReviewPlan, blueprint: BlueprintData, artifacts: StudioArtifact[], designGate: StudioAudit) {
  const files = studioExportFiles({ blueprint, blueprintFingerprint: plan.blueprintHash, artifacts, reports: { designGate }, humanPlaytest: "not-run" }, "作".repeat(80), "00000000-0000-4000-8000-000000000000", "2000-01-01T00:00:00.000Z");
  let segmentedBytes = Buffer.byteLength(JSON.stringify({ plan, units: [] }));
  for (const scope of [...plan.parts, ...plan.links]) for (const stage of scopedStages) {
    segmentedBytes += Buffer.byteLength(JSON.stringify({ id: scopedUnitId(scope.id, stage), scopeId: scope.id, stage, state: "saved", report: null, issues: [] })) - 4 + SCOPED_REPORT_BYTES;
  }
  segmentedBytes += plan.callsMax - 1; // commas between all unit objects
  // The five computed summaries retain one evidence item each; reserve a full report budget each,
  // plus pretty-JSON envelope whitespace. This is intentionally an upper bound, not an estimate.
  return studioZipBytes(files) + segmentedBytes + 76 + 2 * Buffer.byteLength(SEGMENTED_REPORT_PATH) + 5 * SCOPED_REPORT_BYTES + 10_000;
}
export function assertReviewDeliveryCapacity(plan: ReviewPlan, blueprint: BlueprintData, artifacts: StudioArtifact[], designGate: StudioAudit, limit = STUDIO_ZIP_BYTES) {
  const upper = reviewDeliveryUpperBound(plan, blueprint, artifacts, designGate);
  if (upper > limit) throw new LocalApiError(413, "完整正文与全部原始审查报告的保守体积超过64 MiB导出上限，尚未发起分段审查。已生成正文和此前费用保留；请调整创作规模后重新生成，不能靠截断报告获得通过。");
  return upper;
}
