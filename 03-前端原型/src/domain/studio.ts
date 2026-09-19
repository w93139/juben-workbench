import { z } from "zod";
import { blueprintDataSchema } from "./blueprint";
import { moduleIds } from "./production";
import { ANALYSIS_DOCUMENT_LIMIT } from "./analysis-limits";
import { reviewUnits } from "./studio-production";
import { reviewPlanSchema, scopedStages, scopedUnitId } from "./review-plan";

const text = (max: number) => z.string().trim().min(1).max(max);
export const studioDocumentSchema = z.object({ id: text(120), name: text(500), text: z.string().min(1).max(300000).refine(value => !!value.trim(), "原文不能为空") }).strict();
export const studioAnalysisSchema = z.object({
  outline: text(30000),
  directions: z.array(z.object({ id: text(100), title: text(200), summary: text(5000), outline: text(15000), risk: text(5000) }).strict()).min(2).max(5),
  sourceRefs: z.array(z.object({ documentId: text(120), location: text(1000), quote: text(3000) }).strict()).min(1).max(100),
  unknowns: z.array(text(2000)).max(100),
  coverage: z.object({ method: z.literal("segmented"), documents: z.number().int().positive(), parts: z.number().int().positive() }).strict().optional(),
}).strict();
export type StudioAnalysis = z.infer<typeof studioAnalysisSchema>;
export const studioArtifactSchema = z.object({
  id: text(100), module: z.enum(moduleIds), audience: z.enum(["player", "host"]), characterId: text(100).nullable(), roundId: text(100).nullable(),
  title: text(500), content: text(120000), sourceIds: z.array(text(100)).max(200),
}).strict();
export type StudioArtifact = z.infer<typeof studioArtifactSchema>;
export const artifactBundleSchema = z.object({ artifacts: z.array(studioArtifactSchema).min(6).max(240) }).strict();
export const studioAuditSchema = z.object({
  summary: text(12000), blocking: z.array(text(3000)).max(100), warnings: z.array(text(3000)).max(100),
  evidence: z.array(z.object({ location: text(1000), quote: text(3000), conclusion: text(3000) }).strict()).min(1).max(100),
  contentComplete: z.boolean(), playerHostIsolation: z.boolean(), findingsAddressed: z.boolean(), humanPlaytest: z.literal("not-run"),
}).strict();
export type StudioAudit = z.infer<typeof studioAuditSchema>;
export const studioScopedAuditSchema = studioAuditSchema.extend({ coverage: z.array(z.object({ partId: text(100), hash: z.string().regex(/^[a-f0-9]{64}$/), quote: text(3000) }).strict()).min(1).max(2) }).strict();
export type StudioScopedAudit = z.infer<typeof studioScopedAuditSchema>;
export const segmentedReviewSchema = z.object({ plan: reviewPlanSchema, units: z.array(z.object({
  id: text(100), scopeId: text(100), stage: z.enum(scopedStages), state: z.enum(["pending", "running", "saved", "interrupted"]),
  report: studioScopedAuditSchema.optional(), issues: z.array(text(3000)).max(20).default([]),
}).strict()).max(51200) }).strict();
export type SegmentedReview = z.infer<typeof segmentedReviewSchema>;
function completeSegmentedReview(value: SegmentedReview, artifacts: StudioArtifact[]) {
  const { plan, units } = value, scopes = [...plan.parts, ...plan.links];
  if (new Set(scopes.map(scope => scope.id)).size !== scopes.length || units.length !== scopes.length * 5 || plan.callsMax !== units.length || new Set(units.map(unit => unit.id)).size !== units.length) return false;
  if (plan.artifacts.length !== artifacts.length || new Set(artifacts.map(artifact => artifact.id)).size !== artifacts.length) return false;
  for (const artifact of artifacts) {
    if (!plan.artifacts.some(item => item.id === artifact.id && item.length === artifact.content.length)) return false;
    const parts = plan.parts.filter(part => part.artifactId === artifact.id); let end = 0;
    for (const part of parts) { if (part.start !== end || part.end <= end || part.end > artifact.content.length) return false; end = part.end; }
    if (end !== artifact.content.length) return false;
  }
  const byPart = new Map(plan.parts.map(part => [part.id, part])), byUnit = new Map(units.map(unit => [unit.id, unit]));
  for (const scope of scopes) for (const stage of scopedStages) {
    const unit = byUnit.get(scopedUnitId(scope.id, stage)), report = unit?.report;
    if (!unit || unit.scopeId !== scope.id || unit.stage !== stage || unit.state !== "saved" || unit.issues.length || !report || report.blocking.length || !report.contentComplete || !report.playerHostIsolation || !report.findingsAddressed) return false;
    const ids = "parts" in scope ? scope.parts : [scope.id];
    if (report.coverage.length !== ids.length || new Set(report.coverage.map(entry => entry.partId)).size !== ids.length) return false;
    for (const id of ids) {
      const part = byPart.get(id), evidence = report.coverage.find(entry => entry.partId === id), artifact = artifacts.find(item => item.id === part?.artifactId);
      if (!part || !artifact || !evidence || evidence.hash !== part.hash || !artifact.content.slice(part.start, part.end).includes(evidence.quote)) return false;
    }
  }
  return true;
}
export const studioInputs = {
  analyze: z.object({ documents: z.array(studioDocumentSchema).min(1).max(ANALYSIS_DOCUMENT_LIMIT), instructions: z.string().max(10000).default("") }).strict(),
  blueprint: z.object({ analysis: studioAnalysisSchema, choiceId: text(100), instructions: z.string().max(10000).default("") }).strict(),
  review: z.object({ blueprint: blueprintDataSchema }).strict(),
};
export type StudioOperation = keyof typeof studioInputs;
const studioReviewContentSchema = z.object({
  kind: z.literal("review"), passed: z.boolean(), issues: z.array(z.string()).max(2000), artifacts: z.array(studioArtifactSchema).max(240),
  reports: z.object({ designGate: studioAuditSchema.optional(), independentA: studioAuditSchema.optional(), independentB: studioAuditSchema.optional(), mutualA: studioAuditSchema.optional(), mutualB: studioAuditSchema.optional(), coordinator: studioAuditSchema.optional() }).strict(),
  blueprint: blueprintDataSchema.optional(),
  segmented: segmentedReviewSchema.optional(),
  blueprintFingerprint: z.string().regex(/^[a-f0-9]{64}$/), humanPlaytest: z.literal("not-run"),
}).strict();
function completeReview(value: z.infer<typeof studioReviewContentSchema>) {
  return !value.issues.length && value.artifacts.length >= 6 && (!value.segmented || completeSegmentedReview(value.segmented, value.artifacts)) && [value.reports.designGate, value.reports.independentA, value.reports.independentB, value.reports.mutualA, value.reports.mutualB, value.reports.coordinator].every((report) => report && !report.blocking.length && report.contentComplete && report.playerHostIsolation && report.findingsAddressed);
}
export const archivedStudioReviewSchema = studioReviewContentSchema.refine(value => !value.passed || completeReview(value), "历史通过状态缺少完整审查链");
export type ArchivedStudioReview = z.infer<typeof archivedStudioReviewSchema>;
export const studioReviewResultSchema = studioReviewContentSchema.extend({ validationId: z.uuid().optional() }).refine(value => !value.passed || (!!value.validationId && completeReview(value)), "通过状态缺少完整审查链");
export type StudioReviewResult = z.infer<typeof studioReviewResultSchema>;
const productionState = z.enum(["pending", "running", "saved", "interrupted"]);
export const studioReviewProgressSchema = z.object({
  runId: z.uuid().nullable(), revision: z.number().int().nonnegative().safe(),
  steps: z.array(z.object({ id: z.enum(reviewUnits.map(unit => unit.id)), state: z.enum(["pending", "running", "saved", "interrupted"]) }).strict()).length(7)
    .refine(steps => new Set(steps.map(step => step.id)).size === 7, "阶段编号不能重复"),
  generation: z.object({ planHash: z.string().regex(/^[a-f0-9]{64}$/), units: z.array(z.object({
    id: text(100), label: text(500), module: z.enum(moduleIds), characterId: text(100).nullable(), roundId: text(100).nullable(), state: productionState,
  }).strict()).max(240).refine(units => new Set(units.map(unit => unit.id)).size === units.length, "生成单元编号不能重复") }).strict().optional(),
  review: studioReviewContentSchema.extend({ passed: z.literal(false), blueprint: blueprintDataSchema }),
}).strict();
export type StudioReviewProgress = z.infer<typeof studioReviewProgressSchema>;
export const studioResultSchema = z.union([z.object({ kind: z.literal("analysis"), analysis: studioAnalysisSchema }).strict(), z.object({ kind: z.literal("blueprint"), blueprint: blueprintDataSchema }).strict(), studioReviewResultSchema]);
export type StudioResult = z.infer<typeof studioResultSchema>;
export const studioCallDiagnosticSchema = z.object({
  model: z.string().max(200), phase: z.string().max(1000), inputBytes: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative(), elapsedMs: z.number().int().nonnegative(), timeoutMs: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(), pauseGapMs: z.number().int().nonnegative().optional(), status: z.enum(["running", "completed", "failed"]), errorCode: z.string().max(100).optional(),
}).strict();
export type StudioCallDiagnostic = z.infer<typeof studioCallDiagnosticSchema>;
export const studioJobViewSchema = z.object({ jobId: z.string().uuid(), status: z.enum(["running", "completed", "failed"]), phase: z.string().max(1000), result: studioResultSchema.optional(), reviewProgress: studioReviewProgressSchema.optional(), lastCall: studioCallDiagnosticSchema.optional(), error: z.object({ code: z.string().max(100), message: z.string().max(3000) }).strict().optional() }).strict().refine((value) => value.status === "completed" ? !!value.result && !value.error : value.status === "failed" ? !!value.error && !value.result : !value.result && !value.error, "任务状态与结果不一致");
export type StudioJobView = z.infer<typeof studioJobViewSchema>;
