import { artifactBundleSchema, studioAuditSchema, studioReviewProgressSchema, type StudioReviewProgress } from "@/domain/studio";
import { reviewUnits } from "@/domain/studio-production";
import type { StudioProductionStore } from "./studio-production-store";

export function hydrateReviewProgress(base: StudioReviewProgress, snapshot: ReturnType<StudioProductionStore["snapshot"]>, jobId: string, running: boolean): StudioReviewProgress {
  const review = structuredClone(base.review);
  review.artifacts = []; review.reports = {};
  review.issues = ["生成与审查尚未完成，当前成果不能用于通过导出。"];
  for (const unit of snapshot.units) {
    if (unit.value === undefined) continue;
    if (unit.id === "artifacts") review.artifacts = artifactBundleSchema.parse(unit.value).artifacts;
    else review.reports[unit.id] = studioAuditSchema.parse(unit.value);
    review.issues.push(...unit.issues);
  }
  return studioReviewProgressSchema.parse({ runId: snapshot.runId, revision: snapshot.revision, review,
    steps: reviewUnits.map(definition => {
      const unit = snapshot.units.find(item => item.id === definition.id);
      return { id: definition.id, state: !unit ? "pending" : unit.saved ? "saved" : unit.jobId === jobId && running && !unit.issues.length ? "running" : "interrupted" };
    }),
  });
}
