"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "@/domain/models";
import { parseProjectBackup, PROJECT_BACKUP_BYTES, serializeProjectBackup, type ProjectBackup } from "@/domain/project-backup";
import { pendingBlueprintSession } from "@/services/blueprint-draft-session";
import { useService } from "./providers";
import { ErrorMessage } from "./shared";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

function BackupSummary({ backup }: { backup: ProjectBackup }) {
  const state = backup.workbench;
  const segmented = state.reviewProgress?.checkpoint.review.segmented ?? state.review?.segmented;
  return <div className="space-y-3"><p>项目：{backup.project.title} · 备份时间：{new Date(backup.exportedAt).toLocaleString()}</p><p>材料 {state.documents.length} 份（排除 {state.documents.filter(d => d.excluded).length} 份） · 蓝图历史 {state.versions.length} 份 · 草稿 {state.blueprintDrafts.length} 份</p><p>正文材料 {state.review?.artifacts.length ?? 0} 份 · 当前审查报告 {Object.keys(state.review?.reports ?? {}).length} 份 · 历史审查 {state.reviewArchives.length} 份</p>{state.reviewProgress && <p>阶段成果 {state.reviewProgress.checkpoint.steps.filter(step => step.state === "saved").length}/{state.reviewProgress.checkpoint.steps.length} · 阶段正文 {state.reviewProgress.checkpoint.review.artifacts.length} 份 · 阶段报告 {Object.keys(state.reviewProgress.checkpoint.review.reports).length} 份</p>}{state.reviewProgress?.checkpoint.generation && <p>正文生成单元 {state.reviewProgress.checkpoint.generation.units.filter(unit => unit.state === "saved").length}/{state.reviewProgress.checkpoint.generation.units.length}</p>}{segmented && <p>分段审查报告 {segmented.units.filter(unit => unit.state === "saved").length}/{segmented.plan.callsMax} · 正文 {segmented.plan.parts.length} 段</p>}<p>包含原有项目记录、已保存的拆解、创作要求及方向选择。</p>{!backup.authoringRecordExists && <p role="status">原项目没有找到当前创作正文记录；本备份包含项目索引与旧版记录，请核对内容是否齐全。</p>}<p className="field-hint">仅包含已保存的浏览器创作数据。原始磁盘文件、费用账本、模型配置和文件夹权限需分别保管。</p></div>;
}
export function ProjectBackupButton({ project }: { project: Project }) {
  const service = useService(); const [backup, setBackup] = useState<ProjectBackup | null>(null);
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  async function prepare() {
    setOpen(true); setBusy(true); setError(null); setBackup(null);
    const session = pendingBlueprintSession(project.id); let acquired = false;
    try {
      if (session) { session.begin(); acquired = true; await session.writer.flush(); }
      setBackup(await service.exportProjectBackup(project.id));
    } catch (failure) { setError(failure); }
    finally { if (session && acquired && !session.status.closed) session.resume(); setBusy(false); }
  }
  function download() {
    if (!backup) return;
    try {
      const url = URL.createObjectURL(new Blob([serializeProjectBackup(backup)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `${backup.project.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")}-项目备份.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(failure); }
  }
  return <><Button variant="outline" size="sm" disabled={busy} onClick={() => void prepare()}>备份项目</Button><Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent><DialogTitle>下载项目备份</DialogTitle><DialogDescription>包含本次读取时已保存的项目内容；后续编辑需要重新备份。</DialogDescription>{busy && <p role="status">正在核对已保存内容…</p>}{backup && <BackupSummary backup={backup} />}{error != null && <ErrorMessage error={error} />}<Button disabled={busy || !backup} onClick={download}>下载完整项目备份</Button></DialogContent></Dialog></>;
}
export function RestoreProjectButton() {
  const service = useService(); const router = useRouter(); const cache = useQueryClient(); const input = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<{ backup: ProjectBackup; operationId: string } | null>(null);
  const [result, setResult] = useState<{ project: Project; cleanupPending: boolean } | null>(null);
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  async function read(file: File) {
    setOpen(true); setBusy(true); setSelection(null); setResult(null); setError(null);
    try { if (file.size > PROJECT_BACKUP_BYTES) throw new Error("备份超过64 MiB上限，未读取或导入。"); setSelection({ backup: parseProjectBackup(await file.text()), operationId: crypto.randomUUID() }); }
    catch (failure) { setError(failure); } finally { setBusy(false); }
  }
  async function restore() {
    if (!selection || busy || result) return; setBusy(true); setError(null);
    try {
      const restored = await service.restoreProjectBackup(selection.backup, selection.operationId);
      setResult(restored); cache.setQueryData(["project", restored.project.id], restored.project); void cache.invalidateQueries({ queryKey: ["projects"] });
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  }
  return <><Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>从备份恢复</Button><input type="file" accept=".json,application/json" className="sr-only" aria-label="选择完整项目备份" ref={input} disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void read(file); }} /><Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent><DialogTitle>{result ? "项目副本已恢复" : "预览项目备份"}</DialogTitle><DialogDescription>{result ? "原项目保持不变，请在新副本中继续创作。" : "确认后创建新副本，保留原项目；不会接续旧任务或自动调用模型。"}</DialogDescription>{selection && !result && <><BackupSummary backup={selection.backup} /><p>输出位置需重新选择，项目预算需重新设置。备份中的审查结论仅作历史记录，恢复后需要重新审查才能导出。</p><Button disabled={busy} onClick={() => void restore()}>{busy ? "正在恢复…" : "恢复为新副本"}</Button></>}{result && <><p>{result.project.title}</p>{result.cleanupPending && <p>副本已经发布，恢复记录收尾尚未完成；重新读取列表时会继续核对，无需重复创建。</p>}<Button onClick={() => { setOpen(false); router.push(`/projects/${result.project.id}/stages/materials`); }}>打开恢复的副本</Button></>}{error != null && <ErrorMessage error={error} />}</DialogContent></Dialog></>;
}
