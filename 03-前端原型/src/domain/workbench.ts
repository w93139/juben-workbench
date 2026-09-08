import { z } from "zod";
import { blueprintDataSchema } from "./blueprint";
import { studioAnalysisSchema, studioReviewResultSchema } from "./studio";

export const materialSchema = z.object({ id: z.string(), name: z.string().max(1000), size: z.number().nonnegative(), status: z.enum(["read", "unsupported", "error"]), text: z.string().max(300000), method: z.string(), warnings: z.array(z.string()), excluded: z.boolean().default(false) });
export type Material = z.infer<typeof materialSchema>;
export const workbenchSchema = z.object({
  revision: z.number().int().nonnegative(), sourceRevision: z.number().int().nonnegative(),
  documents: z.array(materialSchema).max(2000),
  analysis: studioAnalysisSchema.nullable(), analysisSourceRevision: z.number().int().nullable(), choiceId: z.string().nullable(), instructions: z.string().max(10000),
  blueprint: blueprintDataSchema.nullable(), blueprintRevision: z.number().int().nonnegative(),
  blueprintSourceRevision: z.number().int().nullable(), blueprintChoiceId: z.string().nullable(),
  versions: z.array(z.object({ revision: z.number().int(), data: blueprintDataSchema })).max(20),
  review: studioReviewResultSchema.nullable(), reviewBlueprintRevision: z.number().int().nullable(),
  job: z.object({ jobId: z.string(), operation: z.enum(["analyze", "blueprint", "review"]), phase: z.string(), sourceRevision: z.number().int(), blueprintRevision: z.number().int() }).nullable(),
  error: z.string().nullable(),
});
export type WorkbenchState = z.infer<typeof workbenchSchema>;
export function emptyWorkbench(): WorkbenchState { return { revision: 0, sourceRevision: 0, documents: [], analysis: null, analysisSourceRevision: null, choiceId: null, instructions: "", blueprint: null, blueprintRevision: 0, blueprintSourceRevision: null, blueprintChoiceId: null, versions: [], review: null, reviewBlueprintRevision: null, job: null, error: null }; }
export function readableMaterials(state: WorkbenchState) { return state.documents.filter(d => !d.excluded); }
export function materialsReady(state: WorkbenchState) { const docs = readableMaterials(state); return docs.length > 0 && docs.every(d => d.status === "read" && !!d.text.trim()); }
export function analysisCurrent(state: WorkbenchState) { return !!state.analysis && state.analysisSourceRevision === state.sourceRevision; }
export function blueprintCurrent(state: WorkbenchState) { return !!state.blueprint && state.blueprintSourceRevision === state.sourceRevision && state.blueprintChoiceId === state.choiceId && analysisCurrent(state); }
export function reviewCurrent(state: WorkbenchState) { return !!state.review?.passed && !!state.review.validationId && state.reviewBlueprintRevision === state.blueprintRevision && blueprintCurrent(state); }
