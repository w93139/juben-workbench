"use client";
import { useEffect, useState } from "react";
import type { Project } from "@/domain/models";
import type { BlueprintData } from "@/domain/blueprint";
import { useService } from "../providers";
import { useResearchAction, useResearchDraft } from "../research/common";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Input } from "../ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

function describe(data: BlueprintData) {
  return `故事大纲
${data.premise}

核心真相
${data.truth}

角色目标与选择
${data.characters.map(c => `${c.name}：${c.goal}
选择：${c.choice}`).join("\n\n")}

每轮节奏
${data.rounds.map(r => `${r.name} · ${r.minutes}分钟：${r.activity}`).join("\n\n")}`;
}

export function WholeStory({ project, data, disabled, onDirtyChange }: { project: Project; data: BlueprintData; disabled: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const service = useService();
  const action = useResearchAction(project);
  const { draft, change, saved } = useResearchDraft(data);
  const [preview, setPreview] = useState(false);
  const [topic, setTopic] = useState("story");
  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const busy = disabled || project.readOnly || action.isPending;
  function edit(next: BlueprintData) { action.touch(); change(next); }
  const changed = [draft.premise !== data.premise ? "整体大纲" : "", draft.truth !== data.truth ? "核心真相" : "", JSON.stringify(draft.characters) !== JSON.stringify(data.characters) ? "角色目标与选择" : "", JSON.stringify(draft.rounds) !== JSON.stringify(data.rounds) ? "轮次节奏" : ""].filter(Boolean);
  return <section className="panel" aria-label="整体故事调整"><div className="panel-title"><h2>围绕整体修改故事</h2><span>先看影响，再保存</span></div><p className="field-hint">角色、线索和节奏相互关联。默认只调整大纲、角色动机和每轮节奏；不会自动拆散关联或重新生成全文。更细的资料放在下方“详细结构编辑”。</p>
    <div className="view-switcher mt-4" aria-label="整体调整分类">{[["story", "大纲与真相"], ["characters", "角色目标与选择"], ["rounds", "每轮节奏"]].map(([id, name]) => <button key={id} type="button" aria-pressed={topic === id} onClick={() => setTopic(id)}>{name}</button>)}</div>
    {topic === "story" && <><label className="field-label" htmlFor="whole-premise">整体故事大纲</label><Textarea id="whole-premise" rows={6} maxLength={12000} disabled={busy} value={draft.premise} onChange={(e) => edit({ ...draft, premise: e.target.value })} /><label className="field-label mt-4" htmlFor="whole-truth">整体核心真相</label><Textarea id="whole-truth" rows={4} maxLength={12000} disabled={busy} value={draft.truth} onChange={(e) => edit({ ...draft, truth: e.target.value })} /></>}
    {topic === "characters" && <div className="record-list">{draft.characters.length ? draft.characters.map((character, index) => <article className="record-card" key={character.id}><h3>{character.name} · {character.publicIdentity}</h3><label className="field-label mt-3">{character.name}的目标<Textarea aria-label={`${character.name}的目标`} maxLength={12000} disabled={busy} value={character.goal} onChange={(e) => edit({ ...draft, characters: draft.characters.map((item, i) => i === index ? { ...item, goal: e.target.value } : item) })} /></label><label className="field-label mt-3">{character.name}的关键选择<Textarea aria-label={`${character.name}的关键选择`} maxLength={12000} disabled={busy} value={character.choice} onChange={(e) => edit({ ...draft, characters: draft.characters.map((item, i) => i === index ? { ...item, choice: e.target.value } : item) })} /></label><p className="field-hint">关联 {data.relationships.filter((r) => r.fromId === character.id || r.toId === character.id).length} 条关系，{data.knowledge.filter((k) => k.characterId === character.id).length} 条私人信息，需要一并复核。</p></article>) : <p className="field-hint">角色尚未建立，可返回第二步确定方案，或按需展开详细结构编辑。</p>}</div>}
    {topic === "rounds" && <div className="record-list">{draft.rounds.map((round, index) => <article className="record-card" key={round.id}><h3>{round.name}</h3><label className="field-label mt-3">{round.name}计划分钟<Input aria-label={`${round.name}计划分钟`} type="number" min={1} max={1440} disabled={busy} value={round.minutes} onChange={(e) => edit({ ...draft, rounds: draft.rounds.map((item, i) => i === index ? { ...item, minutes: Number(e.target.value) } : item) })} /></label><label className="field-label mt-3">{round.name}玩家行动<Textarea aria-label={`${round.name}玩家行动`} maxLength={12000} disabled={busy} value={round.activity} onChange={(e) => edit({ ...draft, rounds: draft.rounds.map((item, i) => i === index ? { ...item, activity: e.target.value } : item) })} /></label></article>)}<p className="field-hint">总计划 {draft.rounds.reduce((sum, round) => sum + round.minutes, 0)} 分钟；改变时长不会自动压缩玩家阅读材料或提前发放线索。</p></div>}
    <Button className="mt-4" disabled={busy || !dirty} onClick={() => setPreview(true)}>预览整体调整</Button>{dirty && <p className="field-hint mt-2">有待保存调整。预览后选择保存，离开页面前请完成保存。</p>}{disabled && <p className="field-hint">下方详细编辑有未保存修改，请先保存，再进行整体调整。</p>}{action.feedback}
    <Dialog open={preview} onOpenChange={setPreview}><DialogContent className="sm:max-w-3xl"><DialogTitle>修改前后与关联影响</DialogTitle><DialogDescription>这里只列出需要复核的范围，不代表AI已经检查语义或自动修好关联。</DialogDescription><p>本次修改：{changed.join("、")}。</p><div className="stage-callout">需复核 {data.characters.length} 位角色、{data.relationships.length} 条关系、{data.knowledge.length} 条信息和 {data.clues.length} 条线索。核心真相改变时核对整个因果链；节奏改变时核对阅读量和主持触发时机。已有正文与审查仍对应旧版本，不能直接沿用结论。</div><div className="comparison-grid"><div><h3>修改前</h3><pre className="text-preview">{describe(data)}</pre></div><div><h3>修改后</h3><pre className="text-preview">{describe(draft)}</pre></div></div><p className="field-hint">编号与已有关系保持，历史蓝图版本保留。保存后建立新版本，再到第四步重新核对。</p><Button disabled={busy || !dirty} onClick={() => action.mutate((revision) => service.saveBlueprint(project.id, revision, draft), { onSuccess: () => { saved(); setPreview(false); } })}>确认保存整体调整</Button>{action.feedback}</DialogContent></Dialog>
  </section>;
}
