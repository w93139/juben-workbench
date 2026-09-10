import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock("node:child_process", () => mocks);
import { acquireTaskPower } from "../../src/server/task-power";
class FakeChild extends EventEmitter {
  pid: number | undefined = 23456;
  exitCode: number | null = null;
  signalCode: string | null = null;
  kill = vi.fn((signal: string) => {
    this.signalCode = signal; this.emit("exit", null, signal); return true;
  });
}
let child: FakeChild;
function assertion(pid = 23456, type = "PreventUserIdleSystemSleep") {
  return `   pid ${pid}(caffeinate): [0x001] 00:00:01 ${type} named: "caffeinate command-line tool"\n`;
}
function pmset(result: string | Error) {
  mocks.execFile.mockImplementation((_file, _args, _options, callback) => {
    callback(result instanceof Error ? result : null, result instanceof Error ? "" : result, "");
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  child = new FakeChild(); mocks.spawn.mockReturnValue(child); pmset(assertion());
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); mocks.spawn.mockReset(); mocks.execFile.mockReset(); });
test("确认本任务系统断言后才返回，父进程绑定且不阻止显示器熄屏，释放幂等", async () => {
  const guard = await acquireTaskPower();
  expect(mocks.spawn).toHaveBeenCalledWith("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
  expect(mocks.execFile).toHaveBeenCalledWith("/usr/bin/pmset", ["-g", "assertions"], expect.objectContaining({ timeout: 1000 }), expect.any(Function));
  guard.assertActive(); await Promise.all([guard.release(), guard.release()]);
  expect(child.kill).toHaveBeenCalledTimes(1);
  expect(() => guard.assertActive()).toThrow("保护已中断");
});
test.each([assertion(99999), assertion(23456, "PreventUserIdleDisplaySleep")])("其他进程或仅显示器断言不算保护，等待失败后清理", async (output) => {
  pmset(output);
  const pending = expect(acquireTaskPower()).rejects.toMatchObject({ code: "TASK_POWER_UNAVAILABLE" });
  await vi.runAllTimersAsync(); await pending;
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
});
test("断言延迟建立期间不会提前返回", async () => {
  pmset(""); let resolved = false;
  const pending = acquireTaskPower().then((guard) => { resolved = true; return guard; });
  await vi.advanceTimersByTimeAsync(200); expect(resolved).toBe(false);
  pmset(assertion()); await vi.advanceTimersByTimeAsync(100);
  const guard = await pending; await guard.release();
});
test("pmset查询失败会关闭子进程并拒绝开始", async () => {
  pmset(new Error("synthetic pmset failure"));
  await expect(acquireTaskPower()).rejects.toMatchObject({ code: "TASK_POWER_UNAVAILABLE" });
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
});
test("运行期间子进程意外退出可检测，释放不再杀已退出进程", async () => {
  const guard = await acquireTaskPower(); child.exitCode = 1; child.emit("exit", 1, null);
  expect(() => guard.assertActive()).toThrow("保护已中断");
  await guard.release(); expect(child.kill).not.toHaveBeenCalled();
});
test("无法创建子进程时不执行保护成功路径", async () => {
  mocks.spawn.mockImplementation(() => { throw new Error("spawn failed"); });
  await expect(acquireTaskPower()).rejects.toMatchObject({ code: "TASK_POWER_UNAVAILABLE" });
  expect(mocks.execFile).not.toHaveBeenCalled();
});
test("非macOS明确拒绝而不假装保护成功", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  await expect(acquireTaskPower()).rejects.toMatchObject({ code: "TASK_POWER_UNAVAILABLE" });
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test("异步创建失败无退出事件时也能清理返回", async () => {
  child.pid = undefined;
  mocks.execFile.mockImplementation((_file, _args, _options, callback) => {
    child.emit("error", new Error("spawn ENOENT")); callback(null, "", "");
  });
  await expect(acquireTaskPower()).rejects.toMatchObject({ code: "TASK_POWER_UNAVAILABLE" });
  expect(child.kill).not.toHaveBeenCalled();
});

test("SIGTERM未退出时升级SIGKILL且等待退出，不遗留断言", async () => {
  const guard = await acquireTaskPower();
  child.kill.mockImplementation((signal) => {
    if (signal === "SIGKILL") { child.signalCode = signal; child.emit("exit", null, signal); }
    return true;
  });
  const pending = guard.release();
  await vi.advanceTimersByTimeAsync(1_000); await pending;
  expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
  expect(vi.getTimerCount()).toBe(0);
});

test("断言已建立但子进程发生错误，后续保护检查拒绝", async () => {
  const guard = await acquireTaskPower();
  child.emit("error", new Error("synthetic process error"));
  expect(() => guard.assertActive()).toThrow("保护已中断");
  await guard.release();
});
