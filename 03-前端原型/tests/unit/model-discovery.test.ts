import { describe, expect, it, vi } from "vitest";
import { RESEARCH_SELECTION_POLICY } from "@/domain/model-shortlist";
import { discoverAntModels } from "@/server/model-discovery";

const connection = { baseUrl: "https://maas-api.antdigital.com/v1", apiKey: "test-only-placeholder" };
const item = (name: string, provider: string, input: string, output: string, contextLength = 128000) => ({ name, displayName: name.toUpperCase(), provider, status: "RELEASED", contextLength, inPrice: input, outPrice: output, type: "TEXT_GENERATE", offShelfFlag: 0, modelProtocolCompatibility: { openai_chat_completions: true }, protocolParameters: [{ protocolName: "openai_chat_completions", parameters: { response_format: true } }] });
const ids = [...RESEARCH_SELECTION_POLICY.ids];
function fetcher(permitted = [...ids, "premium", "cheap", "ocr-model"], overrides: Record<string, object> = {}) {
  return vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    void options;
    return String(input).endsWith("/models")
      ? Response.json({ data: permitted.map(id => ({ id })) })
      : Response.json({ success: true, data: { items: [...ids.map((id, i) => ({ ...item(id, `P${i}`, `¥${i+1}/M`, `¥${i+2}/M`), ...(id === "kimi-k3" ? { type: "VISUAL_UNDERSTANDING" } : {}), ...overrides[id] })), item("premium", "Premium", "¥80/M", "¥400/M"), item("cheap", "Cheap", "¥0/M", "¥0/M"), item("ocr-model", "O", "¥0.1/M", "¥0.2/M")] } });
  });
}
describe("蚂蚁模型发现", () => {
  it("只选择研究的三个首选，不因高价或低价加入其他模型", async () => {
    const call = fetcher(); const result = await discoverAntModels(connection, call as typeof fetch);
    expect(result.map(model => model.id)).toEqual(ids.slice(0, 3));
    expect(result[0]).toMatchObject({ inputPriceMicroCnyPerMillion: 1_000_000, outputPriceMicroCnyPerMillion: 2_000_000 });
    expect(call.mock.calls[1]?.[1]?.headers).toEqual({ accept: "application/json" });
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("首选缺失时只换入指定替补，多模态Kimi也可接受纯文本测评", async () => {
    const result = await discoverAntModels(connection, fetcher(ids.filter(id => id !== ids[0])) as typeof fetch);
    expect(result.map(model => model.id)).toEqual(ids.slice(1));
    expect(result.some(model => model.id === "kimi-k3")).toBe(true);
  });
  it("格式不支持时换入替补；两个排除后不漫游搜索新模型", async () => {
    const call = fetcher(undefined, { [ids[0]!]: { protocolParameters: [{ protocolName: "openai_chat_completions", parameters: { response_format: false } }] } });
    expect((await discoverAntModels(connection, call as typeof fetch)).map(item => item.id)).toEqual(ids.slice(1));
    await expect(discoverAntModels(connection, fetcher() as typeof fetch, undefined, [], ids.slice(0, 2))).rejects.toThrow("候选不足三个");
  });
  it("保留旧轮已完成候选，但新名额只从研究清单选择", async () => {
    const result = await discoverAntModels(connection, fetcher() as typeof fetch, undefined, ["premium"]);
    expect(result.map(model => model.id)).toEqual(["premium", ids[0], ids[1]]);
  });
  it("错误地址、无价格或认证失败均不进入付费测评", async () => {
    await expect(discoverAntModels({ ...connection, baseUrl: "https://other.invalid/v1" }, fetcher() as typeof fetch)).rejects.toThrow("只支持蚂蚁数科");
    const unauthorized = vi.fn(async () => new Response("secret-detail", { status: 401 }));
    await expect(discoverAntModels(connection, unauthorized as typeof fetch)).rejects.toThrow("拒绝了API Key");
    await expect(discoverAntModels(connection, fetcher(["one"]) as typeof fetch)).rejects.toThrow("候选不足三个");
  });
});
