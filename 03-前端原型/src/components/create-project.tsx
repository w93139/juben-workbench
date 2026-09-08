"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { sourceFileAccept, sourceImportPolicy } from "@/domain/source-import";
import type { Material } from "@/domain/workbench";
import { ServiceError } from "@/services/contracts";
import { appendMaterials, readMaterials } from "@/services/studio-client";
import { readWorkbench } from "@/services/workbench-store";
import { useService } from "./providers";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { FolderDropzone } from "./folder-dropzone";
import { ErrorMessage } from "./shared";

type PendingImport = { files: File[]; documents: Material[] | null; projectId: string | null };

/** Read actual files before creating a project. Retain the project identity if the second storage fails. */
export function UploadProjectButton({ compact = false, fallback = false }: { compact?: boolean; fallback?: boolean }) {
  const service = useService();
  const router = useRouter();
  const client = useQueryClient();
  const folder = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<PendingImport | null>(null);
  const [batch, setBatch] = useState<File[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [phase, setPhase] = useState<"reading" | "saving">("reading");
  const [progress, setProgress] = useState({ done: 0, total: 0, name: "" });
  const [created, setCreated] = useState(false);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  async function start(input: File[], resume = false) {
    if (controller.current) return;
    if (!resume || !pending.current) pending.current = { files: input, documents: null, projectId: null };
    const task = pending.current;
    const current = new AbortController(); controller.current = current;
    const active = () => controller.current === current;
    setBatch(input); setOpen(true); setBusy(true); setError(null); setCreated(!!task.projectId);
    setPhase(task.documents ? "saving" : "reading"); setProgress({ done: 0, total: input.length, name: "" });
    try {
      if (!task.documents) task.documents = await readMaterials(task.files, (done, total, name) => { if (active()) setProgress({ done, total, name }); }, current.signal);
      if (current.signal.aborted || !active()) throw new Error("读取已取消，未创建新项目。");
      setPhase("saving");
      // From here commit the already-read documents even if the view is closed.
      // A failure preserves projectId for retry rather than creating a second project.
      if (!task.projectId) {
        const first = task.files[0];
        const name = first.webkitRelativePath.includes("/") ? first.webkitRelativePath.split("/")[0] : first.name.replace(/\.[^.]+$/, "");
        const project = await service.create({ title: name.trim().slice(0, 40) || "我的剧本", template: "blank", note: "" });
        task.projectId = project.id;
        client.setQueryData(["project", project.id], project);
        if (active()) setCreated(true);
      }
      const state = await readWorkbench(task.projectId);
      if (!task.documents.every((document) => state.documents.some((saved) => saved.id === document.id))) await appendMaterials(task.projectId, state.revision, task.documents);
      void client.invalidateQueries({ queryKey: ["projects"] });
      if (!active()) return;
      setOpen(false);
      router.push(`/projects/${task.projectId}/stages/materials`);
      pending.current = null; setBatch([]);
    } catch (failure) {
      if (active()) setError(current.signal.aborted ? new Error("读取已取消，已选文件保留，可重新读取。") : failure);
    } finally { if (active()) { controller.current = null; setBusy(false); } }
  }
  async function receive(list: FileList | File[] | null) {
    if (controller.current || !list?.length) return;
    const selected = Array.from(list).filter((file) => !(file.webkitRelativePath || file.name).split("/").some((part) => part.startsWith(".") || part === "__MACOSX"));
    if (!selected.length || selected.length > sourceImportPolicy.batchFiles) {
      pending.current = null; setBatch([]); setCreated(false); setOpen(true);
      setError(new ServiceError("INVALID_INPUT", !selected.length ? "这个文件夹中只有隐藏或系统文件，请选择剧本文件夹。" : `选择了${selected.length}份文件，超过单批${sourceImportPolicy.batchFiles}份。请按子文件夹分批导入；本次未创建项目。`)); return;
    }
    await start(selected);
  }
  const label = phase === "reading" ? "正在读取剧本材料" : "正在保存项目与正文";
  return <>
    {compact ? <Button variant="outline" size="icon" aria-label="上传剧本文件夹" title="上传剧本文件夹，建立项目" disabled={busy} onClick={() => folder.current?.click()}><Plus size={17} /></Button> : <FolderDropzone large disabled={busy} onPick={() => folder.current?.click()} onFiles={receive} />}
    <input className="sr-only" ref={(node) => { folder.current = node; node?.setAttribute("webkitdirectory", ""); }} type="file" multiple aria-label={compact ? "从侧栏选择剧本文件夹" : "选择剧本文件夹"} disabled={busy} onChange={(event) => { receive(event.target.files); event.target.value = ""; }} />
    <input className="sr-only" ref={files} type="file" multiple accept={sourceFileAccept} aria-label={compact ? "从侧栏选择剧本文件" : "选择剧本文件"} disabled={busy} onChange={(event) => { receive(event.target.files); event.target.value = ""; }} />
    {fallback && !compact && <details className="mt-4"><summary className="field-hint">无法选择文件夹？</summary><Button className="mt-3" variant="outline" disabled={busy} onClick={() => files.current?.click()}>选择剧本文件</Button><p className="field-hint mt-2">可以批量选择文件，进入项目后继续补充。空文件夹不会创建项目。</p></details>}
    <Dialog open={open} onOpenChange={(value) => { if (!value && busy) return; setOpen(value); }}><DialogContent><DialogTitle>{busy ? label : "导入未完成"}</DialogTitle><DialogDescription>文件交给此电脑的本地服务提取文字或识别扫描内容，原文件不会改动。读取结果保存到浏览器，完成后自动进入材料中心。</DialogDescription>
      <progress aria-label="文件读取进度" max={Math.max(1, progress.total)} value={phase === "reading" ? progress.done : undefined} className="w-full" />
      <p role="status">{busy ? phase === "reading" ? `已处理 ${progress.done} / ${progress.total} 份 · ${progress.name}` : "正在保存已读取的正文，请稍候…" : created ? "项目已建立，正文保存尚未完成。重试会继续保存到同一项目。" : "本次没有创建项目，已选文件保留，可重试。"}</p>
      {error != null && <ErrorMessage error={error} />}{busy ? <Button variant="outline" disabled={phase === "saving"} onClick={() => controller.current?.abort()}>取消读取</Button> : <div className="flex flex-wrap gap-3">{!!batch.length && <Button onClick={() => void start(batch, true)}>{created ? "重试保存" : "重试导入"}</Button>}<Button variant="outline" onClick={() => { setOpen(false); files.current?.click(); }}>选择剧本文件</Button></div>}
    </DialogContent></Dialog>
  </>;
}

export function CreateProjectPage() {
  return <><div className="page-heading"><div><span className="eyebrow">START WITH YOUR SCRIPT</span><h1 className="serif">从一份完整剧本开始。</h1><p>上传你想要改写的剧本文件夹，先读材料，再拆解结构并选择原创方向。</p></div></div><section className="panel" aria-label="上传剧本入口"><h2 className="serif text-xl">选择剧本文件夹</h2><p className="story-premise mt-4">将角色本、主持手册、线索和终局材料放在同一个文件夹中，可以包含子文件夹。项目默认使用文件夹名称，之后点小笔即可修改。</p><div className="mt-5"><UploadProjectButton fallback /></div><ol className="mt-6 space-y-3"><li>1. 读取正文和扫描文字，逐项处理无法识别的材料。</li><li>2. 拆解故事因果、人物关系、信息、线索和每轮玩法。</li><li>3. 选择原创方向，设计新故事，再进行完整审查。</li></ol><p className="field-hint mt-5">不支持的格式和识别问题会在材料中心列出。模型未连接时会明确提示，不会以演示内容代替你的剧本。</p></section></>;
}
