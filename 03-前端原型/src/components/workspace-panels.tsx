"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil } from "lucide-react";
import { type Project, type UpdateProjectInput } from "@/domain/models";
import { ServiceError } from "@/services/contracts";
import { useService } from "./providers";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { ErrorMessage } from "./shared";


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
