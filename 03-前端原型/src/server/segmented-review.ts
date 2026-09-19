import { createHash } from "node:crypto";
import { scopedStages, scopedUnitId, type ReviewPlan, type ScopedStage } from "@/domain/review-plan";
import { studioScopedAuditSchema, type SegmentedReview, type StudioAudit, type StudioScopedAudit } from "@/domain/studio";
import type { StudioProductionStore } from "./studio-production-store";
import { auditInstructions } from "./studio-review-requests";
import type { prepareReviewScopes } from "./review-plan";

/** Leave room for full mutual/coordinator reports even for the short path. */
export const WHOLE_REVIEW_BYTES = 350_000;
export const SCOPED_REPORT_BYTES = 40_000;
export function reviewApprovalFingerprint(executionFingerprint: string, reviewPlanHash?: string) {
  return reviewPlanHash ? createHash("sha256").update(JSON.stringify([executionFingerprint, "segmented-review/1", reviewPlanHash])).digest("hex") : executionFingerprint;
}
export function scopedInstructions(stage: ScopedStage) {
  const original = stage === "coordinator" ? auditInstructions.coordinator : stage.startsWith("mutual") ? auditInstructions.mutual : auditInstructions.independent;
  return `${original}\n本次只判断scope指定的原文范围，不能声称已经读完未提供的正文。sources包含不可修改的原文片段和精确位置。每个sources.partId必须在coverage恰好出现一次，逐字返回hash并从该片段选非空quote。evidence只能引用blueprint或sources原文，不能引用其他报告冒充原文。范围kind=link时，按完整蓝图核对两段跨角色知情/跨轮次状态/共同来源一致性；区分合法视角差异与矛盾。kind=part时逐字审查该段，未提供的全局体验保持待核对。任何自己或同伴的未解决阻断保留，不能用最终通过覆盖。摘要与意见应精确简洁，JSON整体不超过40000 UTF-8字节；不以缩略原文代替审核。`;
}
export function scopedPayload(read: ReturnType<typeof prepareReviewScopes>, scopeId: string, stage: ScopedStage, reports: Partial<Record<ScopedStage, StudioScopedAudit>>) {
  const selected = stage === "coordinator" ? { independentA: reports.independentA, independentB: reports.independentB, mutualA: reports.mutualA, mutualB: reports.mutualB }
    : stage.startsWith("mutual") ? { own: stage === "mutualA" ? reports.independentA : reports.independentB, other: stage === "mutualA" ? reports.independentB : reports.independentA } : {};
  return read(scopeId, selected);
}
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
