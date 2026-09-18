"use client";
import { useEffect, useRef, useState } from "react";
import { checkBlueprint, type BlueprintIssue } from "@/domain/blueprint";
import type { WorkbenchState } from "@/domain/workbench";
import { useBlueprintDraft } from "../hooks/use-blueprint-draft";
import { StudioBlueprintDrafts, blueprintText } from "./blueprint-drafts";
import { Textarea } from "../ui/textarea";
import { sectionLabels, type EditableBlueprintSection } from "@/domain/blueprint-editing";
import { BlueprintFields, type BlueprintFocus } from "./blueprint-fields";
import { StudioBlueprintHistory } from "./blueprint-history";
import { Button } from "../ui/button";
import { ErrorMessage } from "../shared";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";

export function StudioBlueprint({ id, state, update, onDirty }: { id: string; state: WorkbenchState; update: (state: WorkbenchState) => void; onDirty: (value: boolean) => void }) {
  const editor = useBlueprintDraft(id, state);
  const { draft, change } = editor;
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [preview, setPreview] = useState(false);
  const dirty = !!editor.activeId;
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  const disabled = !!state.job || busy || editor.status.busy;
  const issues = checkBlueprint(draft);
  const [focus, setFocus] = useState<BlueprintFocus>({ section: "characters", token: 0 });
  const [search, setSearch] = useState("");
  const overview = useRef<HTMLTextAreaElement>(null);
  function locate(issue: BlueprintIssue) {
    if (issue.section === "overview") { overview.current?.focus(); overview.current?.scrollIntoView({ block: "center" }); }
    else setFocus(current => ({ section: issue.section as EditableBlueprintSection, id: issue.recordId, token: current.token + 1 }));
  }
  const matchedIssues = issues.filter(issue => `${issue.message} ${issue.recordId ?? ""}`.includes(search.trim()));
  async function save() { setBusy(true); setError(null); try { update(await editor.commit()); setPreview(false); } catch (failure) { setError(failure); } finally { setBusy(false); } }
  return <div className="main-stack">
    <StudioBlueprintDrafts id={id} state={state} editor={editor} disabled={disabled} onBusy={setBusy} />
    <StudioBlueprintHistory id={id} state={state} editor={editor} disabled={disabled} update={update} onBusy={setBusy} />
    <section className="panel" aria-label="蓝图关联检查"><div className="panel-title"><h2>字段与关联检查</h2><span>{issues.filter(i => i.severity === "error").length} 项待修正 · {issues.filter(i => i.severity === "warning").length} 项提示</span></div><p className="field-hint">待修正项需在生成前处理，提示不直接阻止生成；两者都不妨碍草稿保存。这里只检查字段与关联，语义和体验仍须交叉审查及真人试玩。</p>{!!issues.length && <details className="archive-details mt-3"><summary>查看并定位问题（{issues.length}项）</summary><div className="p-4"><label className="field-label">搜索检查问题<input className="plain-select w-full" aria-label="搜索检查问题" value={search} onChange={e => setSearch(e.target.value)} /></label><ul className="max-h-72 overflow-auto mt-3">{matchedIssues.map(issue => <li key={issue.id} className="mb-3"><button type="button" className="text-link text-left" onClick={() => locate(issue)}>{issue.severity === "error" ? "待修正" : "提示"} · {issue.section === "overview" ? "总览" : sectionLabels[issue.section]}{issue.recordId ? `（${issue.recordId}）` : ""}：{issue.message}</button></li>)}</ul></div></details>}</section>
    <section className="panel"><div className="panel-title"><h2>整体蓝图</h2><span>{dirty ? "尚未正式提交" : "正式蓝图已保存"}</span></div><label className="field-label">大纲<Textarea ref={overview} aria-label="大纲" value={draft.premise} rows={6} maxLength={12000} disabled={disabled} onChange={e => change({ ...draft, premise: e.target.value })} /></label><label className="field-label mt-5">真相<Textarea aria-label="真相" value={draft.truth} rows={5} maxLength={12000} disabled={disabled} onChange={e => change({ ...draft, truth: e.target.value })} /></label></section>
    <nav className="blueprint-section-nav" aria-label="蓝图章节">{(Object.keys(sectionLabels) as EditableBlueprintSection[]).map(section => <Button key={section} variant={focus.section === section ? "default" : "outline"} aria-pressed={focus.section === section} onClick={() => setFocus({ section, token: 0 })}>{sectionLabels[section]}（{draft[section].length}）</Button>)}</nav>
    <BlueprintFields key={`${focus.section}:${focus.token}`} data={draft} change={change} activeId={editor.activeId} disabled={disabled} focus={focus} select={recordId => setFocus(current => ({ ...current, id: recordId }))} />
    {dirty && <Button disabled={disabled} onClick={() => setPreview(true)}>预览并保存修改</Button>}{error != null && <ErrorMessage error={error} />}
    <Dialog open={preview} onOpenChange={open => { if (!disabled) setPreview(open); }}><DialogContent className="sm:max-w-3xl"><DialogTitle>确认整体调整</DialogTitle><DialogDescription>修改可能影响角色信息、线索和主持触发。保存后旧验证失效，需要重新交叉验证。</DialogDescription><div className="comparison-grid"><div><h3>修改前</h3><pre className="text-preview">{blueprintText(state.blueprint!)}</pre></div><div><h3>修改后</h3><pre className="text-preview">{blueprintText(draft)}</pre></div></div><p>字段与关联待核对：{checkBlueprint(draft).length} 项</p><Button disabled={disabled} onClick={() => void save()}>保存调整</Button>{error != null && <ErrorMessage error={error} />}</DialogContent></Dialog>
  </div>;
}
