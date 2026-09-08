"use client";

import type { Project } from "@/domain/models";
import type { MechanismChoice, ResearchCatalog } from "@/domain/research";
import { useService } from "../providers";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { NextResearchStep, useResearchAction, useResearchDraft } from "./common";

function MechanismCard({ project, pattern }: { project: Project; pattern: ResearchCatalog["patterns"][number] }) {
  const existing = project.research.choices.find((c) => c.id === pattern.id);
  const { draft, change, saved } = useResearchDraft<{ choice: MechanismChoice["choice"]; reason: string }>({ choice: existing?.choice ?? "adapt", reason: existing?.reason ?? "" });
  const { choice, reason } = draft;
  const service = useService();
  const action = useResearchAction(project);
  const ready = project.research.analysisRevision !== null && project.research.analysisRevision === project.research.materialRevision;
  const busy = !ready || project.readOnly || action.isPending || project.research.job?.status === "running";
  return <article className="panel"><div className="panel-title"><h2>{pattern.id} · {pattern.name}</h2><span>{existing ? "取舍已记录" : "待决定"}</span></div><dl className="mechanism-fields"><dt>希望玩家做什么</dt><dd>{pattern.behavior}</dd><dt>需要哪些前提</dt><dd>{pattern.prerequisites.join("；")}</dd><dt>为什么和故事有关</dt><dd>{pattern.story}</dd><dt>可以迁移的抽象部分</dt><dd>{pattern.transferable}</dd></dl><details className="research-excerpt"><summary>查看证据、改编建议与风险</summary><span className="tag">参考记录明确事实</span><p>{pattern.explicit}</p><p className="source-path">{pattern.locator}</p>{pattern.sources.map((source) => <p className="source-path" key={source.id}>{source.id} · {source.location}</p>)}<span className="tag blue">分析推断</span>{pattern.risks.map((risk) => <p key={risk}>• {risk}</p>)}{Object.entries(pattern.changes).map(([name, risk]) => <p key={name}>{name}改变：{risk}</p>)}<span className="tag neutral">原创迁移建议</span><p>{pattern.suggestion}</p></details><form className="mechanism-decision" onSubmit={(e) => { e.preventDefault(); if (!busy) action.mutate((rev) => service.chooseMechanism(project.id, rev, { id: pattern.id, choice, reason }), { onSuccess: saved }); }}><label className="field-label" htmlFor={`choice-${pattern.id}`}>这条机制如何处理</label><select id={`choice-${pattern.id}`} className="plain-select" value={choice} disabled={busy} onChange={(e) => { action.touch(); change({ ...draft, choice: e.target.value as MechanismChoice["choice"] }); }}><option value="retain">保留抽象功能</option><option value="adapt">改造后迁移</option><option value="omit">舍弃</option></select><label className="field-label mt-4" htmlFor={`reason-${pattern.id}`}>取舍理由</label><Textarea id={`reason-${pattern.id}`} value={reason} maxLength={600} disabled={busy} onChange={(e) => { action.touch(); change({ ...draft, reason: e.target.value }); }} placeholder="例如：保留公开线索带来不同私人更新，重写触发条件与人物经历。" /><Button size="sm" className="mt-3" disabled={busy || !reason.trim()}>保存机制取舍</Button>{action.feedback}</form></article>;
}

export function MechanismsStage({ project, catalog }: { project: Project; catalog: ResearchCatalog }) {
  const ready = project.research.analysisRevision !== null && project.research.analysisRevision === project.research.materialRevision;
  return <><div className="stage-callout"><strong>迁移的是玩法功能，人物、因果和线索需要重新建立。</strong><p>未选择的机制不会自动加入新方向。以下8条均来自历史机制研究，玩家行为与风险属于分析，不是试玩保证。</p>{!ready && <p>可先浏览历史记录；完成当前材料的模拟拆解后才能保存取舍。</p>}</div>{!ready && <NextResearchStep projectId={project.id} stage="analysis" label="先完成参考本拆解" />}{catalog.patterns.map((pattern) => <MechanismCard project={project} pattern={pattern} key={pattern.id} />)}{ready && project.research.choices.some((c) => c.choice !== "omit") && <NextResearchStep projectId={project.id} stage="direction" label="继续设置原创方向" />}</>;
}
