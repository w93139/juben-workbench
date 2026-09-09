"use client";
import { useEffect, useRef, useState } from "react";
import { FolderDropzone } from "../folder-dropzone";
import { visibleFiles } from "@/services/folder-drop";
import type { WorkbenchState } from "@/domain/workbench";
import { replaceMaterials, readMaterials } from "@/services/studio-client";
import { changeWorkbench } from "@/services/workbench-store";
import { Button } from "../ui/button";
import { ErrorMessage } from "../shared";

export function StudioMaterials({ projectId, state, update, onBusy }: { projectId: string; state: WorkbenchState; update: (state: WorkbenchState) => void; onBusy: (busy: boolean) => void }) {
  const files = useRef<HTMLInputElement>(null); const folder = useRef<HTMLInputElement>(null); const controller = useRef<AbortController | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState({ done: 0, total: 0, name: "" }); const [error, setError] = useState<unknown>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const [batch, setBatch] = useState<File[]>([]);
  async function ingest(input: File[]) {
    if (!input.length || controller.current) return;
    input = visibleFiles(input);
    if (!input.length || controller.current) { if (!input.length) setError(new Error("文件夹中没有可读取材料，原材料保持不变。")); return; }
    const abort = new AbortController(); controller.current = abort; setBatch(input); setSaving(false); setBusy(true); onBusy(true); setError(null);
    try { const documents = await readMaterials(input, (done, total, name) => setProgress({ done, total, name }), abort.signal); if (abort.signal.aborted) return; setSaving(true); update(await replaceMaterials(projectId, state.revision, documents)); setBatch([]); }
    catch (failure) { setError(failure); }
    finally { controller.current = null; setSaving(false); setBusy(false); onBusy(false); }
  }
  const active = state.documents.filter(document => !document.excluded);
  const unread = active.filter(document => document.status !== "read" || !document.text.trim()).length;
  const excluded = state.documents.length - active.length;
  const firstName = state.documents[0]?.name;
  const selectedName = firstName ? (firstName.includes("/") ? firstName.split("/")[0] : `已上传 ${state.documents.length} 份材料`) : undefined;
  return <section className="materials-container" aria-label="上传原剧本文件">
    <FolderDropzone selectedName={selectedName} disabled={busy || !!state.job} onPick={() => folder.current?.click()} onFiles={ingest} />
    <input ref={files} className="sr-only" type="file" multiple aria-label="上传原剧本文件" disabled={busy || !!state.job} onChange={e => { void ingest(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    <input className="sr-only" type="file" multiple aria-label="上传原剧本文件夹" ref={node => { folder.current = node; node?.setAttribute("webkitdirectory", ""); }} disabled={busy || !!state.job} onChange={e => { void ingest(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    {busy && <div className="mt-5"><progress aria-label="文件读取进度" value={progress.done} max={progress.total || 1} /><p role="status">{saving ? "正在保存新材料，请稍候…" : `正在读取 ${progress.name} · ${progress.done}/${progress.total}，需要时自动识别文字`}</p><Button size="sm" variant="ghost" disabled={saving} onClick={() => controller.current?.abort()}>取消</Button></div>}
    {error != null && <><ErrorMessage error={error} />{!!batch.length && <Button disabled={busy} onClick={() => void ingest(batch)}>重试读取</Button>}</>}
    {!!state.documents.length && <details className="material-details"><summary><span>共 {state.documents.length} 份 · 已读取 {active.length - unread} 份{unread > 0 && <span className="material-attention"> · {unread} 份待处理</span>}{excluded > 0 && <> · 已排除 {excluded} 份</>}</span><span className="material-details-label">查看文件明细</span></summary><ul className="studio-files">{state.documents.map(document => <li key={document.id}><div><strong>{document.name}</strong><small>{document.excluded ? "本轮不使用" : document.status === "read" ? `已读取 · ${document.text.length} 字` : "尚未读取"}{document.warnings.length ? ` · ${document.warnings.join("；")}` : ""}</small></div><Button size="sm" variant="ghost" disabled={busy || !!state.job} onClick={() => void changeWorkbench(projectId, state.revision, next => { const item = next.documents.find(d => d.id === document.id); if (item) item.excluded = !item.excluded; next.sourceRevision++; }).then(update).catch(setError)}>{document.excluded ? "重新使用" : "本轮不使用"}</Button></li>)}</ul></details>}
  </section>;
}
