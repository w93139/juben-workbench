import { expect, it, vi } from "vitest";
import { POST as operationsPOST } from "@/app/api/studio/[operation]/route";
import { POST as budgetPOST } from "@/app/api/studio/budget/route";
import { randomUUID } from "node:crypto";
import { StudioEngine } from "@/server/studio-models";
import { StudioJobStore } from "@/server/studio-job-store";
import { StudioBilling } from "@/server/studio-billing";
import { previewStudioCost } from "@/server/studio-cost-preview";
import { reviewAudit, reviewCheckpoint } from "../fixtures/studio-review";

const address = "http://127.0.0.1:3107";
const projectId = "retired-review-project";
function request(path: string, body: unknown) {
  return new Request(address + path, { method: "POST", headers: { host: "127.0.0.1:3107", origin: address, "content-type": "application/json" }, body: JSON.stringify(body) });
}
const context = (operation: string) => ({ params: Promise.resolve({ operation }) });

it("服务端拒绝所有新的 review 启动请求，防止绕过页面直接付费", async () => {
  const start = vi.fn(); vi.stubGlobal("__studioEngine", { start });
  const response = await operationsPOST(request("/api/studio/review", { blueprint: {} }), context("review"));
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("OPERATION_RETIRED");
  expect(start).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("服务端拒绝所有新的 review 费用预览，不读取账本也不发起报价", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  const response = await budgetPOST(request("/api/studio/budget", { action: "preview", projectId, operation: "review", input: { blueprint: {} } }));
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("不再提供 review 费用预览");
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("直接调用引擎也拒绝 review，拒绝发生在配置、存储、模型与防休眠启动之前", async () => {
  const config = vi.fn(), transport = vi.fn(), power = vi.fn();
  const engine = new StudioEngine(config, transport, Date.now, undefined, power);
  await expect(engine.start("review", {}, randomUUID())).rejects.toMatchObject({ code: "OPERATION_RETIRED", status: 409 });
  expect(config).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled(); expect(power).not.toHaveBeenCalled();
});

it("直接预览 review 不读取账本、不取报价也不登记费用预览", async () => {
  const store = new StudioJobStore(":memory:");
  try {
    const billing = new StudioBilling(store.budget);
    const snapshot = vi.spyOn(store.budget, "snapshot"), preview = vi.spyOn(store.budget, "preparePreview"), prices = vi.spyOn(billing.prices, "get");
    const config = { baseUrl: "https://model.invalid/v1", apiKey: "synthetic-only", mainModel: "main", reviewA: "a", reviewB: "b" };
    await expect(previewStudioCost(billing, config, projectId, "review", {})).rejects.toMatchObject({ status: 409 });
    expect(snapshot).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled(); expect(prices).not.toHaveBeenCalled();
  } finally { store.close(); }
});

it("旧完成任务、未完成成果和费用仍可读取；历史 ZIP 凭证校验、复制隔离及过期语义保持", async () => {
  let now = Date.now(); const store = new StudioJobStore(":memory:", () => now);
  const config = vi.fn(), transport = vi.fn();
  try {
    const progress = reviewCheckpoint();
    const result = { ...progress.review, passed: true, issues: [], validationId: randomUUID(), reports: Object.fromEntries(["designGate", "independentA", "independentB", "mutualA", "mutualB", "coordinator"].map(id => [id, reviewAudit()])) };
    const completed = { jobId: randomUUID(), status: "completed" as const, phase: "历史完成", result };
    store.claim({ jobId: completed.jobId, status: "running", phase: "自造旧记录" }, "a".repeat(64)); store.save(completed);
    const partial = { jobId: randomUUID(), status: "failed" as const, phase: "历史中断", error: { code: "JOB_INTERRUPTED", message: "自造历史中断" }, reviewProgress: { ...progress, runId: null } };
    store.claim({ jobId: partial.jobId, status: "running", phase: "自造旧记录" }, "b".repeat(64)); store.save(partial);
    const budget = store.budget.configure(projectId, 2000, 0);
    const engine = new StudioEngine(config, transport, () => now, store);
    expect(engine.get(completed.jobId)).toEqual(completed); expect(engine.get(partial.jobId)).toEqual(partial);
    expect(engine.getValidated(result.validationId, result.blueprintFingerprint)).toEqual(result);
    engine.getValidated(result.validationId).artifacts[0].content = "客户端修改";
    expect(engine.getValidated(result.validationId).artifacts[0].content).toBe(result.artifacts[0].content);
    expect(() => engine.getValidated(result.validationId, "0".repeat(64))).toThrow("不一致");
    expect(() => engine.getValidated(randomUUID())).toThrow("没有可用");
    await expect(engine.start("review", { blueprint: result.blueprint }, completed.jobId)).rejects.toMatchObject({ code: "OPERATION_RETIRED" });
    expect(store.budget.snapshot(projectId)).toEqual(budget);
    now += 8 * 24 * 60 * 60 * 1000;
    expect(() => engine.getValidated(result.validationId)).toThrow("没有可用");
    expect(config).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  } finally { store.close(); }
});
