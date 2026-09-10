import { afterEach, expect, it, vi } from "vitest";
import { TaskExecution } from "@/server/task-execution";
afterEach(() => vi.useRealTimers());
it("正常运行定期续租，不把长任务累计时长当作暂停", async () => {
  vi.useFakeTimers(); const heartbeat = vi.fn(); const check = vi.fn();
  const task = new TaskExecution(Date.now, check, heartbeat);
  await vi.advanceTimersByTimeAsync(600000);
  expect(task.signal.aborted).toBe(false); expect(heartbeat).toHaveBeenCalledTimes(60);
  task.dispose(); const count = check.mock.calls.length; await vi.advanceTimersByTimeAsync(10000); expect(check).toHaveBeenCalledTimes(count);
});
it.each([306000, -60000])("时钟跳变%s毫秒时中止，明确主机暂停而非供应商超时", async delta => {
  vi.useFakeTimers(); let now = 1000000; const task = new TaskExecution(() => now, () => {}, () => {});
  now += delta;
  expect(() => task.check()).toThrow("本机休眠");
  await expect(task.interrupted).rejects.toMatchObject({ code: "HOST_EXECUTION_PAUSED", pauseGapMs: Math.abs(delta) });
  expect(task.signal.aborted).toBe(true); task.dispose();
});
it("定时器先恢复时安全报告暂停，不抛出未捕获异常", async () => {
  vi.useFakeTimers(); let now = 1000000; const heartbeat = vi.fn(); const task = new TaskExecution(() => now, () => {}, heartbeat);
  now += 306000; await vi.advanceTimersByTimeAsync(1000);
  expect(task.failure).toMatchObject({ code: "HOST_EXECUTION_PAUSED" }); expect(heartbeat).not.toHaveBeenCalled(); task.dispose();
});
