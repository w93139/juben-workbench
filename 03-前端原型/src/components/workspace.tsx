"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, Compass, Copy, Network } from "lucide-react";
import { AppFrame } from "./app-frame";
import { useContent, useProject, useWorkflow } from "./providers";
import { ErrorMessage, LoadError, Loading } from "./shared";
import { Button } from "./ui/button";
import { ChecksPanel, DecisionPanel, EditProject, ReadinessPanel, SourcesPanel } from "./workspace-panels";
import { StageContent } from "./stage-content";
import { ResearchJobPanel, useResearchRunner } from "./research/common";
import { researchStep } from "@/domain/research";
import { WorkspaceActionHint, WorkspaceActions } from "./workspace-actions";
import { OutputSettingsPanel } from "./output-settings";
import { formatDate, getStats } from "@/domain/presentation";
import type { StageId } from "@/domain/models";

export function WorkspacePage({ projectId, stageId }: { projectId: string; stageId?: StageId }) {
  const projectQuery = useProject(projectId);
  const contentQuery = useContent(projectId);
  const workflow = useWorkflow();
  const project = projectQuery.data;
  const content = contentQuery.data ?? null;
  const runner = useResearchRunner(project);
  const stage = workflow.data?.find((s) => s.id === stageId);
  const base = `/projects/${projectId}`;
  const loadError = projectQuery.error ?? contentQuery.error ?? workflow.error;
  const hasSnapshot = projectQuery.data !== undefined && contentQuery.data !== undefined && workflow.data !== undefined;
  function retry() { void projectQuery.refetch(); void contentQuery.refetch(); void workflow.refetch(); }
  return <AppFrame title={stage?.name ?? project?.title ?? "项目工作台"} projectId={projectId} workspace>
    {projectQuery.isPending || contentQuery.isPending || workflow.isPending ? <Loading /> : loadError && !hasSnapshot ? <LoadError error={loadError} retry={retry} /> : project && <>
      <div className="workspace-fixed-header" aria-label="当前页面与常用操作">
        <header className="workspace-header"><div className="workspace-heading-copy"><span className="eyebrow">{stage ? `创作步骤 ${String((workflow.data?.findIndex((s) => s.id === stageId) ?? 0) + 1).padStart(2, "0")} / ${workflow.data?.length}` : "项目总览"}</span><h1 className="serif" title={stage?.name ?? project.title}>{stage?.name ?? project.title}</h1></div>{project.readOnly ? <Link href="/projects/new?template=demo" className="button-link secondary"><Copy size={13} />创建演示副本</Link> : <EditProject project={project} />}</header>
        <WorkspaceActions project={project} content={content} stageId={stageId} workflow={workflow.data ?? []} />
      </div>
      <section key={`${projectId}:${stageId ?? "overview"}`} className="workspace-details" aria-label="具体功能内容" tabIndex={0}>
      {loadError && <div className="mb-5"><ErrorMessage error={loadError} /><div className="flex flex-wrap items-center gap-3"><p className="field-hint">当前保留上次成功读取的内容与未保存输入。请恢复读取后再保存。</p><Button size="sm" variant="outline" onClick={retry}>重新读取</Button></div></div>}
      <div className="workspace-subline"><span>{stage ? project.title : project.readOnly ? "原始样例 · 只读" : "本机项目 · 自动保存修改"}</span>{content && <><span>{content.players} 位玩家</span><span>计划 {content.plannedMinutes} 分钟</span><span>蓝图 {content.blueprintVersion} / 开本包 {content.kitVersion}</span></>}<span>{formatDate(project.updatedAt)}</span>{project.research.direction && <span>新作目标：{project.research.direction.players}人 · {project.research.direction.minutes}分钟 · {project.research.direction.genre}（原样例尚未改写）</span>}</div>
      <WorkspaceActionHint project={project} stageId={stageId} />
      <ResearchJobPanel project={project} error={runner.error} retry={runner.retry} />
      <div className="workspace-grid"><div className="main-stack">
        {stageId && stageId !== "materials" && <OutputSettingsPanel key={`${project.id}-${stageId}`} project={project} stage={stageId} />}
        {stage ? <StageContent stage={stage} content={content} project={project} /> : <>
          <section className="next-action"><div className="flex items-center gap-4"><Compass className="action-icon" size={28} strokeWidth={1.2} /><div><span className="eyebrow">下一步，从这里开始</span><h2>{project.readOnly ? "读懂结构，再写下你的决定" : "从参考材料到原创方向"}</h2><p>{project.readOnly ? "样例开本材料已齐备，真实体验仍等待真人试玩。" : "载入练习包，体验识别、校对、拆解和机制取舍。"}</p></div></div><Link href={`${base}/stages/${project.readOnly ? "blueprint" : researchStep(project.research)}`} className="button-link">{project.readOnly ? "浏览蓝图" : "打开当前步骤"}<ArrowRight size={13} /></Link></section>
          <section className="stat-grid" aria-label="结构概览">{getStats(content).map((stat) => <div className="stat-cell" key={stat.label}><small>{stat.label}</small><strong>{stat.value}<span>{stat.unit}</span></strong></div>)}</section>
          <section className="panel"><div className="panel-title"><h2><Network size={15} />{content ? "故事底稿" : "创作起点"}</h2><span>{content ? "原创方案 · 只读" : "待确定"}</span></div><p className="story-premise">{content?.premise ?? "项目已经建立。先留下你的故事想法，参考材料和原创结构将在后续阶段逐步补齐。"}</p>{content && <div className="character-row">{content.characters.map((character) => <span className="character-chip" key={character.id}><span className="character-initial">{character.name[0]}</span>{character.name}</span>)}</div>}</section>
          <section className="panel"><div className="panel-title"><h2>创作备注</h2><span>{project.readOnly ? "样例说明" : "可在右上角编辑"}</span></div><p className="story-premise whitespace-pre-wrap">{project.note || "还没有备注。记下一条创意，或这次改写最想解决的问题。"}</p></section>
          <DecisionPanel project={project} />
          <section className="panel"><div className="panel-title"><h2>完整创作流程</h2><span>各阶段可浏览</span></div><div className="workflow-overview">{workflow.data?.map((s, i) => <Link href={`${base}/stages/${s.id}`} key={s.id}><span>{String(i + 1).padStart(2, "0")}</span>{s.name}<ArrowUpRight size={12} /></Link>)}</div></section>
        </>}
      </div><aside className="aside-stack"><ReadinessPanel content={content} /><ChecksPanel content={content} />{content && <SourcesPanel content={content} />}</aside></div>
      <p className="page-footnote">作者工作区 · 结构与原文可能含谜底，请勿直接向玩家展示。参考研究已开放模拟操作；原始样例与历史检查保持独立。</p>
      </section>
    </>}
  </AppFrame>;
}
