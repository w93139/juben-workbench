import { workbenchSchema, emptyWorkbench, type WorkbenchState } from "@/domain/workbench";

export const WORKBENCH_DB = "juben-workbench:authoring:v1";
const STORE = "projects";
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
    req.onsuccess = () => { try { resolve(req.result === undefined ? emptyWorkbench() : workbenchSchema.parse(req.result)); } catch { reject(new Error("本机创作数据无法读取，已保留原数据，请先备份再处理。")); } };
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
