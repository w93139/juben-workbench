"use client";

import { useId, useState } from "react";
import type { BlueprintData } from "@/domain/blueprint";
import { blueprintFields, blueprintRowLabel, knowledgeStates, newBlueprintRow, sectionLabels, type BlueprintSection, type BlueprintRow, type EditorField } from "@/domain/blueprint-editor";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";

type Focus = { section: string; id?: string; ids?: Record<string, string | undefined> };
export function ArrayEditor({ section, data, change, disabled, focus, setFocus }: { section: BlueprintSection; data: BlueprintData; change: (data: BlueprintData) => void; disabled: boolean; focus: Focus; setFocus: (focus: Focus) => void }) {
  const rows = data[section] as BlueprintRow[];
  const selectedId = focus.ids?.[section] ?? (focus.section === section ? focus.id : undefined);
  const row = rows.find((item) => item.id === selectedId) ?? rows[0];
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState<BlueprintRow | null>(null);
  const label = sectionLabels[section];
  function replace(next: BlueprintRow[]) { change({ ...data, [section]: next }); }
  function update(key: string, value: BlueprintRow[string]) { replace(rows.map((item) => item.id === row.id ? { ...item, [key]: value } : item)); }
  return <section className="panel blueprint-section" id={`blueprint-${section}`} aria-label={`${label}编辑`}>
    <div className="panel-title"><h2>{label}</h2><span>{rows.length} 条 · 原创方案</span></div>
    <div className="flex flex-wrap items-center gap-3 mb-5"><label className="field-label grow">选择{label}<select className="plain-select w-full" aria-label={`选择${label}`} value={row?.id ?? ""} onChange={(event) => setFocus({ section, id: event.target.value })}>{!rows.length && <option value="">还没有{label}</option>}{rows.map((item, i) => <option key={item.id} value={item.id}>{i + 1}. {blueprintRowLabel(item, section, data)}</option>)}</select></label>{!disabled && <Button variant="outline" onClick={() => { const item = newBlueprintRow(section, `${section}-${crypto.randomUUID().slice(0, 8)}`); replace([...rows, item]); setFocus({ section, id: item.id }); }}>添加{label}</Button>}</div>
    {row ? <><h3 className="font-medium mb-2">{blueprintRowLabel(row, section, data)}</h3><p className="source-path mb-5">记录编号：{row.id}</p><fieldset disabled={disabled} className="blueprint-field-grid">{blueprintFields[section].map((field) => <EditorInput key={field.key} field={field} value={row[field.key]} data={data} update={(value) => update(field.key, value)} />)}</fieldset>{!disabled && <Button className="mt-5" variant="outline" onClick={() => setRemoving(true)}>移除当前{label}</Button>}</> : <p className="field-hint">从“添加{label}”开始，未填完整也能保存草稿。</p>}
    {removed && !disabled && <p className="field-hint mt-3">已从草稿移除。<Button variant="link" onClick={() => { replace([...rows, removed]); setFocus({ section, id: removed.id }); setRemoved(null); }}>撤销移除</Button></p>}
    <Dialog open={removing} onOpenChange={setRemoving}><DialogContent><DialogTitle>移除当前{label}？</DialogTitle><DialogDescription>只从当前草稿移除。关联内容会保留，并在检查中提示缺失；历史版本不变。保存前可以撤销。</DialogDescription><Button variant="destructive" onClick={() => { if (!disabled && row) { setRemoved(row); replace(rows.filter((item) => item.id !== row.id)); } setRemoving(false); }}>确认移除</Button></DialogContent></Dialog>
  </section>;
}

function EditorInput({ field, value, data, update }: { field: EditorField; value: BlueprintRow[string]; data: BlueprintData; update: (value: BlueprintRow[string]) => void }) {
  const controlId = useId();
  const options = field.target ? (data[field.target] as BlueprintRow[]).map((row) => ({ id: row.id, label: blueprintRowLabel(row, field.target!, data) })) : [];
  const ids = Array.isArray(value) ? value : [];
  const missing = ids.filter((id) => !options.some((option) => option.id === id));
  return <div className="blueprint-field"><label className="field-label" htmlFor={field.type === "references" ? undefined : controlId}>{field.type === "boolean" ? <><input id={controlId} type="checkbox" checked={!!value} onChange={(event) => update(event.target.checked)} /> {field.label}</> : <>{field.label}</>}</label>{field.type !== "boolean" && <>{field.type === "reference" ? <select id={controlId} className="plain-select w-full" value={String(value)} onChange={(event) => update(event.target.value)}><option value="">待确定</option>{value && !options.some((option) => option.id === value) && <option value={String(value)}>已缺失的关联：{String(value)}</option>}{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select> : field.type === "state" ? <select id={controlId} className="plain-select w-full" value={String(value)} onChange={(event) => update(event.target.value)}>{Object.entries(knowledgeStates).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : field.type === "references" ? null : field.type === "number" ? <Input id={controlId} type="number" min={0} max={field.key === "minutes" ? 1440 : 100000} value={Number(value)} onChange={(event) => update(Number(event.target.value))} /> : field.type === "text" ? <Input id={controlId} value={String(value)} maxLength={500} onChange={(event) => update(event.target.value)} /> : <Textarea id={controlId} rows={3} value={String(value)} maxLength={6000} onChange={(event) => update(event.target.value)} />}</>}
    {field.type === "references" && <fieldset className="blueprint-options"><legend className="sr-only">{field.label}</legend>{[...options, ...missing.map((id) => ({ id, label: `已缺失的关联：${id}` }))].map((option) => <label key={option.id}><input type="checkbox" checked={ids.includes(option.id)} onChange={(event) => update(event.target.checked ? [...ids, option.id] : ids.filter((id) => id !== option.id))} />{option.label}</label>)}{!options.length && !missing.length && <p className="field-hint">请先添加{field.target ? sectionLabels[field.target] : "关联内容"}。</p>}</fieldset>}
    {field.hint && <p className="field-hint">{field.hint}</p>}
  </div>;
}

export function RelationshipMap({ data }: { data: BlueprintData }) {
  const nodes = data.characters.map((character, index) => ({ ...character, x: 270 + 205 * Math.cos(index * 2 * Math.PI / Math.max(data.characters.length, 1) - Math.PI / 2), y: 215 + 158 * Math.sin(index * 2 * Math.PI / Math.max(data.characters.length, 1) - Math.PI / 2) }));
  return <details className="archive-details"><summary>查看人物关系图</summary><svg role="img" aria-label="人物关系图，详细关系可在下方编辑" viewBox="0 0 540 430" className="relationship-map"><title>人物之间已建立的关系</title>{data.relationships.map((relation) => { const from = nodes.find((node) => node.id === relation.fromId); const to = nodes.find((node) => node.id === relation.toId); return from && to ? <line key={relation.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#a0ada0" /> : null; })}{nodes.map((node) => <g key={node.id}><rect x={node.x - 47} y={node.y - 17} width={94} height={34} rx={8} fill="#f4f4ed" stroke="#849580" /><text x={node.x} y={node.y + 5} textAnchor="middle" fontSize={13} fill="#30483e">{node.name.slice(0, 6) || "待命名"}</text></g>)}</svg><p className="field-hint px-4 pb-4">连线表示已有关系；角色改名会同步更新。缺失关联在结构检查中处理。</p></details>;
}
