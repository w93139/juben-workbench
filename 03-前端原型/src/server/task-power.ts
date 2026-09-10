import { execFile, spawn } from "node:child_process";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class TaskPowerError extends Error {
  readonly code: "TASK_POWER_UNAVAILABLE" | "TASK_POWER_LOST";
  constructor(code: "TASK_POWER_UNAVAILABLE" | "TASK_POWER_LOST") {
    super(code === "TASK_POWER_UNAVAILABLE"
      ? "无法建立任务防休眠保护，本次未发起模型请求。请检查本机服务后再试。"
      : "任务防休眠保护已中断，已停止继续发起模型请求；已有进度保留。");
    this.name = "TaskPowerError";
    this.code = code;
  }
}
export type TaskPower = { assertActive(): void; release(): Promise<void> };

/** Keep only idle system sleep disabled; display sleep and global settings stay untouched. */
export async function acquireTaskPower(): Promise<TaskPower> {
  if (process.platform !== "darwin") throw new TaskPowerError("TASK_POWER_UNAVAILABLE");
  let child: ReturnType<typeof spawn>;
  try {
    // The OS releases the assertion if this server dies before its finally block.
    child = spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
  } catch { throw new TaskPowerError("TASK_POWER_UNAVAILABLE"); }
  let ended = false;
  let failed = false;
  let released = false;
  let releasePromise: Promise<void> | undefined;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => { ended = true; resolve(); });
    child.on("error", () => {
      failed = true;
      // Spawn failure has no exit event. An error from kill does not imply exit.
      if (!child.pid) { ended = true; resolve(); }
    });
  });
  const assertActive = () => {
    if (ended || failed || released || child.exitCode !== null || child.signalCode !== null) {
      throw new TaskPowerError("TASK_POWER_LOST");
    }
  };
  const waitForExit = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exited, new Promise<void>((resolve) => { timer = setTimeout(resolve, 1_000); })]);
    } finally { if (timer) clearTimeout(timer); }
  };
  const release = () => {
    if (releasePromise) return releasePromise;
    released = true;
    releasePromise = (async () => {
      if (ended) return;
      child.kill("SIGTERM");
      await waitForExit();
      if (ended) return;
      child.kill("SIGKILL");
      await waitForExit();
      if (!ended) throw new TaskPowerError("TASK_POWER_LOST");
    })();
    return releasePromise;
  };
  try {
    // Require this exact PID's assertion before paid work, not another app's.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      assertActive();
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile("/usr/bin/pmset", ["-g", "assertions"], {
          encoding: "utf8", timeout: 1_000, maxBuffer: 1_048_576,
        }, (error, output) => error ? reject(error) : resolve(output));
      });
      assertActive();
      if (child.pid && stdout.split("\n").some((line) => (
        new RegExp(`^\\s*pid ${child.pid}\\(caffeinate\\):.*\\bPreventUserIdleSystemSleep\\b`).test(line)
      ))) return { assertActive, release };
      await delay(100);
    }
    throw new TaskPowerError("TASK_POWER_UNAVAILABLE");
  } catch {
    await release();
    throw new TaskPowerError("TASK_POWER_UNAVAILABLE");
  }
}
