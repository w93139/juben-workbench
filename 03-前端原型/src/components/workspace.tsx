"use client";

import Link from "next/link";
import { Network } from "lucide-react";
import { AppFrame } from "./app-frame";
import { useContent, useProject, useWorkflow } from "./providers";
import { ErrorMessage, LoadError, Loading } from "./shared";
import { Button } from "./ui/button";
import { EditProject, SourcesPanel } from "./workspace-panels";
import { useProductionRunner } from "./production/runner";
import { StageContent } from "./stage-content";
import { ResearchJobPanel, useResearchRunner } from "./research/common";
import { workflowStep, workflowSteps } from "@/domain/workflow-view";
import { WorkspaceActions } from "./workspace-actions";
import { OutputLocation } from "./output-settings";
import { formatDate, getStats } from "@/domain/presentation";
import type { StageId } from "@/domain/models";

export function WorkspacePage({ projectId, stageId }: { projectId: string; stageId?: StageId }) {
  const projectQuery = useProject(projectId);
  const contentQuery = useContent(projectId);
  const workflow = useWorkflow();
  const project = projectQuery.data;
  const content = contentQuery.data ?? null;
  const blueprint = project?.blueprint?.draft;
  const runner = useResearchRunner(project);
  const productionFeedback = useProductionRunner(project);
  const stage = workflow.data?.find((s) => s.id === stageId);
  const step = stageId ? workflowStep(stageId) : undefined;
  const base = `/projects/${projectId}`;
  const loadError = projectQuery.error ?? contentQuery.error ?? workflow.error;
  const hasSnapshot = projectQuery.data !== undefined && contentQuery.data !== undefined && workflow.data !== undefined;
  function retry() { void projectQuery.refetch(); void contentQuery.refetch(); void workflow.refetch(); }
  return <AppFrame title={step?.name ?? project?.title ?? "项目工作台"} projectId={projectId} workspace>
    {projectQuery.isPending || contentQuery.isPending || workflow.isPending ? <Loading /> : loadError && !hasSnapshot ? <LoadError error={loadError} retry={retry} /> : project && <>
      <div className="workspace-fixed-header" aria-label="当前页面与常用操作">
        <header className="workspace-header"><div className="workspace-heading-copy"><div className="project-title-row">{stageId ? <Link className="project-title" href={base} title={project.title}>{project.title}</Link> : <h1 className="serif" title={project.title}>{project.title}</h1>}<EditProject key={`${project.id}:${stageId ?? "overview"}`} project={project} label="改名" iconOnly />{project.readOnly && <small className="readonly-caption">样例</small>}</div>{stageId && <h1 className="serif" title={step?.name}>{step?.name}</h1>}</div></header>
        <nav className="project-workflow" aria-label="创作流程"><Link href={base} aria-current={!stageId ? "page" : undefined}>总览</Link>{workflowSteps.map((item, index) => <Link key={item.id} href={`${base}/stages/${item.id}`} aria-current={item.stages.some((id) => id === stageId) ? "step" : undefined}><span>{index + 1}</span>{item.name}</Link>)}</nav>
        <WorkspaceActions project={project} content={content} stageId={stageId} />
      </div>
      <section key={`${projectId}:${stageId ?? "overview"}`} className="workspace-details" aria-label="具体功能内容" tabIndex={0}>
      {loadError && <div className="mb-5"><ErrorMessage error={loadError} /><div className="flex flex-wrap items-center gap-3"><p className="field-hint">当前保留上次成功读取的内容与未保存输入。请恢复读取后再保存。</p><Button size="sm" variant="outline" onClick={retry}>重新读取</Button></div></div>}
      <div className="workspace-subline"><span>{stage ? project.title : project.readOnly ? "原始样例 · 只读" : "本机项目 · 自动保存修改"}</span>{content && <><span>{content.players} 位玩家</span><span>计划 {content.plannedMinutes} 分钟</span><span>样例档案 {content.blueprintVersion} / 原开本包 {content.kitVersion}</span></>}<span>{formatDate(project.updatedAt)}</span>{project.research.direction && <span>新作目标：{project.research.direction.players}人 · {project.research.direction.minutes}分钟 · {project.research.direction.genre}（原样例尚未改写）</span>}</div>

      {productionFeedback}
      <ResearchJobPanel project={project} error={runner.error} retry={runner.retry} />
      <div className="main-stack">
        <OutputLocation key={`${project.id}-${stageId ?? "overview"}`} project={project} stage={!stageId || stageId === "materials" ? "analysis" : stageId} />
        <div className="stage-content-enter">{stage ? <StageContent stage={stage} content={content} project={project} /> : <>

          <section className="stat-grid" aria-label="结构概览">{getStats(content, blueprint).map((stat) => <div className="stat-cell" key={stat.label}><small>{stat.label}</small><strong>{stat.value}<span>{stat.unit}</span></strong></div>)}</section>
          <section className="panel"><div className="panel-title"><h2><Network size={15} />{blueprint ? "当前蓝图" : content ? "样例故事底稿" : "创作起点"}</h2><span>{blueprint ? "原创方案 · 已保存草稿" : content ? "样例 · 只读" : "待确定"}</span></div><p className="story-premise">{(blueprint ? blueprint.premise || "还没有填写故事简介。" : content?.premise) || "项目已经建立。先留下你的故事想法，参考材料和原创结构将在后续阶段逐步补齐。"}</p>{(blueprint || content) && <div className="character-row">{(blueprint?.characters ?? content?.characters ?? []).map((character) => <span className="character-chip" key={character.id}><span className="character-initial">{character.name[0]}</span>{character.name}</span>)}</div>}</section>
          <section className="panel"><div className="panel-title"><h2>创作备注</h2><span>{project.readOnly ? "样例说明" : "点击标题旁的小笔可一起编辑"}</span></div><p className="story-premise whitespace-pre-wrap">{project.note || "还没有备注。记下一条创意，或这次改写最想解决的问题。"}</p></section>
        </>}</div>
      {content && <details className="archive-details"><summary>项目资料与来源</summary><SourcesPanel content={content} /></details>}
      </div>
      <p className="page-footnote">作者工作区 · 结构与原文可能含谜底，请勿直接向玩家展示。原始样例与历史检查保持独立。</p>
      </section>
    </>}
  </AppFrame>;
}
