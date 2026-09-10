import { expect, it, vi } from "vitest";
import { MockProjectService } from "@/services/mock-project-service";
import type { ProjectDeletionPort, StoragePort } from "@/services/contracts";

function setup() {
  let raw: string | null = null; let fail = false;
  const storage: StoragePort = { read: () => raw, write: value => { if (fail) throw new Error("索引写入失败"); raw = value; }, exclusive: action => action() };
  const deletion: ProjectDeletionPort = { prepare: vi.fn(async () => {}), restore: vi.fn(async () => {}), finish: vi.fn(async () => {}) };
  let id = 0;
  const service = new MockProjectService(storage, undefined, () => String(++id), undefined, deletion);
  return { service, deletion, fail: () => { fail = true; } };
}
const input = { title: "自有删除测试", note: "", template: "blank" as const };
it("删除单个项目保留其他项目与只读样例，按冻结、索引、清理顺序执行", async () => {
  const { service, deletion } = setup(); const first = await service.create(input); const second = await service.create(input);
  vi.mocked(deletion.prepare).mockImplementation(async () => { expect(await service.get(first.id)).toBeDefined(); });
  vi.mocked(deletion.finish).mockImplementation(async () => { await expect(service.get(first.id)).rejects.toThrow(); });
  expect(await service.remove(first.id, first.revision)).toEqual({ cleanupPending: false });
  expect((await service.list()).map(p => p.id)).toEqual([second.id, "demo-names"]);
  expect(deletion.restore).not.toHaveBeenCalled();
});
it("索引写入失败恢复正文，保留项目", async () => {
  const { service, deletion, fail } = setup(); const p = await service.create(input); fail();
  await expect(service.remove(p.id, p.revision)).rejects.toThrow("索引写入失败");
  expect(deletion.restore).toHaveBeenCalledWith(p.id); expect(deletion.finish).not.toHaveBeenCalled();
  expect(await service.get(p.id)).toEqual(p);
});
it("运行中任务拒绝删除，索引与正文保持不变", async () => {
  const { service, deletion } = setup(); const p = await service.create(input);
  vi.mocked(deletion.prepare).mockRejectedValue(new Error("任务运行中"));
  await expect(service.remove(p.id, p.revision)).rejects.toThrow("任务运行中");
  expect(await service.get(p.id)).toEqual(p); expect(deletion.finish).not.toHaveBeenCalled();
});
it("只读样例和过时项目版本不会冻结正文", async () => {
  const { service, deletion } = setup(); const p = await service.create(input);
  await expect(service.remove("demo-names", 0)).rejects.toThrow("不能删除");
  await expect(service.remove(p.id, 9)).rejects.toThrow("更新");
  expect(deletion.prepare).not.toHaveBeenCalled();
});
it("清理正文失败如实返回待清理状态，索引已移除", async () => {
  const { service, deletion } = setup(); const p = await service.create(input);
  vi.mocked(deletion.finish).mockRejectedValue(new Error("存储故障"));
  expect(await service.remove(p.id, 0)).toEqual({ cleanupPending: true });
  await expect(service.get(p.id)).rejects.toThrow();
});
