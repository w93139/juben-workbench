"use client";

import Link from "next/link";
import { useState } from "react";
import { checkBlueprint } from "@/domain/blueprint";
import type { Project, DemoContent } from "@/domain/models";
import { moduleIds, moduleLabels, productionLimits, latestArtifacts, isReviewStale, type Artifact, type ReviewRun, type ReviewFinding } from "@/domain/production";
import { useService } from "../providers";
import { useResearchAction } from "../research/common";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { SourcePreview } from "../shared";

const statusLabels = { running: "正在模拟", completed: "模拟完成", failed: "模拟失败", cancelled: "已取消" };
const decisionLabels = { unhandled: "待处理", adopted: "采纳 · 待修改与复查", provisional: "暂定", rejected: "不采纳" };
const severityLabels = { error: "严重", warning: "注意", info: "建议" };
function running(project: Project) {
  return !!project.production?.jobs.some((job) => job.status === "running") || !!project.production?.reviews.some((run) => run.models.some((model) => model.status === "running"));
}

export function ProductionWorkbench({ project, content, reviewFirst = false }: { project: Project; content: DemoContent | null; reviewFirst?: boolean }) {
  const service = useService();
  const action = useResearchAction(project);
  const [tab, setTab] = useState(reviewFirst ? "review" : "generation");
  const [versionId, setVersionId] = useState("");
  const [target, setTarget] = useState<"blueprint" | "manuscript">("blueprint");
  const [failGeneration, setFailGeneration] = useState(false);
  const [failModel, setFailModel] = useState<"" | "model-a" | "model-b">("");
  const [selectedReview, setSelectedReview] = useState("");
  const [preview, setPreview] = useState<{ artifact: Artifact; suggestion?: string } | null>(null);
  const [audience, setAudience] = useState<"player" | "host">("player");
  const versions = project.blueprint?.versions ?? [];
  const version = versions.find((item) => item.id === versionId) ?? versions.at(-1);
  const production = project.production;
  const active = running(project);
  const busy = project.readOnly || action.isPending || active;
  const artifacts = latestArtifacts(production);
  const reviews = production?.reviews ?? [];
  const review = reviews.find((item) => item.id === selectedReview) ?? reviews.at(-1);
  const draftChanged = !!version && (version.id !== versions.at(-1)?.id || JSON.stringify(project.blueprint?.draft) !== JSON.stringify(version.data));
  const issues = version ? checkBlueprint(version.data) : [];
  const latestJob = production?.jobs.at(-1);

  return <div className="main-stack">
    <section className="panel" id="blueprint-review-ready" aria-label="生成与检查准备">
      <div className="panel-title"><h2>选择创作底稿</h2><span>本地模拟</span></div>
      <p className="story-premise">把蓝图整理为分角色、分轮次的正文草稿，再对照两份模拟意见修改。正文是模板整理，意见是预设练习，均未调用真实AI。</p>
      <p className="field-hint mt-3">作者工作区含谜底。输出只保存在此浏览器，尚未写入所选文件夹；项目打开时自动推进，刷新可继续。</p>
      {project.readOnly ? <p className="stage-callout mt-4">原始样例保留只读。<Link className="inline-link" href="/projects/new">上传自己的剧本</Link>，选择写作方向后建立蓝图版本，再进入此步骤。</p> : !version ? <p className="stage-callout mt-4">请先<Link className="inline-link" href={`/projects/${project.id}/stages/blueprint`}>进入设计故事</Link>，保存蓝图并建立一个版本。不必填完所有内容才能练习。</p> : <>
        <label className="field-label mt-4">本次使用的蓝图版本<select className="plain-select w-full mt-2" value={version.id} disabled={busy} onChange={(event) => setVersionId(event.target.value)}>{[...versions].reverse().map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        {draftChanged && <p className="stage-callout mt-3">当前草稿或最新版本已不同。本次仍使用选中的“{version.label}”；要使用最新内容，请返回设计故事保存并建立新版。</p>}
        <details className="archive-details mt-4"><summary>静态字段与关联检查：{issues.length} 项提示</summary><div className="p-4"><p className="field-hint">依据所选蓝图即时检查必填项、引用、因果循环及获取条件；不是AI语义审查，不保证推理、时间线或信息隔离正确。以下提示不拦住模拟生成。</p>{issues.length ? <ul className="list-disc pl-5 mt-3 space-y-2">{issues.slice(0, 10).map((issue) => <li key={issue.id}>{issue.message}</li>)}</ul> : <p className="success-message">字段与关联检查未发现问题，仍需内容审查与真人试玩。</p>}{issues.length > 10 && <p className="field-hint mt-3">其余 {issues.length - 10} 项可在设计故事中查看并定位。</p>}<Link className="text-link" href={`/projects/${project.id}/stages/blueprint`}>去设计故事修改 →</Link></div></details>
      </>}
    </section>
    <div className="view-switcher" aria-label="生成与检查分类"><button aria-pressed={tab === "generation"} onClick={() => setTab("generation")}>正文材料</button><button aria-pressed={tab === "review"} onClick={() => setTab("review")}>双模型检查</button></div>
    {tab === "generation" ? <>
      <section className="panel" aria-label="分模块生成"><div className="panel-title"><h2>分模块生成</h2><span>生成后可编辑、重新生成</span></div><p className="field-hint">只组织所选版本里已填写的内容。缺少的角色、轮次或发放条件会保留待补充；重新生成保留旧版。</p><div className="record-grid">{moduleIds.map((module) => <div className="record-card" key={module}><h3>{moduleLabels[module]}</h3><p className="field-hint mt-2">{artifacts.filter((artifact) => artifact.module === module).length} 份最新材料</p><Button className="mt-4" variant="outline" disabled={busy || !version} onClick={() => action.mutate((revision) => service.startGeneration(project.id, revision, module, version!.id, failGeneration))}>模拟生成{moduleLabels[module]}</Button></div>)}</div>
      <details className="mt-4"><summary className="field-hint">演示选项</summary><label className="flex items-center gap-2 mt-3"><input type="checkbox" checked={failGeneration} onChange={(event) => setFailGeneration(event.target.checked)} disabled={busy} />让下一次生成模拟失败，练习重试</label></details>{action.feedback}</section>
      {latestJob && <section className="panel" aria-label="正文生成任务"><div className="panel-title"><h2>{moduleLabels[latestJob.module]} · {statusLabels[latestJob.status]}</h2><span>蓝图：{versions.find((item) => item.id === latestJob.blueprintVersionId)?.label}</span></div><p role="status">{latestJob.status === "running" ? "正在按受众整理模板并保存材料，请稍候…" : latestJob.status === "completed" ? `已保存 ${latestJob.artifactIds.length} 份材料。可在下方预览和编辑。` : latestJob.error || "本次任务已取消，已有材料保持不变。"}</p><div className="flex flex-wrap gap-3 mt-4">{latestJob.status === "running" ? <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate((revision) => service.cancelGeneration(project.id, revision, latestJob.id))}>取消本次生成</Button> : ["failed", "cancelled"].includes(latestJob.status) ? <Button disabled={busy} onClick={() => action.mutate((revision) => service.retryGeneration(project.id, revision, latestJob.id))}>重试本次生成</Button> : null}</div></section>}
      <section className="panel" aria-label="正文材料预览"><div className="panel-title"><h2>已保存正文</h2><span>每份材料独立保留历史</span></div><div className="view-switcher mt-3" aria-label="正文受众"><button aria-pressed={audience === "player"} onClick={() => setAudience("player")}>玩家材料</button><button aria-pressed={audience === "host"} onClick={() => setAudience("host")}>主持材料 · 含谜底</button></div><p className="field-hint mt-3">{audience === "host" ? "剧透提醒：主持真相、触发条件和终局材料只在此分区展示，不能直接发给玩家。" : "角色、私人信息和阶段更新逐份分开。公共线索只使用已设置轮次与获取条件的公开线索；发放前仍需作者检查文字。"}</p>
        {!artifacts.some((artifact) => artifact.audience === audience) ? <p className="empty-state">这个分区还没有正文，请先生成相应模块。</p> : <div className="record-list">{artifacts.filter((artifact) => artifact.audience === audience).map((artifact) => <div className="record-item flex-wrap" key={artifact.id}><div className="min-w-0 flex-1"><strong>{artifact.title}</strong><p className="field-hint">{moduleLabels[artifact.module]} · 第 {artifact.version} 版 · {artifact.origin === "mock" ? "模板模拟" : "作者修改"}</p><p className="field-hint">蓝图：{versions.find((item) => item.id === artifact.blueprintVersionId)?.label ?? "历史版本"}{artifact.blueprintVersionId !== versions.at(-1)?.id || JSON.stringify(versions.find((item) => item.id === artifact.blueprintVersionId)?.data) !== JSON.stringify(project.blueprint?.draft) ? " · 蓝图已变化，需更新材料" : ""}</p></div><Button size="sm" variant="outline" onClick={() => setPreview({ artifact })}>预览与编辑：{artifact.title}</Button></div>)}</div>}
        {!!production?.artifacts.length && <details className="mt-5"><summary>查看正文历史版本</summary><p className="field-hint mt-3">按上方玩家／主持分区显示。历史版本只读。</p><div className="record-list">{[...production.artifacts].reverse().filter((artifact) => artifact.audience === audience && !artifacts.some((current) => current.id === artifact.id)).map((artifact) => <div className="record-item" key={artifact.id}><span>{artifact.title} · 第 {artifact.version} 版</span><Button size="sm" variant="outline" onClick={() => setPreview({ artifact })}>查看历史：{artifact.title} 第 {artifact.version} 版</Button></div>)}</div></details>}
      </section>
    </> : <>
      <section className="panel" aria-label="发起模拟审查"><div className="panel-title"><h2>模拟双模型审查</h2><span>预设意见练习</span></div><p className="field-hint">两侧分别模拟检查同一份资料，再比较共同问题和分歧。两侧一致不等于事实正确；不会继承《名字之外》的历史通过结论。</p><label className="field-label mt-4">检查什么<select className="plain-select w-full mt-2" aria-label="检查什么" value={target} disabled={busy} onChange={(event) => setTarget(event.target.value as typeof target)}><option value="blueprint">所选蓝图版本</option><option value="manuscript">所选蓝图对应的已生成正文</option></select></label><Button className="mt-4" disabled={busy || !version} onClick={() => action.mutate((revision) => service.startReview(project.id, revision, target, version!.id, failModel || undefined), { onSuccess: () => setSelectedReview("") })}>{reviews.length ? "发起新一轮模拟复查" : "开始模拟双审"}</Button><p className="field-hint mt-3">正文审查固定当前材料版本清单，未生成的模块不会被当作已审查。修改后请另开一轮复查。</p><details className="mt-3"><summary className="field-hint">演示选项</summary><label className="field-label mt-3">模拟单侧失败<select className="plain-select w-full mt-2" disabled={busy} value={failModel} onChange={(event) => setFailModel(event.target.value as typeof failModel)}><option value="">两侧正常完成</option><option value="model-a">审查者 A 失败</option><option value="model-b">审查者 B 失败</option></select></label></details>{action.feedback}</section>
      {!!reviews.length && <label className="field-label">查看审查记录<select className="plain-select w-full mt-2" value={review?.id ?? ""} onChange={(event) => setSelectedReview(event.target.value)}>{[...reviews].reverse().map((run, index) => <option key={run.id} value={run.id}>第 {reviews.length - index} 次 · {run.target === "blueprint" ? "蓝图" : "正文"} · {versions.find((item) => item.id === run.blueprintVersionId)?.label}{isReviewStale(project, run) ? " · 需要复查" : ""}</option>)}</select></label>}
      {review && <ReviewPanel key={review.id} project={project} review={review} openArtifact={(artifact, suggestion) => setPreview({ artifact, suggestion })} />}
      <section className="panel"><h2>各类检查分别记录</h2><p className="field-hint mt-3">AI结构审查：本次仅模拟，未调用模型。静态检查：仅字段与关联。模拟测试：尚未执行玩家行为模拟。真人试玩：尚未记录。任何一项都不能替代另一项。</p>{content?.documents.filter((document) => document.id === "review").map((document) => <SourcePreview key={document.id} document={document} />)}</section>
    </>}
    <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }}><DialogContent className="sm:max-w-4xl"><DialogTitle>{preview?.artifact.title}</DialogTitle><DialogDescription>作者预览 · {preview?.artifact.audience === "host" ? "主持材料含谜底，请勿发给玩家。" : "只向这份材料指定的玩家及轮次发放。"} 保存编辑会新建版本。</DialogDescription>{preview && <ArtifactEditor key={preview.artifact.id} project={project} artifact={preview.artifact} suggestion={preview.suggestion} close={() => setPreview(null)} />}</DialogContent></Dialog>
  </div>;
}

function ArtifactEditor({ project, artifact, suggestion, close }: { project: Project; artifact: Artifact; suggestion?: string; close: () => void }) {
  const service = useService();
  const action = useResearchAction(project);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(artifact.content);
  const [confirm, setConfirm] = useState(false);
  const current = latestArtifacts(project.production).some((item) => item.id === artifact.id);
  const disabled = project.readOnly || action.isPending || running(project) || !current;
  return <><p className="field-hint">第 {artifact.version} 版 · {current ? "最新材料" : "历史快照，只读"} · {artifact.origin === "mock" ? "模板模拟" : "作者修改"}</p>{suggestion && <div className="stage-callout"><strong>建议预览</strong><p>{suggestion}</p><p className="field-hint mt-2">请结合证据自行修改下方正文。保存只建立新版，不自动认定建议已解决。</p></div>}<p className="field-hint output-path">计划目录：{artifact.plannedPath || "未设置"}（尚未写出文件）</p>
    {!editing ? <><pre className="production-text">{artifact.content}</pre><Button variant="outline" disabled={disabled} onClick={() => setEditing(true)}>编辑这份正文</Button></> : <><label className="field-label">正文内容<Textarea className="mt-2" rows={12} maxLength={productionLimits.content} aria-label="正文内容" value={text} disabled={disabled} onChange={(event) => { action.touch(); setText(event.target.value); setConfirm(false); }} /></label><p className="field-hint">保存前检查材料受众，避免把其他角色秘密或主持谜底写入玩家正文。离开弹窗前请保存，未保存输入不会进入版本。</p>{confirm ? <div className="stage-callout"><strong>即将建立第 {artifact.version + 1} 版</strong><p>仅修改“{artifact.title}”；旧版和它的审查结果保留，新正文需要复查。</p><details className="mt-3"><summary>修改前</summary><pre className="production-text">{artifact.content}</pre></details><details className="mt-3" open><summary>修改后</summary><pre className="production-text">{text}</pre></details><Button className="mt-3" disabled={disabled} onClick={() => action.mutate((revision) => service.saveArtifact(project.id, revision, artifact.id, text), { onSuccess: close })}>确认保存为新版</Button></div> : <Button disabled={disabled || text === artifact.content || !text.trim()} onClick={() => setConfirm(true)}>预览本次修改</Button>}{action.feedback}</>}
  </>;
}

function ReviewPanel({ project, review, openArtifact }: { project: Project; review: ReviewRun; openArtifact: (artifact: Artifact, suggestion?: string) => void }) {
  const service = useService();
  const action = useResearchAction(project);
  const stale = isReviewStale(project, review);
  const complete = review.models.every((model) => model.status === "completed");
  return <section className="panel" aria-label="模拟审查结果"><div className="panel-title"><h2>{review.target === "blueprint" ? "蓝图" : "正文"}模拟意见</h2><span>{stale ? "需要复查" : complete ? "模拟意见已汇总 · 待作者处理" : "部分结果或进行中"}</span></div><p className="field-hint">固定蓝图版本：{project.blueprint?.versions.find((version) => version.id === review.blueprintVersionId)?.label} · 规则：工作台字段规则与预设意见 v1，未运行你的Skill或真实模型。</p>{stale && <p className="stage-callout mt-3">资料已改变，以下仅适用于当时快照，不能作为当前版本结论。请使用最新版本另开一轮复查。</p>}
    <p className="field-hint output-path mt-2">本次审查计划目录：{review.plannedPath || "未设置"}（仅记录，尚未写出文件）</p>
    {review.target === "manuscript" && <details className="mt-3"><summary>本次审查材料清单（{review.artifactIds.length}份）</summary><div className="flex flex-wrap gap-2 mt-3">{review.artifactIds.map((id) => { const artifact = project.production?.artifacts.find((item) => item.id === id); return artifact ? <Button key={id} size="sm" variant="outline" onClick={() => openArtifact(artifact)}>{artifact.title} · 第 {artifact.version} 版</Button> : <span key={id}>历史材料已缺失</span>; })}</div></details>}
    <div className="record-grid">{review.models.map((model) => <div className="record-card" key={model.id}><h3>{model.label}</h3><p role="status" className="mt-2">{statusLabels[model.status]}</p>{model.error && <p className="field-hint mt-2">{model.error}</p>}<p className="field-hint mt-2">模拟数据 · 未调用模型，无实际用量或费用</p>{model.status === "running" ? <Button variant="outline" size="sm" className="mt-3" disabled={action.isPending || project.readOnly} onClick={() => action.mutate((revision) => service.cancelReviewModel(project.id, revision, review.id, model.id))}>取消{model.id === "model-a" ? "审查者 A" : "审查者 B"}</Button> : ["failed", "cancelled"].includes(model.status) ? <Button variant="outline" size="sm" className="mt-3" disabled={action.isPending || running(project) || project.readOnly} onClick={() => action.mutate((revision) => service.retryReviewModel(project.id, revision, review.id, model.id))}>重试{model.id === "model-a" ? "审查者 A" : "审查者 B"}</Button> : null}</div>)}</div>
    <p className="field-hint mt-3">当时的静态字段与关联提示：{review.staticIssues.length} 项。这些提示与下方预设模型意见分别记录。</p>
    {complete && <><Button className="mt-3" variant="outline" disabled={review.crossReviewDone || action.isPending || running(project) || project.readOnly} onClick={() => action.mutate((revision) => service.crossReview(project.id, revision, review.id))}>{review.crossReviewDone ? "已完成一次模拟互审" : "比较分歧（模拟一次互审）"}</Button>{review.crossReviewDone && <p className="field-hint mt-3">互审到此结束。仍有分歧的部分交由作者判断，不重复循环，也不把一致意见变成已验证。</p>}</>}{action.feedback}
    {!review.findings.length ? <p className="empty-state">尚未收到模拟意见。已完成的一侧会保留结果。</p> : <div className="main-stack mt-5">{review.findings.map((finding) => <FindingCard key={finding.id} project={project} review={review} finding={finding} openArtifact={openArtifact} />)}</div>}
  </section>;
}

function FindingCard({ project, review, finding, openArtifact }: { project: Project; review: ReviewRun; finding: ReviewFinding; openArtifact: (artifact: Artifact, suggestion?: string) => void }) {
  const service = useService();
  const action = useResearchAction(project);
  const [draft, setDraft] = useState<{ decision: "adopted" | "provisional" | "rejected"; reason: string } | null>(null);
  const decision = draft?.decision ?? (finding.decision === "unhandled" ? "provisional" : finding.decision);
  const reason = draft?.reason ?? finding.reason;
  const artifact = project.production?.artifacts.find((item) => item.id === finding.evidence.artifactId);
  const disabled = project.readOnly || running(project) || action.isPending;
  const bothComplete = review.models.every((model) => model.status === "completed");
  return <article className="record-card" aria-label={`审查问题：${finding.title}`}><div className="flex flex-wrap gap-2 mb-3"><span className="tag amber">{severityLabels[finding.severity]}</span><span className="tag neutral">{!bothComplete ? "单侧意见 · 尚未完成比较" : finding.agreement === "consensus" ? "共同关注" : "存在分歧"}</span><span className="tag">{decisionLabels[finding.decision]}</span></div><h3 className="font-medium">{finding.title}</h3><p className="field-hint mt-2">{finding.category} · 证据位置：{finding.evidence.location}</p><blockquote className="production-evidence mt-3">{finding.evidence.excerpt || "此位置尚未填写内容"}</blockquote><div className="record-grid">{finding.modelOpinions.map((opinion) => <div className="record-card" key={opinion.modelId}><strong>{opinion.modelId === "model-a" ? "审查者 A" : "审查者 B"}</strong><p className="story-premise mt-2">{opinion.opinion}</p></div>)}</div><p className="story-premise mt-3"><strong>修改建议：</strong>{finding.suggestion}</p><div className="flex flex-wrap gap-3 mt-3">{artifact ? <Button size="sm" variant="outline" onClick={() => openArtifact(artifact, finding.suggestion)}>预览建议与对应正文</Button> : <Link className="text-link" href={`/projects/${project.id}/stages/blueprint`}>去设计故事核对并修改 →</Link>}</div>
    <div className="production-decision mt-4"><label className="field-label">这条建议怎么处理<select className="plain-select w-full mt-2" disabled={disabled} value={decision} onChange={(event) => { action.touch(); setDraft({ decision: event.target.value as typeof decision, reason }); }}><option value="provisional">暂定，再考虑</option><option value="adopted">采纳，准备修改</option><option value="rejected">不采纳</option></select></label><label className="field-label mt-3">处理理由<Textarea rows={2} maxLength={3000} aria-label="处理理由" value={reason} disabled={disabled} onChange={(event) => { action.touch(); setDraft({ decision, reason: event.target.value }); }} placeholder="例如：先补充角色获取这条信息的条件，再检查一次。" /></label><Button size="sm" className="mt-3" disabled={disabled || !reason.trim()} onClick={() => action.mutate((revision) => service.decideReviewFinding(project.id, revision, review.id, finding.id, decision, reason), { onSuccess: () => setDraft(null) })}>保存处理决定</Button><p className="field-hint mt-2">采纳仅记录你的决定；需实际修改并复查，不会自动标记问题已解决。</p>{action.feedback}</div>
  </article>;
}
