import { outputPath } from "@/domain/output-settings";
import { blueprintDataSchema, type BlueprintData } from "@/domain/blueprint";
import { createFolderBlueprint } from "@/mocks/folder-blueprints";
import { folderPlanCurrent, usesFolderPlan } from "@/domain/folder-plan";
import type { Project } from "@/domain/models";
import { folderPlanChoices } from "@/mocks/folder-plans";
import { ServiceError } from "./contracts";

function invalid(message: string): never { throw new ServiceError("INVALID_INPUT", message); }
function eligible(project: Project) {
  if (!usesFolderPlan(project) || !project.research.documents.some((document) => document.origin === "local-metadata")) invalid("请先上传剧本文件夹；当前入口只处理自己的材料项目。");
}
function archiveProposal(project: Project, now: string, reason: string) {
  const plan = project.folderPlan;
  if (!plan?.proposal || !plan.selectedChoiceId) return;
  if (plan.proposalHistory.length >= 30) invalid("已有30份方案历史，请继续编辑故事蓝图；当前方案与记录不会被删除。");
  plan.proposalHistory.push({ id: `proposal-${plan.sourceRevision}-${plan.proposalHistory.length + 1}`, choiceId: plan.selectedChoiceId, sourceRevision: plan.sourceRevision, savedAt: now, reason, data: structuredClone(plan.proposal) });
}
export function start(project: Project, now: string) {
  if (!project.research.documents.some(d => d.origin === "local-metadata")) invalid("请先导入自己的剧本材料，再进入方案讨论。");
  if (project.folderPlan?.status === "running") invalid("模拟拆解正在进行，请等待或取消。");
  archiveProposal(project, now, "重新拆解前的方案");
  project.folderPlan = { sourceRevision: project.research.materialRevision, status: "running", progress: 0, selectedChoiceId: null, updatedAt: now, messages: project.folderPlan?.messages ?? [], proposalHistory: project.folderPlan?.proposalHistory ?? [], proposal: null, plannedPath: outputPath(project.outputSettings, "analysis") };
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
  if (project.folderPlan!.selectedChoiceId === choiceId && project.folderPlan!.proposal) return;
  archiveProposal(project, now, "更换方向前的方案");
  project.folderPlan!.selectedChoiceId = choiceId as NonNullable<Project["folderPlan"]>["selectedChoiceId"];
  project.folderPlan!.proposal = createFolderBlueprint(folderPlanChoices.find((choice) => choice.id === choiceId)!);
  project.folderPlan!.updatedAt = now;
}
export function initializeBlueprint(project: Project, now: string) {
  eligible(project);
  if (!folderPlanCurrent(project)) invalid("当前材料版本尚未完成模拟拆解，请先重新处理。");
  const choice = folderPlanChoices.find((item) => item.id === project.folderPlan?.selectedChoiceId);
  if (!choice) invalid("请先选择一项写作方向。");
  if (project.blueprint) invalid("已有故事草稿已保留。请进入设计故事编辑，不会用新方案覆盖。");
  project.blueprint = { draft: structuredClone(project.folderPlan!.proposal ?? createFolderBlueprint(choice)), revision: 1, versions: [], savedAt: now, sourceLabel: "原创方案蓝图 · 通用模拟结构＋作者选择，非上传正文分析；具体事实和角色经历待完善" };
  project.decisions = project.decisions.map((decision) => decision.id === "experience" ? { ...decision, detail: choice.experience, status: "provisional", nature: "original", source: null } : decision.id === "cast" ? { ...decision, detail: `${choice.players}人，${choice.minutes}分钟；由用户选择的通用建议，待细化。`, status: "provisional", nature: "original", source: null } : decision);
}

export function sendMessage(project: Project, text: string, now: string, uuid: () => string) {
  eligible(project);
  const plan = project.folderPlan;
  const choice = folderPlanChoices.find((item) => item.id === plan?.selectedChoiceId);
  if (!plan || !folderPlanCurrent(project) || !choice) invalid("先完成拆解流程并选择一个方向，再讨论方案。");
  const message = text.trim();
  if (!message || message.length > 3000) invalid("请填写1至3000字的讨论内容。");
  if (plan.messages.length > 78) invalid("本轮对话已达80条，请先保存方案；已有记录不会删除。");
  const common = { createdAt: now, sourceRevision: plan.sourceRevision, choiceId: choice.id };
  plan.messages.push({ ...common, id: uuid(), role: "user", text: message });
  plan.messages.push({ ...common, id: uuid(), role: "coordinator", text: `已将你的补充保留在“${choice.title}”的上下文中。当前方案包含${(plan.proposal ?? createFolderBlueprint(choice)).characters.length}个角色，围绕三幕推进。

建议先核对：这项调整是否改变事件原因、必要线索的获取、角色的选择后果或总时长。如果改变其中一项，相关部分也需要一起复核。

你的补充：“${message}”

这是本地模拟回复，尚不能理解任意自然语言并自动重写。请在下方方案蓝图中直接调整故事大纲和核心真相，保存后再采用；这条回复本身不会改动故事。` });
  plan.updatedAt = now;
}
export function saveProposal(project: Project, input: BlueprintData, now: string) {
  eligible(project);
  if (!folderPlanCurrent(project) || !project.folderPlan?.selectedChoiceId) invalid("请先选择当前材料版本的方向。");
  const parsed = blueprintDataSchema.safeParse(input);
  if (!parsed.success || !parsed.data.premise.trim() || !parsed.data.truth.trim()) invalid("请保留有效的大纲和核心真相，单个文字字段最多12000字。");
  if (JSON.stringify(project.folderPlan.proposal) !== JSON.stringify(parsed.data)) archiveProposal(project, now, "作者修改前的方案");
  project.folderPlan.proposal = parsed.data;
  project.folderPlan.updatedAt = now;
}
