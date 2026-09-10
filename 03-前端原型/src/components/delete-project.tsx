"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { Project } from "@/domain/models";
import { useService } from "./providers";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { ErrorMessage } from "./shared";

export function DeleteProjectButton({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [cleanupPending, setCleanupPending] = useState(false);
  const service = useService(); const cache = useQueryClient();
  const pathname = usePathname(); const router = useRouter();
  if (project.readOnly) return null;
  function refresh() {
    cache.removeQueries({ queryKey: ["project", project.id] });
    cache.removeQueries({ queryKey: ["workbench", project.id] });
    void cache.invalidateQueries({ queryKey: ["projects"] });
    if (pathname === `/projects/${project.id}` || pathname.startsWith(`/projects/${project.id}/`)) router.replace("/projects");
  }
  function close() { setOpen(false); if (cleanupPending) refresh(); }
  async function remove() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await service.remove(project.id, project.revision);
      if (result.cleanupPending) setCleanupPending(true);
      else { setOpen(false); refresh(); }
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="project-delete" aria-label={`删除项目：${project.title}`} title="删除项目" onClick={() => { setError(null); setOpen(true); }}><Trash2 size={16} /></button>
    <Dialog open={open} onOpenChange={value => { if (!busy) { if (value) setOpen(true); else close(); } }}><DialogContent onCloseAutoFocus={event => { if (cleanupPending) { event.preventDefault(); document.getElementById("main")?.focus(); } }}><DialogTitle>{cleanupPending ? "项目正文清理未完成" : `删除“${project.title}”？`}</DialogTitle><DialogDescription>{cleanupPending ? "项目已从列表移除，但浏览器未能清理本机正文备份。原文件、已导出文件和服务端任务记录不受影响，请检查浏览器存储。" : "将删除当前浏览器中这个项目的材料、草稿和创作记录，无法撤销。电脑上的原文件、已导出文件和服务端任务记录不会删除。"}</DialogDescription>
      {error != null && <ErrorMessage error={error} />}
      <div className="form-actions">{cleanupPending ? <Button onClick={close}>知道了</Button> : <><Button variant="outline" disabled={busy} onClick={close}>取消</Button><Button variant="destructive" disabled={busy} onClick={() => void remove()}>{busy ? "删除中…" : "确认删除"}</Button></>}</div>
    </DialogContent></Dialog>
  </>;
}
