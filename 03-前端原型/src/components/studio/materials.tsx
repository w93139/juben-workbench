"use client";
import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { WorkbenchState } from "@/domain/workbench";
import { appendMaterials, readMaterials } from "@/services/studio-client";
import { changeWorkbench } from "@/services/workbench-store";
import { Button } from "../ui/button";
import { ErrorMessage } from "../shared";

export function StudioMaterials({ projectId, state, update, onBusy }: { projectId: string; state: WorkbenchState; update: (state: WorkbenchState) => void; onBusy: (busy: boolean) => void }) {
  const files = useRef<HTMLInputElement>(null); const folder = useRef<HTMLInputElement>(null); const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState({ done: 0, total: 0, name: "" }); const [error, setError] = useState<unknown>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const [batch, setBatch] = useState<File[]>([]);
  async function ingest(input: File[]) {
    if (!input.length || controller.current) return;
    const abort = new AbortController(); controller.current = abort; setBatch(input); setBusy(true); onBusy(true); setError(null);
    try { const documents = await readMaterials(input, (done, total, name) => setProgress({ done, total, name }), abort.signal); if (abort.signal.aborted) return; update(await appendMaterials(projectId, state.revision, documents)); setBatch([]); }
    catch (failure) { setError(failure); }
    finally { controller.current = null; setBusy(false); onBusy(false); }
  }
  return <section className="studio-upload" aria-label="上传原剧本文件">
    <Upload size={30} /><h2>上传原剧本文件</h2><p>可上传完整文件夹，包含角色本、主持手册、线索及其他资料。</p>
    <div className="flex flex-wrap justify-center gap-3 mt-5"><Button disabled={busy || !!state.job} onClick={() => files.current?.click()}>上传文件</Button><Button variant="outline" disabled={busy || !!state.job} onClick={() => folder.current?.click()}>上传文件夹</Button></div>
    <input ref={files} className="sr-only" type="file" multiple aria-label="上传原剧本文件" disabled={busy || !!state.job} onChange={e => { void ingest(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    <input className="sr-only" type="file" multiple aria-label="上传原剧本文件夹" ref={node => { folder.current = node; node?.setAttribute("webkitdirectory", ""); }} disabled={busy || !!state.job} onChange={e => { void ingest(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    {busy && <div className="mt-5"><progress aria-label="文件读取进度" value={progress.done} max={progress.total || 1} /><p role="status">正在读取 {progress.name} · {progress.done}/{progress.total}，需要时自动识别文字</p><Button size="sm" variant="ghost" onClick={() => controller.current?.abort()}>取消</Button></div>}
    {error != null && <><ErrorMessage error={error} />{!!batch.length && <Button disabled={busy} onClick={() => void ingest(batch)}>重试读取</Button>}</>}
    {!!state.documents.length && <ul className="studio-files">{state.documents.map(document => <li key={document.id}><div><strong>{document.name}</strong><small>{document.excluded ? "本轮不使用" : document.status === "read" ? `已读取 · ${document.text.length} 字` : "尚未读取"}{document.warnings.length ? ` · ${document.warnings.join("；")}` : ""}</small></div><Button size="sm" variant="ghost" disabled={busy || !!state.job} onClick={() => void changeWorkbench(projectId, state.revision, next => { const item = next.documents.find(d => d.id === document.id); if (item) item.excluded = !item.excluded; next.sourceRevision++; }).then(update).catch(setError)}>{document.excluded ? "重新使用" : "本轮不使用"}</Button></li>)}</ul>}
  </section>;
}
