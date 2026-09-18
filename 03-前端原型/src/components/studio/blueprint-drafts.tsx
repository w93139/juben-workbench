"use client";
import { useState } from "react";
import type { BlueprintDraft, WorkbenchState } from "@/domain/workbench";
import { deleteBlueprintDraft, readWorkbench } from "@/services/workbench-store";
import type { useBlueprintDraft } from "../hooks/use-blueprint-draft";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { ErrorMessage } from "../shared";
import type { BlueprintData } from "@/domain/blueprint";

export function blueprintText(data: BlueprintData) {
  return [data.premise, `真相：${data.truth}`,
    ...data.characters.map(c => `角色：${c.name}；身份：${c.publicIdentity}；目标：${c.goal}；秘密：${c.privateInformation}；选择：${c.choice}；贡献：${c.contribution}`),
    ...data.relationships.map(r => `关系（${r.fromId}→${r.toId}）：公开 ${r.publicVersion}；实际 ${r.truth}；后果 ${r.consequence}`),
    ...data.events.map(e => `事件（${e.id}）：${e.time} ${e.location} ${e.action}；前因 ${e.causes.join("、")}`),
    ...data.knowledge.map(k => `知情（${k.characterId}·${k.roundId}·${k.factId}）：${k.state} ${k.detail}`),
    ...data.claims.map(c => `结论（${c.id}）：${c.statement}；${c.required ? "必要" : "可选"}`),
    ...data.clues.map(c => `线索（${c.id}）：${c.name} ${c.content}；结论 ${c.supports.join("、")}；轮次 ${c.roundId}；角色 ${c.characterIds.join("、")}；成本 ${c.cost}；获取 ${c.access}`),
    ...data.rounds.map(r => `轮次（${r.id}）：${r.name} ${r.minutes}分钟；行动 ${r.activity}；揭示 ${r.reveal}`),
    ...data.triggers.map(t => `主持触发（${t.roundId}）：${t.condition} → ${t.action}；卡住时 ${t.fallback}`),
    ...data.endings.map(e => `结局：${e.name}；条件 ${e.condition}；选择 ${e.choice} → ${e.consequence}`),
  ].join("\n\n");
}

export function StudioBlueprintDrafts({ id, state, editor, disabled, onBusy }: { id: string; state: WorkbenchState; editor: ReturnType<typeof useBlueprintDraft>; disabled: boolean; onBusy: (value: boolean) => void }) {
  const [selection, setSelection] = useState<{ draft: BlueprintDraft; revision: number; blueprintRevision: number; blueprint: BlueprintData } | null>(null);
  const [deleting, setDeleting] = useState<BlueprintDraft | "active" | null>(null);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<unknown>) { setBusy(true); onBusy(true); setError(null); try { await fn(); } catch (failure) { setError(failure); } finally { setBusy(false); onBusy(false); } }
  async function restore(rebase: boolean) {
    if (!selection) return;
    const current = await readWorkbench(id);
    if (current.job || current.revision !== selection.revision || current.blueprintRevision !== selection.blueprintRevision || current.blueprintDrafts.find(d => d.id === selection.draft.id)?.revision !== selection.draft.revision) throw new Error("项目或草稿已变化，请关闭窗口，重新对照后恢复。");
    await editor.restore(selection.draft, rebase ? selection.revision : undefined, rebase ? selection.blueprintRevision : undefined);
    setSelection(null);
  }
  const locked = disabled || busy;
  return <section className="panel" aria-label="蓝图草稿">
    <div className="panel-title"><h2>蓝图草稿</h2><span role="status">{editor.activeId ? editor.status.error ? "草稿尚未保存成功" : editor.status.pending ? "正在保存草稿…" : editor.status.saved ? "草稿已在本机保存 · 尚未提交蓝图" : "草稿尚未保存" : "正在查看正式蓝图"}</span></div>
    {editor.status.actionError != null && <ErrorMessage error={editor.status.actionError} />}
    <p className="field-hint">编辑会自动保存为本页草稿；刷新后从下方恢复。正式提交后才更新蓝图和审查版本。最多保留12份。</p>
    {editor.status.error != null && <><ErrorMessage error={editor.status.error} /><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={locked} onClick={() => void act(async () => editor.flush())}>重试保存草稿</Button><Button variant="outline" disabled={locked} onClick={() => void act(editor.saveAsNew)}>另存为新草稿</Button></div><p className="field-hint">若原草稿已在另一页面变化或删除，可将当前输入另存；保留原基准，已有草稿不被覆盖。</p></>}
    {editor.activeId && <div className="flex flex-wrap gap-3 mt-3"><Button variant="outline" disabled={locked} onClick={() => void act(editor.leave)}>暂存并返回正式蓝图</Button><Button variant="outline" disabled={locked} onClick={() => setDeleting("active")}>放弃本页草稿</Button></div>}
    {!!state.blueprintDrafts.length && <details className="archive-details mt-4"><summary>查看已保存草稿（{state.blueprintDrafts.length}份）</summary><div className="record-list p-4">{state.blueprintDrafts.map(item => <article className="record-card" key={item.id}><p>{item.id === editor.activeId ? "本页草稿" : "保留的草稿"} · {new Date(item.updatedAt).toLocaleString()} · 基于蓝图版本 {item.baseBlueprintRevision}</p><p className="line-clamp-3 mt-2">{item.data.premise || "尚未填写大纲"}</p><div className="flex flex-wrap gap-3 mt-3"><Button variant="outline" disabled={locked || !!editor.activeId} onClick={() => { setError(null); setSelection({ draft: structuredClone(item), revision: state.revision, blueprintRevision: state.blueprintRevision, blueprint: structuredClone(state.blueprint!) }); }}>对照并恢复草稿</Button><Button variant="outline" disabled={locked || item.id === editor.activeId} onClick={() => setDeleting(item)}>删除此草稿</Button></div></article>)}</div></details>}
    {error != null && <ErrorMessage error={error} />}
    <Dialog open={!!selection} onOpenChange={open => { if (!busy && !open) setSelection(null); }}><DialogContent className="sm:max-w-3xl"><DialogTitle>对照并恢复草稿</DialogTitle><DialogDescription>恢复会创建一份独立草稿，保留原草稿；随后仍须预览并正式提交，不会自动调用模型。</DialogDescription>{selection && <><div className="comparison-grid"><div><h3>当前正式蓝图</h3><pre className="text-preview">{blueprintText(selection.blueprint)}</pre></div><div><h3>待恢复草稿</h3><pre className="text-preview">{blueprintText(selection.draft.data)}</pre></div></div>{selection.draft.baseRevision !== selection.revision && <p>这份草稿基于旧版本。直接恢复会保留原基准并阻止覆盖；如需替换当前蓝图，请核对上方差异后选择以当前版本继续编辑。</p>}<Button disabled={locked || !!editor.activeId} onClick={() => void act(() => restore(false))}>恢复草稿继续编辑</Button>{selection.draft.baseRevision !== selection.revision && <Button variant="outline" disabled={locked || !!editor.activeId} onClick={() => void act(() => restore(true))}>对照后以当前版本继续编辑</Button>}</>}{error != null && <ErrorMessage error={error} />}</DialogContent></Dialog>
    <Dialog open={!!deleting} onOpenChange={open => { if (!busy && !open) setDeleting(null); }}><DialogContent><DialogTitle>删除蓝图草稿</DialogTitle><DialogDescription>仅移除此份草稿，正式蓝图及其他草稿保留。删除后不能从草稿列表恢复。</DialogDescription><Button disabled={locked} onClick={() => void act(async () => { if (deleting === "active") await editor.discard(); else if (deleting) await deleteBlueprintDraft(id, deleting.id, deleting.revision); setDeleting(null); })}>确认删除草稿</Button>{error != null && <ErrorMessage error={error} />}</DialogContent></Dialog>
  </section>;
}
