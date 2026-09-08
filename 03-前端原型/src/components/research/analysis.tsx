"use client";

import { useState } from "react";
import type { Project } from "@/domain/models";
import type { ResearchCatalog } from "@/domain/research";
import { useService } from "../providers";
import { Button } from "../ui/button";
import { NextResearchStep, useResearchAction } from "./common";

const views = ["客观真相", "时间线", "人物关系", "信息分配", "线索结构", "轮次玩法"] as const;

export function AnalysisStage({ project, catalog, embedded = false }: { project: Project; catalog: ResearchCatalog; embedded?: boolean }) {
  const state = project.research;
  const service = useService();
  const action = useResearchAction(project);
  const [view, setView] = useState<typeof views[number]>("信息分配");
  const ready = state.analysisRevision !== null && state.analysisRevision === state.materialRevision;
  const audited = state.auditRevision !== null && state.auditRevision === state.materialRevision;
  const custom = state.issues.filter((i) => ["text", "blur"].includes(i.kind) && (i.status === "retained" || i.resolution !== i.suggestion));
  const facts = catalog.patterns.filter((p) => view === "信息分配" ? p.id === "P03" : view === "线索结构" ? ["P02", "P04"].includes(p.id) : ["P01", "P03"].includes(p.id));
  return <section className="panel"><div className="panel-title"><h2>拆解依据与结果</h2><span>{ready ? "当前材料版本" : "尚未生成当前拆解"}</span></div><p className="story-premise">{catalog.boundary}</p><div className="research-toolbar"><Button disabled={project.readOnly || action.isPending || state.job?.status === "running" || !audited} onClick={() => action.mutate((rev) => service.startResearchJob(project.id, rev, "analysis"))}>{ready ? "重新模拟拆解" : "开始模拟拆解"}</Button></div>{!audited && <><p className="field-hint">先处理识别问题并确认阅读范围，再进行拆解。材料或校对结果改变后，需要重新确认。</p><NextResearchStep projectId={project.id} stage="materials" label="返回材料中心" /></>}{action.feedback}
    {ready && <><div className="research-summary"><span>3份机制摘录</span><span>8条既有机制记录</span><span>{state.issues.filter((i) => i.status === "retained").length} 项保留缺口</span></div><p className="field-hint">来源层级：引用的是既有研究记录，本次没有重新识别或核验原始扫描页。以下为预设模拟拆解，不声称AI实时分析了你的文件。</p>{custom.length > 0 && <div className="stage-callout mt-4"><strong>有自定义校对或未确定文字，以下规则待复核。</strong>{custom.map((issue) => <p key={issue.id}>{issue.location}：{issue.resolution}</p>)}<p>原研究摘录保持原样，不把自定义结果自动当作原规则。</p></div>}
      <div className="view-switcher" aria-label="参考拆解分类">{views.map((name) => <button key={name} aria-pressed={view === name} onClick={() => setView(name)}>{name}</button>)}</div>
      {["客观真相", "时间线", "人物关系"].includes(view) ? <div className="stage-callout mt-5"><span className="tag amber">待确定事项</span><h3 className="mt-3">{view}材料不足</h3><p>本练习没有完整角色本与主持真相，不能从玩法规则反推出完整案件、案发时间线或人物关系。《名字之外》的原创底稿也不充当原参考本真相。</p><p>补充范围：{view === "人物关系" ? "各角色原本、共同事件与关系来源。" : "主持真相、当事人的叙述及关键证据原页。"}</p></div> : <div className="record-list">{facts.map((pattern) => <article className="record-card mb-4" key={pattern.id}><span className={`tag ${custom.length ? "amber" : ""}`}>{custom.length ? "待复核的历史记录" : "参考记录明确事实"}</span><h3>{pattern.name}</h3><p>{pattern.explicit}</p><p className="source-path">{pattern.locator}</p><details className="research-excerpt"><summary>查看原记录标注的来源位置</summary>{pattern.sources.map((source) => <p key={source.id}>{source.id} · {source.location}</p>)}</details><span className="tag blue mt-3">分析推断 · 不是已验证体验</span><p className="mt-2">{pattern.behavior}</p>{view === "轮次玩法" && <><span className="tag neutral mt-3">既有编辑方案 · 非原作规则</span><p className="mt-2">{pattern.editorial}</p></>}</article>)}</div>}
      <p className="field-hint">本轮范围确认：{state.auditNote}</p>{!embedded && <NextResearchStep projectId={project.id} stage="mechanisms" label="继续选择可迁移机制" />}
    </>}
  </section>;
}
