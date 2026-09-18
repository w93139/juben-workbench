import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StudioBilling } from "@/server/studio-billing";
import { StudioPrices, reserveQuotedFen } from "@/server/studio-pricing";
import { StudioJobStore } from "@/server/studio-job-store";
import { openAITransport, StudioEngine } from "@/server/studio-models";
import { previewStudioCost } from "@/server/studio-cost-preview";

const stores: StudioJobStore[] = [];
afterEach(() => { vi.unstubAllGlobals(); stores.forEach(store => store.close()); stores.length = 0; });
const config = { baseUrl: "https://maas-api.antdigital.com/v1", apiKey: "test-only-no-real-credential", mainModel: "main", reviewA: "review-a", reviewB: "review-b" };
const schema = z.object({ answer: z.string() });
const analysis = { outline: "参考结构", directions: ["a", "b"].map(id => ({ id, title: id, summary: "原创方向", outline: "第一幕", risk: "待核对" })), sourceRefs: [{ documentId: "doc", location: "开头", quote: "原始全文" }], unknowns: [] };
const input = { documents: [{ id: "doc", name: "测试", text: "原始全文" }] };
const usage = { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 };
const envelope = (content = '{"answer":"ok"}') => ({ model: "main", usage, choices: [{ finish_reason: "stop", message: { content } }] });
function setup(cap = 1000) {
  const store = new StudioJobStore(":memory:", () => 1000); stores.push(store);
  store.budget.configure("project-a", cap, 0);
  const priceFetch = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ success: true, data: { items: ["main", "review-a", "review-b"].map(name => ({
    name, inPrice: "¥1/M", outPrice: "¥2/M", status: "RELEASED", type: "TEXT_GENERATE", offShelfFlag: 0,
    modelProtocolCompatibility: { openai_chat_completions: true }, protocolParameters: [{ protocolName: "openai_chat_completions", parameters: { response_format: true } }],
  })) } }));
  const billing = new StudioBilling(store.budget, new StudioPrices(priceFetch, () => 1000));
  const jobId = randomUUID(); store.claim({ jobId, status: "running", phase: "准备" }, "a".repeat(64), { projectId: "project-a", revision: 1 });
  const call = (signal = new AbortController().signal, maxTokens = 4096) => openAITransport(config, "main", "检查正文", { source: "自造正文" }, schema, signal, { maxTokens, billing: { service: billing, jobId, phase: "生成" } });
  return { store, billing, call, priceFetch, jobId };
}
it("完整请求含系统指令/Schema和真实输出上限参与预留，而非只算原始正文", async () => {
  const { store, billing, call } = setup();
  let sent = "";
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    sent = String(init?.body); const request = JSON.parse(sent);
    expect(request.max_tokens).toBe(8192); expect(request.messages[0].content).toContain("properties");
    const quote = (await billing.prices.get(config.baseUrl, ["main"]))[0];
    expect(store.budget.snapshot("project-a")!.reservedFen).toBe(reserveQuotedFen(quote, Buffer.byteLength(sent), 8192));
    return Response.json(envelope());
  }); vi.stubGlobal("fetch", fetcher);
  await expect(call(undefined, 8192)).resolves.toEqual({ answer: "ok" });
  expect(Buffer.byteLength(sent)).toBeGreaterThan(1000); expect(fetcher).toHaveBeenCalledOnce();
  expect(store.budget.snapshot("project-a")).toMatchObject({ spentFen: 1, reservedFen: 0, uncertainFen: 0 });
});
it.each(["length", "invalid-json", "missing-choice", "http-error"])("先核算用量再拒绝不合格响应：%s", async failure => {
  const { store, call } = setup();
  const response = envelope(failure === "invalid-json" ? "not-json" : undefined);
  if (failure === "length") response.choices[0].finish_reason = "length";
  const value = failure === "missing-choice" ? { model: "main", usage } : response;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(value, { status: failure === "http-error" ? 500 : 200 })));
  await expect(call()).rejects.toThrow();
  expect(store.budget.snapshot("project-a")).toMatchObject({ spentFen: 1, reservedFen: 0, uncertainCalls: 0 });
});
it.each(["missing-usage", "wrong-model", "wrong-total", "zero-prompt", "zero-completion", "zero-completion-extra-choice", "network"])("无法核对费用即保留占用且重试不再外呼：%s", async failure => {
  const { store, call } = setup();
  const response = { ...envelope(), ...(failure === "missing-usage" ? { usage: undefined } : failure === "wrong-model" ? { model: "other" } : failure === "wrong-total" ? { usage: { ...usage, total_tokens: 1 } } : failure === "zero-prompt" ? { usage: { prompt_tokens: 0, completion_tokens: 100, total_tokens: 100 } } : failure === "zero-completion" ? { usage: { prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 } } : {}) };
  if (failure === "zero-completion-extra-choice") {
    response.usage = { prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 };
    response.choices.push({ finish_reason: "stop", message: {} } as typeof response.choices[number]);
  }
  const fetcher = vi.fn<typeof fetch>();
  if (failure === "network") fetcher.mockRejectedValue(new Error("synthetic network failure")); else fetcher.mockImplementation(async () => Response.json(response));
  vi.stubGlobal("fetch", fetcher);
  await expect(call()).rejects.toThrow();
  expect(store.budget.snapshot("project-a")).toMatchObject({ spentFen: 0, reservedFen: 0, uncertainCalls: 1 });
  expect(store.budget.snapshot("project-a")!.uncertainFen).toBeGreaterThan(0);
  await expect(call()).rejects.toThrow("待核对"); expect(fetcher).toHaveBeenCalledOnce();
});
it("预算不足或本地发送前中止时零付费请求", async () => {
  const { store, call, priceFetch } = setup(0); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(call()).rejects.toThrow("额度不足"); expect(fetcher).not.toHaveBeenCalled(); expect(priceFetch).toHaveBeenCalledOnce();
  expect(store.budget.snapshot("project-a")!.totalCalls).toBe(0);
  const controller = new AbortController(); controller.abort(); await expect(call(controller.signal)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it("网络忽略取消时立即保留待核对，迟到有效用量只结算费用、不返回成功内容", async () => {
  const { store, call } = setup();
  let finish!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController(); const pending = call(controller.signal);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  controller.abort(); expect(store.budget.snapshot("project-a")!.uncertainCalls).toBe(1);
  finish(Response.json(envelope())); await expect(pending).rejects.toThrow();
  expect(store.budget.snapshot("project-a")).toMatchObject({ spentFen: 1, uncertainFen: 0, uncertainCalls: 0 });
});
it("预算预览仅免费读取公开价格，不登记任务、不预留或发送正文", async () => {
  const { store, billing, priceFetch } = setup(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const preview = await previewStudioCost(billing, config, "project-a", "analyze", input);
  expect(preview).toMatchObject({ operation: "analyze", callsMax: 1 });
  expect(preview.estimateFen).toBeGreaterThan(0); expect(store.budget.snapshot("project-a")!.totalCalls).toBe(0);
  expect(fetcher).not.toHaveBeenCalled(); expect(priceFetch).toHaveBeenCalledOnce();
  expect(String(priceFetch.mock.calls[0][1]?.body)).not.toContain("原始全文");
});
it("正式引擎拒绝未设预算，真实transport登记费用；原任务重投幂等且不能改项目", async () => {
  const { store, billing } = setup();
  const engine = new StudioEngine(() => config, openAITransport, () => 1000, store, async () => ({ assertActive() {}, async release() {} }), billing);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(envelope(JSON.stringify(analysis)))); vi.stubGlobal("fetch", fetcher);
  await expect(engine.start("analyze", input, randomUUID())).rejects.toMatchObject({ code: "BUDGET_REQUIRED" });
  expect(fetcher).not.toHaveBeenCalled();
  const preview = await previewStudioCost(billing, config, "project-a", "analyze", input);
  const claim = { projectId: "project-a", revision: 1, previewId: preview.previewId };
  const id = randomUUID(); await engine.start("analyze", input, id, claim);
  await vi.waitFor(() => expect(engine.get(id).status).toBe("completed"));
  await engine.start("analyze", input, id, claim); expect(fetcher).toHaveBeenCalledOnce();
  await expect(engine.start("analyze", input, id, { ...claim, projectId: "project-b" })).rejects.toMatchObject({ code: "REQUEST_ID_CONFLICT" });
  await expect(engine.start("analyze", input, randomUUID(), claim)).rejects.toThrow("费用预览"); expect(fetcher).toHaveBeenCalledOnce();
  expect(store.budget.snapshot("project-a")!.spentFen).toBe(1);
});
it.each(["mainModel", "baseUrl", "apiKey"] as const)("费用预览后变更%s则拒绝启动，不偷偷采用另一连接/模型", async field => {
  const { store, billing } = setup();
  const preview = await previewStudioCost(billing, config, "project-a", "analyze", input);
  const changed = { ...config, [field]: "changed-for-test" };
  const engine = new StudioEngine(() => changed, openAITransport, () => 1000, store, async () => ({ assertActive() {}, async release() {} }), billing);
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(engine.start("analyze", input, randomUUID(), { projectId: "project-a", revision: 1, previewId: preview.previewId })).rejects.toThrow("模型/资料已变化");
  expect(fetcher).not.toHaveBeenCalled(); expect(store.budget.snapshot("project-a")!.totalCalls).toBe(0);
});
