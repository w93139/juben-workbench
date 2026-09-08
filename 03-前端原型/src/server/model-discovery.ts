import { z } from "zod";
import { modelCandidateSchema, type ModelCandidate } from "@/domain/model-evaluation";
import type { ProviderConnection } from "./studio-settings";
import { LocalApiError } from "./local-security";

const MAX_RESPONSE_BYTES = 2_000_000;
const modelId = z.string().trim().min(1).max(200).refine(value => !/[\x00-\x20\x7f]/.test(value));
const upstreamSchema = z.object({ data: z.array(z.object({ id: modelId }).passthrough()).max(1000) }).passthrough();
const priceItemSchema = z.object({
  name: modelId, displayName: z.string().trim().min(1).max(300), provider: z.string().trim().min(1).max(120), status: z.string(),
  contextLength: z.union([z.string(), z.number()]).nullable().optional(), inPrice: z.string(), outPrice: z.string(), type: z.string().nullable().optional(),
  offShelfFlag: z.union([z.boolean(), z.number(), z.string()]).nullable().optional(),
  modelProtocolCompatibility: z.record(z.string(), z.boolean()).optional(),
  protocolParameters: z.array(z.object({ protocolName: z.string(), parameters: z.record(z.string(), z.boolean()) }).passthrough()).optional(),
}).passthrough();
const catalogSchema = z.object({ success: z.literal(true), data: z.object({ items: z.array(priceItemSchema).max(1000) }).passthrough() }).passthrough();

async function limitedJson(response: Response) {
  if (!response.body) throw new LocalApiError(502, "模型服务没有返回可读取的清单。");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength; if (bytes > MAX_RESPONSE_BYTES) throw new LocalApiError(502, "模型服务返回内容过大，已停止读取。");
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const text = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(text); } catch { throw new LocalApiError(502, "模型服务返回格式无法识别。"); }
}
function parsePrice(value: string) {
  // Tiered, cached or minimum-charge descriptions need a richer billing model.
  // Reject them instead of silently using the first number as a flat price.
  const matched = value.match(/^\s*(?:¥|￥)\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*M\s*$/i);
  if (!matched) return null;
  const micro = Math.round(Number(matched[1]) * 1_000_000);
  return Number.isSafeInteger(micro) && micro >= 0 ? micro : null;
}
function context(value: string | number | null | undefined) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null; }
function available(item: z.infer<typeof priceItemSchema>) {
  const off = item.offShelfFlag; return item.status === "RELEASED" && item.type === "TEXT_GENERATE" && !(off === true || off === 1 || off === "1" || off === "true");
}
function supportsRequiredFormat(item: z.infer<typeof priceItemSchema>) {
  const parameters = item.protocolParameters?.find(protocol => protocol.protocolName === "openai_chat_completions")?.parameters;
  return item.modelProtocolCompatibility?.openai_chat_completions === true && parameters?.response_format === true;
}
const excluded = /(embedding|rerank|ocr|vision|image|audio|speech|tts|moderation|code|coder|medical|sante|fin(?:ance)?)/i;
function family(candidate: ModelCandidate) { return candidate.provider.toLowerCase() || candidate.id.split(/[-_.]/)[0]!.toLowerCase(); }
function totalPrice(candidate: ModelCandidate) { return candidate.inputPriceMicroCnyPerMillion + candidate.outputPriceMicroCnyPerMillion; }

export async function discoverAntModels(connection: ProviderConnection, fetcher: typeof fetch = fetch, signal?: AbortSignal, preferredIds: string[] = []): Promise<ModelCandidate[]> {
  const modelsUrl = new URL(connection.baseUrl.replace(/\/+$/, "") + "/models");
  if (modelsUrl.origin !== "https://maas-api.antdigital.com" || modelsUrl.pathname !== "/v1/models") throw new LocalApiError(400, "自动选型当前只支持蚂蚁数科官方模型地址。");
  const timeout = AbortSignal.timeout(20_000); const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const [modelsResponse, catalogResponse] = await Promise.all([
    fetcher(modelsUrl, { headers: { authorization: `Bearer ${connection.apiKey}`, accept: "application/json" }, redirect: "error", signal: combined }),
    fetcher("https://maas.antdigital.com/api/v1/model-service/public/page-list?page=1&pageSize=500", { headers: { accept: "application/json" }, redirect: "error", signal: combined }),
  ]);
  if (!modelsResponse.ok) throw new LocalApiError(502, modelsResponse.status === 401 ? "蚂蚁平台拒绝了API Key，请重新粘贴或检查是否已启用。" : "无法读取这把API Key可调用的模型。");
  if (!catalogResponse.ok) throw new LocalApiError(502, "无法取得蚂蚁平台人民币价格，未进行付费测评。");
  const models = upstreamSchema.safeParse(await limitedJson(modelsResponse)); const catalog = catalogSchema.safeParse(await limitedJson(catalogResponse));
  if (!models.success || !catalog.success) throw new LocalApiError(502, "蚂蚁平台模型清单格式发生变化，未进行付费测评。");
  const permitted = new Set(models.data.data.map(item => item.id));
  const priced = catalog.data.data.items.flatMap((item): ModelCandidate[] => {
    const input = parsePrice(item.inPrice), output = parsePrice(item.outPrice);
    if (!permitted.has(item.name) || !available(item) || !supportsRequiredFormat(item) || input == null || output == null || excluded.test(item.name)) return [];
    const candidate = modelCandidateSchema.safeParse({ id: item.name, displayName: item.displayName, provider: item.provider, contextLength: context(item.contextLength), inputPriceMicroCnyPerMillion: input, outputPriceMicroCnyPerMillion: output });
    return candidate.success ? [candidate.data] : [];
  });
  const usable = priced.filter(candidate => (candidate.contextLength ?? 0) >= 64_000);
  const byFamily = new Map<string, ModelCandidate[]>();
  for (const candidate of usable) byFamily.set(family(candidate), [...(byFamily.get(family(candidate)) ?? []), candidate]);
  // One higher-price tier keeps the comparison broad; the remaining seats favor
  // inexpensive models from other providers. Price is never treated as quality.
  const higherTier = [...usable].sort((a, b) => totalPrice(b) - totalPrice(a) || (b.contextLength ?? 0) - (a.contextLength ?? 0))[0];
  const economical = [...byFamily.values()].map(items => items.sort((a, b) => totalPrice(a) - totalPrice(b) || (b.contextLength ?? 0) - (a.contextLength ?? 0))[0]!)
    .sort((a, b) => totalPrice(a) - totalPrice(b));
  const selected: ModelCandidate[] = preferredIds.flatMap(id => usable.find(candidate => candidate.id === id) ?? []).slice(0, 4);
  if (higherTier && selected.length < 4 && !selected.some(item => item.id === higherTier.id)) selected.push(higherTier);
  for (const candidate of economical) { if (selected.length >= 4) break; if (!selected.some(item => item.id === candidate.id) && !selected.some(item => family(item) === family(candidate))) selected.push(candidate); }
  if (selected.length < 3) for (const candidate of usable.sort((a, b) => totalPrice(a) - totalPrice(b))) { if (selected.length >= 4) break; if (!selected.some(item => item.id === candidate.id)) selected.push(candidate); }
  if (selected.length < 3) throw new LocalApiError(409, "当前账号缺少三个有明确人民币价格的不同文本模型，无法进行三模型选型。");
  return selected;
}
