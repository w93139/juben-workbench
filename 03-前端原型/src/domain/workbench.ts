import { z } from "zod";
import { blueprintDataSchema } from "./blueprint";
import { archivedStudioReviewSchema, studioAnalysisSchema, studioReviewResultSchema, studioReviewProgressSchema } from "./studio";
import { restoreOriginSchema } from "./project-restore";

export const materialSchema = z.object({ id: z.string(), name: z.string().max(1000), size: z.number().nonnegative(), status: z.enum(["read", "unsupported", "error"]), text: z.string().max(300000), method: z.string(), warnings: z.array(z.string()), excluded: z.boolean().default(false) });
export type Material = z.infer<typeof materialSchema>;
export const blueprintDraftSchema = z.object({
  id: z.uuid(), revision: z.number().int().positive(),
  baseRevision: z.number().int().nonnegative(), baseBlueprintRevision: z.number().int().nonnegative(),
  data: blueprintDataSchema, updatedAt: z.iso.datetime(),
});
export type BlueprintDraft = z.infer<typeof blueprintDraftSchema>;
export const reviewArchiveSchema = z.object({
  id: z.uuid(), origin: z.literal("backup-import"), importedAt: z.iso.datetime(),
  blueprintRevision: z.number().int().nullable(), review: archivedStudioReviewSchema,
}).strict();
export const workbenchSchema = z.object({
  revision: z.number().int().nonnegative(), sourceRevision: z.number().int().nonnegative(),
  documents: z.array(materialSchema).max(2000),
  analysis: studioAnalysisSchema.nullable(), analysisSourceRevision: z.number().int().nullable(), choiceId: z.string().nullable(), instructions: z.string().max(10000),
  blueprint: blueprintDataSchema.nullable(), blueprintRevision: z.number().int().nonnegative(),
  blueprintSourceRevision: z.number().int().nullable(), blueprintChoiceId: z.string().nullable(),
  versions: z.array(z.object({ revision: z.number().int(), data: blueprintDataSchema })).max(20),
  historyRevision: z.number().int().nonnegative().default(0),
  blueprintDrafts: z.array(blueprintDraftSchema).max(12).refine(items => new Set(items.map(item => item.id)).size === items.length, "草稿编号不能重复").default([]),
  review: studioReviewResultSchema.nullable(), reviewBlueprintRevision: z.number().int().nullable(),
  reviewProgress: z.object({ jobId: z.uuid().nullable(), blueprintRevision: z.number().int().nonnegative(), checkpoint: studioReviewProgressSchema }).strict().nullable().default(null),
  reviewArchives: z.array(reviewArchiveSchema).max(20).refine(items => new Set(items.map(item => item.id)).size === items.length, "审查历史编号不能重复").default([]),
  restoredFrom: restoreOriginSchema.nullable().default(null),
  job: z.object({ jobId: z.string(), operation: z.enum(["analyze", "blueprint", "review"]), phase: z.string(), sourceRevision: z.number().int(), blueprintRevision: z.number().int(), submittedAt: z.number().optional() }).nullable(),
  error: z.string().nullable(),
});
export type WorkbenchState = z.infer<typeof workbenchSchema>;
export function emptyWorkbench(): WorkbenchState { return { revision: 0, sourceRevision: 0, documents: [], analysis: null, analysisSourceRevision: null, choiceId: null, instructions: "", blueprint: null, blueprintRevision: 0, blueprintSourceRevision: null, blueprintChoiceId: null, versions: [], historyRevision: 0, blueprintDrafts: [], review: null, reviewBlueprintRevision: null, reviewProgress: null, reviewArchives: [], restoredFrom: null, job: null, error: null }; }
export function readableMaterials(state: WorkbenchState) { return state.documents.filter(d => !d.excluded); }
export function materialsReady(state: WorkbenchState) { const docs = readableMaterials(state); return docs.length > 0 && docs.every(d => d.status === "read" && !!d.text.trim()); }
export function analysisCurrent(state: WorkbenchState) { return !!state.analysis && state.analysisSourceRevision === state.sourceRevision; }
export function blueprintCurrent(state: WorkbenchState) { return !!state.blueprint && state.blueprintSourceRevision === state.sourceRevision && state.blueprintChoiceId === state.choiceId && analysisCurrent(state); }
export function reviewCurrent(state: WorkbenchState) { return !state.job && !state.reviewProgress && !!state.review?.passed && !!state.review.validationId && state.reviewBlueprintRevision === state.blueprintRevision && blueprintCurrent(state); }
