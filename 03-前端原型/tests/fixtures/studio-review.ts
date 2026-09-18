import { completeBlueprint } from "./blueprint";
import { reviewUnits } from "../../src/domain/studio-production";
import type { StudioArtifact, StudioAudit, StudioReviewProgress } from "../../src/domain/studio";

export const reviewBlueprint = completeBlueprint;
export const reviewAudit = (): StudioAudit => ({ summary: "自造审查意见，不代表真实模型质量", blocking: [], warnings: ["阅读负担需真人试玩"], evidence: [{ location: "蓝图大纲", quote: completeBlueprint().premise, conclusion: "核对指定输入" }], contentComplete: true, playerHostIsolation: true, findingsAddressed: true, humanPlaytest: "not-run" });
export function reviewArtifacts(): StudioArtifact[] {
  const artifacts: StudioArtifact[] = ["A", "B"].flatMap(characterId => (["character", "private", "updates"] as const).map(module => ({ id: `${characterId}-${module}`, module, characterId, roundId: module === "updates" ? "R1" : null, audience: "player" as const, title: `${characterId}的${module}材料`, content: `${characterId}选择是否公开档案，自造完整测试段落。`, sourceIds: [characterId] })));
  artifacts.push({ id: "public", module: "clues", audience: "player", characterId: null, roundId: "R1", title: "照片", content: "自造公开照片文字", sourceIds: ["C1"] }, { id: "host", module: "host", audience: "host", characterId: null, roundId: null, title: "主持手册", content: "主持发放、兜底及结束流程", sourceIds: ["T1"] }, { id: "ending", module: "ending", audience: "host", characterId: null, roundId: null, title: "终局材料", content: "公开后的结果", sourceIds: ["END1"] });
  return artifacts;
}
export function reviewCheckpoint(runId = crypto.randomUUID(), revision = 5): StudioReviewProgress {
  return { runId, revision, steps: reviewUnits.map(unit => ({ id: unit.id, state: ["designGate", "artifacts", "independentA"].includes(unit.id) ? "saved" : unit.id === "independentB" ? "interrupted" : "pending" })), review: { kind: "review", passed: false, issues: ["生成与审查尚未完成"], blueprint: completeBlueprint(), blueprintFingerprint: "a".repeat(64), artifacts: reviewArtifacts(), reports: { designGate: reviewAudit(), independentA: reviewAudit() }, humanPlaytest: "not-run" } };
}
