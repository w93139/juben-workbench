import { describe, expect, it, vi } from "vitest";
import { discoverAntModels } from "@/server/model-discovery";

const connection = { baseUrl: "https://maas-api.antdigital.com/v1", apiKey: "test-only-placeholder" };
const item = (name: string, provider: string, input: string, output: string, contextLength = 128000) => ({ name, displayName: name.toUpperCase(), provider, status: "RELEASED", contextLength, inPrice: input, outPrice: output, type: "TEXT_GENERATE", offShelfFlag: 0 });
function fetcher(permitted = ["premium", "cheap-a", "cheap-b", "cheap-c", "ocr-model"]) {
  return vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    void options;
    return String(input).endsWith("/models")
      ? Response.json({ data: permitted.map(id => ({ id })) })
      : Response.json({ success: true, data: { items: [item("premium", "P", "¥8/M", "¥40/M", 1_000_000), item("cheap-a", "A", "¥1/M", "¥2/M"), item("cheap-b", "B", "¥2/M", "¥3/M"), item("cheap-c", "C", "¥3/M", "¥4/M"), { ...item("ocr-model", "O", "¥0.1/M", "¥0.2/M"), type: "TEXT_GENERATE" }] } });
  });
}
describe("蚂蚁模型发现", () => {
  it("只交集账号权限与公开人民币价格，保留一款高阶和不同厂商的经济候选", async () => {
    const call = fetcher(); const result = await discoverAntModels(connection, call as typeof fetch);
    expect(result.map(model => model.id)).toEqual(["premium", "cheap-a", "cheap-b", "cheap-c"]);
    expect(result[0]).toMatchObject({ inputPriceMicroCnyPerMillion: 8_000_000, outputPriceMicroCnyPerMillion: 40_000_000 });
    expect(call.mock.calls[1]?.[1]?.headers).toEqual({ accept: "application/json" });
  });
  it("错误地址、无价格或认证失败均不进入付费测评", async () => {
    await expect(discoverAntModels({ ...connection, baseUrl: "https://other.invalid/v1" }, fetcher() as typeof fetch)).rejects.toThrow("只支持蚂蚁数科");
    const unauthorized = vi.fn(async () => new Response("secret-detail", { status: 401 }));
    await expect(discoverAntModels(connection, unauthorized as typeof fetch)).rejects.toThrow("拒绝了API Key");
    await expect(discoverAntModels(connection, fetcher(["one"]) as typeof fetch)).rejects.toThrow("缺少三个");
  });
});
