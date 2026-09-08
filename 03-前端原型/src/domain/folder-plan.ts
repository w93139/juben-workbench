import { z } from "zod";
import { blueprintDataSchema } from "./blueprint";
import type { Project } from "./models";

export const folderPlanSchema = z.object({
  sourceRevision: z.number().int().nonnegative(),
  status: z.enum(["running", "succeeded", "cancelled"]),
  progress: z.union([z.literal(0), z.literal(50), z.literal(100)]),
  selectedChoiceId: z.enum(["deduction", "emotion", "interaction"]).nullable(),
  updatedAt: z.iso.datetime(),
  messages: z.array(z.object({ id: z.string(), role: z.enum(["user", "coordinator"]), text: z.string().max(6000), createdAt: z.iso.datetime(), sourceRevision: z.number().int(), choiceId: z.string() })).max(80).default([]),
  proposalHistory: z.array(z.object({ id: z.string(), choiceId: z.string(), sourceRevision: z.number().int(), savedAt: z.iso.datetime(), reason: z.string(), data: blueprintDataSchema })).max(30).default([]),
  proposal: blueprintDataSchema.nullable().default(null),
  plannedPath: z.string().max(2048).nullable().default(null),
});
export type FolderPlan = z.infer<typeof folderPlanSchema>;
export interface FolderPlanChoice {
  id: NonNullable<FolderPlan["selectedChoiceId"]>;
  title: string; genre: string; players: number; minutes: number;
  experience: string; premise: string; outline: [string, string, string];
  mechanism: string; risk: string;
  ratios: { deduction: number; emotion: number; mechanics: number };
}
export function usesFolderPlan(project: Project) {
  return !!project.folderPlan || project.template === "blank" && !project.research.documents.some((document) => document.origin === "demo") && (!project.research.direction || !!project.folderPlan);
}
export function folderPlanCurrent(project: Project) {
  return project.folderPlan?.status === "succeeded" && project.folderPlan.sourceRevision === project.research.materialRevision;
}
