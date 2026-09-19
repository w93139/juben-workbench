import { artifactBundleSchema, studioArtifactSchema, studioAuditSchema, studioReviewProgressSchema, type StudioReviewProgress } from "@/domain/studio";
import { reviewUnits, type ReviewUnitId } from "@/domain/studio-production";
import { artifactPlanDigest } from "./artifact-plan";
import type { StudioProductionStore } from "./studio-production-store";
import { segmentedProgress, segmentedSummaries } from "./segmented-review";

export function hydrateReviewProgress(base: StudioReviewProgress, snapshot: ReturnType<StudioProductionStore["snapshot"]>, jobId: string, running: boolean): StudioReviewProgress {
  const review = structuredClone(base.review);
  review.artifacts = []; review.reports = {};
  delete review.segmented;
  review.issues = ["生成与审查尚未完成，当前成果不能用于通过导出。"];
  const state = (id: string) => {
    const unit = snapshot.units.find(item => item.id === id);
    return !unit ? "pending" as const : unit.saved ? "saved" as const : unit.jobId === jobId && running && !unit.issues.length ? "running" as const : "interrupted" as const;
  };
  for (const unit of snapshot.units) {
    if (unit.value === undefined) continue;
    if (unit.id.startsWith("sr-")) continue;
    if (snapshot.reviewPlan && unit.id !== "designGate" && unit.id !== "artifacts" && !unit.id.startsWith("gen-")) continue;
    if (snapshot.plan?.targets.some(target => target.id === unit.id)) continue;
    if (unit.id === "artifacts") { if (!snapshot.plan) review.artifacts = artifactBundleSchema.parse(unit.value).artifacts; }
    else review.reports[unit.id as Exclude<ReviewUnitId, "artifacts">] = studioAuditSchema.parse(unit.value);
    review.issues.push(...unit.issues);
  }
  if (snapshot.plan) for (const target of snapshot.plan.targets) {
    const unit = snapshot.units.find(item => item.id === target.id);
    if (unit?.value !== undefined) review.artifacts.push(studioArtifactSchema.parse(unit.value));
    review.issues.push(...(unit?.issues ?? []));
  }
  if (snapshot.reviewPlan) {
    review.segmented = segmentedProgress(snapshot.reviewPlan, snapshot, jobId, running);
    Object.assign(review.reports, segmentedSummaries(review.segmented));
    if (review.segmented.units.some(unit => unit.issues.length)) review.issues.push("分段报告有来源或覆盖契约问题，请查看对应原始报告。");
  }
  return studioReviewProgressSchema.parse({ runId: snapshot.runId, revision: snapshot.revision, review,
    ...(snapshot.plan ? { generation: { planHash: artifactPlanDigest(snapshot.plan), units: snapshot.plan.targets.map(target => ({ id: target.id, label: target.label, module: target.module, characterId: target.characterId, roundId: target.roundId, state: state(target.id) })) } } : {}),
    steps: reviewUnits.map(definition => {
      const units = review.segmented?.units.filter(unit => unit.stage === definition.id);
      if (units?.length) return { id: definition.id, state: units.every(unit => unit.state === "saved") ? "saved" : units.some(unit => unit.state === "running") ? "running" : units.some(unit => unit.state !== "pending") ? "interrupted" : "pending" };
      return { id: definition.id, state: definition.id === "artifacts" && snapshot.plan && state("artifacts") === "pending" && snapshot.units.some(unit => snapshot.plan!.targets.some(target => target.id === unit.id)) ? running ? "running" : "interrupted" : state(definition.id) };
    }),
  });
}
