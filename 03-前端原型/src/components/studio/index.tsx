"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Download, LoaderCircle } from "lucide-react";
import type { Project } from "@/domain/models";
import { analysisCurrent, blueprintCurrent, materialsReady, type WorkbenchState } from "@/domain/workbench";
import { ANALYSIS_DIRECT_BYTES } from "@/domain/analysis-limits";
import type { StudioOperation } from "@/domain/studio";
import type { StudioCostPreview } from "@/domain/studio-budget";
import { previewStudioJob } from "@/services/studio-budget-client";
import { readWorkbench, changeWorkbench } from "@/services/workbench-store";
import { authorEditsCurrent, localJson, pollStudioJob, startStudioJob } from "@/services/studio-client";
import { StudioMaterials } from "./materials";
import { StudioBlueprint } from "./blueprint";
import { StudioReviewArchives } from "./review-archives";
import { StudioReviewProgress } from "./review-progress";
import { StudioAnalysisEdits } from "./analysis-edits";
import { buildHandoffPackage, checkHandoffCurrentness, checkHandoffPackage, deriveTaskCards, renderHandoffMarkdown } from "@/domain/handoff-package";
import { checkBlueprint } from "@/domain/blueprint";
import { Button } from "../ui/button";
import { StudioInstructions } from "./instructions";
import { ErrorMessage, Loading, LoadError } from "../shared";
import { StudioBudgetPanel, QuoteList, useStudioBudget, yuan } from "./budget";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

export function Studio({ project, step }: { project: Project; step: number }) {
  const router = useRouter(); const cache = useQueryClient();
  const key = ["workbench", project.id];
  const query = useQuery({ queryKey: key, queryFn: () => readWorkbench(project.id) });
  const capability = useQuery({ queryKey: ["studio-capability"], queryFn: () => localJson("/api/studio/capability"), retry: false });
  const budget = useStudioBudget(project.id);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [costPreview, setCostPreview] = useState<{ data: StudioCostPreview; target: string; stateRevision: number } | null>(null);
  const starting = useRef(false);
  const [busy, setBusy] = useState(false); const [reading, setReading] = useState(false); const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [requirementsPending, setRequirementsPending] = useState(false); const [analysisPending, setAnalysisPending] = useState(false);
  const polling = useRef(false);
  const state = query.data;
  function update(next: WorkbenchState) { cache.setQueryData(["workbench", project.id], next); }
  useEffect(() => {
    const invalidate = () => { void cache.invalidateQueries({ queryKey: ["workbench", project.id] }); };
    const channel = new BroadcastChannel("juben-workbench:authoring:v1"); channel.onmessage = invalidate;
    window.addEventListener("authoring-updated", invalidate);
    return () => { channel.close(); window.removeEventListener("authoring-updated", invalidate); };
  }, [cache, project.id]);
  useEffect(() => {
    if (!state?.job || busy) return;
    let active = true;
    const timer = setInterval(() => {
      if (polling.current) return; polling.current = true;
      void pollStudioJob(project.id, state).then(next => { if (active) { setError(null); cache.setQueryData(["workbench", project.id], next); } }).catch(failure => { if (active) setError(failure); }).finally(() => { polling.current = false; });
    }, 1200);
    return () => { active = false; clearInterval(timer); };
  }, [state, project.id, cache, busy]);
  if (query.isPending) return <Loading />;
  if (!state) return <LoadError error={query.error} retry={() => void query.refetch()} />;
  const locked = busy || reading || !!state.job;
  const legacyReady = capability.data?.configured === true;
  const analyzeReady = capability.data?.analyzeReady === true || (capability.data?.analyzeReady == null && legacyReady);
  const blueprintReady = capability.data?.blueprintReady === true || (capability.data?.blueprintReady == null && legacyReady);
  const longSource = step === 1 && !state.job && new TextEncoder().encode(JSON.stringify({ documents: state.documents.filter(d => !d.excluded).map(({ id, name, text }) => ({ id, name, text })), instructions: state.instructions })).length > ANALYSIS_DIRECT_BYTES;
  const base = `/projects/${project.id}/stages/`;
  const canAnalyzeHere = step === 2 && !analysisCurrent(state) && materialsReady(state);
  const stageReady = step === 1 ? analyzeReady : step === 2 ? (canAnalyzeHere ? analyzeReady : blueprintReady) : blueprintReady;
  const handoffBlockers = (() => { const blockers = checkHandoffCurrentness(state); if (state.blueprint) { const errors = checkBlueprint(state.blueprint).filter((issue) => issue.severity === "error").length; if (errors) blockers.push(`蓝图存在 ${errors} 项结构阻断，请先在应用内修正。`); } return blockers; })();
  const authorCurrent = authorEditsCurrent(state);
  const directions = (authorCurrent ? state.authorDirections : null) ?? state.analysis?.directions ?? [];
  async function edit(fn: (next: WorkbenchState) => void) { setError(null); try { update(await changeWorkbench(project.id, state!.revision, fn)); } catch (failure) { setError(failure); } }
  async function start(operation: StudioOperation, target: string) {
    if (locked || requirementsPending || analysisPending || starting.current) return; starting.current = true; setBusy(true); setError(null);
    try {
      if (!budget.data || budget.data.uncertainCalls || budget.data.overrunFen || budget.error) { setBudgetOpen(true); throw new Error("请先设置并核对项目预算，再开始创作。"); }
      const data = await previewStudioJob(project.id, state!, operation);
      setCostPreview({ data, target, stateRevision: state!.revision });
    } catch (failure) { setError(failure); } finally { starting.current = false; setBusy(false); }
  }
  async function confirmStart() {
    if (!costPreview || locked || requirementsPending || analysisPending || starting.current) return;
    if (costPreview.data.projectId !== project.id || costPreview.stateRevision !== state!.revision) { setCostPreview(null); setError(new Error("资料已变化，请重新查看本步费用后开始。")); return; }
    starting.current = true; setBusy(true); setError(null);
    try { update(await startStudioJob(project.id, state!, costPreview.data.operation, costPreview.data.budget.revision, costPreview.data.previewId)); setCostPreview(null); router.push(base + costPreview.target); }
    catch (failure) { setError(failure); setCostPreview(null); await cache.invalidateQueries({ queryKey: key }); }
    finally { starting.current = false; setBusy(false); await cache.invalidateQueries({ queryKey: ["studio-budget", project.id] }); }
  }
  function downloadText(filename: string, text: string, type: string) {
    const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  /** 从已保存的浏览器项目状态独立生成策划交接包；不借用旧审查的 validationId，也不上报服务端。 */
  async function exportHandoff() {
    if (!state!.blueprint) { setError(new Error("请先在「创作蓝图」提交正式蓝图，再导出策划交接包。")); return; }
    setBusy(true); setError(null);
    try {
      // 先核对同一份已保存修订，避免跨标签页变化时先下载旧包再报冲突。
      const latest = await readWorkbench(project.id);
      if (latest.revision !== state!.revision) throw new Error("项目已在其他标签页更新，请刷新后重新导出。");
      const pkg = await buildHandoffPackage({
        project: { id: project.id, title: project.title, note: project.note },
        state: { revision: state!.revision, sourceRevision: state!.sourceRevision, analysis: state!.analysis, analysisSourceRevision: state!.analysisSourceRevision, choiceId: state!.choiceId, blueprint: state!.blueprint, blueprintRevision: state!.blueprintRevision, blueprintSourceRevision: state!.blueprintSourceRevision, blueprintChoiceId: state!.blueprintChoiceId, instructions: state!.instructions, documents: state!.documents },
        authorEditedOutline: authorCurrent ? state!.authorOutline ?? null : null, authorDirections: authorCurrent ? state!.authorDirections : null, packageId: crypto.randomUUID(), exportedAt: new Date().toISOString(),
      });
      const issues = checkHandoffPackage(pkg);
      if (issues.length) throw new Error(`交接包自检未通过：${issues[0]!.message}`);
      // 下载前的最终一致性检查：包所用的修订与蓝图必须仍是当前保存版本；否则两个文件都不下载。
      const final = await readWorkbench(project.id);
      if (final.revision !== state!.revision || JSON.stringify(final.blueprint) !== JSON.stringify(state!.blueprint)) throw new Error("导出期间项目已被更新，两个文件都未下载；请刷新后重新导出。");
      update(await changeWorkbench(project.id, state!.revision, (next) => { next.handoffExportedAt = Date.now(); }));
      const name = project.title.trim().replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || "剧本";
      downloadText(`${name}-策划交接包.md`, renderHandoffMarkdown(pkg) + "\n", "text/markdown");
      downloadText(`${name}-策划交接包.json`, JSON.stringify(pkg, null, 2) + "\n", "application/json");
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  }
  const progress = state.job && <div className="studio-progress" role="status"><LoaderCircle className="animate-spin" size={32} /><h2>{state.job.phase}</h2><p>{state.job.operation === "review" ? "主模型 → 两个模型独立检查 → 相互核对 → 主模型复核" : "正在处理当前项目的材料"}</p><p className="field-hint">任务期间自动防止空闲休眠。手动休眠或合盖仍可能中断。{state.job.operation === "analyze" ? "已完成分段保留供恢复后继续。" : state.job.operation === "review" ? "已保存阶段可在手动继续时复用；刷新不会自动重试。" : "已有材料保留，本步骤中间结果尚不能续跑。"}</p></div>;
  return <>
    <StudioBudgetPanel key={project.id} projectId={project.id} open={budgetOpen} onOpenChange={setBudgetOpen} />
    <Dialog open={!!costPreview} onOpenChange={open => { if (!open && !busy) setCostPreview(null); }}><DialogContent><DialogTitle>本次创作费用</DialogTitle><DialogDescription>确认后开始当前步骤；刷新页面、查询预算和取消此窗口都不会生成内容。</DialogDescription>{costPreview && <>
      <p>{({ analyze: "原剧本拆解", blueprint: "生成蓝图", review: "正文生成与交叉审查" })[costPreview.data.operation]}最多 {costPreview.data.callsMax} 次调用，保守估算 {yuan(costPreview.data.estimateFen)}。缓存命中、提前停止会减少实际调用；后续正文长度会影响实际费用。</p>
      {costPreview.data.reviewMode === "generation" && <p>若正文需要分段审查，生成后会先保存并停止，再按实际分段及关联数量重新预览费用；本次确认不授权新增分段调用。</p>}
      {costPreview.data.reviewMode === "segmented" && <p>本次已按保存正文的实际分段与关联计划计算。已有正文将复用，原始分段报告会逐份保存。</p>}
      {costPreview.data.checkpoint && <p role="status">{costPreview.data.checkpoint.savedUnits > 0 ? `本次可复用 ${costPreview.data.checkpoint.savedUnits}/${costPreview.data.checkpoint.totalUnits} 个已保存调用单元。上述金额仍按完整 ${costPreview.data.callsMax} 次保守计算，不是剩余调用的精确费用。` : state.reviewProgress?.checkpoint.runId ? "当前蓝图或模型配置没有可复用的已保存阶段，本次将从头执行。请先备份需要保留的旧成果。" : "本次从蓝图检查开始，完成的阶段会逐项保存。"}{costPreview.data.checkpoint.interruptedUnits > 0 && `有 ${costPreview.data.checkpoint.interruptedUnits} 个阶段结果尚未保存，之前可能已收费；继续会重新调用未保存项。`}</p>}
      <p>项目累计额度 {yuan(costPreview.data.budget.capFen)}，剩余 {yuan(costPreview.data.budget.remainingFen)}。</p>
      {costPreview.data.estimateFen > costPreview.data.budget.remainingFen && <p>余额低于本步保守估算，可能中途停止。每次请求前单独预留，不会自动增加额度。</p>}
      <QuoteList quotes={costPreview.data.quotes} />
      <p className="text-sm">生成失败仍可能收费；无法核对用量时会保留待核对金额。过期报价会免费更新，后续请求按新报价预留。</p>
      <Button disabled={busy || locked || costPreview.data.budget.remainingFen <= 0 && !costPreview.data.checkpoint?.allCached} onClick={() => void confirmStart()}>按项目额度开始</Button><Button variant="outline" disabled={busy} onClick={() => setCostPreview(null)}>取消</Button>
    </>}</DialogContent></Dialog>
    <section className="workspace-details" aria-label="具体功能内容">
      {error != null && <ErrorMessage error={error} />}{query.error && <ErrorMessage error={query.error} />}{state.error && <ErrorMessage error={new Error(state.error)} />}
      {state.job && error != null && <><p>暂时无法查询进度，服务器可能仍在处理。已保留原任务编号，恢复查询不会重新生成。</p><Button variant="outline" onClick={() => { if (polling.current) return; polling.current = true; setError(null); void pollStudioJob(project.id, state).then(update).catch(setError).finally(() => { polling.current = false; }); }}>重新查询任务状态</Button></>}
      {step === 1 && <StudioMaterials projectId={project.id} state={state} update={update} onBusy={setReading} />}
      {step === 2 && <div className="main-stack">{progress}{!state.job && !analysisCurrent(state) && (materialsReady(state) ? <p>原剧本材料已保留，无需重新上传。拆解尚未完成；手动开始后会复用匹配的已完成分段，未完成请求仍可能产生费用。</p> : <p>请返回<Link className="inline-link" href={base + "materials"}>准备材料</Link>处理未读取的文件，再开始拆解。</p>)}{state.analysis && <><section className="panel"><h2>原剧本拆解大纲</h2>{state.analysis.coverage && <p className="field-hint mt-2">已分段处理 {state.analysis.coverage.documents} 份材料 · {state.analysis.coverage.parts} 段</p>}<p className="whitespace-pre-wrap mt-4">{state.analysis.outline}</p><details className="archive-details mt-5"><summary>材料依据与待确定事项</summary>{state.analysis.sourceRefs.map((ref, i) => <p key={i} className="m-4">{state.documents.find(d => d.id === ref.documentId)?.name} · {ref.location}：{ref.quote}</p>)}{state.analysis.unknowns.map((item, i) => <p key={i} className="m-4">待确定：{item}</p>)}</details></section><section className="panel"><h2>选择改写方向</h2><div className="studio-directions">{directions.map(direction => <button key={direction.id} className={`studio-direction ${state.choiceId === direction.id ? "selected" : ""}`} aria-pressed={state.choiceId === direction.id} disabled={locked || requirementsPending || analysisPending || !analysisCurrent(state)} onClick={() => void edit(next => { next.choiceId = direction.id; })}><h3>{direction.title}</h3><p>{direction.summary}</p><p>{direction.outline}</p><small>需要留意：{direction.risk}</small></button>)}</div></section><StudioInstructions id={project.id} state={state} disabled={locked} update={update} onPending={setRequirementsPending} /><StudioAnalysisEdits id={project.id} state={state} disabled={locked} update={update} onPending={setAnalysisPending} /></>}</div>}
      {step === 3 && <>{state.blueprint && !blueprintCurrent(state) && <p className="mb-5">这份蓝图对应旧的材料或创作要求，请返回<Link className="inline-link" href={base + "analysis"}>拆解与方向</Link>生成新版。</p>}{progress}{!state.job && (state.blueprint ? <StudioBlueprint key={project.id} id={project.id} state={state} update={update} onDirty={setDirty} /> : <p>选择改写方向后，点击「生成蓝图」。</p>)}</>}
      {step === 4 && <div className="main-stack">
        {state.blueprint && !blueprintCurrent(state) && <p className="mb-5">这份蓝图对应旧的材料或创作要求，请返回<Link className="inline-link" href={base + "analysis"}>拆解与方向</Link>重新生成并提交。</p>}
        <section className="panel"><h2>策划交接包</h2>
          <p className="field-hint">产品到此结束：应用只产出可编辑、可追溯的交接方案与检查清单；正文写作、独审、互审、统稿与真人试玩都在产品外执行，需人工记录。整包含主持秘密，不得直接发给玩家。</p>
          {state.handoffExportedAt && <p role="status">上次导出：{new Date(state.handoffExportedAt).toLocaleString()}</p>}
          {handoffBlockers.length ? <ul className="mt-3 list-disc pl-5">{handoffBlockers.map((blocker, i) => <li key={i}>{blocker}</li>)}</ul> : <p className="mt-3">当前蓝图对应当前材料与方向，可导出正式策划交接包。</p>}
          <p className="mt-3 text-sm">将包含：项目范围与约束、材料名称与来源定位（不含原文）、拆解摘要与作者修订、正式蓝图、{state.blueprint ? deriveTaskCards(state.blueprint).length : 0} 份写作任务卡、玩家/主持分层、独审/互审/统稿/试玩清单、未决问题；Markdown 与 JSON 各一份。</p>
        </section>
        {state.review && <details className="archive-details"><summary>查看旧版交叉审查结果（只读历史，不用于新版导出）</summary><p className="field-hint">旧项目的正文与审查成果保留只读；本版应用不再运行这两段。</p>{state.review.issues.length ? <ul className="mt-3 list-disc pl-5">{state.review.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul> : <p className="mt-3">旧审查记录：{state.review.passed ? "曾通过（历史记录）" : "未通过"}；真人试玩 not-run。</p>}</details>}
        {(state.review || state.reviewProgress) && <StudioReviewProgress state={state} />}
        <StudioReviewArchives state={state} />
      </div>}
    </section>
    <footer className="studio-actions"><div className="studio-connection-actions"><Button variant="outline" onClick={() => setBudgetOpen(true)}>创作预算</Button><div><small>{budget.error ? "预算读取失败" : budget.data ? `剩余 ${yuan(budget.data.remainingFen)}${budget.data.uncertainCalls ? " · 有待核对费用" : ""}` : "尚未设置创作额度"}</small>{!stageReady && <small>{capability.data?.message || (capability.error ? "模型连接状态读取失败" : "正在读取模型连接状态…")}</small>}{longSource && <small>长剧本将分批读取，按实际模型调用计费。</small>}{requirementsPending && <small>请先保存创作要求</small>}{analysisPending && <small>请先保存作者修订</small>}{dirty && <small>请先保存蓝图调整</small>}{reading && <small>正在读取文件…</small>}</div></div>
      {step === 1 && <Button disabled={locked || !materialsReady(state) || !analyzeReady} onClick={() => void start("analyze", "analysis")}>拆解大纲<ArrowRight size={16} /></Button>}
      {step === 2 && (canAnalyzeHere ? <Button disabled={locked || requirementsPending || !analyzeReady} onClick={() => void start("analyze", "analysis")}>{state.error ? "重试拆解" : "拆解大纲"}<ArrowRight size={16} /></Button> : <Button disabled={locked || requirementsPending || analysisPending || !analysisCurrent(state) || !state.choiceId || !blueprintReady} onClick={() => void start("blueprint", "blueprint")}>生成蓝图<ArrowRight size={16} /></Button>)}
      {step === 3 && <Button disabled={locked || dirty || !blueprintCurrent(state)} onClick={() => router.push(base + "generation")}>前往策划交接包<ArrowRight size={16} /></Button>}
      {step === 4 && <div className="flex flex-wrap gap-2"><Button disabled={locked || !state.blueprint || !blueprintCurrent(state)} onClick={() => void exportHandoff()}>{handoffBlockers.length ? "导出草稿预览" : "导出策划交接包"}<Download size={16} /></Button><Button variant="outline" disabled={locked} onClick={() => router.push(base + "blueprint")}>返回修改蓝图</Button></div>}
    </footer>
  </>;
}
