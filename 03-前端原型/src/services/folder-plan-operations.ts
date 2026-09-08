import { outputPath } from "@/domain/output-settings";
import { emptyBlueprintData } from "@/domain/blueprint";
import { folderPlanCurrent, usesFolderPlan } from "@/domain/folder-plan";
import type { Project } from "@/domain/models";
import { folderPlanChoices } from "@/mocks/folder-plans";
import { ServiceError } from "./contracts";

function invalid(message: string): never { throw new ServiceError("INVALID_INPUT", message); }
function eligible(project: Project) {
  if (!usesFolderPlan(project) || !project.research.documents.some((document) => document.origin === "local-metadata")) invalid("请先上传剧本文件夹；当前入口只处理自己的材料项目。");
}
export function start(project: Project, now: string) {
  eligible(project);
  if (project.folderPlan?.status === "running") invalid("模拟拆解正在进行，请等待或取消。");
  project.folderPlan = { sourceRevision: project.research.materialRevision, status: "running", progress: 0, selectedChoiceId: null, updatedAt: now, plannedPath: outputPath(project.outputSettings, "analysis") };
}
export function advance(project: Project, now: string) {
  const plan = project.folderPlan;
  if (!plan || plan.status !== "running") invalid("当前没有运行中的拆解流程。");
  if (plan.sourceRevision !== project.research.materialRevision) { plan.status = "cancelled"; plan.updatedAt = now; return; }
  plan.progress = plan.progress === 0 ? 50 : 100;
  if (plan.progress === 100) plan.status = "succeeded";
  plan.updatedAt = now;
}
export function cancel(project: Project, now: string) {
  if (project.folderPlan?.status !== "running") invalid("当前没有可取消的拆解流程。");
  project.folderPlan.status = "cancelled"; project.folderPlan.updatedAt = now;
}
export function choose(project: Project, choiceId: string, now: string) {
  eligible(project);
  if (!folderPlanCurrent(project)) invalid("材料已变化或流程未完成，请先重新运行模拟拆解。");
  if (!folderPlanChoices.some((choice) => choice.id === choiceId)) invalid("请选择当前列出的写作方向。");
  project.folderPlan!.selectedChoiceId = choiceId as NonNullable<Project["folderPlan"]>["selectedChoiceId"];
  project.folderPlan!.updatedAt = now;
}
export function initializeBlueprint(project: Project, now: string) {
  eligible(project);
  if (!folderPlanCurrent(project)) invalid("当前材料版本尚未完成模拟拆解，请先重新处理。");
  const choice = folderPlanChoices.find((item) => item.id === project.folderPlan?.selectedChoiceId);
  if (!choice) invalid("请先选择一项写作方向。");
  if (project.blueprint) invalid("已有故事草稿已保留。请进入设计故事编辑，不会用新方案覆盖。");
  const premise = `${choice.premise}\n\n写作方向：${choice.genre}，${choice.players}人，计划${choice.minutes}分钟。${choice.experience}\n\n${choice.outline.map((act, index) => `第${index + 1}幕：${act}`).join("\n")}\n\n抽象玩法建议：${choice.mechanism}\n待处理风险：${choice.risk}\n\n此草稿来自通用预设，由用户选择；未分析所上传剧本正文。`;
  project.blueprint = { draft: { ...emptyBlueprintData(), premise }, revision: 1, versions: [], savedAt: now, sourceLabel: "原创方案草稿 · 通用预设，非上传文件分析结果；人物、客观真相、因果与线索待创作" };
  project.decisions = project.decisions.map((decision) => decision.id === "experience" ? { ...decision, detail: choice.experience, status: "provisional", nature: "original", source: null } : decision.id === "cast" ? { ...decision, detail: `${choice.players}人，${choice.minutes}分钟；由用户选择的通用建议，待细化。`, status: "provisional", nature: "original", source: null } : decision);
}
