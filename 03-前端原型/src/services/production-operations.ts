import { z } from "zod";
import { checkBlueprint } from "@/domain/blueprint";
import type { Project } from "@/domain/models";
import { outputPath } from "@/domain/output-settings";
import { emptyProduction, isReviewStale, hasRunningProduction, latestArtifacts, moduleIds, productionLimits, type ProductionModule, type ReviewModelId, type ReviewDecision, type ReviewRun } from "@/domain/production";
import { mockCoordination, mockRevisionProposal } from "@/mocks/production-coordination";
import { mockArtifacts, mockReviewOpinions } from "@/mocks/production";
import { ServiceError } from "./contracts";

const invalid = (message: string): never => { throw new ServiceError("INVALID_INPUT", message); };
const workspace = (p: Project) => p.production ??= emptyProduction();
function version(p: Project, id: string) {
  const value = p.blueprint?.versions.find((v) => v.id === id);
  return value ?? invalid("请选择已保存的蓝图版本；草稿不能直接生成或审查。");
}
function idle(p: Project, excludeReview?: string) {
  if (p.production?.jobs.some((j) => j.status === "running") || p.production?.reviews.some((r) => r.id !== excludeReview && r.models.some((m) => m.status === "running"))) invalid("已有任务正在处理，请等待完成或先取消。");
}
function job(p: Project, id: string) { return workspace(p).jobs.find((j) => j.id === id) ?? invalid("没有找到这次生成任务。"); }
function review(p: Project, id: string) { return workspace(p).reviews.find((r) => r.id === id) ?? invalid("没有找到这次审查记录。"); }
function newId(p: Project, prefix: string, uuid: () => string) {
  const id = `${prefix}-${uuid()}`;
  const production = workspace(p);
  const ids = [...production.artifacts, ...production.jobs, ...production.reviews, ...production.reviews.flatMap((r) => r.findings)].map((entry) => entry.id);
  if (ids.includes(id)) invalid("记录编号冲突，原有资料已保留，请重试。");
  return id;
}
function limit(length: number, maximum: number, label: string) { if (length >= maximum) invalid(`${label}记录已达本机原型上限（${maximum}条），请先备份项目；不会删除旧记录。`); }
function availableArtifacts(p: Project, count: number) { if ((p.production?.artifacts.length ?? 0) + count > productionLimits.artifacts) invalid(`正文版本最多保留${productionLimits.artifacts}份，请先备份项目；旧版本不会被删除。`); }

export function startGeneration(p: Project, module: ProductionModule, versionId: string, fail: boolean, now: string, uuid: () => string) {
  if (!z.enum(moduleIds).safeParse(module).success) invalid("请选择有效的正文模块。");
  idle(p); const source = version(p, versionId); const production = workspace(p);
  limit(production.jobs.length, productionLimits.jobs, "生成任务");
  const drafts = mockArtifacts(source.data, module);
  if (!drafts.length) invalid("此版本没有符合读者范围的材料。请先补充对应角色、可知信息或公共线索。");
  if (drafts.some((d) => d.content.length > productionLimits.content)) invalid("此模块内容超出单份正文限制，请拆分蓝图内容后重试。");
  availableArtifacts(p, drafts.length);
  production.jobs.push({ id: newId(p, "generation", uuid), module, blueprintVersionId: source.id, status: "running", step: 0, simulateFailure: fail, error: null, artifactIds: [], createdAt: now, plannedPath: outputPath(p.outputSettings, "generation") });
}
export function advanceGeneration(p: Project, id: string, now: string, uuid: () => string) {
  const current = job(p, id); if (current.status !== "running") invalid("这次生成已经停止，请重新查看任务状态。");
  if (current.step === 0) { current.step = 1; return; }
  if (current.simulateFailure) { current.status = "failed"; current.error = "模拟生成失败，未写入正文。可重试本任务。"; return; }
  const drafts = mockArtifacts(version(p, current.blueprintVersionId).data, current.module);
  const production = workspace(p); availableArtifacts(p, drafts.length);
  for (const draft of drafts) {
    const number = Math.max(0, ...production.artifacts.filter((a) => a.logicalKey === draft.logicalKey).map((a) => a.version)) + 1;
    const artifact = { ...draft, id: newId(p, "artifact", uuid), blueprintVersionId: current.blueprintVersionId, version: number, createdAt: now, plannedPath: current.plannedPath, origin: "mock" as const };
    production.artifacts.push(artifact); current.artifactIds.push(artifact.id);
  }
  current.status = "completed"; current.step = 2;
}
export function cancelGeneration(p: Project, id: string) { const current = job(p, id); if (current.status !== "running") invalid("只有进行中的任务可以取消。"); current.status = "cancelled"; current.error = null; }
export function retryGeneration(p: Project, id: string) { idle(p); const current = job(p, id); if (!["failed", "cancelled"].includes(current.status)) invalid("仅失败或取消的任务可以重试。"); current.status = "running"; current.step = 0; current.simulateFailure = false; current.error = null; }
export function saveArtifact(p: Project, id: string, content: string, now: string, uuid: () => string) {
  if (hasRunningProduction(p.production)) invalid("请等待任务完成或取消后再修改正文。");
  const parsed = z.string().trim().min(1).max(productionLimits.content).safeParse(content);
  if (!parsed.success) invalid(`正文不能为空，且不得超过${productionLimits.content}字。`);
  const production = workspace(p); const source = production.artifacts.find((a) => a.id === id) ?? invalid("没有找到这份正文。");
  if (latestArtifacts(production).find((a) => a.logicalKey === source.logicalKey)?.id !== id) invalid("这份正文已有新版本，请先打开最新版再修改。");
  availableArtifacts(p, 1);
  production.artifacts.push({ ...source, id: newId(p, "artifact", uuid), version: source.version + 1, content: parsed.data!, origin: "author", createdAt: now });
}
export function startReview(p: Project, target: "blueprint" | "manuscript", versionId: string, failModel: ReviewModelId | undefined, now: string, uuid: () => string) {
  if (!z.enum(["blueprint", "manuscript"]).safeParse(target).success || (failModel !== undefined && !z.enum(["model-a", "model-b"]).safeParse(failModel).success)) invalid("请选择有效的审查范围。");
  idle(p); const source = version(p, versionId); const production = workspace(p); limit(production.reviews.length, productionLimits.reviews, "审查");
  const artifacts = latestArtifacts(production, versionId);
  if (target === "manuscript" && !artifacts.length) invalid("此蓝图版本尚无正文，请先生成至少一个模块。");
  production.reviews.push({ id: newId(p, "review", uuid), target, blueprintVersionId: versionId, blueprintRevision: p.blueprint!.revision,
    artifactIds: target === "manuscript" ? artifacts.map((a) => a.id) : [], createdAt: now, plannedPath: outputPath(p.outputSettings, "review"), staticIssues: checkBlueprint(source.data), crossReviewDone: false, findings: [], coordination: null,
    models: (["model-a", "model-b"] as const).map((id) => ({ id, label: id === "model-a" ? "模拟模型 A · 结构" : "模拟模型 B · 体验", status: "running", simulateFailure: failModel === id, error: null })),
  });
}
function model(p: Project, reviewId: string, modelId: ReviewModelId) { const run = review(p, reviewId); return { run, current: run.models.find((m) => m.id === modelId) ?? invalid("没有找到此模型任务。") }; }
function evidence(p: Project, run: ReviewRun) {
  if (run.target === "manuscript") { const artifact = workspace(p).artifacts.find((a) => a.id === run.artifactIds[0]) ?? invalid("审查引用的正文已缺失。"); return { location: `${artifact.title} / v${artifact.version} / 开头`, excerpt: artifact.content.slice(0, 260), artifactId: artifact.id }; }
  const source = version(p, run.blueprintVersionId);
  const trigger = source.data.triggers[0];
  if (trigger) return { location: `${source.label} / 主持触发 / ${trigger.id}`, excerpt: `触发条件：${trigger.condition}\n主持操作：${trigger.action}\n未触发处理：${trigger.fallback}`.slice(0, 260), artifactId: null };
  const round = source.data.rounds[0];
  if (round) return { location: `${source.label} / 轮次 / ${round.id}`, excerpt: `${round.name}\n玩家行动：${round.activity}\n本轮揭示：${round.reveal}`.slice(0, 260), artifactId: null };
  return { location: `${source.label} / 故事简介`, excerpt: source.data.premise.slice(0, 260) || "（故事简介为空）", artifactId: null };
}
export function advanceReviewModel(p: Project, reviewId: string, modelId: ReviewModelId, uuid: () => string) {
  const { run, current } = model(p, reviewId, modelId); if (current.status !== "running") invalid("这侧模型已经停止。");
  if (current.simulateFailure) { current.status = "failed"; current.error = "模拟模型失败，另一侧结果已保留；可单独重试。"; return; }
  const opinions = mockReviewOpinions(run.target, evidence(p, run), modelId);
  opinions.forEach((opinion) => {
    const existing = run.findings.find((f) => f.title === opinion.title);
    if (existing) existing.modelOpinions.push(...opinion.modelOpinions);
    else run.findings.push({ ...opinion, id: newId(p, "finding", uuid) });
  });
  current.status = "completed"; current.error = null;
}
export function cancelReviewModel(p: Project, reviewId: string, modelId: ReviewModelId) { const { current } = model(p, reviewId, modelId); if (current.status !== "running") invalid("只有进行中的模型可以取消。"); current.status = "cancelled"; current.error = null; }
export function retryReviewModel(p: Project, reviewId: string, modelId: ReviewModelId) { idle(p, reviewId); const { run, current } = model(p, reviewId, modelId); if (run.crossReviewDone || !["failed", "cancelled"].includes(current.status)) invalid("只可重试未完成的模型。"); current.status = "running"; current.simulateFailure = false; current.error = null; }
export function crossReview(p: Project, reviewId: string) { const run = review(p, reviewId); if (run.crossReviewDone || run.models.some((m) => m.status !== "completed")) invalid("需要两侧完成，且每次只进行一轮模拟互审。"); run.crossReviewDone = true; run.coordination = mockCoordination(run); }
export function decideReviewFinding(p: Project, reviewId: string, findingId: string, decision: ReviewDecision, reason: string) {
  const run = review(p, reviewId); const finding = run.findings.find((f) => f.id === findingId) ?? invalid("没有找到这条意见。");
  if (!z.enum(["adopted", "provisional", "rejected"]).safeParse(decision).success || !z.string().trim().min(1).max(3000).safeParse(reason).success) invalid("请选择处理方式并填写理由（1–3000字）。");
  finding.decision = decision; finding.reason = reason.trim();
}


function editableCoordination(p: Project, reviewId: string) {
  const run = review(p, reviewId);
  idle(p);
  if (isReviewStale(p, run)) invalid("资料已变化，旧审查仅供查看。请用最新版本重新审查后再讨论修订。");
  if (!run.crossReviewDone || !run.coordination) invalid("请先完成两路独审、一次互审与主 Agent 核对。");
  return { run, coordination: run.coordination! };
}
export function sendReviewMessage(p: Project, reviewId: string, findingId: string, message: string, now: string, uuid: () => string) {
  const { run, coordination } = editableCoordination(p, reviewId);
  const finding = run.findings.find((item) => item.id === findingId) ?? invalid("请选择本轮审查的问题作为对话上下文。");
  const parsed = z.string().trim().min(1).max(2000).safeParse(message);
  if (!parsed.success) invalid("请输入1至2000字的修改想法。");
  if (coordination.messages.length + 2 > 120 || coordination.proposals.length >= 60) invalid("本轮对话已达保存上限。请先备份并开启新一轮审查，历史不会删除。");
  const content = mockRevisionProposal(run, finding, parsed.data!);
  const ids = new Set([...coordination.messages, ...coordination.proposals].map((item) => item.id));
  const nextId = (prefix: string) => { const value = `${prefix}-${uuid()}`; if (ids.has(value)) invalid("对话编号冲突，请重试。"); ids.add(value); return value; };
  coordination.messages.push({ id: nextId("author"), role: "author", findingId, content: parsed.data!, createdAt: now });
  coordination.messages.push({ id: nextId("coordinator"), role: "coordinator", findingId, content: `我已将你的要求与“${finding.title.slice(0, 400)}”关联，保留当前审查快照中的证据位置。下面提供可编辑的修订方案；请核对后选择。此回复为本地模板模拟，未作语义分析。`, createdAt: now });
  coordination.proposals.push({ id: nextId("proposal"), findingId, content, decision: "unhandled", reason: "", createdAt: now, updatedAt: now, revision: 1, history: [] });
}
export function saveReviewProposal(p: Project, reviewId: string, proposalId: string, content: string, now: string) {
  const { run, coordination } = editableCoordination(p, reviewId);
  const proposal = coordination.proposals.find((item) => item.id === proposalId) ?? invalid("没有找到这份修订方案。");
  const parsed = z.string().trim().min(1).max(6000).safeParse(content);
  if (!parsed.success) invalid("修订方案需为1至6000字。");
  if (proposal.content === parsed.data) return;
  if (proposal.history.length >= 30) invalid("此方案已保存30次修改，请新发一条讨论，历史版本不会删除。");
  proposal.history.push({ content: proposal.content, decision: proposal.decision, reason: proposal.reason, updatedAt: proposal.updatedAt, revision: proposal.revision });
  proposal.content = parsed.data!; proposal.revision += 1; proposal.updatedAt = now; proposal.decision = "unhandled"; proposal.reason = "";
  const finding = run.findings.find((item) => item.id === proposal.findingId);
  if (finding) { finding.decision = "unhandled"; finding.reason = ""; }
}
export function decideReviewProposal(p: Project, reviewId: string, proposalId: string, decision: ReviewDecision, reason: string, now: string) {
  const { run, coordination } = editableCoordination(p, reviewId);
  const proposal = coordination.proposals.find((item) => item.id === proposalId) ?? invalid("没有找到这份修订方案。");
  if (!z.enum(["adopted", "provisional", "rejected"]).safeParse(decision).success || !z.string().trim().min(1).max(3000).safeParse(reason).success) invalid("请选择处理方式并填写1至3000字理由。");
  proposal.decision = decision; proposal.reason = reason.trim(); proposal.updatedAt = now;
  const finding = run.findings.find((item) => item.id === proposal.findingId) ?? invalid("方案关联的问题已不存在。");
  finding.decision = decision; finding.reason = reason.trim();
}
