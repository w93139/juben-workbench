import { z } from "zod";
import { folderPlanSchema } from "./folder-plan";
import { productionWorkspaceSchema } from "./production";
import { blueprintWorkspaceSchema } from "./blueprint";
import { researchSchema } from "./research";
import { defaultOutputSettings, outputSettingsSchema } from "./output-settings";

export const decisionStatusSchema = z.enum(["confirmed", "provisional", "open"]);
export type DecisionStatus = z.infer<typeof decisionStatusSchema>;
export const decisionLabels: Record<DecisionStatus, string> = {
  confirmed: "已确定", provisional: "暂定", open: "待解决",
};

export const stageIds = ["materials", "analysis", "mechanisms", "direction", "blueprint", "generation", "review", "playtest", "export"] as const;
export const stageIdSchema = z.enum(stageIds);
export type StageId = z.infer<typeof stageIdSchema>;

export const decisionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string(),
  status: decisionStatusSchema,
  nature: z.enum(["source-fact", "inference", "original", "unresolved"]),
  source: z.string().nullable(),
});
export type DecisionRecord = z.infer<typeof decisionSchema>;

export const projectSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(40),
  note: z.string().max(1200),
  template: z.enum(["blank", "names-beyond"]),
  readOnly: z.boolean(),
  revision: z.number().int().nonnegative(),
  createdAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime().nullable(),
  decisions: z.array(decisionSchema),
  research: researchSchema,
  blueprint: blueprintWorkspaceSchema.nullable().default(null),
  outputSettings: outputSettingsSchema.default(defaultOutputSettings),
  production: productionWorkspaceSchema.nullable().default(null),
  folderPlan: folderPlanSchema.nullable().default(null),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectSchema = z.object({
  title: projectSchema.shape.title,
  note: projectSchema.shape.note,
  template: projectSchema.shape.template,
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export const updateProjectSchema = createProjectSchema.pick({ title: true, note: true });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const envelopeSchema = z.object({
  schemaVersion: z.literal(3),
  projects: z.array(projectSchema),
}).superRefine((value, context) => {
  const ids = new Set<string>();
  value.projects.forEach((project) => {
    if (project.readOnly || project.id === "demo-names" || ids.has(project.id)) {
      context.addIssue({ code: "custom", message: "项目身份重复或包含保留项目" });
    }
    ids.add(project.id);
    if (new Set(project.decisions.map((item) => item.id)).size !== project.decisions.length) {
      context.addIssue({ code: "custom", message: "决定记录编号重复" });
    }
  });
});
export type ProjectEnvelope = z.infer<typeof envelopeSchema>;

export const legacyEnvelopeSchema = z.object({ schemaVersion: z.literal(1), projects: z.array(projectSchema.omit({ research: true })) });

export interface WorkflowStage {
  id: StageId;
  name: string;
  shortName: string;
  purpose: string;
  outcome: string;
  nextPhase: "B" | "C" | "D" | "E";
}

const sourceSchema = z.object({ path: z.string(), sha256: z.string(), label: z.string() });
export const demoContentSchema = z.object({
  title: z.string(), premise: z.string(), blueprintVersion: z.string(), kitVersion: z.string(),
  players: z.number(), plannedMinutes: z.number(),
  deliverables: z.array(z.object({ label: z.string(), complete: z.boolean() })),
  sources: z.array(sourceSchema),
  characters: z.array(z.object({ id: z.string(), name: z.string(), publicIdentity: z.string(), goal: z.string(), privateInformation: z.string(), choice: z.string(), contribution: z.string() })),
  relationships: z.array(z.object({ id: z.string(), participants: z.array(z.string()), basis: z.string(), priority: z.string(), publicVersion: z.string(), underlyingFacts: z.string(), leverage: z.string(), statusLabel: z.string() })),
  events: z.array(z.object({ id: z.string(), time: z.string(), location: z.string(), action: z.string() })),
  knowledge: z.array(z.object({ id: z.string(), kind: z.string(), statement: z.string(), initial: z.record(z.string(), z.string()) })),
  clues: z.array(z.object({ id: z.string(), name: z.string(), content: z.string(), cost: z.number(), supports: z.array(z.string()) })),
  claims: z.array(z.object({ id: z.string(), statement: z.string(), tier: z.string() })),
  rounds: z.array(z.object({ id: z.string(), name: z.string(), minutes: z.number() })),
  mechanisms: z.array(z.object({ id: z.string(), name: z.string(), sourcePattern: z.string() })),
  checks: z.array(z.object({ id: z.string(), kind: z.enum(["ai", "static", "simulation", "human"]), label: z.string(), result: z.string(), scope: z.string(), source: z.string().nullable(), origin: z.enum(["historical", "not-run"]) })),
  documents: z.array(z.object({ id: z.string(), title: z.string(), source: z.string(), content: z.string() })),
  decisions: z.array(decisionSchema),
});
export type DemoContent = z.infer<typeof demoContentSchema>;
export type Character = DemoContent["characters"][number];
export type Relationship = DemoContent["relationships"][number];
export type Fact = DemoContent["events"][number];
export type KnowledgeItem = DemoContent["knowledge"][number];
export type Clue = DemoContent["clues"][number];
export type Claim = DemoContent["claims"][number];
export type Round = DemoContent["rounds"][number];
export type SourceDocument = DemoContent["documents"][number];

export const blankDecisions: DecisionRecord[] = [
  { id: "experience", title: "主要体验", detail: "先明确希望玩家在这场故事里得到什么。", status: "open", nature: "unresolved", source: null },
  { id: "cast", title: "人数与时长", detail: "在原创方向阶段设置人数、时长和内容边界。", status: "open", nature: "unresolved", source: null },
  { id: "reference", title: "参考材料范围", detail: "准备参考文本，并确认缺失材料与阅读范围。", status: "open", nature: "unresolved", source: null },
];
