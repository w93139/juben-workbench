"use client";

import { useEffect, useState } from "react";
import type { WorkbenchState } from "@/domain/workbench";
import { changeWorkbench } from "@/services/workbench-store";
import { authorEditsCurrent } from "@/services/studio-client";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Input } from "../ui/input";
import { ErrorMessage } from "../shared";

type Direction = { id: string; title: string; summary: string; outline: string; risk: string };
type Draft = { outline: string; directions: Direction[] };
const draftKey = (id: string) => `juben-workbench:analysis-draft:${id}`;

function readDraft(id: string): Draft | null {
  if (typeof window === "undefined") return null;
  try { const raw = window.localStorage.getItem(draftKey(id)); if (!raw) return null; const parsed = JSON.parse(raw) as Draft; if (typeof parsed?.outline !== "string" || !Array.isArray(parsed?.directions)) return null; return parsed; } catch { return null; }
}
function writeDraft(id: string, value: Draft) { if (typeof window === "undefined") return; try { window.localStorage.setItem(draftKey(id), JSON.stringify(value)); } catch { /* 本机草稿保存失败不阻塞编辑 */ } }
function clearDraft(id: string) { if (typeof window === "undefined") return; try { window.localStorage.removeItem(draftKey(id)); } catch { /* ignore */ } }

/**
 * 作者修订大纲与方向：草稿暂存在本机（跨步骤与刷新不丢），保存后写入独立版本并绑定当前分析依据；
 * 未保存时通过 onPending 阻止方向选择与付费蓝图流程，避免用旧内容发起调用。
 */
export function StudioAnalysisEdits({ id, state, disabled, update, onPending }: { id: string; state: WorkbenchState; disabled: boolean; update: (state: WorkbenchState) => void; onPending: (value: boolean) => void }) {
  const current = authorEditsCurrent(state);
  const baseOutline = (current ? state.authorOutline : null) ?? state.analysis?.outline ?? "";
  const baseDirections: Direction[] = (current ? state.authorDirections : null) ?? state.analysis?.directions ?? [];
  const [outline, setOutline] = useState(() => readDraft(id)?.outline ?? baseOutline);
  const [directions, setDirections] = useState<Direction[]>(() => readDraft(id)?.directions ?? baseDirections);
  const [lastKey, setLastKey] = useState(`${state.revision}:${state.analysisSourceRevision}:${current}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dirty = outline !== baseOutline || JSON.stringify(directions) !== JSON.stringify(baseDirections);
  useEffect(() => { onPending(dirty || busy); return () => onPending(false); }, [dirty, busy, onPending]);
  const key = `${state.revision}:${state.analysisSourceRevision}:${current}`;
  if (lastKey !== key) { setLastKey(key); setOutline(baseOutline); setDirections(baseDirections); clearDraft(id); }
  function update_(nextOutline: string, nextDirections: Direction[]) {
    setOutline(nextOutline); setDirections(nextDirections);
    if (nextOutline !== baseOutline || JSON.stringify(nextDirections) !== JSON.stringify(baseDirections)) writeDraft(id, { outline: nextOutline, directions: nextDirections }); else clearDraft(id);
  }
  function editDirection(index: number, patch: Partial<Direction>) { update_(outline, directions.map((direction, i) => i === index ? { ...direction, ...patch } : direction)); }
  async function save() {
    if (disabled || busy) return;
    setBusy(true); setError(null);
    try {
      const next = await changeWorkbench(id, state.revision, (draft) => {
        if (draft.job) throw new Error("任务正在运行，作者修订尚未保存，请稍后重试。");
        draft.authorOutline = outline;
        draft.authorDirections = directions;
        draft.authorRevision = draft.analysisSourceRevision;
        draft.analysisVersions = [...draft.analysisVersions, { revision: draft.revision, outline, directions, savedAt: Date.now() }].slice(-20);
        // 大纲/方向变化后，既有蓝图不再对应当前依据，必须重新选择方向并生成新版。
        draft.choiceId = null;
        draft.blueprintSourceRevision = null;
      });
      clearDraft(id); update(next);
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  function discard() { clearDraft(id); setError(null); setOutline(baseOutline); setDirections(baseDirections); }
  const staleAuthorEdits = state.authorRevision != null && !current;
  return <details className="archive-details"><summary>作者修订大纲与方向（保存后需重新选择方向并生成新版蓝图）</summary>
    {staleAuthorEdits && <p className="field-hint mt-3" role="status">已保存的作者修订基于旧的分析依据（修订 {state.authorRevision}），当前不作为依据；重新编辑并保存即可采用。旧修订仍保留在历史中。</p>}
    <Textarea aria-label="作者修订大纲" className="mt-3" maxLength={30000} value={outline} disabled={disabled || busy} onChange={(event) => update_(event.target.value, directions)} />
    {directions.map((direction, index) => <section className="mt-4 grid gap-2" key={direction.id}>
      <p className="field-hint">方向 {index + 1} · {direction.id}</p>
      <Input aria-label={`方向${index + 1}标题`} maxLength={200} value={direction.title} disabled={disabled || busy} onChange={(event) => editDirection(index, { title: event.target.value })} />
      <Textarea aria-label={`方向${index + 1}概要`} maxLength={5000} value={direction.summary} disabled={disabled || busy} onChange={(event) => editDirection(index, { summary: event.target.value })} />
      <Textarea aria-label={`方向${index + 1}结构`} maxLength={15000} value={direction.outline} disabled={disabled || busy} onChange={(event) => editDirection(index, { outline: event.target.value })} />
      <Input aria-label={`方向${index + 1}风险`} maxLength={5000} value={direction.risk} disabled={disabled || busy} onChange={(event) => editDirection(index, { risk: event.target.value })} />
    </section>)}
    <p className="field-hint mt-3">{busy ? "正在保存作者修订…" : dirty ? "有未保存的作者修订：已暂存在本机，保存前不能选择方向或生成蓝图。" : `已保存 ${state.analysisVersions.length} 个修订版本。`}</p>
    {error != null && <><ErrorMessage error={error} /><p className="field-hint">当前输入已保留。</p></>}
    <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={disabled || busy || !dirty} onClick={() => void save()}>保存作者修订</Button><Button variant="ghost" disabled={disabled || busy || !dirty} onClick={discard}>放弃本页修订</Button></div>
  </details>;
}
