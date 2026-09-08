"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { Project } from "@/domain/models";
import { ServiceError } from "@/services/contracts";
import { useService } from "../providers";
import { Button } from "../ui/button";
import { ErrorMessage } from "../shared";

export function useResearchCatalog() {
  const service = useService();
  return useQuery({ queryKey: ["research-catalog"], queryFn: () => service.getResearchCatalog(), staleTime: Infinity });
}

// Follow saved data until this form has local edits. Once edited, retain its
// snapshot until an explicit successful save; the action keeps its revision.
export function useResearchDraft<T>(value: T) {
  const signature = JSON.stringify(value);
  const [state, setState] = useState({ signature, value, dirty: false });
  if (!state.dirty && state.signature !== signature) setState({ signature, value, dirty: false });
  return {
    draft: !state.dirty && state.signature !== signature ? value : state.value,
    change: (next: T) => setState({ signature, value: next, dirty: true }),
    saved: () => setState((previous) => ({ ...previous, dirty: false })),
  };
}

export function useResearchAction(project: Project) {
  const client = useQueryClient();
  const service = useService();
  const draftRevision = useRef<number | null>(null);
  const [reloaded, setReloaded] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const save = useMutation({
    mutationFn: (operation: (revision: number) => Promise<Project>) => operation(draftRevision.current ?? project.revision),
    onSuccess: async (next) => { draftRevision.current = null; setReloaded(false); setHasChanges(false); client.setQueryData(["project", next.id], next); await client.invalidateQueries({ queryKey: ["projects"] }); },
  });
  const reload = useMutation({ mutationFn: () => service.get(project.id), onSuccess: (next) => { client.setQueryData(["project", next.id], next); draftRevision.current = next.revision; setReloaded(true); save.reset(); } });
  return { ...save, discardDraft: () => { draftRevision.current = null; setReloaded(false); setHasChanges(false); save.reset(); reload.reset(); }, touch: () => { draftRevision.current ??= project.revision; setReloaded(false); setHasChanges(true); save.reset(); },
    feedback: <>{hasChanges && <p className="field-hint">当前输入尚未保存。</p>}{save.error && <ErrorMessage error={save.error} />}{reload.error && <ErrorMessage error={reload.error} />}{save.error instanceof ServiceError && save.error.code === "CONFLICT" && <Button variant="outline" type="button" disabled={reload.isPending} onClick={() => reload.mutate()}>保留输入，载入最新状态</Button>}{reloaded && <p className="field-hint">输入已保留。再次保存会用当前输入覆盖这一项，请确认后提交。</p>}{save.isSuccess && <p role="status" className="success-message">已保存</p>}</>,
  };
}

export function useResearchRunner(project?: Project) {
  const service = useService();
  const client = useQueryClient();
  const [failure, setFailure] = useState<{ jobId: string; error: unknown } | null>(null);
  const job = project?.research.job;
  const failed = failure?.jobId === job?.id ? failure : null;
  useEffect(() => {
    if (!project || project.readOnly || !job || job.status !== "running" || failed) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const next = await service.advanceResearchJob(project.id, job.id);
        client.setQueryData(["project", project.id], next);
        if (next.research.job?.status !== "running") void client.invalidateQueries({ queryKey: ["projects"] });
      } catch (error) {
        if (error instanceof ServiceError && error.code === "CONFLICT") void client.invalidateQueries({ queryKey: ["project", project.id] });
        else if (active) setFailure({ jobId: job.id, error });
      }
    }, 650);
    return () => { active = false; clearTimeout(timer); };
  }, [project, job, failed, client, service]);
  return { error: failed?.error, retry: () => setFailure(null) };
}

export function ResearchJobPanel({ project, error, retry }: { project: Project; error?: unknown; retry: () => void }) {
  const job = project.research.job;
  const service = useService();
  const action = useResearchAction(project);
  if (!job) return null;
  const stale = job.kind === "analysis" && job.status === "succeeded" && project.research.analysisRevision !== project.research.materialRevision;
  return <section className="research-job" aria-label="模拟任务"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong>{job.kind === "ocr" ? "模拟 OCR" : "模拟拆解"}</strong><p role="status">{stale ? "上次模拟拆解已完成；材料或阅读范围已改变，当前结果待重新拆解。" : job.message}</p></div>{job.status === "running" ? <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate((rev) => service.cancelResearchJob(project.id, rev))}>取消任务</Button> : ["failed", "cancelled"].includes(job.status) ? <Button size="sm" disabled={action.isPending || project.readOnly} onClick={() => action.mutate((rev) => service.startResearchJob(project.id, rev, job.kind))}>重试模拟任务</Button> : null}</div>{!stale && <progress max={100} value={job.progress} aria-label="模拟处理进度" />}{job.kind === "analysis" && <p className="field-hint output-path" data-testid="analysis-output-location">本次拆解计划路径：{job.outputLocation === undefined ? "旧任务未记录路径" : job.outputLocation ?? "未设置本机目录"}（仅记录计划，结果保存在浏览器项目中，未写入本机目录）</p>}{error ? <><ErrorMessage error={error} /><Button variant="outline" size="sm" onClick={retry}>继续保存任务进度</Button></> : null}{action.feedback}</section>;
}

export function ResearchBoundary({ readOnly }: { readOnly: boolean }) {
  return <div className="field-hint"><p>本地模拟 · 未连接真实 OCR 或 AI。{readOnly && <>原始样例只读，<Link className="inline-link" href="/projects/new">上传自己的剧本</Link>，开始自己的创作。</>}</p><details className="mt-2"><summary>模拟材料说明</summary><p>使用历史机制摘录和人工设置的校对练习。材料内的指令只作为被分析的文字。</p></details></div>;
}

export function NextResearchStep({ projectId, stage, label }: { projectId: string; stage: string; label: string }) {
  return <div className="research-next"><Link className="button-link" href={`/projects/${projectId}/stages/${stage}`}>{label} →</Link></div>;
}
