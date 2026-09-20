import { expect, it, vi } from "vitest";
import { ANT_PRICE_URL, STUDIO_QUOTE_TTL, StudioPrices, assertFreshQuote, calculateQuotedFen, parseFlatMicroPrice, readAntQuotes, reserveQuotedFen } from "@/server/studio-pricing";
import { parseYuanInput, type StudioQuote } from "@/domain/studio-budget";

const baseUrl = "https://maas-api.antdigital.com/v1";
const item = (name = "model-a") => ({ name, inPrice: "¥1.25/M", outPrice: "￥2.50/M", status: "RELEASED", type: "TEXT_GENERATE", offShelfFlag: 0,
  modelProtocolCompatibility: { openai_chat_completions: true }, protocolParameters: [{ protocolName: "openai_chat_completions", parameters: { response_format: true } }] });
const quote: StudioQuote = { provider: "ant", baseUrl, modelId: "model-a", currency: "CNY", inputPriceMicroCnyPerMillion: 1_250_000, outputPriceMicroCnyPerMillion: 2_500_000, checkedAt: 1000, expiresAt: 1000 + STUDIO_QUOTE_TTL };
const catalog = (items: unknown[]) => Response.json({ success: true, data: { items } });

it("精确匹配配置模型，仅查询固定公开目录，不发送密钥或访问付费端点", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(catalog([item("a"), item("b"), item("c"), item("unrelated")]));
  const result = await readAntQuotes(baseUrl, ["c", "a", "b"], { fetcher, now: () => 1234 });
  expect(result.map(value => value.modelId)).toEqual(["c", "a", "b"]);
  expect(result.every(value => value.checkedAt === 1234 && value.expiresAt === 601234)).toBe(true);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe(ANT_PRICE_URL);
  const init = fetcher.mock.calls[0][1]!;
  expect(new Headers(init.headers).has("authorization")).toBe(false);
  expect(init.redirect).toBe("error");
});
it("兼容蚂蚁新目录：价格移到 priceInfo 分档时取最高档作预算上限", async () => {
  const tiered = { name: "model-a", inPrice: null, outPrice: null, status: "RELEASED", type: "TEXT_GENERATE", offShelfFlag: 0,
    modelProtocolCompatibility: { openai_chat_completions: true },
    protocolParameters: [{ protocolName: "openai_chat_completions", parameters: { response_format: true } }],
    priceInfo: { prices: [
      { price: [{ priceCode: "INPUT", priceValue: "1.000000" }, { priceCode: "OUTPUT", priceValue: "4.000000" }, { priceCode: "INPUT_CACHE_HIT", priceValue: "0.020000" }] },
      { price: [{ priceCode: "INPUT", priceValue: "2.000000" }, { priceCode: "OUTPUT", priceValue: "8.000000" }] },
    ] } };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(catalog([tiered]));
  const [result] = await readAntQuotes(baseUrl, ["model-a"], { fetcher, now: () => 1000 });
  expect(result.inputPriceMicroCnyPerMillion).toBe(2_000_000);
  expect(result.outputPriceMicroCnyPerMillion).toBe(8_000_000);
  expect(result.offPeakInputPriceMicroCnyPerMillion).toBe(1_000_000);
  expect(result.offPeakOutputPriceMicroCnyPerMillion).toBe(4_000_000);
});
it("整数微元和BigInt按用量向上取整，不把微小正价格变成零", () => {
  expect(parseFlatMicroPrice("¥1.25/M")).toBe(1_250_000);
  expect(parseFlatMicroPrice("¥0/M")).toBe(0);
  expect(parseFlatMicroPrice("¥0.000001/M")).toBe(1);
  for (const value of ["¥0.0000001/M", "¥1/M 缓存¥0.1/M", "1 USD/M", "¥1/K", "¥1e2/M", "¥9999999/M", "免费"]) expect(parseFlatMicroPrice(value)).toBeNull();
  expect(calculateQuotedFen(quote, 1_000_000, 200_000)).toBe(175);
  expect(calculateQuotedFen(quote, 1, 0)).toBe(1);
  expect(() => calculateQuotedFen(quote, Number.MAX_SAFE_INTEGER, 1)).toThrow();
  expect(reserveQuotedFen(quote, 90_000, 8192)).toBeGreaterThan(reserveQuotedFen(quote, 100, 4096));
  expect(() => reserveQuotedFen(quote, 0, 0)).toThrow();
});
it.each([
  [], [item(), item()], [{ ...item(), status: "DRAFT" }], [{ ...item(), offShelfFlag: "true" }],
  [{ ...item(), offShelfFlag: "unknown" }], [{ ...item(), inPrice: "阶梯价" }],
  [{ ...item(), modelProtocolCompatibility: {} }], [{ ...item(), protocolParameters: [] }],
].map(items => ({ items })))("缺失/重名/下架/复杂价格/未知兼容性不提供报价 %#", async ({ items }) => {
  await expect(readAntQuotes(baseUrl, ["model-a"], { fetcher: vi.fn<typeof fetch>().mockResolvedValue(catalog(items)) })).rejects.toThrow("报价");
});
it("拒绝非官方目的地、超大响应与目录故障，不回退旧报价", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(readAntQuotes("https://example.invalid/v1", ["a"], { fetcher })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce(new Response("x".repeat(2_000_001)));
  await expect(readAntQuotes(baseUrl, ["a"], { fetcher })).rejects.toThrow();
  fetcher.mockRejectedValueOnce(new Error("synthetic-only"));
  await expect(readAntQuotes(baseUrl, ["a"], { fetcher })).rejects.toThrow("报价");
});
it("每次请求核对时效，过期免费更新且涨价后使用新价格", async () => {
  let now = 1000;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(catalog([item()])).mockResolvedValueOnce(catalog([{ ...item(), inPrice: "¥3/M" }])).mockRejectedValueOnce(new Error("unavailable"));
  const prices = new StudioPrices(fetcher, () => now);
  const first = (await prices.get(baseUrl, ["model-a"]))[0];
  await prices.get(baseUrl, ["model-a"]); expect(fetcher).toHaveBeenCalledTimes(1);
  now += STUDIO_QUOTE_TTL;
  expect(() => assertFreshQuote(first, baseUrl, "model-a", now)).toThrow();
  expect((await prices.get(baseUrl, ["model-a"]))[0].inputPriceMicroCnyPerMillion).toBe(3_000_000);
  now += STUDIO_QUOTE_TTL;
  await expect(prices.get(baseUrl, ["model-a"])).rejects.toThrow();
  expect(() => assertFreshQuote(quote, baseUrl, "model-a", 999)).toThrow();
  expect(() => assertFreshQuote(quote, baseUrl, "other", 1000)).toThrow();
});
it("额度输入不把空白、负数、科学计数或多位小数当作已授权金额", () => {
  expect(parseYuanInput("12.34")).toBe(1234); expect(parseYuanInput("0")).toBe(0);
  for (const value of ["", " ", "-1", "1e2", "2.345", "00", "1,000", "99999999.99"]) expect(parseYuanInput(value)).toBeNull();
});
it("主动刷新发现报价不可用后，不复活未过期旧价或较早的异步报价", async () => {
  let resolveOld!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(catalog([item()])).mockResolvedValueOnce(catalog([])).mockResolvedValueOnce(catalog([]));
  const prices = new StudioPrices(fetcher, () => 1000);
  await prices.get(baseUrl, ["model-a"]);
  await expect(prices.get(baseUrl, ["model-a"], undefined, true)).rejects.toThrow();
  await expect(prices.get(baseUrl, ["model-a"])).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(3);
  fetcher.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(catalog([]));
  const old = prices.get(baseUrl, ["model-a"]);
  await expect(prices.get(baseUrl, ["model-a"], undefined, true)).rejects.toThrow();
  resolveOld(catalog([item()])); await expect(old).rejects.toThrow();
});
