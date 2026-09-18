import type { BlueprintData } from "@/domain/blueprint";
import type { BlueprintDraft } from "@/domain/workbench";
import { BlueprintDraftWriter, type DraftWriteStatus } from "./blueprint-draft-writer";
import { saveBlueprintDraft, WORKBENCH_DB } from "./workbench-store";

// Memory belongs to this browser page, not a shared tab identity. Pending/failed
// drafts survive SPA unmounts; successful detached drafts live only in IndexedDB.
const sessions = new Map<string, BlueprintDraftSession>();
export type DraftSessionStatus = DraftWriteStatus & { busy: boolean; closed: boolean; actionError: unknown };
export const idleDraftSession: DraftSessionStatus = { pending: false, saved: false, error: null, busy: false, closed: false, actionError: null };
let warningInstalled = false;
let deletionChannel: BroadcastChannel | null = null;
let deletionInstalled = false;
const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
function deleted(projectId: unknown) {
  if (typeof projectId !== "string") return;
  const session = sessions.get(projectId);
  if (session) { void session.writer.abandon().then(() => session.release()); }
}
const deletedHere = (event: Event) => deleted((event as CustomEvent).detail);
function refreshWarning() {
  if (typeof window === "undefined") return;
  const pending = [...sessions.values()].some(session => session.status.pending || session.status.error);
  if (pending && !warningInstalled) window.addEventListener("beforeunload", warn);
  if (!pending && warningInstalled) window.removeEventListener("beforeunload", warn);
  warningInstalled = pending;
  if (sessions.size && !deletionInstalled) {
    window.addEventListener("authoring-deleted", deletedHere); deletionInstalled = true;
    if (typeof BroadcastChannel !== "undefined") {
      deletionChannel = new BroadcastChannel(WORKBENCH_DB);
      deletionChannel.onmessage = event => { if (event.data && typeof event.data === "object") deleted(event.data.deletedProjectId); };
    }
  } else if (!sessions.size && deletionInstalled) {
    window.removeEventListener("authoring-deleted", deletedHere); deletionInstalled = false;
    deletionChannel?.close(); deletionChannel = null;
  }
}
export class BlueprintDraftSession {
  writer: BlueprintDraftWriter;
  data: BlueprintData | null = null;
  status: DraftSessionStatus = { ...idleDraftSession };
  private listener: ((status: DraftSessionStatus) => void) | null = null;
  constructor(readonly projectId: string, baseRevision: number, baseBlueprintRevision: number, private write: (draft: BlueprintDraft, expected: number | null) => Promise<BlueprintDraft> = (draft, expected) => saveBlueprintDraft(projectId, draft, expected)) {
    this.writer = this.createWriter(baseRevision, baseBlueprintRevision);
  }
  private createWriter(baseRevision: number, baseBlueprintRevision: number) {
    return new BlueprintDraftWriter(crypto.randomUUID(), baseRevision, baseBlueprintRevision, this.write, status => {
      this.status = { ...this.status, ...status }; this.publish();
    });
  }
  async fork() {
    const previous = this.writer;
    await previous.abandon();
    this.writer = this.createWriter(previous.baseRevision, previous.baseBlueprintRevision);
    this.status = { ...this.status, pending: false, saved: false, error: null };
    this.change(this.data!);
  }
  private publish() {
    this.listener?.(this.status);
    if (!this.listener && !this.status.pending && !this.status.error && !this.status.busy && sessions.get(this.projectId) === this) sessions.delete(this.projectId);
    refreshWarning();
  }
  attach(listener: (status: DraftSessionStatus) => void) { this.listener = listener; sessions.set(this.projectId, this); listener(this.status); refreshWarning(); }
  begin() {
    if (this.status.busy || this.status.closed) throw new Error("草稿操作尚未结束，请稍候。");
    this.status = { ...this.status, busy: true, actionError: null }; this.publish();
  }
  resume(actionError: unknown = null) { this.status = { ...this.status, busy: false, actionError }; this.publish(); }
  change(data: BlueprintData) { this.data = data; this.writer.change(data); }
  detach() {
    this.listener = null;
    if (this.status.pending || this.status.error) void this.writer.flush().catch(() => {});
    else if (!this.status.busy && sessions.get(this.projectId) === this) sessions.delete(this.projectId);
    refreshWarning();
  }
  release() {
    this.status = { ...idleDraftSession, closed: true }; this.listener?.(this.status);
    this.listener = null;
    if (sessions.get(this.projectId) === this) sessions.delete(this.projectId);
    refreshWarning();
  }
}
export function pendingBlueprintSession(id: string) { return sessions.get(id); }
