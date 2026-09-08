"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usesFolderPlan } from "@/domain/folder-plan";
import type { Project } from "@/domain/models";
import type { OCRIssue, ResearchCatalog } from "@/domain/research";
import { SourceImport, SourceSupplement } from "./source-import";
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
  if (usesFolderPlan(project)) return <FolderMaterials project={project} />;
  return <>
    <section className="panel"><div className="panel-title"><h2>原剧本材料（输入）</h2><span>文件留在本机</span></div><SourceSupplement hasMaterials={!!state.documents.length}><SourceImport key={project.id} project={project}>{project.readOnly ? <Button asChild><Link href="/projects/new">上传自己的剧本</Link></Button> : <Button disabled={busy || hasDemo} onClick={() => action.mutate((rev) => service.addResearchDemo(project.id, rev))}>{hasDemo ? "练习包已载入" : "载入研究练习包"}</Button>}</SourceImport></SourceSupplement>{project.readOnly && <p className="field-hint">原始样例仅供浏览。上传自己的完整剧本文件夹，开始新项目。</p>}{hasDemo && <p className="field-hint">{processed ? "练习包已经在这个项目中，模拟识别已完成。下一步：在下方校对问题并确认阅读范围。" : "练习包已经在这个项目中，无需重复载入。下一步：点击“开始模拟 OCR”。"}</p>}{action.feedback}
      <SourceList documents={state.documents} />
      {hasDemo && !processed && <div className="research-toolbar"><Button disabled={busy} onClick={() => action.mutate((rev) => service.startResearchJob(project.id, rev, "ocr", fail))}>开始模拟 OCR</Button><details><summary className="field-hint">演示选项</summary><label className="field-hint"><input type="checkbox" checked={fail} disabled={busy} onChange={(e) => setFail(e.target.checked)} /> 演示一次失败，体验重试</label></details></div>}
    </section>
    {processed && <>
      <section className="panel"><div className="panel-title"><h2>② 校对识别问题</h2><span>{state.issues.filter((i) => i.status === "open").length} 项待处理</span></div><p className="field-hint">这些错误为体验校对而人为设置。缺失的真实材料只能记录为缺口，不能点击成“已补齐”。</p><div className="research-issues">{state.issues.map((issue) => <IssueEditor key={issue.id} issue={issue} project={project} />)}</div></section>
      <section className="panel"><div className="panel-title"><h2>③ 确认阅读范围</h2><span>{state.auditRevision === state.materialRevision ? "范围已确认" : "待确认"}</span></div><p className="story-premise">校对练习展示3份摘录；后续拆解同时引用8条既有机制研究记录。练习页4为重复页；完整参考本不在本次范围。本机登记文件没有可分析正文。</p>{catalog.excerpts.map((excerpt) => <details className="research-excerpt" key={excerpt.id}><summary>{excerpt.label} · {excerpt.recordId} · 查看摘录与来源</summary><p>{excerpt.text}</p><p className="source-path">历史记录定位：{excerpt.locator}</p></details>)}<p className="field-hint">摘录保留原始历史记录；你的校对结果另存于上方，不覆盖原资料。自定义校对与摘录不一致时，拆解会提示待复核。</p><form onSubmit={(e) => { e.preventDefault(); if (!audit.isPending) audit.mutate((rev) => service.confirmMaterialAudit(project.id, rev, note), { onSuccess: auditSaved }); }}><label htmlFor="audit-note" className="field-label mt-5">本轮阅读范围与限制</label><Textarea id="audit-note" value={note} maxLength={1000} onChange={(e) => { audit.touch(); setNote(e.target.value); }} disabled={project.readOnly || state.job?.status === "running"} /><Button className="mt-4" disabled={project.readOnly || audit.isPending || state.job?.status === "running" || state.issues.some((i) => i.status === "open")}>确认阅读范围（含保留缺口）</Button>{audit.feedback}</form>{state.auditRevision === state.materialRevision && <NextResearchStep projectId={project.id} stage="analysis" label="查看创作方案" />}</section>
    </>}
  </>;
}

function FolderMaterials({ project }: { project: Project }) {
  const service = useService();
  const router = useRouter();
  const action = useResearchAction(project);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const count = project.research.documents.length;
  const resume = project.folderPlan?.status === "running";
  return <>
    <section className="panel" aria-label="剧本文件清单"><div className="panel-title"><h2>已导入的剧本材料</h2><span>{count} 份已登记</span></div><p className="story-premise">这里是原剧本的输入材料。已有文件无需重复导入；遗漏时展开“补充原剧本材料”。输出文件夹用于新作成果，与输入材料分开。</p><SourceSupplement hasMaterials={!!count}><SourceImport project={project} /></SourceSupplement><SourceList documents={project.research.documents} /></section>
    <section className="panel" aria-label="识别与拆解准备"><div className="panel-title"><h2>从材料进入拆解</h2><span>正文尚未识别</span></div><p className="story-premise">正式流程会先识别文字或音视频内容，检查缺页、重复、模糊文字及材料完整性，再拆解故事架构并提出原创方案。</p><p className="stage-callout mt-3">目前仅保存文件清单，不能仅凭文件名判断剧本是否完整。尚未执行OCR或音视频转写，下一步仅演示拆解框架和方向选择。</p><div className="flex flex-wrap gap-3 mt-4">{resume ? <Link className="button-link" href={`/projects/${project.id}/stages/analysis`}>继续模拟拆解 →</Link> : <Button disabled={!count || action.isPending} onClick={() => action.mutate((revision) => service.startFolderPlan(project.id, revision), { onSuccess: () => { if (mounted.current) router.push(`/projects/${project.id}/stages/analysis`); } })}>模拟拆解并查看建议</Button>}</div>{action.feedback}</section>
  </>;
}
