import type { BlueprintData } from "@/domain/blueprint";
import { studioArtifactSchema, studioAuditSchema, studioScopedAuditSchema, type StudioArtifact, type StudioAudit } from "@/domain/studio";
import { artifactTargetIssues, type artifactPayload } from "./artifact-plan";

export function auditIssues(audit: StudioAudit, label: string, source?: unknown) {
  const values: string[] = []; const visit = (value: unknown) => { if (typeof value === "string") values.push(value); else if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") Object.values(value).forEach(visit); }; if (source) visit(source);
  return [...(source && audit.evidence.some((entry) => !values.some((value) => value.includes(entry.quote))) ? [`${label}：报告引用无法在冻结资料中核对`] : []),...audit.blocking.map((issue) => `${label}：${issue}`), ...(!audit.contentComplete ? [`${label}：内容尚不完整`] : []), ...(!audit.playerHostIsolation ? [`${label}：玩家与主持信息隔离未通过`] : []), ...(!audit.findingsAddressed ? [`${label}：仍有未处理审查发现`] : [])]; }
export function artifactIssues(blueprint: BlueprintData, artifacts: StudioArtifact[]) {
  const issues: string[] = [];
  if (new Set(artifacts.map((a) => a.id)).size !== artifacts.length) issues.push("正文材料编号重复");
  for (const moduleId of ["character", "private", "updates", "clues", "host", "ending"] as const) if (!artifacts.some((a) => a.module === moduleId)) issues.push(`缺少正文类别：${moduleId}`);
  for (const role of blueprint.characters) for (const moduleId of ["character", "private", "updates"] as const) if (!artifacts.some((a) => a.module === moduleId && a.characterId === role.id && a.audience === "player")) issues.push(`${role.name}缺少${moduleId}材料`);
  const allIds = new Set([...blueprint.characters, ...blueprint.relationships, ...blueprint.events, ...blueprint.knowledge, ...blueprint.clues, ...blueprint.claims, ...blueprint.rounds, ...blueprint.triggers, ...blueprint.endings].map((item) => item.id));
  for (const clue of blueprint.clues.filter((item) => item.characterIds.length === 0)) if (!artifacts.some((artifact) => artifact.module === "clues" && artifact.sourceIds.includes(clue.id))) issues.push(`公共线索“${clue.name}”未覆盖到正文材料`);
  for (const clue of blueprint.clues.filter(item => item.characterIds.length > 0)) {
    const allowed = (artifact: StudioArtifact) => artifact.audience === "player" && ["character", "private", "updates"].includes(artifact.module) && clue.characterIds.includes(artifact.characterId ?? "") && artifact.roundId === clue.roundId;
    const linked = artifacts.filter(artifact => artifact.sourceIds.includes(clue.id));
    if (!linked.some(allowed)) issues.push(`私人线索“${clue.name}”未发放到允许角色的指定轮次材料`);
    if (linked.some(artifact => artifact.audience === "player" && !allowed(artifact))) issues.push(`私人线索“${clue.name}”存在角色或发放轮次越界`);
  }
  for (const artifact of artifacts) {
    if (!artifact.sourceIds.length || artifact.sourceIds.some((sourceId) => !allIds.has(sourceId))) issues.push(`${artifact.title}的蓝图来源关联缺失或无效`);
    if (artifact.module === "clues" && artifact.sourceIds.some((sourceId) => blueprint.clues.some((clue) => clue.id === sourceId && clue.characterIds.length > 0))) issues.push(`${artifact.title}把限定读者线索放入公共线索`);
    if (artifact.module === "clues" && artifact.characterId !== null) issues.push(`${artifact.title}的公共线索受众不正确`);
    if (["character", "private", "updates"].includes(artifact.module) && !artifact.sourceIds.includes(artifact.characterId ?? "")) issues.push(`${artifact.title}未关联所属角色来源`);
    if (artifact.module === "host" || artifact.module === "ending") { if (artifact.audience !== "host" || artifact.characterId !== null) issues.push(`${artifact.title}的主持受众不正确`); }
    else if (artifact.audience !== "player") issues.push(`${artifact.title}的玩家受众不正确`);
    if (["character", "private", "updates"].includes(artifact.module) && !blueprint.characters.some((role) => role.id === artifact.characterId)) issues.push(`${artifact.title}缺少有效角色`);
    if (artifact.module === "updates" && !blueprint.rounds.some((round) => round.id === artifact.roundId)) issues.push(`${artifact.title}缺少有效发放轮次`);
    if (/\[(?:待补充|待生成|TODO)|占位正文|此处省略/.test(artifact.content)) issues.push(`${artifact.title}仍含正文占位内容`);
  }
  return issues;
}
export function reviewContractIssues(unitId: string, value: unknown, payload: unknown): string[] {
  const data = payload as { blueprint?: BlueprintData; snapshot?: { blueprint: BlueprintData; artifacts: StudioArtifact[] } };
  if (unitId.startsWith("gen-")) return artifactTargetIssues((payload as ReturnType<typeof artifactPayload>).target, studioArtifactSchema.parse(value));
  if (unitId.startsWith("sr-")) {
    const audit = studioScopedAuditSchema.parse(value);
    const scoped = payload as { blueprint: BlueprintData; sources: { partId: string; hash: string; content: string }[] };
    const issues = auditIssues({ ...audit, blocking: [], contentComplete: true, playerHostIsolation: true, findingsAddressed: true }, "报告依据", { blueprint: scoped.blueprint, sources: scoped.sources });
    if (Buffer.byteLength(JSON.stringify(value)) > 40_000) issues.push("单段报告超过40000字节容量，未采用");
    if (audit.coverage.length !== scoped.sources.length || new Set(audit.coverage.map(entry => entry.partId)).size !== scoped.sources.length
      || scoped.sources.some(source => !audit.coverage.some(entry => entry.partId === source.partId && entry.hash === source.hash && source.content.includes(entry.quote)))) issues.push("分段报告未完整覆盖指定原文，或片段哈希/摘录无法核对");
    return issues;
  }
  const audit = studioAuditSchema.parse(value);
  // Contract failures are retryable; valid blocking opinions remain saved and require author changes.
  return auditIssues({ ...audit, blocking: [], contentComplete: true, playerHostIsolation: true, findingsAddressed: true }, "报告依据", unitId === "designGate" ? data.blueprint : data.snapshot ?? payload);
}
