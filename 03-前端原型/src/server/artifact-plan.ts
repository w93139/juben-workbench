import { createHash } from "node:crypto";
import { z } from "zod";
import type { BlueprintData } from "@/domain/blueprint";
import { studioArtifactSchema, type StudioArtifact } from "@/domain/studio";
import { SINGLE_CONTEXT_BYTES } from "@/domain/analysis-limits";
import { LocalApiError } from "./local-security";

const id = z.string().min(1).max(100);
export const artifactTargetSchema = z.object({
  id, module: studioArtifactSchema.shape.module, audience: studioArtifactSchema.shape.audience,
  characterId: id.nullable(), roundId: id.nullable(), endingId: id.nullable(), label: z.string().max(500),
  requiredSourceIds: z.array(id).max(200),
}).strict();
export type ArtifactTarget = z.infer<typeof artifactTargetSchema>;
export const artifactPlanSchema = z.object({ version: z.literal("modular-artifacts/1"), targets: z.array(artifactTargetSchema).max(240) }).strict()
  .refine(plan => new Set(plan.targets.map(target => target.id)).size === plan.targets.length, "生成单元不能重复");
export type ArtifactPlan = z.infer<typeof artifactPlanSchema>;
export function artifactPayload(blueprint: BlueprintData, target: ArtifactTarget) {
  const rows = [...blueprint.characters, ...blueprint.relationships, ...blueprint.events, ...blueprint.knowledge, ...blueprint.claims, ...blueprint.clues, ...blueprint.rounds, ...blueprint.triggers, ...blueprint.endings];
  const roundIndex = blueprint.rounds.findIndex(round => round.id === target.roundId);
  const forbidden = new Set(blueprint.clues.filter(clue => {
    if (target.audience === "host") return false;
    if (clue.characterIds.length) return !(target.module === "updates" && clue.characterIds.includes(target.characterId ?? "") && clue.roundId === target.roundId);
    if (target.module === "clues") return clue.roundId !== target.roundId;
    const clueRound = blueprint.rounds.findIndex(round => round.id === clue.roundId);
    return target.module !== "updates" || roundIndex < 0 || clueRound < 0 || clueRound > roundIndex;
  }).map(clue => clue.id));
  return { blueprint, target: { ...target, allowedSourceIds: rows.map(row => row.id).filter(id => !forbidden.has(id)) } };
}
export function buildArtifactPlan(blueprint: BlueprintData): ArtifactPlan {
  const rows = [...blueprint.characters, ...blueprint.relationships, ...blueprint.events, ...blueprint.knowledge, ...blueprint.claims, ...blueprint.clues, ...blueprint.rounds, ...blueprint.triggers, ...blueprint.endings];
  const ids = rows.map(row => row.id);
  if (new Set(ids).size !== ids.length) throw new LocalApiError(400, "蓝图不同章节存在重复编号，无法唯一核对正文来源。请先修订关联编号，未调用模型。");
  const targets: ArtifactTarget[] = [];
  const add = (module: StudioArtifact["module"], characterId: string | null, roundId: string | null, endingId: string | null, label: string, required: string[]) => {
    const audience = module === "host" || module === "ending" ? "host" : "player";
    const requiredSourceIds = [...new Set(required)];
    if (requiredSourceIds.length > 200) throw new LocalApiError(413, "单份正文必需来源超过200条，未截断或发起模型调用。请拆分蓝图轮次或关联。");
    targets.push({ id: `gen-${createHash("sha256").update(JSON.stringify([module, characterId, roundId, endingId])).digest("hex").slice(0, 32)}`, module, audience, characterId, roundId, endingId, label: label.slice(0, 500), requiredSourceIds });
  };
  for (const role of blueprint.characters) {
    const relations = blueprint.relationships.filter(row => row.fromId === role.id || row.toId === role.id).map(row => row.id);
    add("character", role.id, null, null, `${role.name} · 角色本`, [role.id, ...relations]);
    add("private", role.id, null, null, `${role.name} · 私人信息`, [role.id]);
    for (const round of blueprint.rounds) add("updates", role.id, round.id, null, `${role.name} · ${round.name} · 阶段更新`, [role.id, round.id, ...blueprint.knowledge.filter(row => row.characterId === role.id && row.roundId === round.id).map(row => row.id), ...blueprint.clues.filter(row => row.characterIds.includes(role.id) && row.roundId === round.id).map(row => row.id)]);
  }
  for (const round of blueprint.rounds) add("clues", null, round.id, null, `${round.name} · 公共材料`, [round.id, ...blueprint.clues.filter(row => !row.characterIds.length && row.roundId === round.id).map(row => row.id)]);
  add("host", null, null, null, "主持开场与总流程", [...blueprint.characters, ...blueprint.rounds, ...blueprint.events].map(row => row.id));
  for (const round of blueprint.rounds) add("host", null, round.id, null, `${round.name} · 主持手册`, [round.id, ...blueprint.triggers.filter(row => row.roundId === round.id).map(row => row.id)]);
  for (const ending of blueprint.endings) add("ending", null, null, ending.id, `${ending.name} · 终局材料`, [ending.id]);
  if (targets.length > 240) throw new LocalApiError(413, `正文计划需要${targets.length}份材料，超过240份上限；未截断或调用模型。请调整角色、轮次或终局规模。`);
  const plan = artifactPlanSchema.parse({ version: "modular-artifacts/1", targets });
  for (const target of plan.targets) if (Buffer.byteLength(JSON.stringify(artifactPayload(blueprint, target))) > SINGLE_CONTEXT_BYTES) throw new LocalApiError(413, "冻结蓝图与单元目标超过600KB生成容量，未调用模型。请缩小蓝图规模；不会截断正文或来源。");
  return plan;
}
export function artifactTargetIssues(target: ReturnType<typeof artifactPayload>["target"], artifact: StudioArtifact): string[] {
  const issues: string[] = [];
  for (const key of ["id", "module", "audience", "characterId", "roundId"] as const) if (artifact[key] !== target[key]) issues.push(`${target.label}的${key}与冻结生成目标不一致`);
  if (new Set(artifact.sourceIds).size !== artifact.sourceIds.length || artifact.sourceIds.some(id => !target.allowedSourceIds.includes(id)) || target.requiredSourceIds.some(id => !artifact.sourceIds.includes(id))) issues.push(`${target.label}的蓝图来源关联缺失或无效，或线索发放越界`);
  if (/\[(?:待补充|待生成|TODO)|占位正文|此处省略/.test(artifact.content)) issues.push(`${target.label}仍含正文占位内容`);
  return issues;
}
export function artifactPlanDigest(plan: ArtifactPlan) { return createHash("sha256").update(JSON.stringify(plan)).digest("hex"); }
