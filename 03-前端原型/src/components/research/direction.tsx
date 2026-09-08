"use client";

import type { Project } from "@/domain/models";
import { defaultDirection, type OriginalDirection, type ResearchCatalog } from "@/domain/research";
import { useService } from "../providers";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { NextResearchStep, useResearchAction, useResearchDraft } from "./common";

export function DirectionStage({ project, catalog }: { project: Project; catalog: ResearchCatalog }) {
  const { draft, change: setDraft, saved } = useResearchDraft<OriginalDirection>(project.research.direction ?? defaultDirection);
  const service = useService();
  const action = useResearchAction(project);
  const selected = project.research.choices.filter((c) => c.choice !== "omit");
  const ready = project.research.analysisRevision !== null && project.research.analysisRevision === project.research.materialRevision && selected.length > 0;
  const total = draft.deduction + draft.emotion + draft.mechanics;
  function change<K extends keyof OriginalDirection>(key: K, value: OriginalDirection[K]) { action.touch(); setDraft({ ...draft, [key]: value }); }
  return <>
    <section className="panel"><div className="panel-title"><h2>设置原创方向</h2><span>{project.research.directionConfirmed ? "方向已保存" : "待确定"}</span></div><p className="story-premise">这些是新作目标，不会自动把原始样例改成相应人数或题材。首次显示的数值只是可修改的建议。</p>{!ready && <><p className="field-hint">完成当前材料拆解，并至少保留或改造一条机制后，可以保存方向。</p><NextResearchStep projectId={project.id} stage="mechanisms" label="前往机制提炼" /></>}
      <form className="mt-6" onSubmit={(e) => { e.preventDefault(); if (!action.isPending) action.mutate((rev) => service.saveDirection(project.id, rev, draft), { onSuccess: saved }); }}><fieldset disabled={project.readOnly || action.isPending || project.research.job?.status === "running"}><legend className="sr-only">原创方向设置</legend><div className="research-form-grid"><label className="field-label">玩家人数<Input aria-label="目标玩家人数" type="number" min={2} max={12} required value={draft.players} onChange={(e) => change("players", Number(e.target.value))} /></label><label className="field-label">计划时长（分钟）<Input aria-label="目标时长" type="number" min={60} max={600} required value={draft.minutes} onChange={(e) => change("minutes", Number(e.target.value))} /></label></div><label className="field-label mt-4" htmlFor="direction-genre">题材</label><Input id="direction-genre" value={draft.genre} maxLength={60} required onChange={(e) => change("genre", e.target.value)} /><p className="field-label mt-6">希望玩家获得的体验比例</p><div className="research-form-grid three">{([ ["deduction", "推理还原"], ["emotion", "情感关系"], ["mechanics", "机制互动"] ] as const).map(([key, label]) => <label className="field-label" key={key}>{label} %<Input aria-label={`${label}比例`} type="number" min={0} max={100} required value={draft[key]} onChange={(e) => change(key, Number(e.target.value))} /></label>)}</div><p className={`field-hint ${total !== 100 ? "text-destructive" : ""}`}>当前合计 {total}%，保存时需要等于100%。</p><label className="field-label mt-5" htmlFor="direction-forbidden">禁止内容／创作边界</label><Textarea id="direction-forbidden" value={draft.forbidden} maxLength={1200} onChange={(e) => change("forbidden", e.target.value)} /><label className="field-label mt-5" htmlFor="direction-intensity">机制改编方式</label><select id="direction-intensity" className="plain-select" value={draft.intensity} onChange={(e) => change("intensity", e.target.value as OriginalDirection["intensity"])}><option value="mechanisms">借鉴抽象机制，重建故事与因果</option><option value="recombine">重新组合机制，重建人物与证据结构</option></select><p className="field-hint">两种方式都要求原创人物、事件与线索，不提供只替换姓名和地点的选项。</p><label className="field-label mt-5" htmlFor="direction-idea">补充创意</label><Textarea id="direction-idea" rows={5} value={draft.idea} maxLength={2000} onChange={(e) => change("idea", e.target.value)} placeholder="写下你的故事起点、核心矛盾或希望保留的体验。" /></fieldset><Button className="mt-5" disabled={project.readOnly || !ready || total !== 100 || action.isPending || project.research.job?.status === "running"}>保存原创方向</Button>{action.feedback}</form>
    </section>
    <section className="panel"><div className="panel-title"><h2>改变条件后，需要重新检查什么</h2><span>分析建议</span></div>{draft.players !== 5 && <p className="stage-callout mb-3">人数从参考结构的5人改为{draft.players}人，需要重新分配私人信息、谈判对象和关键贡献。原有5人样例尚未随之改写。</p>}{draft.minutes !== 225 && <p className="stage-callout mb-3">目标{draft.minutes}分钟不同于原样例计划225分钟，需要重算阅读、讨论、行动和主持说明的时间，不能只缩短轮次标签。</p>}{selected.map((choice) => { const pattern = catalog.patterns.find((p) => p.id === choice.id)!; return <article className="record-item" key={choice.id}><div><h3>{pattern.name}</h3>{Object.entries(pattern.changes).map(([key, value]) => <p key={key}>{key}：{value}</p>)}</div></article>; })}{selected.length === 0 && <p className="field-hint">选定机制后，这里会列出对应的迁移风险。</p>}</section>
    {project.research.directionConfirmed && <NextResearchStep projectId={project.id} stage="blueprint" label="查看原创蓝图阶段" />}
  </>;
}
