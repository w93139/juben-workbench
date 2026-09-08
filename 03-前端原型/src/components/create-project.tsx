"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus } from "lucide-react";
import { sourceFileAccept, sourceImportPolicy, type SourceFileInput } from "@/domain/source-import";
import { ServiceError, type SourceImportProgress } from "@/services/contracts";
import { useService } from "./providers";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { ErrorMessage } from "./shared";

const phases = { checking: "正在整理文件清单", transferring: "正在模拟上传", saving: "正在保存项目与材料", complete: "材料登记完成" };

/** Starts only from an explicit file selection; no project exists before the atomic save. */
export function UploadProjectButton({ compact = false, fallback = false }: { compact?: boolean; fallback?: boolean }) {
  const service = useService();
  const router = useRouter();
  const client = useQueryClient();
  const folder = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [batch, setBatch] = useState<SourceFileInput[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [progress, setProgress] = useState<SourceImportProgress>({ phase: "checking", percent: 0 });
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  async function start(input: SourceFileInput[]) {
    if (controller.current) return;
    const current = new AbortController(); controller.current = current;
    setBatch(input); setOpen(true); setBusy(true); setError(null); setProgress({ phase: "checking", percent: 0 });
    try {
      const result = await service.createFromSources(input, { signal: current.signal, onProgress: (next) => { if (controller.current === current) setProgress(next); } });
      if (controller.current !== current) return;
      client.setQueryData(["project", result.project.id], result.project);
      void client.invalidateQueries({ queryKey: ["projects"] });
      setOpen(false);
      router.push(`/projects/${result.project.id}/stages/materials`);
    } catch (failure) {
      if (controller.current === current) setError(failure);
    } finally { if (controller.current === current) { controller.current = null; setBusy(false); } }
  }
  function receive(list: FileList | null) {
    if (controller.current || !list?.length) return;
    if (list.length > sourceImportPolicy.batchFiles) {
      setBatch([]); setOpen(true); setError(new ServiceError("INVALID_INPUT", `选择了${list.length}份文件，超过单批${sourceImportPolicy.batchFiles}份。请按子文件夹分批导入；本次未创建项目。`)); return;
    }
    void start(Array.from(list, (file) => ({ name: file.name, size: file.size, mime: file.type, relativePath: file.webkitRelativePath || undefined, lastModified: file.lastModified })));
  }
  return <>
    <Button variant={compact ? "outline" : "default"} size={compact ? "icon" : "default"} aria-label={compact ? "上传剧本文件夹" : undefined} title={compact ? "上传完整剧本文件夹，建立项目" : undefined} disabled={busy} onClick={() => {
      if (folder.current && "webkitdirectory" in folder.current) folder.current.click();
      else { setOpen(true); setBatch([]); setError(new ServiceError("DIRECTORY_UNAVAILABLE", "当前浏览器不支持文件夹选择，请用下方“选择剧本文件”批量选择。")); }
    }}>{compact ? <Plus size={17} /> : <><FolderOpen size={17} />上传完整剧本文件夹</>}</Button>
    <input className="sr-only" ref={(node) => { folder.current = node; node?.setAttribute("webkitdirectory", ""); }} type="file" multiple aria-label={compact ? "从侧栏选择剧本文件夹" : "选择剧本文件夹"} disabled={busy} onChange={(event) => { receive(event.target.files); event.target.value = ""; }} />
    <input className="sr-only" ref={files} type="file" multiple accept={sourceFileAccept} aria-label={compact ? "从侧栏选择剧本文件" : "选择剧本文件"} disabled={busy} onChange={(event) => { receive(event.target.files); event.target.value = ""; }} />
    {fallback && <details className="mt-4"><summary className="field-hint">无法选择文件夹？</summary><Button className="mt-3" variant="outline" disabled={busy} onClick={() => files.current?.click()}>选择剧本文件</Button><p className="field-hint mt-2">可以批量选择文件，进入项目后继续补充。空文件夹不会创建项目。</p></details>}
    <Dialog open={open} onOpenChange={(value) => { if (!value && busy) return; setOpen(value); }}><DialogContent><DialogTitle>{busy ? phases[progress.phase] : "导入未完成"}</DialogTitle><DialogDescription>本地模拟：只保存文件名称、类型、大小和相对路径，尚未读取正文或上传到服务器。保存成功后自动进入材料中心，无需确认。</DialogDescription><progress aria-label="模拟上传进度" max={100} value={progress.percent} className="w-full" /><p role="status">{busy ? `${phases[progress.phase]} · ${progress.percent}%` : "本次没有创建项目，已选清单保留，可重试。"}</p>{progress.preview && <p className="field-hint">有效 {progress.preview.eligibleCount} 份，略过 {progress.preview.skippedCount} 份。</p>}{error != null && <ErrorMessage error={error} />}{busy ? <Button variant="outline" disabled={progress.phase === "saving"} onClick={() => controller.current?.abort()}>取消导入</Button> : <div className="flex flex-wrap gap-3">{!!batch.length && <Button onClick={() => void start(batch)}>重试导入</Button>}<Button variant="outline" onClick={() => { setOpen(false); files.current?.click(); }}>选择剧本文件</Button></div>}</DialogContent></Dialog>
  </>;
}

export function CreateProjectPage() {
  return <><div className="page-heading"><div><span className="eyebrow">START WITH YOUR SCRIPT</span><h1 className="serif">从一份完整剧本开始。</h1><p>上传你想要改写的剧本文件夹，先看清结构，再选择原创方向。</p></div></div><section className="panel" aria-label="上传剧本入口"><h2 className="serif text-xl">选择剧本文件夹</h2><p className="story-premise mt-4">将角色本、主持手册、线索和终局材料放在同一个文件夹中，可以包含子文件夹。项目默认使用文件夹名称，之后点小笔即可修改。</p><div className="mt-5"><UploadProjectButton fallback /></div><ol className="mt-6 space-y-3"><li>1. 整理材料，标出缺失和识别问题。</li><li>2. 拆解故事因果、人物关系、信息、线索和每轮玩法。</li><li>3. 比较原创大纲与写作方向，选择后再设计新故事。</li></ol><p className="field-hint mt-5">当前为可交互原型，仅登记文件信息。真实OCR、音视频转写和内容分析尚未接入；后续方向卡明确标为通用模拟建议。</p></section></>;
}
