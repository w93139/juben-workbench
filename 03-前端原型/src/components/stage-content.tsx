"use client";

import Link from "next/link";
import { workflowStep } from "@/domain/workflow-view";
import { useState } from "react";
import { knowledgeKindLabel, knowledgeLabels } from "@/domain/presentation";
import { Check, FileText } from "lucide-react";
import type { DemoContent, Project, WorkflowStage } from "@/domain/models";
import { SourcePreview } from "./shared";
import { ResearchStage } from "./research";

const blueprintViews = ["人物", "人物关系", "时间线", "谁知道什么", "线索与结论", "轮次"] as const;
type BlueprintView = typeof blueprintViews[number];

function Blueprint({ content }: { content: DemoContent }) {
  const [view, setView] = useState<BlueprintView>("人物");
  return <><p className="field-hint">作者视角，含谜底。当前以只读记录浏览；关系图、表格编辑和联动检查将在蓝图阶段开放。</p><div className="view-switcher" aria-label="蓝图内容分类">{blueprintViews.map((item) => <button key={item} aria-pressed={view === item} onClick={() => setView(item)}>{item}</button>)}</div>
    {view === "人物" && <div className="record-grid">{content.characters.map((c) => <article className="record-card" key={c.id}><span className="tag">{c.id} · 原创方案</span><h3>{c.name}</h3><p>{c.publicIdentity}</p><dl className="record-fields"><dt>个人目标</dt><dd>{c.goal}</dd><dt>私密信息</dt><dd>{c.privateInformation}</dd><dt>有后果的选择</dt><dd>{c.choice}</dd><dt>对推进的贡献</dt><dd>{c.contribution}</dd></dl></article>)}</div>}
    {view === "人物关系" && <div className="record-list">{content.relationships.map((r) => <article className="record-item" key={r.id}><small>{r.id}</small><div><h3>{r.participants.map((id) => content.characters.find((c) => c.id === id)?.name ?? id).join(" ↔ ")}</h3><span className="tag mb-3">{r.statusLabel}</span><p>{r.publicVersion}</p><p className="mt-2">真实关联：{r.underlyingFacts}</p><p className="mt-2">交换与贡献：{r.leverage}</p><span className="source-path">关联事件：{r.basis} · {r.priority}关系</span></div></article>)}</div>}
    {view === "时间线" && <div className="record-list">{content.events.map((event) => <article className="record-item" key={event.id}><small>{event.time}</small><div><h3>{event.location}</h3><p>{event.action}</p><span className="source-path">{event.id} · 客观事件 / 原创方案</span></div></article>)}</div>}
    {view === "谁知道什么" && <><p className="field-hint mt-4">也称“知识矩阵”：逐条记录信息，以及不同角色开局对它的了解。</p><div className="record-list">{content.knowledge.map((item) => <article className="record-item" key={item.id}><small>{item.id}</small><div><span className="tag mb-2">{knowledgeKindLabel(item.kind)}</span><p>{item.statement}</p><div className="knowledge-states">{Object.entries(item.initial).map(([id, status]) => <span key={id}>{content.characters.find((c) => c.id === id)?.name ?? id}：{knowledgeLabels[status] ?? status}</span>)}</div></div></article>)}</div></>}
    {view === "线索与结论" && <><h3 className="mt-5 font-medium">推理结论</h3><div className="record-list">{content.claims.map((claim) => <article className="record-item" key={claim.id}><small>{claim.id}</small><div><span className="tag mb-2">{claim.tier === "required" ? "必要结论" : "补充结论"}</span><p>{claim.statement}</p></div></article>)}</div><h3 className="mt-6 font-medium">线索支持哪些结论</h3><div className="record-list">{content.clues.map((clue) => <article className="record-item" key={clue.id}><small>{clue.id}</small><div><h3>{clue.name}</h3><p>{clue.content}</p><p>支持：{clue.supports.join("、") || "需结合其他材料理解"} · 获取成本 {clue.cost}</p></div></article>)}</div></>}
    {view === "轮次" && <div className="record-list">{content.rounds.map((round) => <article className="record-item" key={round.id}><small>{round.id}</small><div><h3>{round.name}</h3><p>计划 {round.minutes} 分钟</p></div></article>)}</div>}
  </>;
}

export function StageContent({ stage, content, project }: { stage: WorkflowStage; content: DemoContent | null; project: Project }) {
  if (stage.nextPhase === "B") return <ResearchStage project={project} stageId={stage.id} />;
  const step = workflowStep(stage.id);
  return <>
    <p className="field-hint">当前可浏览样例档案。故事编辑、模拟生成、问题处理及导出功能尚未开放。</p>
    <section className="panel"><div className="panel-title"><h2>{step.name}档案</h2><span>{content ? "原始样例 · 只读" : "尚未准备"}</span></div>
      {!content ? <div className="empty-state"><FileText size={26} className="mx-auto" /><h2>这部分内容还未建立</h2><p>先在项目总览记录备注与决定。后续将开放{step.name}的具体操作。</p></div> : <>
        {stage.id === "blueprint" && <><Blueprint content={content} /><p className="field-hint mt-5">正文生成前需要先检查蓝图，正文完成后再次检查。当前只有原始样例的历史记录。</p><Link className="text-link" href={`/projects/${project.id}/stages/review#review-records`}>查看蓝图检查记录</Link></>}
        {step.id === "generation" && <><h3 className="mt-4 mb-3 font-medium">正文材料</h3><p className="story-premise">原样例开本包 {content.kitVersion} 已包含以下材料。当前展示现有文件状态，没有调用模型重新生成。</p><div className="record-list">{content.deliverables.map((d) => <div className="record-item" key={d.label}><Check size={15} /><p>{d.label}</p><span className="tag ml-auto">{d.complete ? "原包已具备" : "待补齐"}</span></div>)}</div><p className="field-hint">后续开放分模块模拟生成、重新生成及版本差异查看。</p></>}
        {step.id === "generation" && <><h3 id="review-records" className="mt-6 mb-3 font-medium">审查记录</h3><p className="story-premise">顶部“检查与试玩”可分别查看 AI 结构审查、静态一致性检查、模拟测试与真人试玩。AI 结论来自历史蓝图审查；静态结果来自原开本包，不能外推为当前副本或真人体验已通过。</p>{content.documents.filter((d) => d.id === "review").map((doc) => <SourcePreview key={doc.id} document={doc} />)}<p className="field-hint">后续开放问题严重程度、证据位置、修改建议与处理状态。</p></>}
        {step.id === "export" && <><h3 className="mt-6 mb-3 font-medium">试玩记录</h3><span className="tag amber">尚未真人试玩</span><h3 className="serif text-lg mt-5">纸面之外，还需要一桌玩家。</h3><p className="story-premise mt-4">此项目没有真实试玩记录。计划时长与角色参与度均不能作为已验证的体验结论。</p><div className="record-grid">{["实际时长与各轮卡点", "每个角色的参与和选择", "线索购买与推理结果", "主持执行问题与修改建议"].map((item) => <div className="record-card" key={item}><p>{item}</p><span className="tag neutral mt-3">待记录</span></div>)}</div></>}
        {step.id === "export" && <><h3 className="mt-6 mb-3 font-medium">开本包与导出</h3><p className="field-hint">可以先导出标注“未试玩”的试玩包，再记录真人试玩、修改剧本并重新导出。当前导出功能尚未开放。</p><p className="story-premise">原始开本包 {content.kitVersion} 的使用说明可只读查看。导出与玩家材料隔离将在后续阶段实现，当前没有生成新的下载文件。</p>{content.documents.filter((d) => d.id === "kit").map((doc) => <SourcePreview key={doc.id} document={doc} />)}<div className="stage-callout mt-5"><strong>作者资料含谜底</strong><br />未来导出将区分玩家包与主持包，并明确标注审查范围及真人试玩状态。</div></>}
      </>}
    </section>
  </>;
}
