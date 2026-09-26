"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Pencil, Plus, Trash2 } from "lucide-react";
import { AppFrame } from "./app-frame";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { LoadError, Loading } from "./shared";
import { localJson } from "@/services/studio-client";
import { fetchMemory, type MemoryList } from "@/services/author-memory-client";
import { AUTHOR_MEMORY_TYPES, authorMemoryTypeLabels, type AuthorMemoryItem, type AuthorMemoryType } from "@/domain/author-memory";

interface Draft { id?: string; type: AuthorMemoryType; text: string; note: string; enabled: boolean; confidence: number }
const emptyDraft = (): Draft => ({ type: "hard", text: "", note: "", enabled: true, confidence: 100 });

export function MemoryLibrary() {
  const cache = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [message, setMessage] = useState<string | null>(null);
  const memory = useQuery({ queryKey: ["author-memory"], queryFn: fetchMemory });
  const mutate = useMutation({
    mutationFn: (body: Record<string, unknown>) => localJson("/api/studio/memory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as Promise<MemoryList>,
    onSuccess: (data: MemoryList) => { cache.setQueryData(["author-memory"], data); setMessage(null); },
    onError: (error: unknown) => setMessage(error instanceof Error ? error.message : "作者记忆操作未完成，请重试。"),
  });

  const items = memory.data?.items ?? [];
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.text.trim()) { setMessage("请先填写记忆内容。"); return; }
    const id = draft.id;
    mutate.mutate({ action: "save", item: { ...(id ? { id } : {}), type: draft.type, text: draft.text.trim(), note: draft.note.trim(), enabled: draft.enabled, confidence: draft.confidence } });
    setDraft(emptyDraft());
  }
  function edit(item: AuthorMemoryItem) {
    setDraft({ id: item.id, type: item.type, text: item.text, note: item.note, enabled: item.enabled, confidence: item.confidence });
    setMessage(null);
  }

  return <AppFrame title="作者记忆">
    <div className="page-heading"><div><span className="eyebrow">AUTHOR MEMORY</span><h1 className="serif">作者记忆</h1></div></div>
    <p className="field-hint">这里保存跨项目长期生效的偏好、文风与禁忌。拆解并生成原创方向时会自动带入已启用的条目；它是参考，不会覆盖当前项目的创作要求，也不改变已通过的成果。记忆只保存在本机，不写入 GitHub。</p>
    <section className="panel">
      <h2 className="section-heading">{draft.id ? "编辑记忆" : "新增记忆"}</h2>
      <form className="space-y-3" onSubmit={submit}>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm">类别
            <select aria-label="记忆类别" className="rounded-md border border-input bg-transparent px-3 py-2 text-sm" value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value as AuthorMemoryType })}>
              {AUTHOR_MEMORY_TYPES.map(type => <option key={type} value={type}>{authorMemoryTypeLabels[type]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">备注（可选）
            <Input aria-label="记忆备注" maxLength={500} value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} placeholder="来源或证据，例如“上一部作品多次修改”" />
          </label>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />启用</label>
        </div>
        <Textarea aria-label="记忆内容" maxLength={500} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} placeholder="例如：偏好 5 人本格，不喜欢感情线" />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={mutate.isPending}><Plus size={15} />{draft.id ? "保存修改" : "添加记忆"}</Button>
          {draft.id && <Button type="button" variant="ghost" onClick={() => setDraft(emptyDraft())}>取消编辑</Button>}
        </div>
      </form>
      {message && <p className="field-hint mt-2" role="alert">{message}</p>}
    </section>
    {memory.isPending ? <Loading /> : memory.error ? <LoadError error={memory.error} retry={() => void memory.refetch()} /> : items.length === 0
      ? <section className="panel empty-state"><BrainCircuit size={26} className="mx-auto" /><h2>还没有作者记忆</h2><p className="field-hint">添加偏好后，下次拆解生成原创方向时会自动带入。</p></section>
      : <section className="panel">
        <h2 className="section-heading">记忆库<span className="count">{memory.data!.enabled}/{memory.data!.count}</span></h2>
        {AUTHOR_MEMORY_TYPES.map(type => {
          const group = items.filter(item => item.type === type);
          if (!group.length) return null;
          return <div key={type} className="mt-3">
            <h3 className="text-sm font-semibold">{authorMemoryTypeLabels[type]}</h3>
            <ul className="mt-1 space-y-2">
              {group.map(item => <li key={item.id} className="flex items-start gap-3 rounded-md border border-input p-3">
                <input type="checkbox" aria-label={item.text} checked={item.enabled} disabled={mutate.isPending} onChange={event => mutate.mutate({ action: "toggle", id: item.id, enabled: event.target.checked })} />
                <div className="min-w-0 flex-1"><p className="whitespace-pre-wrap break-words text-sm">{item.text}</p>{item.note && <p className="field-hint">备注：{item.note}</p>}<p className="field-hint">已使用 {item.useCount} 次</p></div>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`编辑：${item.text}`} onClick={() => edit(item)}><Pencil size={14} /></Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`删除：${item.text}`} disabled={mutate.isPending} onClick={() => mutate.mutate({ action: "delete", id: item.id })}><Trash2 size={14} /></Button>
              </li>)}
            </ul>
          </div>;
        })}
      </section>}
    <div className="page-footnote"><span><span className="local-dot" />作者记忆保存在本机受限目录，清除或换机前请先备份。</span><span>AI 参考不等于真人试玩</span></div>
  </AppFrame>;
}
