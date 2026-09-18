import { workbenchSchema, emptyWorkbench, type BlueprintDraft, type WorkbenchState } from "@/domain/workbench";
import { applyBlueprintDraft, putBlueprintDraft, removeBlueprintDraft } from "@/domain/blueprint-drafts";
import { assertHistoryVersion, removeBlueprintHistory, type BlueprintVersion, type HistorySelection } from "@/domain/blueprint-history";

export const WORKBENCH_DB = "juben-workbench:authoring:v1";
export const WORKBENCH_STORE = "projects";
const STORE = WORKBENCH_STORE;
function isDeleted(value: unknown): value is { deleted: true; backup?: unknown } {
  return !!value && typeof value === "object" && "deleted" in value && value.deleted === true;
}
class DeletedWorkbenchError extends Error {}
function assertAvailable(value: unknown) {
  if (isDeleted(value)) throw new DeletedWorkbenchError("项目已删除或删除尚未完成，请返回项目列表。原文件不受影响。");
}
export async function openWorkbenchDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(WORKBENCH_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => { if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
    request.onerror = request.onblocked = () => { settled = true; reject(new Error("无法打开本机创作数据，原数据未改变。")); };
  });
}
export async function readWorkbench(id: string): Promise<WorkbenchState> {
  return (await readWorkbenchSnapshot(id)).state;
}
export async function readWorkbenchSnapshot(id: string): Promise<{ exists: boolean; state: WorkbenchState }> {
  const db = await openWorkbenchDatabase();
  try { return await new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = () => { try { assertAvailable(req.result); resolve({ exists: req.result !== undefined, state: req.result === undefined ? emptyWorkbench() : workbenchSchema.parse(req.result) }); } catch (failure) { reject(failure instanceof DeletedWorkbenchError ? failure : new Error("本机创作数据无法读取，已保留原数据，请先备份再处理。")); } };
    req.onerror = () => reject(new Error("读取创作数据失败，请重试。"));
  }); } finally { db.close(); }
}
async function transactWorkbench(id: string, update: (state: WorkbenchState) => void): Promise<WorkbenchState> {
  const db = await openWorkbenchDatabase();
  try {
    const result = await new Promise<WorkbenchState>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE); const req = store.get(id); let next: WorkbenchState; let error: Error | null = null;
      req.onsuccess = () => { try {
        assertAvailable(req.result);
        next = req.result === undefined ? emptyWorkbench() : workbenchSchema.parse(req.result);
        update(next); next = workbenchSchema.parse(next); store.put(next, id);
      } catch (failure) { error = failure instanceof Error ? failure : new Error("无法保存当前修改"); transaction.abort(); } };
      transaction.oncomplete = () => resolve(next);
      transaction.onabort = transaction.onerror = () => reject(error ?? new Error("本机存储失败，当前输入已保留，请重试。"));
    });
    window.dispatchEvent(new CustomEvent("authoring-updated", { detail: id }));
    if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel(WORKBENCH_DB); channel.postMessage(id); channel.close(); }
    return result;
  } finally { db.close(); }
}
export function changeWorkbench(id: string, revision: number, update: (state: WorkbenchState) => void): Promise<WorkbenchState> {
  return transactWorkbench(id, state => {
    if (state.revision !== revision) throw new Error("项目已在其他页面更新，当前输入保留，请刷新后重试。");
    update(state); state.revision++;
  });
}
export async function saveBlueprintDraft(id: string, draft: BlueprintDraft, expected: number | null, history?: HistorySelection): Promise<BlueprintDraft> {
  const next = await transactWorkbench(id, state => {
    if (history) {
      assertHistoryVersion(state, history.historyRevision, history.index, history.version);
      if (state.revision !== draft.baseRevision || state.blueprintRevision !== draft.baseBlueprintRevision) throw new Error("正式蓝图或项目已变化，请重新对照后恢复。");
    }
    putBlueprintDraft(state, draft, expected);
  });
  return next.blueprintDrafts.find(item => item.id === draft.id)!;
}
export async function deleteBlueprintDraft(id: string, draftId: string, revision: number, allowMissing = false): Promise<void> {
  await transactWorkbench(id, state => removeBlueprintDraft(state, draftId, revision, allowMissing));
}
export function commitBlueprintDraft(id: string, draftId: string, revision: number): Promise<WorkbenchState> {
  return transactWorkbench(id, state => applyBlueprintDraft(state, draftId, revision));
}

export function deleteBlueprintHistory(id: string, historyRevision: number, index: number, selected: BlueprintVersion) {
  return transactWorkbench(id, state => removeBlueprintHistory(state, historyRevision, index, selected));
}

/** A tombstone serializes deletion against job reservation and stale-tab writes. */
async function deleteTransaction(id: string, action: "prepare" | "restore" | "finish") {
  const db = await openWorkbenchDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite"); const store = tx.objectStore(STORE);
    const request = store.get(id); let error: unknown;
    request.onsuccess = () => { try {
      const value: unknown = request.result;
      if (action === "prepare") {
        if (isDeleted(value)) return; // A failed rollback can be completed safely.
        const state = value === undefined ? emptyWorkbench() : workbenchSchema.parse(value);
        if (state.job) throw new Error("当前项目仍有任务在运行或等待确认，请打开项目等待任务结束后再删除。");
        store.put({ deleted: true, backup: value ?? null }, id);
      } else if (action === "restore" && isDeleted(value)) {
        if (value.backup === undefined) throw new Error("已完成删除的项目不能恢复。");
        if (value.backup === null) store.delete(id); else store.put(value.backup, id);
      } else if (action === "finish" && isDeleted(value)) store.put({ deleted: true }, id);
    } catch (failure) { error = failure; tx.abort(); } };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(error ?? new Error("本机存储未完成删除，请重试。"));
  }); } finally { db.close(); }
  window.dispatchEvent(new CustomEvent("authoring-updated", { detail: id }));
  if (action === "finish") window.dispatchEvent(new CustomEvent("authoring-deleted", { detail: id }));
  if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel(WORKBENCH_DB); channel.postMessage(action === "finish" ? { deletedProjectId: id } : id); channel.close(); }
}
export const browserProjectDeletion = {
  prepare: (id: string) => deleteTransaction(id, "prepare"),
  restore: (id: string) => deleteTransaction(id, "restore"),
  finish: (id: string) => deleteTransaction(id, "finish"),
};
