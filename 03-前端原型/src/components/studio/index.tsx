"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Download, LoaderCircle, Network } from "lucide-react";
import type { Project } from "@/domain/models";
import { analysisCurrent, blueprintCurrent, materialsReady, reviewCurrent, type WorkbenchState } from "@/domain/workbench";
import type { StudioOperation } from "@/domain/studio";
import { readWorkbench, changeWorkbench } from "@/services/workbench-store";
import { localJson, pollStudioJob, startStudioJob } from "@/services/studio-client";
import { StudioConnection } from "./connection";
import { StudioMaterials } from "./materials";
import { StudioBlueprint } from "./blueprint";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { ErrorMessage, Loading, LoadError } from "../shared";
import { useService } from "../providers";

export function Studio({ project, step }: { project: Project; step: number }) {
  const router = useRouter(); const cache = useQueryClient(); const service = useService();
  const key = ["workbench", project.id];
  const query = useQuery({ queryKey: key, queryFn: () => readWorkbench(project.id) });
  const capability = useQuery({ queryKey: ["studio-capability"], queryFn: () => localJson("/api/studio/capability"), retry: false });
  const [busy, setBusy] = useState(false); const [reading, setReading] = useState(false); const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>(null); const [savedFile, setSavedFile] = useState(""); const [savedDirectory, setSavedDirectory] = useState("");
  const state = query.data;
  function update(next: WorkbenchState) { cache.setQueryData(["workbench", project.id], next); }
  useEffect(() => {
    const invalidate = () => { void cache.invalidateQueries({ queryKey: ["workbench", project.id] }); };
    const channel = new BroadcastChannel("juben-workbench:authoring:v1"); channel.onmessage = invalidate;
    window.addEventListener("authoring-updated", invalidate);
    return () => { channel.close(); window.removeEventListener("authoring-updated", invalidate); };
  }, [cache, project.id]);
  useEffect(() => {
    if (!state?.job) return;
    let active = true; let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return; inFlight = true;
      void pollStudioJob(project.id, state).then(next => { if (active) cache.setQueryData(["workbench", project.id], next); }).catch(failure => { if (active) setError(failure); }).finally(() => { inFlight = false; });
    }, 1200);
    return () => { active = false; clearInterval(timer); };
  }, [state, project.id, cache]);
  if (query.isPending) return <Loading />;
  if (!state) return <LoadError error={query.error} retry={() => void query.refetch()} />;
  const locked = busy || reading || !!state.job;
  const connected = capability.data?.configured === true;
  const base = `/projects/${project.id}/stages/`;
  async function edit(fn: (next: WorkbenchState) => void) { setError(null); try { update(await changeWorkbench(project.id, state!.revision, fn)); } catch (failure) { setError(failure); } }
  async function start(operation: StudioOperation, target: string) {
    if (locked) return; setBusy(true); setError(null);
    try { update(await startStudioJob(project.id, state!, operation)); router.push(base + target); }
    catch (failure) { setError(failure); } finally { setBusy(false); }
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
  const progress = state.job && <div className="studio-progress" role="status"><LoaderCircle className="animate-spin" size={32} /><h2>{state.job.phase}</h2><p>{state.job.operation === "review" ? "主模型 → 两个模型独立检查 → 相互核对 → 主模型复核" : "正在处理当前项目的材料"}</p></div>;
  return <>
    <section className="workspace-details" aria-label="具体功能内容">
      {error != null && <ErrorMessage error={error} />}{query.error && <ErrorMessage error={query.error} />}{state.error && <ErrorMessage error={new Error(state.error)} />}
      {state.job && error != null && <Button variant="outline" onClick={() => void edit(next => { next.job = null; next.error = "已停止等待，已有内容保持不变。"; })}>停止等待并保留已有内容</Button>}
      {step === 1 && <StudioMaterials projectId={project.id} state={state} update={update} onBusy={setReading} />}
      {step === 2 && <div className="main-stack">{progress}{!state.job && !analysisCurrent(state) && <p>请返回<Link className="inline-link" href={base + "materials"}>准备材料</Link>读取原剧本并拆解。更新材料后需要重新拆解。</p>}{state.analysis && <><section className="panel"><h2>原剧本拆解大纲</h2><p className="whitespace-pre-wrap mt-4">{state.analysis.outline}</p><details className="archive-details mt-5"><summary>材料依据与待确定事项</summary>{state.analysis.sourceRefs.map((ref, i) => <p key={i} className="m-4">{state.documents.find(d => d.id === ref.documentId)?.name} · {ref.location}：{ref.quote}</p>)}{state.analysis.unknowns.map((item, i) => <p key={i} className="m-4">待确定：{item}</p>)}</details></section><section className="panel"><h2>选择改写方向</h2><div className="studio-directions">{state.analysis.directions.map(direction => <button key={direction.id} className={`studio-direction ${state.choiceId === direction.id ? "selected" : ""}`} aria-pressed={state.choiceId === direction.id} disabled={locked || !analysisCurrent(state)} onClick={() => void edit(next => { next.choiceId = direction.id; })}><h3>{direction.title}</h3><p>{direction.summary}</p><p>{direction.outline}</p><small>需要留意：{direction.risk}</small></button>)}</div></section><details className="archive-details"><summary>补充你的创作要求</summary><Textarea aria-label="补充创作要求" className="mt-3" maxLength={10000} defaultValue={state.instructions} disabled={locked} onBlur={e => { if (e.target.value !== state.instructions) void edit(next => { next.instructions = e.target.value; next.choiceId = null; next.blueprintSourceRevision = null; }); }} /><p className="field-hint">保存后重新选择方向，再生成蓝图。</p></details></>}</div>}
      {step === 3 && <>{state.blueprint && !blueprintCurrent(state) && <p className="mb-5">这份蓝图对应旧的材料或创作要求，请返回<Link className="inline-link" href={base + "analysis"}>拆解与方向</Link>生成新版。</p>}{progress}{!state.job && (state.blueprint ? <StudioBlueprint id={project.id} state={state} update={update} onDirty={setDirty} /> : <p>选择改写方向后，点击「生成蓝图」。</p>)}</>}
      {step === 4 && <>{progress}{!state.job && (reviewCurrent(state) ? <div className="studio-progress"><Network size={36} /><h2>当前档案交叉验证完成</h2><p>尚未真人试玩</p>{savedFile && <p role="status">已保存：{savedFile}</p>}{savedDirectory && <Button variant="outline" onClick={() => void localJson("/api/local/directories/reveal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ directoryId: savedDirectory }) }).catch(setError)}>打开保存位置</Button>}</div> : state.review && blueprintCurrent(state) && state.reviewBlueprintRevision === state.blueprintRevision ? <section className="panel"><h2>需要调整后再验证</h2><ul className="mt-4 list-disc pl-5">{state.review.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></section> : <p>确认整体蓝图后开始交叉验证，完成后可以导出完整档案。</p>)}</>}
    </section>
    <footer className="studio-actions"><div className="studio-connection-actions"><StudioConnection /><div>{!connected && <small>{capability.data?.message || (capability.error ? "模型连接状态读取失败" : "正在读取模型连接状态…")}</small>}{dirty && <small>请先保存蓝图调整</small>}{reading && <small>正在读取文件…</small>}</div></div>
      {step === 1 && <Button disabled={locked || !materialsReady(state) || !connected} onClick={() => void start("analyze", "analysis")}>拆解大纲<ArrowRight size={16} /></Button>}
      {step === 2 && <Button disabled={locked || !analysisCurrent(state) || !state.choiceId || !connected} onClick={() => void start("blueprint", "blueprint")}>生成蓝图<ArrowRight size={16} /></Button>}
      {step === 3 && <Button disabled={locked || dirty || !blueprintCurrent(state) || !connected} onClick={() => void start("review", "generation")}>开始交叉验证<ArrowRight size={16} /></Button>}
      {step === 4 && (reviewCurrent(state) ? <Button disabled={locked} onClick={() => void exportKit()}>导出完整档案<Download size={16} /></Button> : <Button disabled={locked} onClick={() => router.push(base + "blueprint")}>{state.job ? "正在交叉验证…" : "返回修改蓝图"}<ArrowRight size={16} /></Button>)}
    </footer>
  </>;
}
