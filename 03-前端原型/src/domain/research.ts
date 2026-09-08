import { z } from "zod";
import { sourceFileInputSchema, sourceImportPolicy } from "./source-import";
export { sourceFileInputSchema, type SourceFileInput } from "./source-import";

export const sourceDocumentSchema = sourceFileInputSchema.safeExtend({
  // Older versions accepted names containing backslashes or line breaks. Keep
  // persisted labels intact; only new imports use the stricter input rule.
  name: z.string().min(1).max(255),
  id: z.string(), origin: z.enum(["demo", "local-metadata"]), kind: z.string(), audience: z.string(), edition: z.string(),
  status: z.enum(["registered", "processed"]), fixtureId: z.string().nullable(),
});
export type ResearchDocument = z.infer<typeof sourceDocumentSchema>;
export const ocrIssueSchema = z.object({
  id: z.string(), documentId: z.string(), kind: z.enum(["text", "blur", "duplicate", "missing"]), location: z.string(),
  description: z.string(), original: z.string(), suggestion: z.string(),
  status: z.enum(["open", "corrected", "excluded", "retained"]), resolution: z.string().max(600),
});
export type OCRIssue = z.infer<typeof ocrIssueSchema>;
export const issueResolutionSchema = z.object({ id: z.string(), status: z.enum(["corrected", "excluded", "retained"]), resolution: z.string().trim().min(1, "请填写校对文字或处理说明。").max(600) });
export type IssueResolution = z.infer<typeof issueResolutionSchema>;
export const mechanismChoiceSchema = z.object({ id: z.enum(["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08"]), choice: z.enum(["retain", "adapt", "omit"]), reason: z.string().trim().min(1, "请写下取舍理由。").max(600) });
export type MechanismChoice = z.infer<typeof mechanismChoiceSchema>;
export const directionDraftSchema = z.object({
  players: z.number().int().min(2).max(12), genre: z.string().trim().max(60), minutes: z.number().int().min(60).max(600),
  deduction: z.number().int().min(0).max(100), emotion: z.number().int().min(0).max(100), mechanics: z.number().int().min(0).max(100),
  forbidden: z.string().max(1200), intensity: z.enum(["mechanisms", "recombine"]), idea: z.string().max(2000),
});
export const directionSchema = directionDraftSchema.extend({ genre: z.string().trim().min(1, "请填写新作题材。").max(60) }).refine((d) => d.deduction + d.emotion + d.mechanics === 100, { message: "三种体验比例相加需要等于 100%。", path: ["deduction"] });
export type OriginalDirection = z.infer<typeof directionSchema>;
export const creativePlanInputSchema = z.object({ choices: z.array(mechanismChoiceSchema).max(8), direction: directionDraftSchema, confirm: z.boolean() }).refine((plan) => new Set(plan.choices.map((choice) => choice.id)).size === plan.choices.length, { message: "机制取舍不能重复。", path: ["choices"] });
export type CreativePlanInput = z.infer<typeof creativePlanInputSchema>;
export const defaultDirection: OriginalDirection = { players: 5, genre: "现代悬疑", minutes: 225, deduction: 60, emotion: 25, mechanics: 15, forbidden: "不强制恋爱或煽情，不以羞辱玩家制造体验。", intensity: "mechanisms", idea: "" };
export const researchJobSchema = z.object({ id: z.string(), kind: z.enum(["ocr", "analysis"]), status: z.enum(["running", "succeeded", "failed", "cancelled"]), progress: z.number().int().min(0).max(100), fail: z.boolean(), message: z.string(), sourceRevision: z.number().int().nonnegative(), outputLocation: z.string().nullable().optional() });
export const researchSchema = z.object({
  documents: z.array(sourceDocumentSchema).max(sourceImportPolicy.projectFiles), issues: z.array(ocrIssueSchema),
  materialRevision: z.number().int().nonnegative(), auditRevision: z.number().int().nonnegative().nullable(), auditNote: z.string().max(1000),
  analysisRevision: z.number().int().nonnegative().nullable(), job: researchJobSchema.nullable(),
  choices: z.array(mechanismChoiceSchema), direction: directionDraftSchema.nullable(), directionConfirmed: z.boolean(),
}).superRefine((state, ctx) => {
  for (const rows of [state.documents, state.issues, state.choices]) if (new Set(rows.map((r) => r.id)).size !== rows.length) ctx.addIssue({ code: "custom", message: "研究记录编号重复。" });
  if (state.issues.some((i) => !state.documents.some((d) => d.id === i.documentId))) ctx.addIssue({ code: "custom", message: "识别问题引用了不存在的材料。" });
  if ([state.auditRevision, state.analysisRevision].some((r) => r !== null && r > state.materialRevision)) ctx.addIssue({ code: "custom", message: "研究版本不一致。" });
  if (state.directionConfirmed && (!directionSchema.safeParse(state.direction).success || state.auditRevision !== state.materialRevision || state.analysisRevision !== state.materialRevision || !state.choices.some((c) => c.choice !== "omit"))) ctx.addIssue({ code: "custom", message: "原创方向缺少有效的研究依据。" });
});
export type ResearchState = z.infer<typeof researchSchema>;
export function emptyResearch(): ResearchState { return { documents: [], issues: [], materialRevision: 0, auditRevision: null, auditNote: "", analysisRevision: null, job: null, choices: [], direction: null, directionConfirmed: false }; }

const excerptSchema = z.object({ id: z.string(), label: z.string(), text: z.string(), recordId: z.string(), locator: z.string() });
export const researchCatalogSchema = z.object({
  title: z.string(), edition: z.string(), boundary: z.string(), provenance: z.array(z.object({ path: z.string(), sha256: z.string() })),
  excerpts: z.array(excerptSchema),
  issues: z.array(ocrIssueSchema),
  patterns: z.array(z.object({ id: mechanismChoiceSchema.shape.id, name: z.string(), explicit: z.string(), editorial: z.string(), behavior: z.string(), story: z.string(), transferable: z.string(), prerequisites: z.array(z.string()), risks: z.array(z.string()), changes: z.record(z.string(), z.string()), suggestion: z.string(), sources: z.array(z.object({ id: z.string(), location: z.string() })), locator: z.string() })),
});
export type ResearchCatalog = z.infer<typeof researchCatalogSchema>;

export function researchStep(research: ResearchState) {
  if (!research.documents.some((d) => d.origin === "demo" && d.status === "processed") || research.auditRevision !== research.materialRevision) return "materials";
  if (research.analysisRevision !== research.materialRevision) return "analysis";
  if (!research.choices.some((c) => c.choice !== "omit")) return "mechanisms";
  return research.directionConfirmed ? "blueprint" : "direction";
}
