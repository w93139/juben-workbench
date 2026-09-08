"use client";

import Link from "next/link";
import { useState } from "react";
import type { Project } from "@/domain/models";
import { hasRunningProduction, isReviewStale, type Artifact, type ReviewDecision, type ReviewProposal, type ReviewRun } from "@/domain/production";
import { useService } from "../providers";
import { useResearchAction } from "../research/common";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

const choiceLabels = { unhandled: "待选择", adopted: "已采纳 · 待修改与复查", provisional: "暂定", rejected: "不采纳" };

export function ReviewCoordinator({ project, review, openArtifact }: { project: Project; review: ReviewRun; openArtifact: (artifact: Artifact, suggestion?: string) => void }) {
  const service = useService();
  const action = useResearchAction(project);
  const [selection, setSelected] = useState("");
  const selected = review.findings.some(item => item.id === selection) ? selection : review.findings[0]?.id ?? "";
  const [message, setMessage] = useState("");
  const coordination = review.coordination;
  const stale = isReviewStale(project, review);
  const disabled = project.readOnly || stale || action.isPending || hasRunningProduction(project.production);
  const finding = review.findings.find((item) => item.id === selected);
  return <section className="record-card mt-5" aria-label="主Agent核对与修订讨论">
    <h3 className="font-medium">主 Agent 核对与修订讨论</h3>
    <p className="field-hint mt-2">两路独立检查 → 相互复核 → 主 Agent 按证据整理 → 你选择修订方案。当前全部为本地模拟，未调用模型。</p>
    {!coordination ? <p className="stage-callout mt-3">{review.crossReviewDone ? "这是旧版互审记录，未记录主 Agent 上下文。历史意见保留，请发起新一轮模拟复查体验讨论。" : "完成两路独审并点击上方“比较分歧”后，在这里查看主 Agent 核对并讨论修改。"}</p> : <>
      <p className="story-premise mt-3">{coordination.summary}</p>
      <details className="archive-details mt-4"><summary>查看两路相互复核结果</summary><div className="p-4 space-y-3">{coordination.mutualChecks.map((item) => <article key={`${item.modelId}:${item.findingId}`}><strong>{item.modelId === "model-a" ? "审查者 A 复核 B" : "审查者 B 复核 A"} · {review.findings.find((finding) => finding.id === item.findingId)?.title}</strong><p>{item.conclusion}</p></article>)}</div></details>
      <div className="record-list mt-3">{coordination.checks.map((item) => <div className="record-card" key={item.findingId}><strong>{review.findings.find((finding) => finding.id === item.findingId)?.title}</strong><p className="field-hint">{item.outcome === "human-test" ? "待真人试玩" : "待作者核对证据"}</p><p>{item.rationale}</p></div>)}</div>
      {stale && <p className="stage-callout mt-3">这次审查的资料已变化。对话与方案只读保留，请发起新一轮复查后继续修改。</p>}
      <label className="field-label mt-4">围绕哪个问题讨论<select className="plain-select w-full mt-2" aria-label="讨论的问题" value={selected} onChange={(event) => setSelected(event.target.value)}>{review.findings.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      {finding && <div className="stage-callout mt-3"><strong>本次对话的资料上下文</strong><p className="field-hint">{finding.evidence.location}</p><blockquote className="production-evidence mt-2">{finding.evidence.excerpt || "该处尚未填写内容"}</blockquote><p className="field-hint">仅引用本轮审查快照，不补造上传文件的事实。</p></div>}
      <div className="mt-4 space-y-3" aria-label="修订对话记录">{coordination.messages.filter((item) => item.findingId === selected).map((item) => <article className="record-card" key={item.id}><strong>{item.role === "author" ? "你的想法" : "主 Agent · 模拟回复"}</strong><p className="whitespace-pre-wrap mt-2">{item.content}</p></article>)}</div>
      <form className="mt-4" onSubmit={(event) => { event.preventDefault(); if (finding && !disabled) action.mutate((revision) => service.sendReviewMessage(project.id, revision, review.id, finding.id, message), { onSuccess: () => setMessage("") }); }}>
        <label className="field-label">告诉主 Agent 你的修改想法<Textarea aria-label="修订讨论输入" className="mt-2" rows={3} maxLength={2000} value={message} disabled={disabled} onChange={(event) => { action.touch(); setMessage(event.target.value); }} placeholder="例如：先保留现有线索，把提示改为卡住后由主持触发。" /></label>
        <Button className="mt-3" disabled={disabled || !finding || !message.trim()}>发送并生成修订方案（模拟）</Button>{action.feedback}
      </form>
      <div className="main-stack mt-5">{[...coordination.proposals].reverse().filter((item) => item.findingId === selected).map((proposal) => <ProposalEditor key={proposal.id} project={project} review={review} proposal={proposal} openArtifact={openArtifact} />)}</div>
    </>}
  </section>;
}

function ProposalEditor({ project, review, proposal, openArtifact }: { project: Project; review: ReviewRun; proposal: ReviewProposal; openArtifact: (artifact: Artifact, suggestion?: string) => void }) {
  const service = useService(); const action = useResearchAction(project);
  const [draft, setDraft] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ decision: ReviewDecision; reason: string } | null>(null);
  const value = draft ?? proposal.content;
  const decision = selection?.decision ?? (proposal.decision === "unhandled" ? "provisional" : proposal.decision);
  const reason = selection?.reason ?? proposal.reason;
  const dirty = value !== proposal.content;
  const disabled = project.readOnly || isReviewStale(project, review) || action.isPending || hasRunningProduction(project.production);
  const finding = review.findings.find((item) => item.id === proposal.findingId);
  const artifact = project.production?.artifacts.find((item) => item.id === finding?.evidence.artifactId);
  return <article className="record-card" aria-label="可编辑修订方案"><div className="panel-title"><h4>修订方案 · 第 {proposal.revision} 版</h4><span>{choiceLabels[proposal.decision]}</span></div>
    <label className="field-label mt-3">修改方案内容<Textarea aria-label="修订方案内容" rows={8} className="mt-2" maxLength={6000} disabled={disabled} value={value} onChange={(event) => { action.touch(); setDraft(event.target.value); }} /></label>
    <Button variant="outline" size="sm" className="mt-3" disabled={disabled || !dirty || !value.trim()} onClick={() => action.mutate((revision) => service.saveReviewProposal(project.id, revision, review.id, proposal.id, value), { onSuccess: () => { setDraft(null); setSelection(null); } })}>保存修订方案</Button>
    {dirty && <p className="field-hint mt-2">请先保存修改，再选择如何处理。修改方案会保留旧版，并需要重新选择。</p>}
    <div className="research-form-grid mt-4"><label className="field-label">如何处理这个方案<select className="plain-select w-full mt-2" aria-label="修订方案选择" value={decision} disabled={disabled || dirty} onChange={(event) => { action.touch(); setSelection({ decision: event.target.value as ReviewDecision, reason }); }}><option value="adopted">采纳，准备修改</option><option value="provisional">暂定，再考虑</option><option value="rejected">不采纳</option></select></label><label className="field-label">选择理由<Textarea aria-label="修订方案选择理由" rows={2} className="mt-2" maxLength={3000} disabled={disabled || dirty} value={reason} onChange={(event) => { action.touch(); setSelection({ decision, reason: event.target.value }); }} /></label></div>
    <Button size="sm" className="mt-3" disabled={disabled || dirty || !reason.trim()} onClick={() => action.mutate((revision) => service.decideReviewProposal(project.id, revision, review.id, proposal.id, decision, reason), { onSuccess: () => setSelection(null) })}>保存方案选择</Button>
    <p className="field-hint mt-2">采纳只记录决定，不会自动改写剧本或认定问题已解决。保存剧本新版后需要复查。</p>
    {proposal.decision === "adopted" && !dirty && <div className="mt-3">{artifact ? <Button variant="outline" size="sm" onClick={() => openArtifact(artifact, proposal.content)}>按方案打开对应正文</Button> : <Link className="text-link" href={`/projects/${project.id}/stages/blueprint`}>带着方案去修改故事 →</Link>}</div>}
    {!!proposal.history.length && <details className="archive-details mt-3"><summary>查看此方案旧版本（{proposal.history.length}）</summary>{[...proposal.history].reverse().map((item) => <div className="p-4" key={item.revision}><strong>第 {item.revision} 版 · {choiceLabels[item.decision]}</strong><pre className="production-text">{item.content}</pre><p>{item.reason}</p></div>)}</details>}{action.feedback}
  </article>;
}
