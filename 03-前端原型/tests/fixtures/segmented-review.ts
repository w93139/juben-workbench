import { buildReviewPlan, prepareReviewScopes } from "../../src/server/review-plan";
import { scopedStages, scopedUnitId } from "../../src/domain/review-plan";
import type { SegmentedReview, StudioScopedAudit } from "../../src/domain/studio";
import { reviewArtifacts, reviewAudit, reviewBlueprint, reviewCheckpoint } from "./studio-review";

export function segmentedFixture() {
  const blueprint = reviewBlueprint(), artifacts = reviewArtifacts();
  const plan = buildReviewPlan(blueprint, artifacts, { partBytes: 20 }), read = prepareReviewScopes(plan, blueprint, artifacts);
  const segmented: SegmentedReview = { plan, units: [...plan.parts, ...plan.links].flatMap(scope => scopedStages.map(stage => {
    const payload = read(scope.id);
    const report: StudioScopedAudit = { ...reviewAudit(), summary: `${scope.id}的${stage}原始报告`, coverage: payload.sources.map(source => ({ partId: source.partId, hash: source.hash, quote: source.content })) };
    return { id: scopedUnitId(scope.id, stage), scopeId: scope.id, stage, state: "saved", report, issues: [] };
  })) };
  const checkpoint = reviewCheckpoint(); checkpoint.review.artifacts = artifacts; checkpoint.review.segmented = segmented;
  checkpoint.review.reports = { designGate: reviewAudit() }; checkpoint.steps.forEach(step => step.state = "saved");
  return { blueprint, artifacts, segmented, checkpoint };
}
