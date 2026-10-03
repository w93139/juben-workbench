import { scopedStages, scopedUnitId, type ReviewPlan, type ScopedStage } from "@/domain/review-plan";
import { studioScopedAuditSchema, type SegmentedReview, type StudioAudit } from "@/domain/studio";
import type { StudioProductionStore } from "./studio-production-store";

export function segmentedProgress(plan: ReviewPlan, snapshot: ReturnType<StudioProductionStore["snapshot"]>, jobId: string, running: boolean): SegmentedReview {
  const saved = new Map(snapshot.units.map(unit => [unit.id, unit]));
  return { plan, units: [...plan.parts, ...plan.links].flatMap(scope => scopedStages.map(stage => {
    const id = scopedUnitId(scope.id, stage), unit = saved.get(id);
    return { id, scopeId: scope.id, stage, state: !unit ? "pending" : unit.saved ? "saved" : unit.jobId === jobId && running && !unit.issues.length ? "running" : "interrupted", ...(unit?.value !== undefined ? { report: studioScopedAuditSchema.parse(unit.value) } : {}), issues: unit?.issues ?? [] };
  })) };
}
/** Full original opinions remain in units; these are computed indexes, not new model opinions. */
export function segmentedSummaries(segmented: SegmentedReview): Partial<Record<ScopedStage, StudioAudit>> {
  const reports: Partial<Record<ScopedStage, StudioAudit>> = {};
  for (const stage of scopedStages) {
    const units = segmented.units.filter(unit => unit.stage === stage);
    if (!units.length || units.some(unit => unit.state !== "saved" || !unit.report || unit.issues.length)) continue;
    const audits = units.map(unit => unit.report!);
    const blocked = audits.filter(report => report.blocking.length || !report.contentComplete || !report.playerHostIsolation || !report.findingsAddressed).length;
    reports[stage] = {
      summary: `程序汇总：${units.length}个正文或关联范围的本路报告已保存。逐段原始意见及引用见分段报告；这不是额外模型复核。`,
      blocking: blocked ? [`${blocked}个范围仍有阻断或未通过判断，请查看全部分段原始报告。`] : [],
      warnings: ["相邻关联检查不能证明所有非相邻正文语义一致；整体体验和可玩性仍需人工核对与真人试玩。"],
      evidence: [audits[0].evidence[0]], contentComplete: audits.every(report => report.contentComplete),
      playerHostIsolation: audits.every(report => report.playerHostIsolation), findingsAddressed: audits.every(report => report.findingsAddressed), humanPlaytest: "not-run",
    };
  }
  return reports;
}
