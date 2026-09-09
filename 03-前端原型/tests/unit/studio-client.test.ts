import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyWorkbench, type WorkbenchState } from "@/domain/workbench";
import { pollStudioJob, startStudioJob } from "@/services/studio-client";
let saved: WorkbenchState;
vi.mock("@/services/workbench-store", () => ({
  readWorkbench: async () => structuredClone(saved),
  changeWorkbench: async (_id: string, revision: number, fn: (state: WorkbenchState) => void) => {
    if (revision !== saved.revision) throw new Error("版本冲突");
    const next = structuredClone(saved); fn(next); next.revision++; saved = next; return structuredClone(next);
  },
}));
beforeEach(() => { saved = emptyWorkbench(); saved.documents = [{ id: "d", name: "测试.txt", size: 10, text: "自有测试文本", status: "read", excluded: false, method: "text", warnings: [] }]; });
afterEach(() => { vi.unstubAllGlobals(); });
it("HTTP拒绝显示原始错误并清除预留任务，正文不丢失", async () => {
  const fetcher = vi.fn(async () => Response.json({ error: { code: "BUSY", message: "服务繁忙，请稍候" } }, { status: 429 })); vi.stubGlobal("fetch", fetcher);
  await expect(startStudioJob("project", saved, "analyze")).rejects.toThrow("服务繁忙");
  expect(saved.job).toBeNull(); expect(saved.error).toBe("服务繁忙，请稍候"); expect(saved.documents[0].text).toBe("自有测试文本"); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("网络中断保留同一任务，GET恢复不额外发出POST", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("network")); vi.stubGlobal("fetch", fetcher);
  await expect(startStudioJob("project", saved, "analyze")).rejects.toThrow("network");
  const id = saved.job!.jobId;
  fetcher.mockResolvedValue(Response.json({ jobId: id, status: "running", phase: "正在拆解" }));
  const current = await pollStudioJob("project", saved); expect(current.job?.phase).toBe("正在拆解");
  expect(fetcher.mock.calls[1][0]).toContain(id); expect(fetcher.mock.calls[1][1]?.method).toBeUndefined();
});
it("提交期间404暂不释放，旧404解锁并保留资料、不自动重试", async () => {
  const fetcher = vi.fn(async () => Response.json({ error: { code: "JOB_NOT_FOUND", message: "未找到" } }, { status: 404 })); vi.stubGlobal("fetch", fetcher);
  saved.job = { jobId: "legacy", operation: "analyze", phase: "提交中", sourceRevision: 0, blueprintRevision: 0, submittedAt: Date.now() };
  expect((await pollStudioJob("p", saved)).job).not.toBeNull();
  delete saved.job.submittedAt;
  const recovered = await pollStudioJob("p", saved); expect(recovered.job).toBeNull(); expect(recovered.error).toContain("没有自动重试"); expect(recovered.documents).toHaveLength(1);
});
it("过量或空材料在预留任务前失败，不发送请求", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); saved.documents = Array.from({ length: 201 }, () => saved.documents[0]);
  await expect(startStudioJob("p", saved, "analyze")).rejects.toThrow("201份"); expect(saved.job).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
});
