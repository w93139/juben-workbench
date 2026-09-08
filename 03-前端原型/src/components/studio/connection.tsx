"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Settings2, Square } from "lucide-react";
import type { SafeStudioSettings } from "@/server/studio-settings";
import { evaluationViewSchema, priceLabel, type EvaluationView } from "@/domain/model-evaluation";
import { localJson } from "@/services/studio-client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ErrorMessage } from "../shared";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

const ANT_BASE_URL = "https://maas-api.antdigital.com/v1";
type Draft = Pick<SafeStudioSettings, "baseUrl" | "mainModel" | "reviewA" | "reviewB">;
const money = (fen: number) => `¥${(fen / 100).toFixed(2)}`;
async function fetchConnection(signal?: AbortSignal) {
  const [safe, view] = await Promise.all([
    localJson("/api/studio/settings", { signal }) as Promise<SafeStudioSettings>,
    localJson("/api/studio/evaluation", { signal }).then(evaluationViewSchema.parse),
  ]);
  return { safe, view };
}

export function StudioConnection() {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false); const [settings, setSettings] = useState<SafeStudioSettings | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationView | null>(null);
  const [draft, setDraft] = useState<Draft>({ baseUrl: ANT_BASE_URL, mainModel: "", reviewA: "", reviewB: "" });
  const [apiKey, setApiKey] = useState(""); const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);

  function applyConnection({ safe, view }: Awaited<ReturnType<typeof fetchConnection>>) {
    setSettings(safe); setDraft({ baseUrl: safe.baseUrl || ANT_BASE_URL, mainModel: safe.mainModel, reviewA: safe.reviewA, reviewB: safe.reviewB }); setEvaluation(view);
  }
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    void fetchConnection(abort.signal).then(applyConnection).catch(failure => { if (!abort.signal.aborted) setError(failure); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [open]);
  useEffect(() => {
    if (!open || !evaluation || !["running", "cancelling"].includes(evaluation.status)) return;
    const timer = window.setInterval(() => void localJson("/api/studio/evaluation").then(value => {
      const next = evaluationViewSchema.parse(value); setEvaluation(next);
      if (next.status === "completed") { void fetchConnection().then(applyConnection).catch(setError); void cache.invalidateQueries({ queryKey: ["studio-capability"] }); }
    }).catch(setError), 1200);
    return () => window.clearInterval(timer);
  }, [open, evaluation, cache]);

  const locked = loading || busy || settings?.environmentLocked === true || evaluation?.status === "running" || evaluation?.status === "cancelling";
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (locked || !settings) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const value: SafeStudioSettings = await localJson("/api/studio/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, mainModel: "", reviewA: "", reviewB: "", apiKey, revision: settings.revision }) });
      setApiKey(""); setSettings(value); setDraft({ baseUrl: value.baseUrl, mainModel: value.mainModel, reviewA: value.reviewA, reviewB: value.reviewB }); setSaved(true);
      await cache.invalidateQueries({ queryKey: ["studio-capability"] });
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  }
  async function action(value: "discover" | "start" | "cancel") {
    setBusy(true); setError(null); setSaved(false);
    try {
      const next = evaluationViewSchema.parse(await localJson("/api/studio/evaluation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: value }) }));
      setEvaluation(next);
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  }
  const roleName = (id: string) => evaluation?.candidates.find(candidate => candidate.id === id)?.displayName || id;

  return <>
    <Button size="sm" variant="outline" onClick={() => { setSettings(null); setEvaluation(null); setLoading(true); setError(null); setSaved(false); setApiKey(""); setOpen(true); }}><Settings2 size={15} />配置模型</Button>
    <Dialog open={open} onOpenChange={value => { if (busy) return; setOpen(value); if (!value) { setApiKey(""); setError(null); } }}><DialogContent className="sm:max-w-2xl"><DialogTitle>连接蚂蚁平台并自动选型</DialogTitle><DialogDescription>先保存连接，再读取候选模型。只有你点击“开始测评”后才会产生费用；工作台按平台公开价估算并保留安全余量。</DialogDescription>
      {loading ? <p role="status">正在读取连接设置…</p> : <div className="space-y-5">
        {settings?.environmentLocked && <p className="stage-callout">当前配置由服务端环境变量管理，页面只读。{!settings.configured && "环境变量尚不完整，请在服务端补齐。"}</p>}
        <form onSubmit={save} className="space-y-4 rounded-xl border border-[var(--border)] p-4">
          <div><p className="field-label">1 · 连接蚂蚁平台</p><p className="field-hint mt-1">保存连接不会调用模型，也不会产生模型费用。</p></div>
          <label className="field-label">服务器地址<Input aria-label="模型服务地址" className="mt-2" type="url" autoComplete="off" value={draft.baseUrl} maxLength={2048} disabled={locked} required onChange={event => { setDraft({ ...draft, baseUrl: event.target.value }); setSaved(false); }} /></label>
          <label className="field-label">API Key<Input aria-label="模型API密钥" className="mt-2" type="password" autoComplete="new-password" spellCheck={false} value={apiKey} maxLength={4096} disabled={locked} required={!settings?.hasApiKey} placeholder={settings?.hasApiKey ? "已安全保存；不更换时留空" : "粘贴蚂蚁平台创建的API Key"} onChange={event => { setApiKey(event.target.value); setSaved(false); }} /></label>
          <p className="field-hint">Key只保存在这台电脑的服务端受限文件中，不会返回页面、写入浏览器存储或上传GitHub。</p>
          {!settings?.environmentLocked && <Button type="submit" disabled={locked || !settings}>{busy ? "正在保存…" : settings?.providerConfigured ? "更新平台连接" : "保存平台连接"}</Button>}
          {saved && <p role="status" className="success-message">平台连接已保存。尚未调用模型，也未产生费用。</p>}
        </form>

        {settings?.configured && !evaluation?.allocation && <section className="rounded-xl border border-[var(--border)] p-4 text-sm"><p className="field-label">当前模型分配</p><p className="mt-2 break-all">主模型：{settings.mainModel}</p><p className="break-all">审查 A：{settings.reviewA}</p><p className="break-all">审查 B：{settings.reviewB}</p></section>}

        {settings?.providerConfigured && <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
          <div><p className="field-label">2 · 读取候选模型</p><p className="field-hint mt-1">读取当前Key可调用的文本模型，并与蚂蚁公开的人民币价格表核对。这一步不生成内容。</p></div>
          <Button type="button" variant="outline" disabled={locked || settings.configured && evaluation?.status === "completed"} onClick={() => void action("discover")}>{busy ? "正在读取…" : settings.configured && evaluation?.status === "completed" ? "本轮选型已完成" : evaluation?.candidates.length ? "重新读取候选模型" : "读取候选模型（免费）"}</Button>
          {!!evaluation?.candidates.length && <div className="grid gap-2 sm:grid-cols-2">{evaluation.candidates.map(candidate => <div className="rounded-lg bg-[var(--muted)] p-3 text-sm" key={candidate.id}><strong>{candidate.displayName}</strong><p className="field-hint mt-1 break-all">{candidate.id} · {candidate.provider}</p><p className="field-hint">输入 {priceLabel(candidate.inputPriceMicroCnyPerMillion)} · 输出 {priceLabel(candidate.outputPriceMicroCnyPerMillion)}</p></div>)}</div>}
        </section>}

        {evaluation?.status !== "idle" && evaluation?.candidates.length ? <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
          <div><p className="field-label">3 · 小样测评与自动分配</p><p className="field-hint mt-1">固定测试“结构拆解、原创方向、一致性审查”，不发送你的剧本；达到质量线后，同等表现优先费用更低的模型。最多{evaluation.maximumCalls}次短调用；按当前公开价加安全余量最多预留{money(evaluation.plannedMaximumFen)}，工作台估算限额{money(evaluation.budgetCapFen)}。</p></div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]"><div className="h-full bg-[#333333] transition-all" style={{ width: `${evaluation.maximumCalls ? evaluation.completedCalls / evaluation.maximumCalls * 100 : 0}%` }} /></div>
          <p role="status" className="text-sm">{evaluation.phase} · 已完成 {evaluation.completedCalls}/{evaluation.maximumCalls} · 已核算 {money(evaluation.spentFen)}{evaluation.uncertainFen ? ` · 待核对 ${money(evaluation.uncertainFen)}` : ""}</p>
          {evaluation.status === "discovered" && <Button type="button" disabled={busy} onClick={() => void action("start")}>开始受限测评</Button>}
          {evaluation.status === "running" && <Button type="button" variant="outline" disabled={busy} onClick={() => void action("cancel")}><Square size={14} />停止测评</Button>}
          {!!evaluation.scores.length && <div className="space-y-2">{evaluation.scores.map(score => <div className="rounded-lg bg-[var(--muted)] p-3 text-sm" key={score.modelId}><div className="flex items-center justify-between gap-3"><span className="break-all">{roleName(score.modelId)}</span><strong>{score.total}分 · {money(score.costFen)}</strong></div><p className="field-hint mt-1">结构 {score.structure} · 证据 {score.evidence} · 原创 {score.originality} · 格式 {score.format} · {(score.latencyMs / 1000).toFixed(1)}秒 · {score.promptTokens + score.completionTokens} Token</p><p className="field-hint mt-1">{score.notes.join("；")}</p></div>)}</div>}
          {evaluation.allocation && <div className="stage-callout"><strong>自动分配完成</strong><p className="mt-2">主模型：{roleName(evaluation.allocation.mainModel)}</p><p>审查 A：{roleName(evaluation.allocation.reviewA)}</p><p>审查 B：{roleName(evaluation.allocation.reviewB)}</p></div>}
          {evaluation.error && <p className="text-sm text-[var(--danger)]">{evaluation.error}</p>}
        </section> : null}
        <p className="stage-callout">公开价可能与最终账单口径不同，建议同时在蚂蚁平台设置账号侧消费限额。测评只代表固定小样表现；未经真人试玩的效果不会写成“已验证”。</p>
      </div>}
      {error != null && <ErrorMessage error={error} />}
    </DialogContent></Dialog>
  </>;
}
