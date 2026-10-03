"use client";

import { useState } from "react";
import type { WorkbenchState } from "@/domain/workbench";
import { changeWorkbench } from "@/services/workbench-store";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Input } from "../ui/input";
import { ErrorMessage } from "../shared";

type Direction = { id: string; title: string; summary: string; outline: string; risk: string };

/** 作者修订大纲与方向：保存后写入独立版本，并使蓝图依据失效（需重新选方向再生成）。 */
export function StudioAnalysisEdits({ id, state, disabled, update }: { id: string; state: WorkbenchState; disabled: boolean; update: (state: WorkbenchState) => void }) {
  const sourceOutline = state.authorOutline ?? state.analysis?.outline ?? "";
  const sourceDirections: Direction[] = state.authorDirections ?? state.analysis?.directions ?? [];
  const [outline, setOutline] = useState(sourceOutline);
  const [directions, setDirections] = useState<Direction[]>(sourceDirections);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [lastRevision, setLastRevision] = useState(state.revision);
  // React 推荐的“属性变化时调整 state”写法：在渲染中重置，而不是在 effect 中 setState。
  if (lastRevision !== state.revision) { setLastRevision(state.revision); setOutline(state.authorOutline ?? state.analysis?.outline ?? ""); setDirections(state.authorDirections ?? state.analysis?.directions ?? []); }
  const dirty = outline !== sourceOutline || JSON.stringify(directions) !== JSON.stringify(sourceDirections);
  async function save() {
    if (disabled || busy) return;
    setBusy(true); setError(null);
    try {
      const next = await changeWorkbench(id, state.revision, (current) => {
        if (current.job) throw new Error("任务正在运行，作者修订尚未保存，请稍后重试。");
        current.authorOutline = outline;
        current.authorDirections = directions;
        current.analysisVersions = [...current.analysisVersions, { revision: current.revision, outline, directions, savedAt: Date.now() }].slice(-20);
        // 大纲/方向变化后，既有蓝图不再对应当前设计依据，必须重新选择方向并生成新版。
        current.choiceId = null;
        current.blueprintSourceRevision = null;
      });
      update(next);
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  function editDirection(index: number, patch: Partial<Direction>) { setDirections((current) => current.map((direction, i) => i === index ? { ...direction, ...patch } : direction)); }
  return <details className="archive-details"><summary>作者修订大纲与方向（保存后需重新选择方向并生成新版蓝图）</summary>
    <Textarea aria-label="作者修订大纲" className="mt-3" maxLength={30000} value={outline} disabled={disabled || busy} onChange={(event) => setOutline(event.target.value)} />
    {directions.map((direction, index) => <section className="mt-4 grid gap-2" key={direction.id}>
      <p className="field-hint">方向 {index + 1} · {direction.id}</p>
      <Input aria-label={`方向${index + 1}标题`} maxLength={200} value={direction.title} disabled={disabled || busy} onChange={(event) => editDirection(index, { title: event.target.value })} />
      <Textarea aria-label={`方向${index + 1}概要`} maxLength={5000} value={direction.summary} disabled={disabled || busy} onChange={(event) => editDirection(index, { summary: event.target.value })} />
      <Textarea aria-label={`方向${index + 1}结构`} maxLength={15000} value={direction.outline} disabled={disabled || busy} onChange={(event) => editDirection(index, { outline: event.target.value })} />
      <Input aria-label={`方向${index + 1}风险`} maxLength={5000} value={direction.risk} disabled={disabled || busy} onChange={(event) => editDirection(index, { risk: event.target.value })} />
    </section>)}
    <p className="field-hint mt-3">{busy ? "正在保存作者修订…" : dirty ? "有未保存的作者修订。" : `已保存 ${state.analysisVersions.length} 个修订版本。`}</p>
    {error != null && <><ErrorMessage error={error} /><p className="field-hint">当前输入已保留。</p></>}
    <Button variant="outline" className="mt-3" disabled={disabled || busy || !dirty} onClick={() => void save()}>保存作者修订</Button>
  </details>;
}
