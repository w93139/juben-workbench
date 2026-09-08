"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { checkBlueprint, type BlueprintData, type BlueprintIssue, type BlueprintWorkspace } from "@/domain/blueprint";
import { blueprintGroups, sectionLabels, type BlueprintSection } from "@/domain/blueprint-editor";
import type { Project } from "@/domain/models";
import { useService } from "../providers";
import { useResearchAction, useResearchDraft } from "../research/common";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { LoadError, Loading } from "../shared";
import { ArrayEditor, RelationshipMap } from "./fields";

type Focus = { section: string; id?: string; ids?: Record<string, string | undefined> };
export function BlueprintWorkbench({ project }: { project: Project }) {
  const service = useService();
  const original = useQuery({ queryKey: ["blueprint-original", project.id], queryFn: () => service.getBlueprint(project.id), enabled: project.readOnly, staleTime: Infinity });
  const action = useResearchAction(project);
  const workspace = project.readOnly ? original.data : project.blueprint;
  if (project.readOnly && original.isPending) return <Loading />;
  if (project.readOnly && original.error) return <LoadError error={original.error} retry={() => void original.refetch()} />;
  if (!workspace) return <section className="panel"><h2 className="serif text-xl">建立故事蓝图</h2><p className="story-premise mt-4">蓝图把故事真相、人物和线索放在同一个底稿里。可以直接开始设计，未完成的部分会显示为待补充。</p>{project.template === "names-beyond" && <p className="field-hint mt-3">演示蓝图沿用《名字之外》已有内容，供编辑练习，不是根据你填写的题材新生成的剧本。</p>}<div className="flex flex-wrap gap-3 mt-5">{project.template === "names-beyond" && <Button disabled={action.isPending} onClick={() => action.mutate((revision) => service.initializeBlueprint(project.id, revision, "demo"))}>载入演示蓝图</Button>}<Button variant="outline" disabled={action.isPending} onClick={() => action.mutate((revision) => service.initializeBlueprint(project.id, revision, "blank"))}>建立空白蓝图</Button></div>{action.feedback}</section>;
  return <BlueprintEditor key={project.id} project={project} workspace={workspace} />;
}

function BlueprintEditor({ project, workspace }: { project: Project; workspace: BlueprintWorkspace }) {
  const service = useService();
  const action = useResearchAction(project);
  const { draft, change, saved } = useResearchDraft(workspace.draft);
  const [tab, setTab] = useState(0);
  const [focus, storeFocus] = useState<Focus>({ section: "overview" });
  function setFocus(next: Focus) { storeFocus((previous) => ({ ...next, ids: { ...previous.ids, [next.section]: next.id } })); }
  const [showIssues, setShowIssues] = useState(false);
  const [issueFilter, setIssueFilter] = useState("all");
  const [issuePage, setIssuePage] = useState(0);
  const [versionName, setVersionName] = useState("");
  const [preview, setPreview] = useState<BlueprintWorkspace["versions"][number] | null>(null);
  const [previewTab, setPreviewTab] = useState(0);
  const [previewFocus, storePreviewFocus] = useState<Focus>({ section: "overview" });
  function setPreviewFocus(next: Focus) { storePreviewFocus((previous) => ({ ...next, ids: { ...previous.ids, [next.section]: next.id } })); }
  const dirty = JSON.stringify(draft) !== JSON.stringify(workspace.draft);
  const lastVersion = workspace.versions.at(-1);
  const versionMatches = !!lastVersion && JSON.stringify(lastVersion.data) === JSON.stringify(draft);
  const busy = project.readOnly || action.isPending;
  const issues = checkBlueprint(draft);
  const filtered = issues.filter((issue) => issueFilter === "all" || issue.section === issueFilter);
  const shownPage = Math.min(issuePage, Math.max(0, Math.ceil(filtered.length / 20) - 1));
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  function edit(next: BlueprintData) { action.touch(); change(next); }
  function locate(issue: BlueprintIssue) {
    const next = issue.section === "overview" ? 0 : blueprintGroups.findIndex((group) => (group.sections as readonly string[]).includes(issue.section));
    setTab(Math.max(0, next)); setFocus({ section: issue.section, id: issue.recordId });
    requestAnimationFrame(() => document.getElementById(`blueprint-${issue.section}`)?.scrollIntoView({ block: "start" }));
  }
  return <div className="main-stack">
    <section className="panel" aria-label="蓝图保存与版本"><div className="panel-title"><h2>故事蓝图</h2><span>{project.readOnly ? "原始样例 · 只读" : dirty ? "有未保存修改" : `草稿修订 ${workspace.revision} · 已保存`}</span></div>
      <p className="field-hint">作者视角 · 含谜底。所有编辑属于原创方案；保存和建立版本不表示通过审查或真人试玩。</p>
      <p className="field-hint mt-2">{workspace.sourceLabel}</p>
      {project.readOnly ? <Link className="text-link" href="/projects/new">上传自己的剧本 →</Link> : <form id="blueprint-save-form" onSubmit={(event) => { event.preventDefault(); if (!busy) action.mutate((revision) => service.saveBlueprint(project.id, revision, draft), { onSuccess: saved }); }}><div className="flex flex-wrap gap-3 mt-4"><Button disabled={busy || !dirty}>{action.isPending ? "正在保存…" : "保存蓝图草稿"}</Button><Button type="button" variant="outline" onClick={() => setShowIssues(true)}>检查当前草稿（{issues.length}）</Button></div>{action.feedback}</form>}
      {project.readOnly && <Button className="mt-3" variant="outline" onClick={() => setShowIssues(true)}>查看结构缺口（{issues.length}）</Button>}
      {dirty && <p className="field-hint mt-3">切换本页分类会保留输入；离开设计故事页前请先保存。</p>}
      {project.research.direction && <p className="field-hint mt-3">方向目标 {project.research.direction.players} 人／{project.research.direction.minutes} 分钟；当前蓝图 {draft.characters.length} 位角色／{draft.rounds.reduce((sum, round) => sum + round.minutes, 0)} 分钟。方向设置不会自动改写人物或轮次。</p>}
    </section>
    <details className="archive-details" open={showIssues} onToggle={(event) => setShowIssues(event.currentTarget.open)}><summary>结构检查 · {issues.length} 项待处理</summary><div className="p-4 pt-0"><p className="field-hint">检查当前{dirty ? "未保存输入" : "蓝图草稿"}的必填项和关联。这里只验证编号、因果循环及线索获取条件是否填写，不判断文字推理是否成立，也不检测所有时间矛盾或信息泄漏；可前往“生成与检查”练习模拟双审。</p>{!issues.length ? <p role="status" className="success-message">本轮字段与关联检查未发现问题，仍需内容审查与真人试玩。</p> : <><label className="field-label mt-3">筛选问题<select className="plain-select ml-3" value={issueFilter} onChange={(event) => { setIssueFilter(event.target.value); setIssuePage(0); }}><option value="all">全部内容</option><option value="overview">故事真相</option>{Object.entries(sectionLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><ul className="blueprint-issues">{filtered.slice(shownPage * 20, shownPage * 20 + 20).map((issue) => <li key={issue.id}><span className={`tag ${issue.severity === "error" ? "amber" : "neutral"}`}>{issue.severity === "error" ? "待解决" : "建议补充"}</span><span>{issue.message}</span><Button size="sm" variant="outline" onClick={() => locate(issue)}>定位：{issue.section === "overview" ? "故事真相" : sectionLabels[issue.section]}</Button></li>)}</ul><div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={shownPage === 0} onClick={() => setIssuePage(shownPage - 1)}>问题上一页</Button><span className="field-hint">{shownPage + 1} / {Math.max(1, Math.ceil(filtered.length / 20))} 页</span><Button variant="outline" size="sm" disabled={(shownPage + 1) * 20 >= filtered.length} onClick={() => setIssuePage(shownPage + 1)}>问题下一页</Button></div></>}</div></details>
    <BlueprintSections data={draft} change={edit} disabled={busy} tab={tab} setTab={setTab} focus={focus} setFocus={setFocus} />
    <section className="panel" aria-label="蓝图版本"><div className="panel-title"><h2>版本与审查准备</h2><span>{versionMatches ? "当前内容与最新版本一致" : lastVersion ? "草稿与版本不同 · 待建立新版" : "尚未建立版本"}</span></div><p className="field-hint">版本是保存当时蓝图的独立副本，供后续审查和生成使用。最多保留20份；可以保留待修订版本，缺项不会因此变成已通过。</p>{!project.readOnly && <form className="mt-4" onSubmit={(event) => { event.preventDefault(); if (!busy && !dirty) action.mutate((revision) => service.publishBlueprintVersion(project.id, revision, versionName), { onSuccess: () => setVersionName("") }); }}><label className="field-label">版本名称<Input value={versionName} maxLength={80} placeholder="例如：第一次结构草稿" onChange={(event) => setVersionName(event.target.value)} disabled={busy} /></label><Button className="mt-3" disabled={busy || dirty || !versionName.trim()}>建立蓝图版本</Button>{dirty && <p className="field-hint">先保存当前修改，再建立版本。</p>}</form>}
      <div className="record-list">{[...workspace.versions].reverse().map((version) => <div className="record-item" key={version.id}><div><strong>{version.label}</strong><p className="field-hint">{new Date(version.createdAt).toLocaleString("zh-CN")} · {checkBlueprint(version.data).length} 项结构提示 · 未进行真实AI审查</p></div><Button variant="outline" size="sm" onClick={() => { setPreviewTab(0); setPreview(version); }}>查看版本：{version.label}</Button></div>)}</div>
      <p className="field-hint mt-4">下一步可进入“生成与检查”对所选版本模拟双审并生成正文；目前尚未调用真实模型。</p><Link className="text-link" href={`/projects/${project.id}/stages/review#blueprint-review-ready`}>进入蓝图审查准备 →</Link>
    </section>
    <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }}><DialogContent className="sm:max-w-4xl"><DialogTitle>历史蓝图：{preview?.label}</DialogTitle><DialogDescription>只读历史快照 · 含谜底。查看不会替换当前草稿，也不继承历史样例的检查结论。</DialogDescription>{preview && <BlueprintSections data={preview.data} change={() => undefined} disabled tab={previewTab} setTab={setPreviewTab} focus={previewFocus} setFocus={setPreviewFocus} />}</DialogContent></Dialog>
  </div>;
}

function BlueprintSections({ data, change, disabled, tab, setTab, focus, setFocus }: { data: BlueprintData; change: (data: BlueprintData) => void; disabled: boolean; tab: number; setTab: (tab: number) => void; focus: Focus; setFocus: (focus: Focus) => void }) {
  const formId = useId();
  return <><div className="view-switcher" aria-label="蓝图内容分类">{blueprintGroups.map((group, index) => <button key={group.name} type="button" aria-pressed={tab === index} onClick={() => setTab(index)}>{group.name}</button>)}</div>{tab === 0 ? <section className="panel" id="blueprint-overview" aria-label="故事真相编辑"><div className="panel-title"><h2>故事真相</h2><span>原创方案 · 作者可见</span></div><label className="field-label" htmlFor={`${formId}-premise`}>故事简介</label><Textarea id={`${formId}-premise`} rows={4} maxLength={12000} disabled={disabled} value={data.premise} onChange={(event) => change({ ...data, premise: event.target.value })} /><label className="field-label mt-5" htmlFor={`${formId}-truth`}>客观真相</label><Textarea id={`${formId}-truth`} rows={8} maxLength={12000} disabled={disabled} value={data.truth} onChange={(event) => change({ ...data, truth: event.target.value })} /><p className="field-hint">写真实发生的事情。不同角色的误解和隐瞒，请写在“信息与线索”中。</p></section> : <>{tab === 1 && <RelationshipMap data={data} />}{tab === 3 && <p className="field-hint">“谁在什么时候知道什么”就是知识矩阵。事件是真相依据，信息是玩家实际收到的内容；线索另行关联推理结论。</p>}{blueprintGroups[tab].sections.map((section) => <ArrayEditor key={section} section={section as BlueprintSection} data={data} change={change} disabled={disabled} focus={focus} setFocus={setFocus} />)}</>}</>;
}
