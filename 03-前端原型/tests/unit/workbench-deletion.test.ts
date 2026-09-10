import { afterEach, expect, it, vi } from "vitest";
import { changeWorkbench, readWorkbench } from "@/services/workbench-store";
import { emptyWorkbench } from "@/domain/workbench";

// Only the IndexedDB transport is faked; both public storage functions run unchanged.
function storedRecord(value: unknown) {
  const put = vi.fn(); const close = vi.fn();
  const transactions: Array<{ abort: ReturnType<typeof vi.fn> }> = [];
  const db = {
    close,
    transaction: vi.fn(() => {
      const tx = {
        onabort: null as null | (() => void),
        abort: vi.fn(() => queueMicrotask(() => tx.onabort?.())),
        objectStore: () => ({
          put,
          get: vi.fn(() => {
            const request = { result: structuredClone(value), onsuccess: null as null | (() => void) };
            queueMicrotask(() => request.onsuccess?.()); return request;
          }),
        }),
      };
      transactions.push(tx); return tx;
    }),
  };
  vi.stubGlobal("indexedDB", { open: vi.fn(() => {
    const request = { result: db, onsuccess: null as null | (() => void) };
    queueMicrotask(() => request.onsuccess?.()); return request;
  }) });
  return { put, close, transactions };
}
afterEach(() => vi.unstubAllGlobals());
it.each([
  { deleted: true, backup: emptyWorkbench() },
  { deleted: true },
])("正在删除及已删除项目均拒绝旧页读取和保存，不执行修改回调：%j", async marker => {
  const storage = storedRecord(marker); const update = vi.fn();
  await expect(readWorkbench("deleted-project")).rejects.toThrow("项目已删除或删除尚未完成");
  await expect(changeWorkbench("deleted-project", 0, update)).rejects.toThrow("项目已删除或删除尚未完成");
  expect(update).not.toHaveBeenCalled(); expect(storage.put).not.toHaveBeenCalled();
  expect(storage.transactions[1].abort).toHaveBeenCalledOnce(); expect(storage.close).toHaveBeenCalledTimes(2);
});
it("损坏正文仍使用保留原数据的提示，不暴露结构解析内容", async () => {
  storedRecord({ instructions: 99 });
  await expect(readWorkbench("corrupt-project")).rejects.toThrow("本机创作数据无法读取，已保留原数据");
});
