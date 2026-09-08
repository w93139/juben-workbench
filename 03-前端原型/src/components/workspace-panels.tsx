"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, FileCheck2, Pencil, ShieldCheck } from "lucide-react";
import { decisionLabels, type DecisionStatus, type DemoContent, type Project, type UpdateProjectInput } from "@/domain/models";
import { ServiceError } from "@/services/contracts";
import { useService } from "./providers";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { ErrorMessage, SourcePreview } from "./shared";

const natureLabels = { "source-fact": "参考材料明确事实", inference: "分析推断", original: "原创方案", unresolved: "待确定事项" };

function useSaveProject() {
  const client = useQueryClient();
  return async (project: Project) => {
    client.setQueryData(["project", project.id], project);
    await client.invalidateQueries({ queryKey: ["projects"] });
  };
}

export function EditProject({ project, label = "编辑项目", iconOnly = false }: { project: Project; label?: string; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [note, setNote] = useState(project.note);
  const [revision, setRevision] = useState(project.revision);
  const [saved, setSaved] = useState(false);
  const [reloadError, setReloadError] = useState<unknown>(null);
  const [reloading, setReloading] = useState(false);
  const [latest, setLatest] = useState<Project | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const router = useRouter();
  const pathname = usePathname();
  const service = useService();
  const onSave = useSaveProject();
  const update = useMutation({ mutationFn: (input: UpdateProjectInput) => project.readOnly ? service.create({ ...input, template: project.template }) : service.update(project.id, revision, input), onSuccess: async (next) => { await onSave(next); if (!mounted.current) return; setOpen(false); setSaved(true); if (project.readOnly) router.replace(pathname.replace(`/projects/${project.id}`, `/projects/${next.id}`)); } });
  const conflict = update.error instanceof ServiceError && update.error.code === "CONFLICT";
  async function loadLatest() {
    setReloadError(null); setReloading(true);
    try {
      const next = await service.get(project.id);
      await onSave(next);
      // Preserve unsaved input while allowing an explicit rebase onto the latest revision.
      setRevision(next.revision); setLatest(next); update.reset();
    } catch (error) { setReloadError(error); } finally { setReloading(false); }
  }
  return <><div className="flex items-center gap-3">{saved && <span role="status" className="success-message"><Check size={12} />已保存</span>}<Button ref={triggerRef} variant={iconOnly ? "ghost" : "outline"} size={iconOnly ? "icon-sm" : "sm"} aria-label={label} title={label} onClick={() => { setLatest(null); setReloadError(null); setTitle(project.title); setNote(project.note); setRevision(project.revision); update.reset(); setOpen(true); setSaved(false); }}><Pencil size={14} aria-hidden="true" />{!iconOnly && label}</Button></div>
    <Dialog open={open} onOpenChange={(value) => { if (!update.isPending) setOpen(value); }}><DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}><DialogTitle>修改剧本名称</DialogTitle><DialogDescription>{project.readOnly ? "输入新名称并保存即可继续创作，系统会自动保留独立副本，原始样例不变。" : "修改当前剧本名称，也可以一起更新创作备注。"}</DialogDescription><form onSubmit={(e) => { e.preventDefault(); if (!update.isPending) update.mutate({ title, note }); }}><fieldset disabled={update.isPending}><legend className="sr-only">编辑项目资料</legend><label className="field-label" htmlFor="edit-title">项目名称</label><Input id="edit-title" value={title} onFocus={(event) => event.target.select()} onChange={(e) => setTitle(e.target.value)} required maxLength={40} /><label className="field-label mt-5" htmlFor="edit-note">创作备注</label><Textarea id="edit-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1200} rows={5} /></fieldset>
      {update.error && <div className="mt-4"><ErrorMessage error={update.error} />{conflict && <Button type="button" variant="outline" disabled={reloading} onClick={() => void loadLatest()}>{reloading ? "读取中…" : "保留输入，载入最新版本"}</Button>}</div>}
      {reloadError ? <ErrorMessage error={reloadError} /> : null}
      {latest && <div role="status" className="stage-callout mt-4"><strong>你的输入已保留，尚未合并。</strong><p>再次保存会用当前输入覆盖下列最新项目资料。</p><details className="mt-2"><summary>查看最新资料</summary><p className="mt-2">名称：{latest.title}</p><p className="max-h-28 overflow-auto whitespace-pre-wrap">备注：{latest.note || "无"}</p></details></div>}
      <div className="form-actions"><Button type="submit" disabled={update.isPending || !title.trim() || conflict}>{update.isPending ? "保存中…" : latest ? "使用当前输入覆盖保存" : "保存修改"}</Button></div></form></DialogContent></Dialog>
  </>;
}

export function DecisionPanel({ project }: { project: Project }) {
  const service = useService();
  const client = useQueryClient();
  const onSave = useSaveProject();
  const update = useMutation({ mutationFn: ({ id, status }: { id: string; status: DecisionStatus }) => service.setDecision(project.id, project.revision, id, status), onSuccess: onSave });
  return <section className="panel"><div className="panel-title"><h2>创作决定</h2><span>{project.decisions.filter((d) => d.status === "open").length} 项待解决</span></div>
    <p className="field-hint mb-4">{project.readOnly ? <>原始样例为只读。请先<Link href="/projects/new?template=demo" className="inline-link">创建演示副本</Link>，再修改决定状态。</> : <>在每条决定的“修改状态”下拉框中选择，修改后自动保存。</>}<br />状态记录你的决定，不代表剧本内容已修改或效果已验证。</p>
    {project.decisions.map((decision) => <div className="decision-row" key={decision.id}><div><h3>{decision.title}<span className="nature-label">{natureLabels[decision.nature]}</span></h3><p>{decision.detail}</p>{decision.source && <details className="decision-source"><summary>查看来源</summary><p>{decision.source}</p></details>}</div>
      {project.readOnly ? <span className={`tag ${decision.status === "provisional" ? "blue" : decision.status === "open" ? "amber" : ""}`}>{decisionLabels[decision.status]}</span> : <label className="decision-control"><span>修改状态</span><select aria-label={`${decision.title}状态`} className="plain-select" value={decision.status} disabled={update.isPending} onChange={(e) => update.mutate({ id: decision.id, status: e.target.value as DecisionStatus })}>{Object.entries(decisionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    </div>)}
    {update.error && <><ErrorMessage error={update.error} /><Button variant="outline" size="sm" onClick={() => { update.reset(); void client.invalidateQueries({ queryKey: ["project", project.id] }); }}>重新读取项目</Button></>}
    <div role="status" className="success-message">{update.isPending ? "正在保存…" : update.isSuccess ? <><Check size={12} />决定状态已保存</> : ""}</div>
  </section>;
}

export function ChecksPanel({ content }: { content: DemoContent | null }) {
  return <section className="panel"><div className="panel-title"><h2><ShieldCheck size={15} />检查与试玩</h2></div>
    {content ? content.checks.map((check) => <div className="check-row" key={check.id}><div className="check-label">{check.origin === "historical" ? <FileCheck2 size={13} /> : <Circle size={12} />}{check.label}</div><strong>{check.result}</strong><small>{check.origin === "historical" ? "历史记录 · " : ""}{check.scope}</small>{check.source && <details className="decision-source"><summary>记录来源</summary><p>{check.source}</p></details>}</div>) : <p className="readiness-copy">尚无历史样例检查记录。当前项目的模拟结果在“生成与检查”查看，各类检查分别记录。</p>}
    <p className="check-notice">{content ? "历史结果只适用于标注的样例版本，不代表当前修改通过。尚未真人试玩。" : "尚未真人试玩。结构检查通过后，仍需观察真实玩家的参与和理解。"}</p>
  </section>;
}

export function ReadinessPanel({ content }: { content: DemoContent | null }) {
  const ready = content?.deliverables.filter((item) => item.complete).length ?? 0;
  const total = content?.deliverables.length ?? 0;
  return <section className="panel"><div className="panel-title"><h2>材料准备</h2><span>{content ? "原始样例" : "新项目"}</span></div><div className="readiness-number">{total ? Math.round(ready / total * 100) : 0}<span className="text-sm"> %</span></div><div className="stage-strip" aria-hidden="true">{content?.deliverables.map((d) => <span className={d.complete ? "done" : ""} key={d.label} />)}</div><p className="readiness-copy">{total ? `${ready} / ${total} 类开本材料齐备` : "还没有开本材料"}<br />此比例仅表示材料齐备程度。</p></section>;
}

export function SourcesPanel({ content }: { content: DemoContent }) {
  return <section className="panel"><div className="panel-title"><h2>档案原文</h2><span>作者视角</span></div>{content.documents.map((document) => <SourcePreview document={document} key={document.id} />)}<p className="field-hint">原文含主持信息与谜底，请勿展示给玩家。</p></section>;
}
