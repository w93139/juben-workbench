"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parseYuanInput, type StudioBudget, type StudioCharge, type StudioQuote } from "@/domain/studio-budget";
import { readStudioBudget, reconcileStudioCharge, refreshStudioPrices, saveStudioBudget } from "@/services/studio-budget-client";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { ErrorMessage } from "../shared";

export const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;
export function useStudioBudget(projectId: string, offset = 0) {
  return useQuery({ queryKey: ["studio-budget", projectId, offset], queryFn: ({ signal }) => readStudioBudget(projectId, offset, signal), retry: false, refetchInterval: 5000,
    structuralSharing: (oldData, newData) => {
      const old = oldData as StudioBudget | null | undefined, next = newData as StudioBudget | null;
      return old && next && old.projectId === next.projectId && old.ledgerRevision > next.ledgerRevision ? old : next;
    },
  });
}
export function QuoteList({ quotes }: { quotes: StudioQuote[] }) {
  return <ul className="space-y-2 text-sm">{quotes.map(quote => {
    const off = quote.offPeakInputPriceMicroCnyPerMillion != null && quote.offPeakOutputPriceMicroCnyPerMillion != null && (quote.offPeakInputPriceMicroCnyPerMillion !== quote.inputPriceMicroCnyPerMillion || quote.offPeakOutputPriceMicroCnyPerMillion !== quote.outputPriceMicroCnyPerMillion);
    return <li key={quote.modelId} className="break-all">{quote.modelId}：{off
      ? `闲时 输入 ¥${quote.offPeakInputPriceMicroCnyPerMillion! / 1_000_000}、输出 ¥${quote.offPeakOutputPriceMicroCnyPerMillion! / 1_000_000}；忙时 输入 ¥${quote.inputPriceMicroCnyPerMillion / 1_000_000}、输出 ¥${quote.outputPriceMicroCnyPerMillion / 1_000_000}（预留按忙时，实际按用量结算）`
      : `输入 ¥${quote.inputPriceMicroCnyPerMillion / 1_000_000}、输出 ¥${quote.outputPriceMicroCnyPerMillion / 1_000_000}`}。有效至 {new Date(quote.expiresAt).toLocaleTimeString()}。</li>;
  })}</ul>;
}
const labels: Record<StudioCharge["state"], string> = { prepared: "已预留未发送", dispatched: "调用中", settled: "按用量核算", uncertain: "待核对", reconciled: "已核对账单", released: "未发送已释放" };
export function StudioBudgetPanel({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange(open: boolean): void }) {
  const cache = useQueryClient(); const [offset, setOffset] = useState(0); const query = useStudioBudget(projectId, offset);
  const [draft, setDraft] = useState<{ text: string; revision: number } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const [quotes, setQuotes] = useState<StudioQuote[]>([]);
  const [charge, setCharge] = useState<StudioCharge | null>(null), [amount, setAmount] = useState(""), [note, setNote] = useState("");
  const [chargeError, setChargeError] = useState<unknown>(null);
  const budget = query.data;
  const refresh = () => cache.invalidateQueries({ queryKey: ["studio-budget", projectId] });
  async function save() {
    if (!draft || busy) return;
    const capFen = parseYuanInput(draft.text); if (capFen === null) { setError(new Error("请填写非负金额，最多两位小数。")); return; }
    setBusy(true); setError(null);
    try { await saveStudioBudget(projectId, capFen, draft.revision); setDraft(null); await refresh(); }
    catch (error) { setError(error); await refresh(); } finally { setBusy(false); }
  }
  async function reconcile() {
    if (!charge || busy) return;
    setChargeError(null);
    const actualFen = parseYuanInput(amount);
    if (actualFen === null || !note.trim()) { setChargeError(new Error("请根据供应商账单填写实际金额及核对依据；空白不代表零元。")); return; }
    setBusy(true); setError(null);
    try { await reconcileStudioCharge(projectId, charge.callId, charge.version, actualFen, note); setCharge(null); setAmount(""); setNote(""); await refresh(); }
    catch (error) { setChargeError(error); await refresh(); } finally { setBusy(false); }
  }
  const reconcileForm = charge && <section className="grid gap-3 rounded border p-3" aria-label="核对待定费用"><h3>核对待定费用</h3>{chargeError != null && <ErrorMessage error={chargeError} />}<p className="text-sm">{charge.model} · {charge.phase} · 原预留 {yuan(charge.reservedFen)}</p><label>账单实际金额（元）<input className="mt-1 w-full rounded border p-2" disabled={busy} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label><label>核对依据<textarea className="mt-1 w-full rounded border p-2" disabled={busy} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label><p className="text-sm">只有确认未扣费时才填写0。此操作不会重试模型。</p><Button disabled={busy} onClick={() => void reconcile()}>保存核对金额</Button><Button variant="outline" disabled={busy} onClick={() => { setCharge(null); setChargeError(null); }}>取消核对</Button></section>;
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent><DialogTitle>项目创作预算</DialogTitle><DialogDescription>额度累计覆盖拆解、蓝图、正文和审查，重试不清账。浏览器备份不包含本机费用账本。</DialogDescription>
    {query.error && <ErrorMessage error={query.error} />}{error != null && <ErrorMessage error={error} />}
    {query.isPending ? <p>正在读取费用记录…</p> : <>
      <label className="grid gap-2">累计额度（元）<input className="w-full rounded border p-2" inputMode="decimal" disabled={busy || !!query.error} value={draft?.text ?? (budget ? (budget.capFen / 100).toFixed(2) : "")} placeholder="请自行填写" onChange={event => setDraft(previous => ({ text: event.target.value, revision: previous?.revision ?? budget?.revision ?? 0 }))} /></label>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !draft || !!query.error} onClick={() => void save()}>保存项目额度</Button>{draft && <Button variant="outline" disabled={busy} onClick={() => { setDraft(null); setError(null); void refresh(); }}>使用最新额度</Button>}</div>
      {draft && draft.revision !== (budget?.revision ?? 0) && <p role="status">另一页面已修改额度。你的输入仍保留，保存前请核对最新值。</p>}
      {budget ? <dl className="grid grid-cols-2 gap-2 text-sm"><dt>已核算</dt><dd>{yuan(budget.spentFen)}</dd><dt>调用预留</dt><dd>{yuan(budget.reservedFen)}</dd><dt>待核对</dt><dd>{yuan(budget.uncertainFen)} · {budget.uncertainCalls} 笔</dd><dt>剩余额度</dt><dd>{yuan(budget.remainingFen)}</dd>{budget.overrunFen > 0 && <><dt>超过额度</dt><dd>{yuan(budget.overrunFen)}</dd></>}</dl> : <p>本项目尚未设置付费额度。</p>}
      <Button variant="outline" disabled={busy} onClick={() => { setBusy(true); setError(null); setQuotes([]); void refreshStudioPrices().then(setQuotes).catch(setError).finally(() => setBusy(false)); }}>免费刷新模型报价</Button>
      <QuoteList quotes={quotes} />
      <p className="text-sm text-muted-foreground">按有效报价和返回用量向上取整核算，供应商账单是最终依据。报价有效10分钟；后续请求会免费更新过期报价，并按新报价预留，不自动增加额度。</p>
      {budget && <section className="space-y-3"><h3>逐次费用 · 共 {budget.totalCalls} 笔</h3>{budget.calls.map(item => <article key={item.callId} className="rounded border p-3 text-sm"><p>{labels[item.state]} · {item.model}</p><p className="break-words">{item.phase}</p><p>预留 {yuan(item.reservedFen)}{item.actualFen != null && ` · 核算 ${yuan(item.actualFen)}`}</p><p>{new Date(item.createdAt).toLocaleString()}</p><details><summary>调用记录</summary><p className="break-all">任务：{item.jobId}</p><p className="break-all">调用：{item.callId}</p>{item.note && <p>{item.note}</p>}</details>{item.state === "uncertain" && <Button variant="outline" disabled={busy} onClick={() => { setCharge(item); setAmount(""); setNote(""); setChargeError(null); }}>核对这笔费用</Button>}{charge?.callId === item.callId && reconcileForm}</article>)}
        <div className="flex gap-2"><Button variant="outline" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>上一页</Button><Button variant="outline" disabled={busy || offset + 100 >= budget.totalCalls} onClick={() => setOffset(offset + 100)}>下一页</Button></div></section>}

    </>}
  </DialogContent></Dialog>;
}
