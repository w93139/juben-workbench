import { projectSchema } from "../../src/domain/models";
import { emptyResearch } from "../../src/domain/research";
import { emptyBlueprintData } from "../../src/domain/blueprint";
import { emptyWorkbench } from "../../src/domain/workbench";
import type { StudioAudit } from "../../src/domain/studio";

export function backupFixture() {
  const now = "2026-09-18T00:00:00.000Z";
  const blueprint = { ...emptyBlueprintData(), premise: "自造完整备份测试大纲", truth: "资料更换出于主动选择" };
  const project = projectSchema.parse({ id: "project-backup-source", title: "完整备份原项目", note: "旧字段也要保存", template: "blank", readOnly: false, revision: 7, createdAt: now, updatedAt: now, decisions: [], research: emptyResearch(),
    blueprint: { draft: blueprint, versions: [{ id: "old-v1", label: "旧版蓝图", createdAt: now, data: blueprint }], savedAt: now, revision: 1, sourceLabel: "旧版自造记录" },
    outputSettings: { rootPath: "/test-output-only", directory: null, folders: { analysis: "拆解", mechanisms: "机制", direction: "方向", blueprint: "蓝图", generation: "正文", review: "审查", playtest: "试玩", export: "导出" } },
    folderPlan: { sourceRevision: 0, status: "running", progress: 50, selectedChoiceId: null, updatedAt: now, plannedPath: "/test-output-only/plan" },
    production: { artifacts: [{ id: "old-a", logicalKey: "host", module: "host", title: "旧版主持稿", audience: "host", characterId: null, roundId: null, blueprintVersionId: "old-v1", version: 1, content: "保留旧版正文", createdAt: now, plannedPath: "/test-output-only/host", origin: "author" }], jobs: [{ id: "old-job", module: "host", blueprintVersionId: "old-v1", status: "running", step: 1, simulateFailure: true, error: null, artifactIds: ["old-a"], createdAt: now, plannedPath: "/test-output-only/job" }], reviews: [] },
  });
  const state = emptyWorkbench(); state.revision = 9; state.sourceRevision = 2; state.blueprintRevision = 3; state.blueprint = blueprint;
  state.documents = [{ id: "d", name: "引用材料.txt", text: "自造原文内容", size: 20, status: "read", method: "text", warnings: [], excluded: false }, { id: "excluded", name: "排除.txt", text: "自造排除内容", size: 20, status: "read", method: "text", warnings: ["保留提醒"], excluded: true }];
  state.analysis = { outline: "原材料概览", directions: ["one", "two"].map(id => ({ id, title: id, summary: "重建动机", outline: "核验与选择", risk: "真人试玩待完成" })), sourceRefs: [{ documentId: "d", location: "开头", quote: "自造原文内容" }], unknowns: ["尚未明确的体验"] };
  state.analysisSourceRevision = 2; state.choiceId = "one"; state.instructions = "保留有后果的选择"; state.blueprintChoiceId = "one"; state.blueprintSourceRevision = 2;
  state.versions = Array.from({ length: 20 }, (_, revision) => ({ revision, data: { ...blueprint, premise: `自造历史${revision}` } }));
  state.blueprintDrafts = Array.from({ length: 12 }, (_, i) => ({ id: crypto.randomUUID(), revision: 1, baseRevision: i ? 9 : 8, baseBlueprintRevision: 3, data: { ...blueprint, premise: `自造草稿${i}` }, updatedAt: now }));
  const report: StudioAudit = { summary: "仅用于结构测试的审查记录", blocking: [], warnings: ["尚未真人试玩"], evidence: [{ location: "测试大纲", quote: blueprint.premise, conclusion: "结构存在" }], contentComplete: true, playerHostIsolation: true, findingsAddressed: true, humanPlaytest: "not-run" };
  state.review = { kind: "review", passed: true, validationId: crypto.randomUUID(), blueprintFingerprint: "b".repeat(64), blueprint, issues: [], humanPlaytest: "not-run", artifacts: (["character", "private", "updates", "clues", "host", "ending"] as const).map((module, i) => ({ id: `fixture-a${i}`, module, title: `备份正文${module}`, content: `自造正文${i}`, audience: i >= 4 ? "host" as const : "player" as const, characterId: null, roundId: null, sourceIds: [] })), reports: { designGate: report, independentA: report, independentB: report, mutualA: report, mutualB: report, coordinator: report } };
  state.reviewBlueprintRevision = 3; return { project, state, now };
}
