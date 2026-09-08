"use client";

import { useState } from "react";
import Link from "next/link";
import type { Project } from "@/domain/models";
import type { OCRIssue, ResearchCatalog } from "@/domain/research";
import { SourceImport } from "./source-import";
import { SourceList } from "./source-list";
import { useService } from "../providers";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { NextResearchStep, useResearchAction, useResearchDraft } from "./common";

const issueNames = { text: "待确认文字", blur: "模糊内容", duplicate: "重复页", missing: "缺失材料" };
const issueStatuses = { open: "待处理", corrected: "已人工校对", excluded: "已排除重复", retained: "保留缺口" };

function IssueEditor({ project, issue }: { project: Project; issue: OCRIssue }) {
  const { draft: resolution, change: setResolution, saved } = useResearchDraft(issue.resolution || issue.suggestion);
  const service = useService();
  const action = useResearchAction(project);
  const busy = action.isPending || project.readOnly || project.research.job?.status === "running";
  const status = issue.kind === "missing" ? "retained" : issue.kind === "duplicate" ? "excluded" : "corrected";
  return <article className="research-issue"><div className="panel-title"><h3>{issueNames[issue.kind]}</h3><span className={`tag ${issue.status === "open" || issue.status === "retained" ? "amber" : ""}`}>{issueStatuses[issue.status]}</span></div><p className="source-path">{issue.location}</p><p>{issue.description}</p><p className="research-original">练习原文：{issue.original}</p><form onSubmit={(e) => { e.preventDefault(); if (!busy) action.mutate((rev) => service.resolveOCRIssue(project.id, rev, { id: issue.id, status, resolution }), { onSuccess: saved }); }}><label className="field-label" htmlFor={`resolution-${issue.id}`}>{issue.kind === "missing" ? "缺口与影响说明" : "校对结果／处理说明"}</label><Textarea id={`resolution-${issue.id}`} value={resolution} maxLength={600} disabled={busy} onChange={(e) => { action.touch(); setResolution(e.target.value); }} /><div className="flex flex-wrap gap-2 mt-3"><Button size="sm" disabled={busy || !resolution.trim()}>{status === "retained" ? "保留缺口并记录" : status === "excluded" ? "排除重复页" : "保存校对"}</Button>{["text", "blur"].includes(issue.kind) && <Button size="sm" variant="outline" type="button" disabled={busy || !resolution.trim()} onClick={() => action.mutate((rev) => service.resolveOCRIssue(project.id, rev, { id: issue.id, status: "retained", resolution }), { onSuccess: saved })}>仍不确定，保留问题</Button>}</div>{action.feedback}</form></article>;
}

export function MaterialsStage({ project, catalog }: { project: Project; catalog: ResearchCatalog }) {
  const service = useService();
  const action = useResearchAction(project);
  const audit = useResearchAction(project);
  const [fail, setFail] = useState(false);
  const { draft: note, change: setNote, saved: auditSaved } = useResearchDraft(project.research.auditNote || "本轮用3份摘录进行校对练习，并参考8条既有机制研究记录。完整角色本、主持真相和结局原页未提供，不据此重建完整案件。");
  const state = project.research;
  const busy = project.readOnly || action.isPending || state.job?.status === "running";
  const hasDemo = state.documents.some((d) => d.origin === "demo");
  const processed = state.documents.some((d) => d.origin === "demo" && d.status === "processed");
  return <>
    <section className="panel"><div className="panel-title"><h2>① 添加参考材料</h2><span>文件留在本机</span></div><SourceImport key={project.id} project={project}>{project.readOnly ? <Button asChild><Link href="/projects/new?template=demo&start=research">载入研究练习包</Link></Button> : <Button disabled={busy || hasDemo} onClick={() => action.mutate((rev) => service.addResearchDemo(project.id, rev))}>{hasDemo ? "练习包已载入" : "载入研究练习包"}</Button>}</SourceImport>{project.readOnly && <p className="field-hint">原始样例仅供浏览。点击“载入研究练习包”会先进入副本创建，创建后在材料中心载入。</p>}{hasDemo && <p className="field-hint">{processed ? "练习包已经在这个项目中，模拟识别已完成。下一步：在下方校对问题并确认阅读范围。" : "练习包已经在这个项目中，无需重复载入。下一步：点击“开始模拟 OCR”。"}</p>}{action.feedback}
      <SourceList documents={state.documents} />
      {hasDemo && !processed && <div className="research-toolbar"><Button disabled={busy} onClick={() => action.mutate((rev) => service.startResearchJob(project.id, rev, "ocr", fail))}>开始模拟 OCR</Button><label className="field-hint"><input type="checkbox" checked={fail} disabled={busy} onChange={(e) => setFail(e.target.checked)} /> 演示一次失败，体验重试</label></div>}
    </section>
    {processed && <>
      <section className="panel"><div className="panel-title"><h2>② 校对识别问题</h2><span>{state.issues.filter((i) => i.status === "open").length} 项待处理</span></div><p className="field-hint">这些错误为体验校对而人为设置。缺失的真实材料只能记录为缺口，不能点击成“已补齐”。</p><div className="research-issues">{state.issues.map((issue) => <IssueEditor key={issue.id} issue={issue} project={project} />)}</div></section>
      <section className="panel"><div className="panel-title"><h2>③ 确认阅读范围</h2><span>{state.auditRevision === state.materialRevision ? "范围已确认" : "待确认"}</span></div><p className="story-premise">校对练习展示3份摘录；后续拆解同时引用8条既有机制研究记录。练习页4为重复页；完整参考本不在本次范围。本机登记文件没有可分析正文。</p>{catalog.excerpts.map((excerpt) => <details className="research-excerpt" key={excerpt.id}><summary>{excerpt.label} · {excerpt.recordId} · 查看摘录与来源</summary><p>{excerpt.text}</p><p className="source-path">历史记录定位：{excerpt.locator}</p></details>)}<p className="field-hint">摘录保留原始历史记录；你的校对结果另存于上方，不覆盖原资料。自定义校对与摘录不一致时，拆解会提示待复核。</p><form onSubmit={(e) => { e.preventDefault(); if (!audit.isPending) audit.mutate((rev) => service.confirmMaterialAudit(project.id, rev, note), { onSuccess: auditSaved }); }}><label htmlFor="audit-note" className="field-label mt-5">本轮阅读范围与限制</label><Textarea id="audit-note" value={note} maxLength={1000} onChange={(e) => { audit.touch(); setNote(e.target.value); }} disabled={project.readOnly || state.job?.status === "running"} /><Button className="mt-4" disabled={project.readOnly || audit.isPending || state.job?.status === "running" || state.issues.some((i) => i.status === "open")}>确认阅读范围（含保留缺口）</Button>{audit.feedback}</form>{state.auditRevision === state.materialRevision && <NextResearchStep projectId={project.id} stage="analysis" label="继续参考本拆解" />}</section>
    </>}
  </>;
}
