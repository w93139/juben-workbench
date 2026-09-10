import { workbenchSchema, emptyWorkbench, type WorkbenchState } from "@/domain/workbench";

export const WORKBENCH_DB = "juben-workbench:authoring:v1";
const STORE = "projects";
function isDeleted(value: unknown): value is { deleted: true; backup?: unknown } {
  return !!value && typeof value === "object" && "deleted" in value && value.deleted === true;
}
class DeletedWorkbenchError extends Error {}
function assertAvailable(value: unknown) {
  if (isDeleted(value)) throw new DeletedWorkbenchError("项目已删除或删除尚未完成，请返回项目列表。原文件不受影响。");
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(WORKBENCH_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => { if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
    request.onerror = request.onblocked = () => { settled = true; reject(new Error("无法打开本机创作数据，原数据未改变。")); };
  });
}
export async function readWorkbench(id: string): Promise<WorkbenchState> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = () => { try { assertAvailable(req.result); resolve(req.result === undefined ? emptyWorkbench() : workbenchSchema.parse(req.result)); } catch (failure) { reject(failure instanceof DeletedWorkbenchError ? failure : new Error("本机创作数据无法读取，已保留原数据，请先备份再处理。")); } };
    req.onerror = () => reject(new Error("读取创作数据失败，请重试。"));
  }); } finally { db.close(); }
}
export async function changeWorkbench(id: string, revision: number, update: (state: WorkbenchState) => void): Promise<WorkbenchState> {
  const db = await database();
  try {
    const result = await new Promise<WorkbenchState>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE); const req = store.get(id); let next: WorkbenchState; let error: Error | null = null;
      req.onsuccess = () => { try {
        assertAvailable(req.result);
        next = req.result === undefined ? emptyWorkbench() : workbenchSchema.parse(req.result);
        if (next.revision !== revision) throw new Error("项目已在其他页面更新，当前输入保留，请刷新后重试。");
        update(next); next.revision++; next = workbenchSchema.parse(next); store.put(next, id);
      } catch (failure) { error = failure instanceof Error ? failure : new Error("无法保存当前修改"); transaction.abort(); } };
      transaction.oncomplete = () => resolve(next);
      transaction.onabort = transaction.onerror = () => reject(error ?? new Error("本机存储失败，当前输入已保留，请重试。"));
    });
    window.dispatchEvent(new CustomEvent("authoring-updated", { detail: id }));
    if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel(WORKBENCH_DB); channel.postMessage(id); channel.close(); }
    return result;
  } finally { db.close(); }
}

/** A tombstone serializes deletion against job reservation and stale-tab writes. */
async function deleteTransaction(id: string, action: "prepare" | "restore" | "finish") {
  const db = await database();
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
  if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel(WORKBENCH_DB); channel.postMessage(id); channel.close(); }
}
export const browserProjectDeletion = {
  prepare: (id: string) => deleteTransaction(id, "prepare"),
  restore: (id: string) => deleteTransaction(id, "restore"),
  finish: (id: string) => deleteTransaction(id, "finish"),
};
