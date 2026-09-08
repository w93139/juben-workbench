import { z } from "zod";
import type { BlueprintIssue } from "./blueprint";
import type { Project } from "./models";

export const moduleIds = ["character", "private", "updates", "clues", "host", "ending"] as const;
export const moduleLabels = { character: "角色本", private: "私人信息", updates: "阶段更新", clues: "公共线索", host: "主持手册", ending: "终局材料" } as const;
export type ProductionModule = typeof moduleIds[number];
export const productionLimits = { artifacts: 240, jobs: 40, reviews: 30, content: 100000 } as const;
const id = z.string().min(1).max(100);
const status = z.enum(["running", "completed", "failed", "cancelled"]);
export const artifactSchema = z.object({
  id, logicalKey: z.string().min(1).max(400), module: z.enum(moduleIds), title: z.string().max(12000), audience: z.enum(["player", "host"]),
  characterId: id.nullable(), roundId: id.nullable(), blueprintVersionId: id, version: z.number().int().positive(),
  content: z.string().max(productionLimits.content), createdAt: z.iso.datetime(), plannedPath: z.string().nullable(), origin: z.enum(["mock", "author"]),
});
export type Artifact = z.infer<typeof artifactSchema>;
export const generationJobSchema = z.object({
  id, module: z.enum(moduleIds), blueprintVersionId: id, status, step: z.number().int().min(0).max(2), simulateFailure: z.boolean(),
  error: z.string().nullable(), artifactIds: z.array(id), createdAt: z.iso.datetime(), plannedPath: z.string().nullable(),
});
export type GenerationJob = z.infer<typeof generationJobSchema>;
export const modelIds = ["model-a", "model-b"] as const;
export type ReviewModelId = typeof modelIds[number];
const reviewModelSchema = z.object({ id: z.enum(modelIds), label: z.string(), status, simulateFailure: z.boolean(), error: z.string().nullable() });
export type ReviewModel = z.infer<typeof reviewModelSchema>;
const findingSchema = z.object({
  id, title: z.string(), severity: z.enum(["error", "warning", "info"]), category: z.string(), agreement: z.enum(["consensus", "disagreement"]),
  evidence: z.object({ location: z.string(), excerpt: z.string(), artifactId: id.nullable() }), suggestion: z.string(),
  modelOpinions: z.array(z.object({ modelId: z.enum(modelIds), opinion: z.string() })),
  decision: z.enum(["unhandled", "adopted", "provisional", "rejected"]), reason: z.string().max(3000),
});
export type ReviewFinding = z.infer<typeof findingSchema>;
export type ReviewDecision = Exclude<ReviewFinding["decision"], "unhandled">;
const issueSchema = z.object({ id: z.string(), severity: z.enum(["error", "warning"]), section: z.enum(["overview", "characters", "relationships", "events", "knowledge", "claims", "clues", "rounds", "triggers", "endings"]), recordId: z.string().optional(), message: z.string() });
export const reviewCoordinationSchema = z.object({
  summary: z.string().max(6000),
  mutualChecks: z.array(z.object({ modelId: z.enum(modelIds), findingId: id, conclusion: z.string().max(3000) })).max(400),
  checks: z.array(z.object({ findingId: id, outcome: z.enum(["needs-evidence", "human-test"]), rationale: z.string().max(3000) })).max(200),
  messages: z.array(z.object({ id, role: z.enum(["author", "coordinator"]), findingId: id, content: z.string().max(6000), createdAt: z.iso.datetime() })).max(120),
  proposals: z.array(z.object({
    id, findingId: id, content: z.string().trim().min(1).max(6000), decision: z.enum(["unhandled", "adopted", "provisional", "rejected"]), reason: z.string().max(3000),
    createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), revision: z.number().int().positive(),
    history: z.array(z.object({ content: z.string().max(6000), decision: z.enum(["unhandled", "adopted", "provisional", "rejected"]), reason: z.string().max(3000), updatedAt: z.iso.datetime(), revision: z.number().int().positive() })).max(30),
  })).max(60),
});
export type ReviewCoordination = z.infer<typeof reviewCoordinationSchema>;
export type ReviewProposal = ReviewCoordination["proposals"][number];
export const reviewRunSchema = z.object({
  id, target: z.enum(["blueprint", "manuscript"]), blueprintVersionId: id, blueprintRevision: z.number().int().nonnegative(),
  artifactIds: z.array(id), createdAt: z.iso.datetime(), plannedPath: z.string().nullable(), staticIssues: z.array(issueSchema), models: z.array(reviewModelSchema).length(2),
  findings: z.array(findingSchema), crossReviewDone: z.boolean(),
  coordination: reviewCoordinationSchema.nullable().default(null),
});
export type ReviewRun = z.infer<typeof reviewRunSchema>;
export const productionWorkspaceSchema = z.object({
  artifacts: z.array(artifactSchema).max(productionLimits.artifacts), jobs: z.array(generationJobSchema).max(productionLimits.jobs), reviews: z.array(reviewRunSchema).max(productionLimits.reviews),
});
export type ProductionWorkspace = z.infer<typeof productionWorkspaceSchema>;
export function emptyProduction(): ProductionWorkspace { return { artifacts: [], jobs: [], reviews: [] }; }
export function latestArtifacts(production: ProductionWorkspace | null, blueprintVersionId?: string): Artifact[] {
  const latest = new Map<string, Artifact>();
  production?.artifacts.filter((artifact) => !blueprintVersionId || artifact.blueprintVersionId === blueprintVersionId).forEach((artifact) => latest.set(artifact.logicalKey, artifact));
  return [...latest.values()];
}
export function isReviewStale(project: Project, review: ReviewRun): boolean {
  const blueprint = project.blueprint;
  if (!blueprint || blueprint.revision !== review.blueprintRevision || blueprint.versions.at(-1)?.id !== review.blueprintVersionId) return true;
  if (JSON.stringify(blueprint.draft) !== JSON.stringify(blueprint.versions.find((v) => v.id === review.blueprintVersionId)?.data)) return true;
  return review.target === "manuscript" && JSON.stringify(latestArtifacts(project.production, review.blueprintVersionId).map((a) => a.id).sort()) !== JSON.stringify([...review.artifactIds].sort());
}
export type StaticProductionIssue = BlueprintIssue;

export function hasRunningProduction(production: ProductionWorkspace | null): boolean { return !!production && (production.jobs.some((j) => j.status === "running") || production.reviews.some((r) => r.models.some((m) => m.status === "running"))); }
