import { expect, it } from "vitest";
import { LocalProjectService } from "@/services/local-project-service";
import type { ProjectRecoveryPort, ProjectRestoreJournal, StoragePort } from "@/services/contracts";
import { createProjectBackup, projectBackupFingerprint, restoredProject } from "@/domain/project-backup";
import { emptyWorkbench, type WorkbenchState } from "@/domain/workbench";
import { backupFixture } from "../fixtures/project-backup";

class Index implements StoragePort {
  crossTabSafe = true; raw: string | null = null; fail = false;
  private queue: Promise<unknown> = Promise.resolve();
  read() { return this.raw; }
  write(value: string) { if (this.fail) throw new Error("index quota"); this.raw = value; }
  exclusive<T>(operation: () => Promise<T>) { const next = this.queue.then(operation, operation); this.queue = next.catch(() => undefined); return next; }
}
// Fault injection at cross-storage boundaries; native IDB behavior is covered by E2E.
class Recovery implements ProjectRecoveryPort {
  bodies = new Map<string, WorkbenchState>(); journals = new Map<string, ProjectRestoreJournal>();
  failStage = false; failComplete = false; failRollback = false;
  async readSnapshot(id: string) { return { exists: this.bodies.has(id), state: structuredClone(this.bodies.get(id) ?? emptyWorkbench()) }; }
  async pending() { return structuredClone([...this.journals.values()]); }
  async stage(journal: ProjectRestoreJournal, state: WorkbenchState) {
    if (this.failStage || this.bodies.has(journal.project.id) || this.journals.has(journal.operationId)) throw new Error("stage failed");
    this.bodies.set(journal.project.id, structuredClone(state)); this.journals.set(journal.operationId, structuredClone(journal));
  }
  async finish(id: string, rollback: boolean) {
    if (rollback ? this.failRollback : this.failComplete) throw new Error("cleanup failed");
    const journal = this.journals.get(id); if (!journal) return;
    const body = this.bodies.get(journal.project.id);
    if (body && (body.restoredFrom?.operationId !== id || body.restoredFrom.fingerprint !== journal.fingerprint)) throw new Error("identity mismatch");
    if (!body && !rollback) throw new Error("missing body");
    if (rollback) this.bodies.delete(journal.project.id); this.journals.delete(id);
  }
  rollback(id: string) { return this.finish(id, true); }
  complete(id: string) { return this.finish(id, false); }
}
function setup() {
  const fixture = backupFixture(), storage = new Index(), recovery = new Recovery();
  storage.raw = JSON.stringify({ schemaVersion: 3, projects: [fixture.project] }); recovery.bodies.set(fixture.project.id, structuredClone(fixture.state));
  const service = () => new LocalProjectService(storage, () => fixture.now, () => crypto.randomUUID(), undefined, undefined, recovery);
  return { ...fixture, storage, recovery, service, backup: createProjectBackup(fixture.project, fixture.state, true, fixture.now), operationId: crypto.randomUUID() };
}
async function stageOnly(s: ReturnType<typeof setup>) {
  const fingerprint = await projectBackupFingerprint(s.backup), restored = restoredProject(s.backup, s.operationId, fingerprint, s.now);
  await s.recovery.stage({ operationId: s.operationId, fingerprint, project: restored.project }, restored.workbench); return restored;
}

it("完整快照和新副本互相隔离，两个实例同操作并发/重试只创建一次", async () => {
  const s = setup(); const original = structuredClone({ project: s.project, state: s.state });
  const exported = await s.service().exportProjectBackup(s.project.id); expect(exported.workbench.blueprintDrafts).toHaveLength(12);
  const [a, b] = await Promise.all([s.service().restoreProjectBackup(s.backup, s.operationId), s.service().restoreProjectBackup(s.backup, s.operationId)]);
  expect(a.project.id).toBe(b.project.id); expect(await s.service().list()).toHaveLength(3); expect(await s.recovery.pending()).toEqual([]);
  await s.service().update(a.project.id, 0, { title: "副本后续编辑", note: "修改副本不被重试覆盖" });
  const again = await s.service().restoreProjectBackup(s.backup, s.operationId); expect(again.project.note).toBe("修改副本不被重试覆盖");
  expect(await s.service().get(s.project.id)).toEqual(original.project); expect((await s.recovery.readSnapshot(s.project.id)).state).toEqual(original.state);
});
it.each(["published", "pending"])("同操作 ID 不允许换另一份备份：%s", async phase => {
  const s = setup(); if (phase === "published") await s.service().restoreProjectBackup(s.backup, s.operationId); else await stageOnly(s);
  const index = s.storage.raw, bodies = structuredClone(s.recovery.bodies), journals = structuredClone(s.recovery.journals);
  const different = structuredClone(s.backup); different.project.note = "另一份备份";
  await expect(s.service().restoreProjectBackup(different, s.operationId)).rejects.toThrow("恢复编号");
  expect(s.storage.raw).toBe(index); expect(s.recovery.bodies).toEqual(bodies); expect(s.recovery.journals).toEqual(journals);
});
it("不支持跨页锁时恢复拒绝且不写任何存储", async () => {
  const s = setup(); s.storage.crossTabSafe = false; const raw = s.storage.raw;
  await expect(s.service().restoreProjectBackup(s.backup, s.operationId)).rejects.toThrow("跨页安全恢复");
  expect(s.storage.raw).toBe(raw); expect(s.recovery.bodies.size).toBe(1); expect(s.recovery.journals.size).toBe(0);
});
it("正文写失败不发布索引，索引写失败回滚本次正文，恢复后可重试", async () => {
  const s = setup(), raw = s.storage.raw;
  s.recovery.failStage = true; await expect(s.service().restoreProjectBackup(s.backup, s.operationId)).rejects.toThrow("stage");
  expect(s.storage.raw).toBe(raw); expect(s.recovery.bodies.size).toBe(1);
  s.recovery.failStage = false; s.storage.fail = true; await expect(s.service().restoreProjectBackup(s.backup, s.operationId)).rejects.toThrow("index quota");
  expect(s.storage.raw).toBe(raw); expect(s.recovery.bodies.size).toBe(1); expect(s.recovery.journals.size).toBe(0);
  s.storage.fail = false; await s.service().restoreProjectBackup(s.backup, s.operationId); expect(await s.service().list()).toHaveLength(3);
});
it("失败回滚也失败时保留恢复记录，重启后只清理本次未发布正文", async () => {
  const s = setup(); s.storage.fail = true; s.recovery.failRollback = true;
  s.recovery.bodies.set("unrelated-orphan", emptyWorkbench());
  await expect(s.service().restoreProjectBackup(s.backup, s.operationId)).rejects.toThrow("已保留恢复记录");
  expect(s.recovery.journals.size).toBe(1); expect(s.recovery.bodies.size).toBe(3);
  s.storage.fail = false; s.recovery.failRollback = false;
  expect(await s.service().list()).toHaveLength(2); expect(s.recovery.bodies.has("unrelated-orphan")).toBe(true); expect(s.recovery.bodies.size).toBe(2); expect(s.recovery.journals.size).toBe(0);
});
it.each([false, true])("进程在发布索引 %s 时中断，重新读取会对账且原项目不变", async published => {
  const s = setup(); const next = await stageOnly(s);
  if (published) s.storage.raw = JSON.stringify({ schemaVersion: 3, projects: [s.project, next.project] });
  const result = await s.service().list(); expect(result).toHaveLength(published ? 3 : 2);
  expect(s.recovery.bodies.has(next.project.id)).toBe(published); expect(s.recovery.journals.size).toBe(0);
  expect((await s.recovery.readSnapshot(s.project.id)).state).toEqual(s.state);
});
it("已发布但收尾失败返回可用副本，重启收尾后不重复创建", async () => {
  const s = setup(); s.recovery.failComplete = true;
  const result = await s.service().restoreProjectBackup(s.backup, s.operationId); expect(result.cleanupPending).toBe(true); expect(s.recovery.bodies.has(result.project.id)).toBe(true);
  s.recovery.failComplete = false; expect(await s.service().list()).toHaveLength(3); expect(s.recovery.journals.size).toBe(0);
  expect((await s.service().restoreProjectBackup(s.backup, s.operationId)).project.id).toBe(result.project.id);
});
it("有未收尾发布记录时清空索引必须先收尾，之后仍保留正文", async () => {
  const s = setup(); s.recovery.failComplete = true;
  const result = await s.service().restoreProjectBackup(s.backup, s.operationId), raw = s.storage.raw!;
  await expect(s.service().resetLocalProjects(raw)).rejects.toThrow("cleanup"); expect(s.storage.raw).toBe(raw);
  s.recovery.failComplete = false; await s.service().resetLocalProjects(raw); expect(await s.service().list()).toHaveLength(1);
  expect(s.recovery.bodies.has(result.project.id)).toBe(true); expect(s.recovery.journals.size).toBe(0);
});
it("删除已发布但未收尾的副本先对账，删除后列表不受旧记录阻塞", async () => {
  const s = setup(); s.recovery.failComplete = true;
  const result = await s.service().restoreProjectBackup(s.backup, s.operationId);
  const deletion = { async prepare() {}, async restore() {}, async finish(id: string) { s.recovery.bodies.delete(id); } };
  const service = new LocalProjectService(s.storage, () => s.now, undefined, undefined, deletion, s.recovery);
  await expect(service.remove(result.project.id, result.project.revision)).rejects.toThrow("cleanup"); expect(s.recovery.bodies.has(result.project.id)).toBe(true);
  s.recovery.failComplete = false; await service.remove(result.project.id, result.project.revision);
  expect(await service.list()).toHaveLength(2); expect(s.recovery.journals.size).toBe(0); expect(s.recovery.bodies.has(result.project.id)).toBe(false);
});
it("缺失或被其他身份替换的正文不当成空白成功恢复，也不自动删掉", async () => {
  const s = setup(); const next = await stageOnly(s); s.recovery.bodies.set(next.project.id, emptyWorkbench());
  await expect(s.service().list()).rejects.toThrow("identity mismatch"); expect(s.recovery.bodies.has(next.project.id)).toBe(true); expect(s.recovery.journals.size).toBe(1);
  s.storage.raw = JSON.stringify({ schemaVersion: 3, projects: [s.project, next.project] }); s.recovery.bodies.delete(next.project.id);
  await expect(s.service().list()).rejects.toThrow("missing body"); expect(s.recovery.journals.size).toBe(1);
  s.recovery.journals.clear(); await expect(s.service().restoreProjectBackup(s.backup, s.operationId)).rejects.toThrow("正文缺失");
});
