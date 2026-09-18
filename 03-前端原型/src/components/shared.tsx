"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowUpRight, LoaderCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ServiceError } from "@/services/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useService } from "./providers";

export function Loading() { return <div role="status" className="loading"><LoaderCircle size={18} className="animate-spin" />正在打开工作区…</div>; }
export function ErrorMessage({ error }: { error: unknown }) {
  return <div role="alert" className="error-banner">{error instanceof Error ? error.message : "操作未完成，请重试。"}</div>;
}

export function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  const service = useService();
  const client = useQueryClient();
  const [backup, setBackup] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const recoveryTrigger = useRef<HTMLButtonElement>(null);
  const recoverable = error instanceof ServiceError && ["STORAGE_CORRUPT", "STORAGE_VERSION"].includes(error.code);
  async function prepare() {
    setActionError(null);
    try { setBackup(await service.getBackup()); setConfirmed(false); setOpen(true); } catch (e) { setActionError(e); }
  }
  function download() {
    if (backup === null) return;
    const url = URL.createObjectURL(new Blob([backup], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "本间工作台-原始项目索引.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function reset() {
    if (!confirmed || backup === null || busy) return;
    setBusy(true); setActionError(null);
    try { await service.resetLocalProjects(backup); setOpen(false); await client.invalidateQueries(); } catch (e) { setActionError(e); } finally { setBusy(false); }
  }
  return <section className="panel"><AlertCircle size={22} className="mb-4 text-destructive" /><ErrorMessage error={error} />
    {actionError && !open ? <ErrorMessage error={actionError} /> : null}
    <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={retry}>重新读取</Button>{recoverable && <Button ref={recoveryTrigger} variant="outline" onClick={prepare}>项目索引排错</Button>}<Link href="/projects/demo-names" className="text-link">仍可浏览原始样例 <ArrowUpRight size={13} /></Link></div>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}><DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); (recoveryTrigger.current ?? document.getElementById("main"))?.focus(); }}><DialogTitle>项目索引排错</DialogTitle><DialogDescription>此操作仅清空项目索引，会使现有项目无法从列表打开。此处下载不包含IndexedDB中的材料、蓝图或草稿，不能代替完整项目备份。</DialogDescription>
      {actionError ? <ErrorMessage error={actionError} /> : null}
      <Button variant="outline" onClick={download} disabled={backup === null}>下载原始项目索引</Button>
      <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />我了解这将清空项目索引，并已另行保留完整创作数据</label>
      <Button variant="destructive" disabled={!confirmed || backup === null || busy} onClick={reset}>{busy ? "正在清空…" : "清空项目索引"}</Button>
    </DialogContent></Dialog>
  </section>;
}
