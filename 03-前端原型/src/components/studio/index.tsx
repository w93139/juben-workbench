"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Download, LoaderCircle, Network } from "lucide-react";
import type { Project } from "@/domain/models";
import { analysisCurrent, blueprintCurrent, materialsReady, reviewCurrent, type WorkbenchState } from "@/domain/workbench";
import { ANALYSIS_DIRECT_BYTES } from "@/domain/analysis-limits";
import type { StudioOperation } from "@/domain/studio";
import type { StudioCostPreview } from "@/domain/studio-budget";
import { previewStudioJob } from "@/services/studio-budget-client";
import { readWorkbench, changeWorkbench } from "@/services/workbench-store";
import { localJson, pollStudioJob, startStudioJob } from "@/services/studio-client";
import { StudioMaterials } from "./materials";
import { StudioBlueprint } from "./blueprint";
import { Button } from "../ui/button";
import { StudioInstructions } from "./instructions";
import { ErrorMessage, Loading, LoadError } from "../shared";
import { useService } from "../providers";
import { StudioBudgetPanel, QuoteList, useStudioBudget, yuan } from "./budget";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

export function Studio({ project, step }: { project: Project; step: number }) {
  const router = useRouter(); const cache = useQueryClient(); const service = useService();
  const key = ["workbench", project.id];
  const query = useQuery({ queryKey: key, queryFn: () => readWorkbench(project.id) });
  const capability = useQuery({ queryKey: ["studio-capability"], queryFn: () => localJson("/api/studio/capability"), retry: false });
  const budget = useStudioBudget(project.id);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [costPreview, setCostPreview] = useState<{ data: StudioCostPreview; target: string; stateRevision: number } | null>(null);
  const starting = useRef(false);
  const [busy, setBusy] = useState(false); const [reading, setReading] = useState(false); const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>(null); const [savedFile, setSavedFile] = useState(""); const [savedDirectory, setSavedDirectory] = useState("");
  const [requirementsPending, setRequirementsPending] = useState(false);
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
  const connected = capability.data?.configured === true;
  const longSource = step === 1 && !state.job && new TextEncoder().encode(JSON.stringify({ documents: state.documents.filter(d => !d.excluded).map(({ id, name, text }) => ({ id, name, text })), instructions: state.instructions })).length > ANALYSIS_DIRECT_BYTES;
  const base = `/projects/${project.id}/stages/`;
  const canAnalyzeHere = step === 2 && !analysisCurrent(state) && materialsReady(state);
  async function edit(fn: (next: WorkbenchState) => void) { setError(null); try { update(await changeWorkbench(project.id, state!.revision, fn)); } catch (failure) { setError(failure); } }
  async function start(operation: StudioOperation, target: string) {
    if (locked || requirementsPending || starting.current) return; starting.current = true; setBusy(true); setError(null);
    try {
      if (!budget.data || budget.data.uncertainCalls || budget.data.overrunFen || budget.error) { setBudgetOpen(true); throw new Error("请先设置并核对项目预算，再开始创作。"); }
      const data = await previewStudioJob(project.id, state!, operation);
      setCostPreview({ data, target, stateRevision: state!.revision });
    } catch (failure) { setError(failure); } finally { starting.current = false; setBusy(false); }
  }
  async function confirmStart() {
    if (!costPreview || locked || requirementsPending || starting.current) return;
    if (costPreview.data.projectId !== project.id || costPreview.stateRevision !== state!.revision) { setCostPreview(null); setError(new Error("资料已变化，请重新查看本步费用后开始。")); return; }
    starting.current = true; setBusy(true); setError(null);
    try { update(await startStudioJob(project.id, state!, costPreview.data.operation, costPreview.data.budget.revision, costPreview.data.previewId)); setCostPreview(null); router.push(base + costPreview.target); }
    catch (failure) { setError(failure); setCostPreview(null); await cache.invalidateQueries({ queryKey: key }); }
    finally { starting.current = false; setBusy(false); await cache.invalidateQueries({ queryKey: ["studio-budget", project.id] }); }
  }
  async function exportKit() {
    setBusy(true); setError(null);
    try {
      let directory = project.outputSettings.directory;
      if (!directory) {
        directory = await service.pickOutputDirectory(); if (!directory) return;
        const nextProject = await service.saveOutputSettings(project.id, project.revision, { directory, rootPath: "", stage: "export", folder: project.outputSettings.folders.export });
        cache.setQueryData(["project", project.id], nextProject); await cache.invalidateQueries({ queryKey: ["projects"] });
      }
      const result = await localJson("/api/local/directories/write", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ directoryId: directory.id, validationId: state!.review!.validationId, title: project.title }) });
      setSavedFile(result.filename); setSavedDirectory(directory.id);
      await localJson("/api/local/directories/reveal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ directoryId: directory.id }) });
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  }
  const progress = state.job && <div className="studio-progress" role="status"><LoaderCircle className="animate-spin" size={32} /><h2>{state.job.phase}</h2><p>{state.job.operation === "review" ? "主模型 → 两个模型独立检查 → 相互核对 → 主模型复核" : "正在处理当前项目的材料"}</p><p className="field-hint">任务期间自动防止空闲休眠。手动休眠或合盖仍可能中断。{state.job.operation === "analyze" ? "已完成分段保留供恢复后继续。" : "已有材料保留，本步骤中间结果尚不能续跑。"}</p></div>;
  return <>
    <StudioBudgetPanel key={project.id} projectId={project.id} open={budgetOpen} onOpenChange={setBudgetOpen} />
    <Dialog open={!!costPreview} onOpenChange={open => { if (!open && !busy) setCostPreview(null); }}><DialogContent><DialogTitle>本次创作费用</DialogTitle><DialogDescription>确认后开始当前步骤；刷新页面、查询预算和取消此窗口都不会生成内容。</DialogDescription>{costPreview && <>
      <p>{({ analyze: "原剧本拆解", blueprint: "生成蓝图", review: "正文生成与交叉审查" })[costPreview.data.operation]}最多 {costPreview.data.callsMax} 次调用，保守估算 {yuan(costPreview.data.estimateFen)}。缓存命中、提前停止会减少实际调用；后续正文长度会影响实际费用。</p>
      <p>项目累计额度 {yuan(costPreview.data.budget.capFen)}，剩余 {yuan(costPreview.data.budget.remainingFen)}。</p>
      {costPreview.data.estimateFen > costPreview.data.budget.remainingFen && <p>余额低于本步保守估算，可能中途停止。每次请求前单独预留，不会自动增加额度。</p>}
      <QuoteList quotes={costPreview.data.quotes} />
      <p className="text-sm">生成失败仍可能收费；无法核对用量时会保留待核对金额。过期报价会免费更新，后续请求按新报价预留。</p>
      <Button disabled={busy || locked || costPreview.data.budget.remainingFen <= 0} onClick={() => void confirmStart()}>按项目额度开始</Button><Button variant="outline" disabled={busy} onClick={() => setCostPreview(null)}>取消</Button>
    </>}</DialogContent></Dialog>
    <section className="workspace-details" aria-label="具体功能内容">
      {error != null && <ErrorMessage error={error} />}{query.error && <ErrorMessage error={query.error} />}{state.error && <ErrorMessage error={new Error(state.error)} />}
      {state.job && error != null && <><p>暂时无法查询进度，服务器可能仍在处理。已保留原任务编号，恢复查询不会重新生成。</p><Button variant="outline" onClick={() => { if (polling.current) return; polling.current = true; setError(null); void pollStudioJob(project.id, state).then(update).catch(setError).finally(() => { polling.current = false; }); }}>重新查询任务状态</Button></>}
      {step === 1 && <StudioMaterials projectId={project.id} state={state} update={update} onBusy={setReading} />}
      {step === 2 && <div className="main-stack">{progress}{!state.job && !analysisCurrent(state) && (materialsReady(state) ? <p>原剧本材料已保留，无需重新上传。拆解尚未完成；手动开始后会复用匹配的已完成分段，未完成请求仍可能产生费用。</p> : <p>请返回<Link className="inline-link" href={base + "materials"}>准备材料</Link>处理未读取的文件，再开始拆解。</p>)}{state.analysis && <><section className="panel"><h2>原剧本拆解大纲</h2>{state.analysis.coverage && <p className="field-hint mt-2">已分段处理 {state.analysis.coverage.documents} 份材料 · {state.analysis.coverage.parts} 段</p>}<p className="whitespace-pre-wrap mt-4">{state.analysis.outline}</p><details className="archive-details mt-5"><summary>材料依据与待确定事项</summary>{state.analysis.sourceRefs.map((ref, i) => <p key={i} className="m-4">{state.documents.find(d => d.id === ref.documentId)?.name} · {ref.location}：{ref.quote}</p>)}{state.analysis.unknowns.map((item, i) => <p key={i} className="m-4">待确定：{item}</p>)}</details></section><section className="panel"><h2>选择改写方向</h2><div className="studio-directions">{state.analysis.directions.map(direction => <button key={direction.id} className={`studio-direction ${state.choiceId === direction.id ? "selected" : ""}`} aria-pressed={state.choiceId === direction.id} disabled={locked || requirementsPending || !analysisCurrent(state)} onClick={() => void edit(next => { next.choiceId = direction.id; })}><h3>{direction.title}</h3><p>{direction.summary}</p><p>{direction.outline}</p><small>需要留意：{direction.risk}</small></button>)}</div></section><StudioInstructions id={project.id} state={state} disabled={locked} update={update} onPending={setRequirementsPending} /></>}</div>}
      {step === 3 && <>{state.blueprint && !blueprintCurrent(state) && <p className="mb-5">这份蓝图对应旧的材料或创作要求，请返回<Link className="inline-link" href={base + "analysis"}>拆解与方向</Link>生成新版。</p>}{progress}{!state.job && (state.blueprint ? <StudioBlueprint key={project.id} id={project.id} state={state} update={update} onDirty={setDirty} /> : <p>选择改写方向后，点击「生成蓝图」。</p>)}</>}
      {step === 4 && <>{progress}{!state.job && (reviewCurrent(state) ? <div className="studio-progress"><Network size={36} /><h2>当前档案交叉验证完成</h2><p>尚未真人试玩</p>{savedFile && <p role="status">已保存：{savedFile}</p>}{savedDirectory && <Button variant="outline" onClick={() => void localJson("/api/local/directories/reveal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ directoryId: savedDirectory }) }).catch(setError)}>打开保存位置</Button>}</div> : state.review && blueprintCurrent(state) && state.reviewBlueprintRevision === state.blueprintRevision ? <section className="panel"><h2>需要调整后再验证</h2><ul className="mt-4 list-disc pl-5">{state.review.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></section> : <p>确认整体蓝图后开始交叉验证，完成后可以导出完整档案。</p>)}</>}
    </section>
    <footer className="studio-actions"><div className="studio-connection-actions"><Button variant="outline" onClick={() => setBudgetOpen(true)}>创作预算</Button><div><small>{budget.error ? "预算读取失败" : budget.data ? `剩余 ${yuan(budget.data.remainingFen)}${budget.data.uncertainCalls ? " · 有待核对费用" : ""}` : "尚未设置创作额度"}</small>{!connected && <small>{capability.data?.message || (capability.error ? "模型连接状态读取失败" : "正在读取模型连接状态…")}</small>}{longSource && <small>长剧本将分批读取，按实际模型调用计费。</small>}{requirementsPending && <small>请先保存创作要求</small>}{dirty && <small>请先保存蓝图调整</small>}{reading && <small>正在读取文件…</small>}</div></div>
      {step === 1 && <Button disabled={locked || !materialsReady(state) || !connected} onClick={() => void start("analyze", "analysis")}>拆解大纲<ArrowRight size={16} /></Button>}
      {step === 2 && (canAnalyzeHere ? <Button disabled={locked || requirementsPending || !connected} onClick={() => void start("analyze", "analysis")}>{state.error ? "重试拆解" : "拆解大纲"}<ArrowRight size={16} /></Button> : <Button disabled={locked || requirementsPending || !analysisCurrent(state) || !state.choiceId || !connected} onClick={() => void start("blueprint", "blueprint")}>生成蓝图<ArrowRight size={16} /></Button>)}
      {step === 3 && <Button disabled={locked || dirty || !blueprintCurrent(state) || !connected} onClick={() => void start("review", "generation")}>开始交叉验证<ArrowRight size={16} /></Button>}
      {step === 4 && (reviewCurrent(state) ? <Button disabled={locked} onClick={() => void exportKit()}>导出完整档案<Download size={16} /></Button> : <Button disabled={locked} onClick={() => router.push(base + "blueprint")}>{state.job ? "正在交叉验证…" : "返回修改蓝图"}<ArrowRight size={16} /></Button>)}
    </footer>
  </>;
}
