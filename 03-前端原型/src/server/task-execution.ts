/** A delayed JS callback is evidence of host execution interruption, not provider latency. */
export const EXECUTION_PAUSE_MS = 15000;
export const HOST_PAUSE_MESSAGE = "检测到本机休眠、程序长时间暂停或系统时间变化，当前请求已停止，不能据此判断模型处理超时。材料和已完成分段已保留，没有自动重试；恢复后可手动继续，已发出的请求可能产生费用。";
export class TaskExecutionError extends Error {
  constructor(public code: string, message: string, public pauseGapMs?: number) { super(message); }
}
export class TaskExecution {
  private lastSeen: number;
  private lastHeartbeat: number;
  private timer: ReturnType<typeof setInterval>;
  private reject!: (error: unknown) => void;
  private controller = new AbortController();
  failure?: Error;
  readonly interrupted: Promise<never>;
  get signal() { return this.controller.signal; }
  constructor(private now: () => number, private assertPower: () => void, private heartbeat: () => void) {
    this.lastSeen = this.lastHeartbeat = now();
    this.interrupted = new Promise((_, reject) => { this.reject = reject; });
    void this.interrupted.catch(() => {}); // May fail between calls; the next check still rejects.
    this.timer = setInterval(() => {
      try {
        this.check();
        if (this.now() - this.lastHeartbeat >= 10000) { this.heartbeat(); this.lastHeartbeat = this.now(); }
      } catch (error) { this.fail(error); }
    }, 1000);
    this.timer.unref?.();
  }
  private fail(error: unknown) {
    this.failure ??= error instanceof Error ? error : new TaskExecutionError("JOB_INTERRUPTED", "本机任务已中断，已有材料保留，没有自动重试。");
    clearInterval(this.timer); this.controller.abort(this.failure); this.reject(this.failure);
  }
  check() {
    if (this.failure) throw this.failure;
    const time = this.now(); const gap = time - this.lastSeen;
    if (gap > EXECUTION_PAUSE_MS || gap < -1000) { this.fail(new TaskExecutionError("HOST_EXECUTION_PAUSED", HOST_PAUSE_MESSAGE, Math.abs(gap))); throw this.failure; }
    try { this.assertPower(); } catch (error) { this.fail(error); throw this.failure; }
    this.lastSeen = time;
  }
  dispose() { clearInterval(this.timer); }
}
