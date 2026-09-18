"use client";
import { useEffect, useRef, useState } from "react";
import type { BlueprintData } from "@/domain/blueprint";
import type { BlueprintDraft, WorkbenchState } from "@/domain/workbench";
import { commitBlueprintDraft, deleteBlueprintDraft } from "@/services/workbench-store";
import { BlueprintDraftSession, idleDraftSession, pendingBlueprintSession } from "@/services/blueprint-draft-session";
import { useSavedDraft } from "./use-saved-draft";

export function useBlueprintDraft(id: string, state: WorkbenchState) {
  const [initial] = useState(() => pendingBlueprintSession(id));
  const local = useSavedDraft(state.blueprint!, initial?.data ?? undefined);
  const sessionRef = useRef<BlueprintDraftSession | null>(initial ?? null);
  const [activeId, setActiveId] = useState<string | null>(initial?.writer.id ?? null);
  const [status, setStatus] = useState(initial?.status ?? idleDraftSession);
  // A remounted editor becomes the current subscriber of an in-flight action.
  function attach(session: BlueprintDraftSession) {
    session.attach(next => {
      if (sessionRef.current !== session) return;
      setStatus(next.closed ? idleDraftSession : next);
      if (next.closed) { sessionRef.current = null; setActiveId(null); local.reset(); }
      else setActiveId(session.writer.id);
    });
  }
  const subscriber = useRef(attach);
  useEffect(() => { subscriber.current = attach; });
  function create(baseRevision: number, baseBlueprintRevision: number) {
    const session = new BlueprintDraftSession(id, baseRevision, baseBlueprintRevision);
    sessionRef.current = session; attach(session); setActiveId(session.writer.id); return session;
  }
  function change(data: BlueprintData) {
    const session = sessionRef.current ?? create(state.revision, state.blueprintRevision);
    if (session.status.busy) return;
    session.change(data); local.change(data);
  }
  async function run<T>(session: BlueprintDraftSession, action: () => Promise<T>) {
    session.begin();
    try { const result = await action(); if (!session.status.closed) session.resume(); return result; }
    catch (failure) { if (!session.status.closed) { session.writer.reopen(); session.resume(failure); } throw failure; }
  }
  async function restore(draft: BlueprintDraft, baseRevision = draft.baseRevision, baseBlueprintRevision = draft.baseBlueprintRevision) {
    if (sessionRef.current) throw new Error("请先提交或放弃当前编辑，再恢复另一份草稿。");
    const session = create(baseRevision, baseBlueprintRevision);
    session.change(draft.data); local.change(draft.data); await run(session, () => session.writer.flush());
  }
  async function commit() {
    const session = sessionRef.current; if (!session) throw new Error("当前没有未提交的草稿。");
    return run(session, async () => {
      const record = await session.writer.seal();
      const next = await commitBlueprintDraft(id, record.id, record.revision);
      session.release(); return next;
    });
  }
  async function discard() {
    const session = sessionRef.current; if (!session) return;
    await run(session, async () => { const record = await session.writer.abandon(); if (record) await deleteBlueprintDraft(id, record.id, record.revision, true); session.release(); });
  }
  async function leave() {
    const session = sessionRef.current; if (!session) return;
    await run(session, async () => { await session.writer.seal(); session.release(); });
  }
  async function saveAsNew() {
    const session = sessionRef.current; if (!session?.data) return;
    await run(session, async () => { await session.fork(); await session.writer.flush(); });
  }
  async function flush() {
    const session = sessionRef.current; if (!session) return;
    return run(session, () => session.writer.flush());
  }
  useEffect(() => {
    if (sessionRef.current) subscriber.current(sessionRef.current);
    return () => { sessionRef.current?.detach(); };
  }, [id]);
  return { draft: local.draft, activeId, status, change, restore, commit, discard, leave, saveAsNew, flush };
}
