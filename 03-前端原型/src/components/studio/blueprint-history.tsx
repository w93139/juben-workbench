"use client";
import { useState } from "react";
import type { WorkbenchState } from "@/domain/workbench";
import { assertHistoryVersion, type BlueprintVersion } from "@/domain/blueprint-history";
import { deleteBlueprintHistory, readWorkbench } from "@/services/workbench-store";
import type { useBlueprintDraft } from "../hooks/use-blueprint-draft";
import { blueprintText } from "./blueprint-drafts";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { ErrorMessage } from "../shared";

export function StudioBlueprintHistory({ id, state, editor, disabled, update, onBusy }: { id: string; state: WorkbenchState; editor: ReturnType<typeof useBlueprintDraft>; disabled: boolean; update: (state: WorkbenchState) => void; onBusy: (value: boolean) => void }) {
  const [selection, setSelection] = useState<{ index: number; version: BlueprintVersion; historyRevision: number; revision: number; current: NonNullable<WorkbenchState["blueprint"]>; blueprintRevision: number } | null>(null);
  const [deleting, setDeleting] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const locked = busy || disabled;
  async function act(action: () => Promise<void>) { setBusy(true); onBusy(true); setError(null); try { await action(); setSelection(null); setDeleting(false); } catch (failure) { setError(failure); } finally { setBusy(false); onBusy(false); } }
  async function load() {
    if (!selection) return;
    const current = await readWorkbench(id); assertHistoryVersion(current, selection.historyRevision, selection.index, selection.version);
    if (current.revision !== selection.revision || current.blueprintRevision !== selection.blueprintRevision) throw new Error("正式蓝图或项目已变化，请重新对照后恢复。");
    await editor.restoreData(selection.version.data, current.revision, current.blueprintRevision, selection);
  }
  return <section className="panel" aria-label="蓝图历史版本"><div className="panel-title"><h2>历史版本</h2><span>{state.versions.length}/20 份</span></div><p className="field-hint">历史只保存蓝图内容。载入为新草稿后仍须预览并提交；清理历史不改变正式蓝图或本页草稿。删除前请使用项目标题旁的“备份项目”保留完整档案。</p>
    {!!state.versions.length && <details className="archive-details mt-3"><summary>查看蓝图历史（{state.versions.length}份）</summary><div className="record-list p-4">{state.versions.map((version, index) => <article className="record-card" key={`${version.revision}:${index}`}><h3>蓝图版本 {version.revision}</h3><p className="line-clamp-3 my-3">{version.data.premise || "未填写大纲"}</p><Button variant="outline" disabled={locked} onClick={() => { setError(null); setDeleting(false); setSelection({ index, version: structuredClone(version), historyRevision: state.historyRevision, revision: state.revision, blueprintRevision: state.blueprintRevision, current: structuredClone(state.blueprint!) }); }}>查看与当前版本对照</Button></article>)}</div></details>}
    <Dialog open={!!selection} onOpenChange={open => { if (!locked && !open) { setSelection(null); setDeleting(false); } }}><DialogContent className="sm:max-w-3xl"><DialogTitle>{deleting ? "确认删除历史版本" : `对照蓝图版本 ${selection?.version.revision ?? ""}`}</DialogTitle><DialogDescription>{deleting ? "只删除下面选中的历史记录，当前正式蓝图、其他历史和独立草稿保留；不能撤销，请先保管完整项目备份。" : "历史内容可能属于旧方向或材料，需自行核对。载入后成为当前项目的新草稿，不回退版本号，也不恢复旧审查通过资格。"}</DialogDescription>{selection && <><div className="comparison-grid"><div><h3>当前正式蓝图 · 版本 {selection.blueprintRevision}</h3><pre className="text-preview">{blueprintText(selection.current)}</pre></div><div><h3>选中历史 · 版本 {selection.version.revision}</h3><pre className="text-preview">{blueprintText(selection.version.data)}</pre></div></div>
      {deleting ? <><Button variant="destructive" disabled={locked} onClick={() => void act(async () => update(await deleteBlueprintHistory(id, selection.historyRevision, selection.index, selection.version)))}>确认删除此历史版本</Button><Button variant="outline" disabled={locked} onClick={() => setDeleting(false)}>取消删除</Button></> : <><Button disabled={locked || !!editor.activeId} onClick={() => void act(load)}>对照后载入为新草稿</Button>{editor.activeId && <p>请先提交或暂存本页草稿，再载入历史；仍可清理不再需要的历史。</p>}<Button variant="outline" disabled={locked} onClick={() => setDeleting(true)}>删除此历史版本</Button></>}
    </>}{error != null && <ErrorMessage error={error} />}</DialogContent></Dialog>
  </section>;
}
