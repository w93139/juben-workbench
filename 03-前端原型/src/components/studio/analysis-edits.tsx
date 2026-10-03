"use client";

import { useEffect, useState } from "react";
import { analysisCurrent, type WorkbenchState } from "@/domain/workbench";
import { changeWorkbench } from "@/services/workbench-store";
import { authorEditsCurrent } from "@/services/studio-client";
import { analysisDraftBasis, persistAnalysisDraft, readAnalysisDraft, type AnalysisDraft, type Direction } from "./analysis-draft";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Input } from "../ui/input";
import { ErrorMessage } from "../shared";

export function StudioAnalysisEdits({ id, state, disabled, update, onPending }: { id: string; state: WorkbenchState; disabled: boolean; update: (state: WorkbenchState) => void; onPending: (value: boolean) => void }) {
  const current = authorEditsCurrent(state);
  const baseOutline = (current ? state.authorOutline : null) ?? state.analysis?.outline ?? "";
  const baseDirections = (current ? state.authorDirections : null) ?? state.analysis?.directions ?? [];
  const basis = analysisDraftBasis(state);
  const [initial] = useState(() => readAnalysisDraft(id));
  const [draft, setDraft] = useState<AnalysisDraft | null>(initial.draft);
  const [storageError, setStorageError] = useState<unknown>(initial.error);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const outline = draft?.outline ?? baseOutline;
  const directions = draft?.directions ?? baseDirections;
  const conflict = !!draft && draft.basis !== basis;
  useEffect(() => { onPending(!!draft || busy || !!storageError); return () => onPending(false); }, [draft, busy, storageError, onPending]);
  useEffect(() => {
    if (!storageError || !draft) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [draft, storageError]);
  function persist(value: AnalysisDraft | null) {
    setDraft(value);
    try { persistAnalysisDraft(id, value); setStorageError(null); }
    catch (failure) { setStorageError(failure); }
  }
  function updateDraft(nextOutline: string, nextDirections: Direction[]) {
    persist({ outline: nextOutline, directions: nextDirections, basis: draft ? draft.basis : basis });
  }
  function editDirection(index: number, patch: Partial<Direction>) { updateDraft(outline, directions.map((direction, i) => i === index ? { ...direction, ...patch } : direction)); }
  async function save() {
    if (!draft || disabled || busy || conflict || !analysisCurrent(state)) return;
    setBusy(true); setError(null);
    try {
      const next = await changeWorkbench(id, state.revision, (saved) => {
        if (saved.job) throw new Error("任务正在运行，作者修订尚未保存，请稍后重试。");
        if (analysisDraftBasis(saved) !== draft.basis) throw new Error("分析或作者修订已更新，请核对最新内容后显式采用草稿。");
        saved.authorOutline = draft.outline; saved.authorDirections = draft.directions;
        saved.authorRevision = saved.sourceRevision; saved.authorAnalysisRevision = saved.analysisRevision;
        saved.analysisVersions = [...saved.analysisVersions, { revision: saved.revision, outline: draft.outline, directions: draft.directions, savedAt: Date.now() }].slice(-20);
        saved.choiceId = null; saved.blueprintSourceRevision = null;
      });
      update(next); persist(null);
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  const staleAuthorEdits = !current && (state.authorOutline != null || state.authorDirections != null);
  return <details className="archive-details"><summary>作者修订大纲与方向（保存后需重新选择方向并生成新版蓝图）</summary>
    {staleAuthorEdits && <details className="mt-3"><summary>查看旧依据的作者修订（未自动采用）</summary><p className="whitespace-pre-wrap">{state.authorOutline}</p>{state.authorDirections?.map(direction => <p key={direction.id}>{direction.title}：{direction.summary}；{direction.outline}；{direction.risk}</p>)}<Button variant="outline" disabled={disabled || busy || !!draft || !analysisCurrent(state)} onClick={() => persist({ outline: state.authorOutline ?? baseOutline, directions: state.authorDirections ?? baseDirections, basis })}>将旧作者修订载入当前草稿</Button></details>}
    {conflict && <div role="alert" className="mt-3"><p>草稿依据已变化或来自旧版本。输入已保留，请与当前分析及最新作者修订核对后再采用。</p><p className="whitespace-pre-wrap">当前已保存大纲：{baseOutline}</p>{baseDirections.map(direction => <p key={direction.id}>当前方向：{direction.title} · {direction.summary} · {direction.outline} · {direction.risk}</p>)}<Button variant="outline" disabled={disabled || busy || !analysisCurrent(state)} onClick={() => persist({ outline, directions, basis })}>按当前分析采用本页草稿</Button></div>}
    <Textarea aria-label="作者修订大纲" className="mt-3" maxLength={30000} value={outline} disabled={disabled || busy} onChange={(event) => updateDraft(event.target.value, directions)} />
    {directions.map((direction, index) => <section className="mt-4 grid gap-2" key={direction.id}>
      <p className="field-hint">方向 {index + 1} · {direction.id}</p>
      <Input aria-label={`方向${index + 1}标题`} maxLength={200} value={direction.title} disabled={disabled || busy} onChange={(event) => editDirection(index, { title: event.target.value })} />
      <Textarea aria-label={`方向${index + 1}概要`} maxLength={5000} value={direction.summary} disabled={disabled || busy} onChange={(event) => editDirection(index, { summary: event.target.value })} />
      <Textarea aria-label={`方向${index + 1}结构`} maxLength={15000} value={direction.outline} disabled={disabled || busy} onChange={(event) => editDirection(index, { outline: event.target.value })} />
      <Input aria-label={`方向${index + 1}风险`} maxLength={5000} value={direction.risk} disabled={disabled || busy} onChange={(event) => editDirection(index, { risk: event.target.value })} />
    </section>)}
    <p className="field-hint mt-3">{busy ? "正在保存作者修订…" : storageError ? (draft ? "本机暂存失败，输入仅保留在当前浏览器内存；请先重试暂存或保存作者修订，刷新/关闭可能丢失。" : "本机草稿读取或清理失败，请重试处理暂存记录。") : draft ? "有未保存的作者修订：已暂存于本标签页，刷新可恢复；关闭标签页前请保存，保存前不能选择方向或生成蓝图。" : `已保存 ${state.analysisVersions.length} 个修订版本。`}</p>
    {storageError != null && <><ErrorMessage error={storageError} /><Button variant="outline" onClick={() => persist(draft)}>重试暂存</Button></>}
    {error != null && <><ErrorMessage error={error} /><p className="field-hint">当前输入已保留。</p></>}
    <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={disabled || busy || !draft || conflict || !analysisCurrent(state)} onClick={() => void save()}>保存作者修订</Button><Button variant="ghost" disabled={disabled || busy || !draft} onClick={() => { persist(null); setError(null); }}>放弃本页修订</Button></div>
  </details>;
}
