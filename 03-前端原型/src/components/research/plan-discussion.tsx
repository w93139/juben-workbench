"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/domain/models";
import { createFolderBlueprint } from "@/mocks/folder-blueprints";
import { folderPlanChoices } from "@/mocks/folder-plans";
import { folderPlanCurrent } from "@/domain/folder-plan";
import { useService } from "../providers";
import { useResearchAction, useResearchDraft } from "./common";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";

export function PlanDiscussion({ project }: { project: Project }) {
  const service = useService();
  const router = useRouter();
  const chat = useResearchAction(project);
  const save = useResearchAction(project);
  const choice = folderPlanChoices.find((item) => item.id === project.folderPlan?.selectedChoiceId)!;
  const value = project.folderPlan?.proposal ?? createFolderBlueprint(choice);
  const { draft, change, saved } = useResearchDraft(value);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  const current = folderPlanCurrent(project);
  const busy = chat.isPending || save.isPending || sending;
  return <section className="panel" aria-label="方案上下文对话" id="plan-discussion">
    <div className="panel-title"><h2>和主 Agent 商量创作方案</h2><span>上下文保存在本项目 · 模拟</span></div>
    <p className="field-hint">当前方向：{choice.title}。讨论会带上材料版本、已选方向和方案内容。当前使用预设回复，可编辑下方方案；真实大模型尚未接入。</p>
    <div className="conversation-log" role="log" aria-label="创作方案对话记录">{!project.folderPlan?.messages.length && <p className="conversation-message">主 Agent · 模拟：先说你想保留什么体验、改变什么冲突。我们先确定大纲与角色分工，再调整会影响全局的细节。</p>}{project.folderPlan?.messages.map((item) => <article key={item.id} className={`conversation-message ${item.role}`}><strong>{item.role === "user" ? "你" : "主 Agent · 模拟"}</strong><small>材料版本 {item.sourceRevision} · {folderPlanChoices.find((c) => c.id === item.choiceId)?.title ?? "历史方向"}</small><p className="whitespace-pre-wrap">{item.text}</p></article>)}</div>
    <form onSubmit={(event) => { event.preventDefault(); if (busy || !message.trim() || dirty) return; setSending(true); chat.mutate((revision) => service.sendFolderMessage(project.id, revision, message), { onSuccess: () => setMessage(""), onSettled: () => setSending(false) }); }}>
      <label className="field-label" htmlFor="plan-message">补充想法或提出修改</label><Textarea id="plan-message" maxLength={3000} value={message} onChange={(event) => { chat.touch(); setMessage(event.target.value); }} placeholder="例如：保留群像关系，但希望第二幕更紧凑，结尾留给玩家选择。" disabled={busy || !current} />
      <Button className="mt-3" disabled={busy || !current || !message.trim() || dirty}>{chat.isPending ? "正在保存对话…" : "发送并获取模拟建议"}</Button>{dirty && <p className="field-hint">先保存下方方案修改，再继续对话，确保讨论使用最新方案。</p>}{chat.feedback}
    </form>
    <div className="mt-6"><div className="panel-title"><h3>最终创作方案蓝图</h3><span>原创方案 · 暂定</span></div><p className="field-hint">大纲、核心真相、{draft.characters.length} 位角色分工、{draft.rounds.length} 轮节奏及关联线索组成同一份方案。这里先讨论整体，第三步再按需修改。方案来自通用模拟结构，不能作为原剧本拆解事实。</p>
      <label className="field-label mt-4" htmlFor="plan-outline">大纲与写作方向</label><Textarea id="plan-outline" rows={8} value={draft.premise} maxLength={12000} disabled={busy || !current} onChange={(event) => { save.touch(); change({ ...draft, premise: event.target.value }); }} />
      <label className="field-label mt-4" htmlFor="plan-truth">核心真相与因果</label><Textarea id="plan-truth" rows={4} value={draft.truth} maxLength={12000} disabled={busy || !current} onChange={(event) => { save.touch(); change({ ...draft, truth: event.target.value }); }} />
      <details className="archive-details mt-4"><summary>查看角色分工、节奏与关联范围</summary><div className="p-4"><ul>{draft.characters.map((character) => <li key={character.id}>{character.name} · {character.publicIdentity} · {character.goal}</li>)}</ul><ul className="mt-3">{draft.rounds.map((round) => <li key={round.id}>{round.name} · {round.minutes} 分钟 · {round.activity}</li>)}</ul><p className="field-hint mt-3">包含 {draft.relationships.length} 条关系、{draft.events.length} 段因果、{draft.clues.length} 条线索；细节为待完善的通用结构。</p></div></details>
      <div className="flex flex-wrap gap-3 mt-4"><Button variant="outline" disabled={busy || !current || !dirty || !draft.premise.trim() || !draft.truth.trim()} onClick={() => save.mutate((revision) => service.saveFolderProposal(project.id, revision, draft), { onSuccess: saved })}>保存方案修改</Button>{project.blueprint ? <Link className="button-link" href={`/projects/${project.id}/stages/blueprint`}>继续编辑故事草稿 →</Link> : <Button disabled={busy || !current || dirty} onClick={() => save.mutate((revision) => service.initializeFolderBlueprint(project.id, revision), { onSuccess: () => router.push(`/projects/${project.id}/stages/blueprint`) })}>采用大纲并进入设计故事</Button>}</div>
      {project.blueprint && <p className="field-hint">已有故事蓝图保持独立，下方讨论与方案修改不会覆盖它。请到第三步进行有影响提示的调整。</p>}{save.feedback}
    </div>
  </section>;
}
