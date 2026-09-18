"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { BlueprintData } from "@/domain/blueprint";
import { affectedReferences, blueprintFields, blueprintRowLabel, knowledgeStates, newBlueprintRow, removeBlueprintRow, sectionLabels, sectionLimits, type BlueprintRow, type EditableBlueprintSection, type EditorField } from "@/domain/blueprint-editing";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { ErrorMessage } from "../shared";

export type BlueprintFocus = { section: EditableBlueprintSection; id?: string; token: number };
export function BlueprintFields({ data, change, disabled, focus, select, activeId }: { data: BlueprintData; change: (data: BlueprintData) => string | undefined; disabled: boolean; focus: BlueprintFocus; select: (id: string) => void; activeId: string | null }) {
  const section = focus.section, label = sectionLabels[section], rows = data[section] as BlueprintRow[];
  const row = rows.find(item => item.id === focus.id) ?? rows[0];
  const [search, setSearch] = useState(""), [page, setPage] = useState(() => Math.floor(Math.max(0, rows.findIndex(item => item.id === focus.id)) / 30));
  const [removing, setRemoving] = useState<BlueprintRow | null>(null), [removed, setRemoved] = useState<{ row: BlueprintRow; index: number; sessionId: string } | null>(null);
  const [removeError, setRemoveError] = useState<unknown>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focus.token) { heading.current?.focus(); heading.current?.scrollIntoView({ block: "nearest" }); } }, [focus.token]);
  const matches = rows.filter(item => `${blueprintRowLabel(item, section, data)} ${item.id}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(matches.length / 30)), currentPage = Math.min(page, pageCount - 1), shown = matches.slice(currentPage * 30, (currentPage + 1) * 30);
  const affected = removing ? affectedReferences(data, section, removing.id) : [];
  function replace(next: BlueprintRow[]) { change({ ...data, [section]: next }); }
  function edit(key: string, value: BlueprintRow[string]) { if (!disabled && row) replace(rows.map(item => item.id === row.id ? { ...item, [key]: value } : item)); }
  return <section className="panel blueprint-section" aria-label={`${label}编辑`}>
    <div className="panel-title"><h2>{label}</h2><span>{rows.length}/{sectionLimits[section]} 条</span></div>
    <div className="flex flex-wrap items-end gap-3 mb-4"><label className="field-label flex-1">搜索{label}记录<Input aria-label={`搜索${label}记录`} value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label><Button variant="outline" disabled={disabled || rows.length >= sectionLimits[section]} onClick={() => { const item = newBlueprintRow(section, `${section}-${crypto.randomUUID()}`); replace([...rows, item]); setSearch(""); setPage(Math.floor(rows.length / 30)); select(item.id); }}>添加{label}</Button></div>
    <div className="blueprint-record-picker" aria-label={`${label}记录列表`}>{shown.map(item => <button type="button" key={item.id} aria-pressed={row?.id === item.id} aria-label={`编辑${label}：${blueprintRowLabel(item, section, data)}（${item.id}）`} onClick={() => select(item.id)}><strong>{blueprintRowLabel(item, section, data)}</strong><small>{item.id}</small></button>)}</div>
    {!matches.length && <p className="field-hint">{rows.length ? "没有找到匹配记录，当前编辑内容仍保留。" : `从“添加${label}”开始，未填写完整也能保存草稿。`}</p>}
    {pageCount > 1 && <div className="flex flex-wrap items-center gap-3 my-3"><Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页记录</Button><span>{currentPage + 1}/{pageCount} 页 · {matches.length} 条</span><Button variant="outline" size="sm" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>下一页记录</Button></div>}
    <h3 ref={heading} tabIndex={-1} className="font-medium mt-5 mb-2">{row ? `编辑${label}：${blueprintRowLabel(row, section, data)}` : `尚无${label}`}</h3>
    {row && <><p className="source-path mb-4">记录编号：{row.id}</p><fieldset disabled={disabled} className="blueprint-field-grid"><legend className="sr-only">{label}完整字段</legend>{blueprintFields[section].map(field => <EditorInput key={`${row.id}:${field.key}`} field={field} value={row[field.key]} data={data} update={value => edit(field.key, value)} />)}</fieldset><Button className="mt-4" variant="outline" disabled={disabled} onClick={() => { setRemoveError(null); setRemoving(structuredClone(row)); }}>移除当前{label}</Button></>}
    {removed && removed.sessionId === activeId && <p className="field-hint mt-3">已从本页草稿移除一条{label}。可在切换章节、定位问题、结束本页草稿或刷新前撤销。<Button variant="link" disabled={disabled || rows.length >= sectionLimits[section] || rows.some(item => item.id === removed.row.id)} onClick={() => { const next = [...rows]; next.splice(Math.min(removed.index, rows.length), 0, removed.row); replace(next); select(removed.row.id); setRemoved(null); }}>撤销移除</Button></p>}
    <Dialog open={!!removing} onOpenChange={open => { if (!disabled && !open) setRemoving(null); }}><DialogContent><DialogTitle>移除当前{label}？</DialogTitle><DialogDescription>只移除选中记录，关联编号保留并提示修复；正式蓝图和历史不变。私人线索不会自动改成公共线索。</DialogDescription>{removing && <><p>{blueprintRowLabel(removing, section, data)} · {removing.id}</p><p>受影响的关联记录：{affected.length} 条</p><ul className="max-h-48 overflow-auto list-disc pl-5">{affected.map((text, i) => <li key={i}>{text}</li>)}</ul><Button variant="destructive" disabled={disabled} onClick={() => { const current = rows.find(item => item.id === removing.id); if (JSON.stringify(current) !== JSON.stringify(removing)) { setRemoveError(new Error("选中记录已变化，请关闭窗口重新查看后再移除。")); return; } if (current) { const sessionId = change(removeBlueprintRow(data, section, current.id)); if (sessionId) setRemoved({ row: structuredClone(current), index: rows.findIndex(item => item.id === current.id), sessionId }); } setRemoving(null); }}>确认移除</Button></>}{removeError != null && <ErrorMessage error={removeError} />}</DialogContent></Dialog>
  </section>;
}

function EditorInput({ field, value, data, update }: { field: EditorField; value: BlueprintRow[string]; data: BlueprintData; update: (value: BlueprintRow[string]) => void }) {
  const id = useId(), [search, setSearch] = useState("");
  const options = field.target ? (data[field.target] as BlueprintRow[]).map(row => ({ id: row.id, label: `${blueprintRowLabel(row, field.target!, data)}（${row.id}）` })) : [];
  const ids = Array.isArray(value) ? value : [], missing = ids.filter(key => !options.some(option => option.id === key));
  const all = [...options, ...missing.map(key => ({ id: key, label: `已失效：${key}` }))];
  const shown = all.filter(option => option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className="blueprint-field">
    {field.type === "references" ? <fieldset className="blueprint-options"><legend className="field-label">{field.label}</legend>{all.length > 30 && <Input aria-label={`搜索${field.label}`} placeholder="搜索名称或编号" value={search} onChange={e => setSearch(e.target.value)} />}
      <div className="max-h-56 overflow-auto space-y-2">{shown.map(option => <label className="flex gap-2 items-start" key={option.id}><input type="checkbox" checked={ids.includes(option.id)} disabled={!ids.includes(option.id) && ids.length >= 200} onChange={e => update(e.target.checked ? [...ids, option.id] : ids.filter(key => key !== option.id))} />{option.label}</label>)}</div>{!all.length && <p className="field-hint">请先添加{field.target ? sectionLabels[field.target] : "关联内容"}。</p>}{ids.length >= 200 && <p className="field-hint">最多关联200条，请先取消不需要的关联。</p>}
    </fieldset> : <><label className="field-label" htmlFor={id}>{field.label}</label>{field.type === "boolean" ? <input id={id} type="checkbox" checked={!!value} onChange={e => update(e.target.checked)} /> : field.type === "reference" ? <select id={id} className="plain-select w-full" value={String(value)} onChange={e => update(e.target.value)}><option value="">待确定</option>{!!value && !options.some(option => option.id === value) && <option value={String(value)}>已失效：{String(value)}</option>}{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> : field.type === "state" ? <select id={id} className="plain-select w-full" value={String(value)} onChange={e => update(e.target.value)}>{Object.entries(knowledgeStates).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : field.type === "number" ? <Input id={id} type="number" min={0} max={field.key === "minutes" ? 1440 : 100000} step={1} value={Number(value)} onChange={e => { const n = Number(e.target.value); update(Number.isFinite(n) ? Math.min(field.key === "minutes" ? 1440 : 100000, Math.max(0, Math.trunc(n))) : 0); }} /> : field.type === "text" ? <Input id={id} value={String(value)} maxLength={12000} onChange={e => update(e.target.value)} /> : <Textarea id={id} rows={3} value={String(value)} maxLength={12000} onChange={e => update(e.target.value)} />}</>}
    {field.type === "number" && <p className="field-hint">仅保存0至{field.key === "minutes" ? 1440 : 100000}的整数，超出范围会限制为边界值，小数取整数部分。{field.key === "minutes" ? "正式生成前需填写正数时长。" : ""}</p>}
    {field.hint && <p className="field-hint">{field.hint}</p>}
  </div>;
}
