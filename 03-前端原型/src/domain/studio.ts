import { z } from "zod";
import { blueprintDataSchema } from "./blueprint";
import { moduleIds } from "./production";
import { ANALYSIS_DOCUMENT_LIMIT } from "./analysis-limits";

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
export const studioAuditSchema = z.object({
  summary: text(12000), blocking: z.array(text(3000)).max(100), warnings: z.array(text(3000)).max(100),
  evidence: z.array(z.object({ location: text(1000), quote: text(3000), conclusion: text(3000) }).strict()).min(1).max(100),
  contentComplete: z.boolean(), playerHostIsolation: z.boolean(), findingsAddressed: z.boolean(), humanPlaytest: z.literal("not-run"),
}).strict();
export type StudioAudit = z.infer<typeof studioAuditSchema>;
export const studioInputs = {
  analyze: z.object({ documents: z.array(studioDocumentSchema).min(1).max(ANALYSIS_DOCUMENT_LIMIT), instructions: z.string().max(10000).default("") }).strict(),
  blueprint: z.object({ analysis: studioAnalysisSchema, choiceId: text(100), instructions: z.string().max(10000).default("") }).strict(),
  review: z.object({ blueprint: blueprintDataSchema }).strict(),
};
export type StudioOperation = keyof typeof studioInputs;
export const studioReviewResultSchema = z.object({
  kind: z.literal("review"), passed: z.boolean(), issues: z.array(z.string()).max(2000), artifacts: z.array(studioArtifactSchema).max(240),
  reports: z.object({ designGate: studioAuditSchema.optional(), independentA: studioAuditSchema.optional(), independentB: studioAuditSchema.optional(), mutualA: studioAuditSchema.optional(), mutualB: studioAuditSchema.optional(), coordinator: studioAuditSchema.optional() }).strict(),
  blueprint: blueprintDataSchema.optional(),
  validationId: z.string().uuid().optional(), blueprintFingerprint: z.string().regex(/^[a-f0-9]{64}$/), humanPlaytest: z.literal("not-run"),
}).strict().refine((value) => !value.passed || (!!value.validationId && !value.issues.length && value.artifacts.length >= 6 && [value.reports.designGate, value.reports.independentA, value.reports.independentB, value.reports.mutualA, value.reports.mutualB, value.reports.coordinator].every((report) => report && !report.blocking.length && report.contentComplete && report.playerHostIsolation && report.findingsAddressed)), "通过状态缺少完整审查链");
export type StudioReviewResult = z.infer<typeof studioReviewResultSchema>;
export const studioResultSchema = z.union([z.object({ kind: z.literal("analysis"), analysis: studioAnalysisSchema }).strict(), z.object({ kind: z.literal("blueprint"), blueprint: blueprintDataSchema }).strict(), studioReviewResultSchema]);
export type StudioResult = z.infer<typeof studioResultSchema>;
export const studioJobViewSchema = z.object({ jobId: z.string().uuid(), status: z.enum(["running", "completed", "failed"]), phase: z.string().max(1000), result: studioResultSchema.optional(), error: z.object({ code: z.string().max(100), message: z.string().max(3000) }).strict().optional() }).strict().refine((value) => value.status === "completed" ? !!value.result && !value.error : value.status === "failed" ? !!value.error && !value.result : !value.result && !value.error, "任务状态与结果不一致");
export type StudioJobView = z.infer<typeof studioJobViewSchema>;
