"use client";
import { useEffect, useRef, useState } from "react";
import type { WorkbenchState } from "@/domain/workbench";
import { changeWorkbench } from "@/services/workbench-store";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { ErrorMessage } from "../shared";

export function StudioInstructions({ id, state, disabled, update, onPending }: { id: string; state: WorkbenchState; disabled: boolean; update: (state: WorkbenchState) => void; onPending: (value: boolean) => void }) {
  const [draft, setDraft] = useState<{ value: string; revision: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  useEffect(() => { onPending(draft !== null || busy); return () => onPending(false); }, [draft, busy, onPending]);
  async function save() {
    if (!draft || disabled || saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try {
      const next = await changeWorkbench(id, draft.revision, current => {
        if (current.job) throw new Error("任务正在运行，创作要求尚未保存，请稍后重试。");
        current.instructions = draft.value; current.choiceId = null; current.blueprintSourceRevision = null;
      });
      update(next); setDraft(null);
    } catch (failure) { setError(failure); }
    finally { saving.current = false; setBusy(false); }
  }
  return <details className="archive-details"><summary>补充你的创作要求</summary>
    <Textarea aria-label="补充创作要求" className="mt-3" maxLength={10000} value={draft?.value ?? state.instructions} disabled={disabled || busy}
      onChange={event => { const value = event.target.value; setError(null); setDraft(previous => value === state.instructions ? null : { value, revision: previous?.revision ?? state.revision }); }} onBlur={() => void save()} />
    <p className="field-hint">{busy ? "正在保存创作要求…" : draft ? "当前要求尚未保存，离开输入框时保存。" : "保存后重新选择方向，再生成蓝图。"}</p>
    {error != null && <><ErrorMessage error={error} /><p className="field-hint">当前输入已保留。其他页面有更新时，请先核对最新要求。</p>
      <p className="whitespace-pre-wrap">最新已保存要求：{state.instructions || "（空）"}</p>
      <Button variant="outline" disabled={disabled || busy} onClick={() => void save()}>重试保存要求</Button>
      <Button variant="outline" disabled={disabled || busy} onClick={() => { setDraft(null); setError(null); }}>使用最新已保存要求</Button></>}
  </details>;
}
