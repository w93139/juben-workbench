import { z } from "zod";
import { projectSchema } from "@/domain/models";
import { workbenchSchema, type WorkbenchState } from "@/domain/workbench";
import type { ProjectRecoveryPort, ProjectRestoreJournal } from "./contracts";
import { openWorkbenchDatabase, readWorkbenchSnapshot, WORKBENCH_STORE } from "./workbench-store";

const journalSchema = z.object({ operationId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), project: projectSchema }).strict().refine(j => j.project.id === `project-restored-${j.operationId}` && j.project.restoredFrom?.operationId === j.operationId && j.project.restoredFrom.fingerprint === j.fingerprint, "恢复记录身份不一致");
const key = (operationId: string): IDBValidKey => ["project-restore", z.uuid().parse(operationId)];
async function pending(): Promise<ProjectRestoreJournal[]> {
  const db = await openWorkbenchDatabase();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction(WORKBENCH_STORE); const request = tx.objectStore(WORKBENCH_STORE).openCursor(IDBKeyRange.bound(["project-restore"], ["project-restore", []]));
    const records: ProjectRestoreJournal[] = []; let error: unknown;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      try { if (Array.isArray(cursor.key) && cursor.key[0] === "project-restore") records.push(journalSchema.parse(cursor.value)); cursor.continue(); }
      catch (failure) { error = failure; tx.abort(); }
    };
    tx.oncomplete = () => resolve(records);
    tx.onabort = tx.onerror = () => reject(error ?? new Error("无法核对未完成的项目恢复，原数据保留。"));
  }); } finally { db.close(); }
}
async function stage(journal: ProjectRestoreJournal, state: WorkbenchState) {
  const valid = journalSchema.parse(journal), body = workbenchSchema.parse(state);
  if (body.restoredFrom?.operationId !== valid.operationId || body.restoredFrom.fingerprint !== valid.fingerprint) throw new Error("恢复正文与项目身份不一致。");
  const db = await openWorkbenchDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(WORKBENCH_STORE, "readwrite"), store = tx.objectStore(WORKBENCH_STORE); let error: unknown;
    const prior = store.get(key(valid.operationId));
    prior.onsuccess = () => {
      if (prior.result !== undefined) { error = new Error("这次恢复尚未对账，请重新读取项目列表后重试。"); tx.abort(); return; }
      const existing = store.get(valid.project.id);
      existing.onsuccess = () => {
        if (existing.result !== undefined) { error = new Error("新副本编号已有正文，未覆盖现有数据。"); tx.abort(); return; }
        try { store.add(body, valid.project.id); store.add(valid, key(valid.operationId)); }
        catch (failure) { error = failure; tx.abort(); }
      };
    };
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(error ?? new Error("本机存储未能准备完整副本，原项目未改变。"));
  }); } finally { db.close(); }
}
async function finish(operationId: string, rollback: boolean) {
  const db = await openWorkbenchDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(WORKBENCH_STORE, "readwrite"), store = tx.objectStore(WORKBENCH_STORE); let error: unknown;
    const request = store.get(key(operationId));
    request.onsuccess = () => {
      if (request.result === undefined) return;
      try {
        const journal = journalSchema.parse(request.result);
        const body = store.get(journal.project.id);
        body.onsuccess = () => {
          try {
            if (body.result !== undefined) {
              const state = workbenchSchema.parse(body.result);
              if (state.restoredFrom?.operationId !== operationId || state.restoredFrom.fingerprint !== journal.fingerprint) throw new Error("恢复正文身份已变化，未自动清理，请保留当前数据。");
              if (rollback) { if (state.job) throw new Error("恢复正文已有任务，未自动删除，请保留当前数据。"); store.delete(journal.project.id); }
            } else if (!rollback) throw new Error("已发布副本缺少正文，未删除恢复记录。");
            store.delete(key(operationId));
          } catch (failure) { error = failure; tx.abort(); }
        };
      } catch (failure) { error = failure; tx.abort(); }
    };
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(error ?? new Error("项目恢复收尾未完成，请重新读取列表后重试。"));
  }); } finally { db.close(); }
}
export const browserProjectRecovery: ProjectRecoveryPort = { readSnapshot: readWorkbenchSnapshot, pending, stage, rollback: id => finish(id, true), complete: id => finish(id, false) };
