"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import type { SafeStudioSettings } from "@/server/studio-settings";
import { localJson } from "@/services/studio-client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ErrorMessage } from "../shared";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

type Draft = Pick<SafeStudioSettings, "baseUrl" | "mainModel" | "reviewA" | "reviewB">;
export function StudioConnection() {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false); const [settings, setSettings] = useState<SafeStudioSettings | null>(null);
  const [draft, setDraft] = useState<Draft>({ baseUrl: "", mainModel: "", reviewA: "", reviewB: "" });
  const [apiKey, setApiKey] = useState(""); const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    void localJson("/api/studio/settings", { signal: abort.signal }).then((value: SafeStudioSettings) => {
      if (abort.signal.aborted) return;
      setSettings(value); setDraft({ baseUrl: value.baseUrl, mainModel: value.mainModel, reviewA: value.reviewA, reviewB: value.reviewB });
    }).catch((failure) => { if (!abort.signal.aborted) setError(failure); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [open]);
  const locked = loading || saving || settings?.environmentLocked === true;
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (locked || !settings) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const value: SafeStudioSettings = await localJson("/api/studio/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, apiKey, revision: settings.revision }) });
      setApiKey(""); setSettings(value); setSaved(true);
      await cache.invalidateQueries({ queryKey: ["studio-capability"] });
    } catch (failure) { setError(failure); } finally { setSaving(false); }
  }
  return <>
    <Button size="sm" variant="outline" onClick={() => { setSettings(null); setLoading(true); setError(null); setSaved(false); setApiKey(""); setOpen(true); }}><Settings2 size={15} />配置模型</Button>
    <Dialog open={open} onOpenChange={(value) => { if (saving) return; setOpen(value); if (!value) { setApiKey(""); setError(null); } }}><DialogContent className="sm:max-w-xl"><DialogTitle>配置模型连接</DialogTitle><DialogDescription>填写支持 OpenAI 兼容接口的服务地址和三个不同的模型编号。保存仅记录配置，不会调用模型。</DialogDescription>
      {loading ? <p role="status">正在读取连接设置…</p> : <form onSubmit={save} className="space-y-4">
        {settings?.environmentLocked && <p className="stage-callout">当前配置由服务端环境变量管理，页面只读。{!settings.configured && "环境变量尚不完整，请在服务端补齐。"}</p>}
        <label className="field-label">服务地址<Input aria-label="模型服务地址" className="mt-2" type="url" autoComplete="off" placeholder="https://你的服务地址/v1" value={draft.baseUrl} maxLength={2048} disabled={locked} required onChange={e => { setDraft({ ...draft, baseUrl: e.target.value }); setSaved(false); }} /></label>
        <label className="field-label">API 密钥<Input aria-label="模型API密钥" className="mt-2" type="password" autoComplete="new-password" spellCheck={false} value={apiKey} maxLength={4096} disabled={locked} required={!settings?.hasApiKey} placeholder={settings?.hasApiKey ? "已保存密钥；不修改时留空" : "粘贴此服务的API密钥"} onChange={e => { setApiKey(e.target.value); setSaved(false); }} /></label>
        {settings?.hasApiKey && <p className="field-hint">已保存的密钥不会返回到页面。更换服务地址时需重新填写密钥。</p>}
        <div className="grid gap-3 sm:grid-cols-3">{([ ["mainModel", "主模型"], ["reviewA", "审查模型 A"], ["reviewB", "审查模型 B"] ] as const).map(([field, label]) => <label className="field-label" key={field}>{label}<Input aria-label={label} className="mt-2" value={draft[field]} autoComplete="off" maxLength={200} disabled={locked} required onChange={e => { setDraft({ ...draft, [field]: e.target.value }); setSaved(false); }} /></label>)}</div>
        <p className="field-hint">模型编号请按服务商提供的名称填写，主模型负责拆解、创作和最终核对，两路审查模型分别检查并互审。</p>
        <p className="stage-callout">之后点击拆解、生成或交叉验证时，剧本资料将发送到你填写的服务，可能产生费用。密钥仅保存在这台电脑的受限配置文件中，不进入浏览器持久存储或 GitHub。</p>
        {!settings?.environmentLocked && <Button type="submit" disabled={locked || !settings}>{saving ? "正在保存…" : "保存连接配置"}</Button>}
        {saved && <p role="status" className="success-message">配置已保存。尚未测试模型可用性，也未产生模型调用。</p>}
      </form>}
      {error != null && <ErrorMessage error={error} />}
    </DialogContent></Dialog>
  </>;
}
