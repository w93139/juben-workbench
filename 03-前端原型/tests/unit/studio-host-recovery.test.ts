import { afterEach, expect, it, vi } from "vitest";
import { StudioEngine, type ModelTransport } from "@/server/studio-models";
import { StudioJobStore } from "@/server/studio-job-store";
import { analysisBatches, sourceSelectionSchema, type CitationSegment } from "@/server/long-analysis";
import { TaskPowerError } from "@/server/task-power";
const config = { baseUrl: "https://model.invalid/v1", apiKey: "self-owned-test", mainModel: "main", reviewA: "a", reviewB: "b" };
const shortInput = { documents: [{ id: "d", name: "测试", text: "自有原文" }] };
const directResult = { outline: "测试", directions: ["a", "b"].map(id => ({ id, title: id, summary: "方向", outline: "结构", risk: "待核对" })), sourceRefs: [{ documentId: "d", location: "正文", quote: "自有原文" }], unknowns: [] };
const flush = () => vi.advanceTimersByTimeAsync(0);
afterEach(() => vi.useRealTimers());
it("保护建立前零外呼，建立失败保留任务失败信息", async () => {
  vi.useFakeTimers(); let reject!: (error: unknown) => void;
  const power = vi.fn(() => new Promise<never>((_, fail) => { reject = fail; })); const model = vi.fn();
  const engine = new StudioEngine(() => config, model, Date.now, undefined, power);
  const task = await engine.start("analyze", shortInput); expect(model).not.toHaveBeenCalled();
  reject(new TaskPowerError("TASK_POWER_UNAVAILABLE")); await flush();
  expect(engine.get(task.jobId).error?.code).toBe("TASK_POWER_UNAVAILABLE"); expect(model).not.toHaveBeenCalled();
});
it("13/15批后暂停，查询先恢复仍保存准确诊断；迟到响应无效，续跑只补两批及汇总", async () => {
  vi.useFakeTimers(); let now = 1000000; const store = new StudioJobStore(":memory:", () => now);
  const input = { documents: Array.from({ length: 15 }, (_, i) => ({ id: `d${i}`, name: `角色${i}`, text: `角色${i}。` + "自有测试原文".repeat(800) })) };
  expect(analysisBatches(input.documents)).toHaveLength(15);
  let hang = true; let late!: (value: unknown) => void; let lateValue: unknown; let aborted = false;
  const sources: string[] = []; const release = vi.fn(async () => {}); const power = vi.fn(async () => ({ assertActive: () => {}, release }));
  const transport: ModelTransport = async (_config, _model, _instructions, payload, schema, signal) => {
    const data = payload as { segments?: CitationSegment[]; notes?: { sourceRefs: { citationId: string }[] }[] };
    const id = data.segments ? data.segments[0].passages.find(p => p.citationId)!.citationId : data.notes![0].sourceRefs[0].citationId;
    const value = schema === sourceSelectionSchema ? { summary: "自有摘要", sourceRefIds: [id], unknowns: [] } : { outline: directResult.outline, directions: directResult.directions, sourceRefIds: [id], unknowns: [] };
    if (data.segments) {
      sources.push(data.segments[0].documentId);
      if (hang && sources.length === 14) { lateValue = value; signal.addEventListener("abort", () => { aborted = true; }); return new Promise(resolve => { late = resolve; }); }
    }
    return value;
  };
  try {
    const first = new StudioEngine(() => config, transport, () => now, store, power);
    const task = await first.start("analyze", input); await flush(); expect(sources).toHaveLength(14);
    now += 328956;
    const failed = first.get(task.jobId);
    expect(failed.error?.code).toBe("HOST_EXECUTION_PAUSED"); expect(failed.error?.message).toContain("已完成 13 批");
    expect(failed.lastCall).toMatchObject({ status: "failed", errorCode: "HOST_EXECUTION_PAUSED", elapsedMs: 328956, pauseGapMs: 328956 });
    late(lateValue); await flush(); expect(aborted).toBe(true); expect(release).toHaveBeenCalledTimes(1);
    expect(first.get(task.jobId)).toEqual(failed); expect(store.read(task.jobId)?.view).toEqual(failed);
    hang = false; const restarted = new StudioEngine(() => config, transport, () => now, store, power);
    const retry = await restarted.start("analyze", input); await flush();
    const done = restarted.get(retry.jobId); expect(done.status).toBe("completed"); expect(sources).toHaveLength(16);
    for (let i = 0; i < 13; i++) expect(sources.filter(id => id === `d${i}`)).toHaveLength(1);
    expect(sources.filter(id => id === "d13")).toHaveLength(2); expect(sources.filter(id => id === "d14")).toHaveLength(1);
    expect(done.result?.kind === "analysis" && done.result.analysis.coverage?.documents).toBe(15); expect(release).toHaveBeenCalledTimes(2);
  } finally { store.close(); }
});
it("响应先于唤醒定时器返回，也不能把暂停期间迟到结果当作成功", async () => {
  vi.useFakeTimers(); let now = 1000000; let finish!: (value: unknown) => void; const release = vi.fn(async () => {});
  const engine = new StudioEngine(() => config, () => new Promise(resolve => { finish = resolve; }), () => now, undefined, async () => ({ assertActive: () => {}, release }));
  const task = await engine.start("analyze", shortInput); await flush(); now += 306000; finish(directResult); await flush();
  expect(engine.get(task.jobId).error?.code).toBe("HOST_EXECUTION_PAUSED"); expect(engine.get(task.jobId).result).toBeUndefined(); expect(release).toHaveBeenCalledTimes(1);
});
it("正常240秒等待仍是模型请求超时，失败后释放保护", async () => {
  vi.useFakeTimers(); const release = vi.fn(async () => {});
  const engine = new StudioEngine(() => config, () => new Promise(() => {}), Date.now, undefined, async () => ({ assertActive: () => {}, release }));
  const task = await engine.start("analyze", shortInput); await vi.advanceTimersByTimeAsync(240001);
  expect(engine.get(task.jobId).error?.code).toBe("MODEL_TIMEOUT"); expect(release).toHaveBeenCalledTimes(1);
});
it("保护中途退出中止在途调用，清理失败不覆盖原始暂停原因", async () => {
  vi.useFakeTimers(); let lost = false; let aborted = false;
  const engine = new StudioEngine(() => config, async (_c, _m, _i, _p, _s, signal) => { signal.addEventListener("abort", () => { aborted = true; }); return new Promise(() => {}); }, Date.now, undefined,
    async () => ({ assertActive: () => { if (lost) throw new TaskPowerError("TASK_POWER_LOST"); }, release: async () => { throw new Error("test cleanup"); } }));
  const task = await engine.start("analyze", shortInput); await flush(); lost = true; await vi.advanceTimersByTimeAsync(1000);
  expect(engine.get(task.jobId).error?.code).toBe("TASK_POWER_LOST"); expect(engine.get(task.jobId).error?.message).toContain("释放异常"); expect(aborted).toBe(true);
});
it("另一个实例先读到过期租约，原实例迟到响应不能覆盖暂停终态", async () => {
  vi.useFakeTimers(); let now = 1000000; const store = new StudioJobStore(":memory:", () => now); let finish!: (value: unknown) => void;
  const release = vi.fn(async () => {}); const power = async () => ({ assertActive: () => {}, release });
  const first = new StudioEngine(() => config, () => new Promise(resolve => { finish = resolve; }), () => now, store, power);
  const other = new StudioEngine(() => config, vi.fn(), () => now, store, power);
  try {
    const task = await first.start("analyze", shortInput); await flush(); now += 306000;
    expect(other.get(task.jobId).error?.code).toBe("HOST_EXECUTION_PAUSED");
    finish(directResult); await flush();
    expect(first.get(task.jobId).error?.code).toBe("HOST_EXECUTION_PAUSED"); expect(first.get(task.jobId).result).toBeUndefined(); expect(release).toHaveBeenCalledTimes(1);
  } finally { store.close(); }
});

it("查询先保存暂停终态后释放失败，服务诊断仍保留警告且不覆盖原因", async () => {
  vi.useFakeTimers(); let now = 1000000; const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const engine = new StudioEngine(() => config, () => new Promise(() => {}), () => now, undefined,
    async () => ({ assertActive: () => {}, release: async () => { throw new Error("test cleanup"); } }));
  try {
    const task = await engine.start("analyze", shortInput); await flush(); now += 306000;
    expect(engine.get(task.jobId).error?.code).toBe("HOST_EXECUTION_PAUSED"); await flush();
    expect(warning).toHaveBeenCalledWith("TASK_POWER_RELEASE_FAILED", task.jobId);
    expect(engine.get(task.jobId).error?.code).toBe("HOST_EXECUTION_PAUSED");
  } finally { warning.mockRestore(); }
});
