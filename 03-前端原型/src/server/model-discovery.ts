import { z } from "zod";
import { modelCandidateSchema, type ModelCandidate } from "@/domain/model-evaluation";
import type { ProviderConnection } from "./studio-settings";
import { LocalApiError } from "./local-security";
import { RESEARCH_SELECTION_POLICY, type CandidateSelectionPolicy } from "@/domain/model-shortlist";

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
  const off = item.offShelfFlag; return item.status === "RELEASED" && ["TEXT_GENERATE", "VISUAL_UNDERSTANDING"].includes(item.type ?? "") && !(off === true || off === 1 || off === "1" || off === "true");
}
function supportsRequiredFormat(item: z.infer<typeof priceItemSchema>) {
  const parameters = item.protocolParameters?.find(protocol => protocol.protocolName === "openai_chat_completions")?.parameters;
  return item.modelProtocolCompatibility?.openai_chat_completions === true && parameters?.response_format === true;
}
const excluded = /(embedding|rerank|ocr|vision|image|audio|speech|tts|moderation|code|coder|medical|sante|fin(?:ance)?)/i;

export async function discoverAntModels(connection: ProviderConnection, fetcher: typeof fetch = fetch, signal?: AbortSignal, preferredIds: string[] = [], excludedIds: string[] = [], policy: CandidateSelectionPolicy = RESEARCH_SELECTION_POLICY): Promise<ModelCandidate[]> {
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
  const excludedSet = new Set(excludedIds); const usable = priced.filter(candidate => (candidate.contextLength ?? 0) >= 64_000 && !excludedSet.has(candidate.id));
  // Existing results may predate the shortlist. Preserve them, but only introduce
  // researched IDs. Never expand to unrelated cheap/high-price models.
  const selected: ModelCandidate[] = preferredIds.flatMap(id => usable.find(candidate => candidate.id === id) ?? []).slice(0, 4);
  const targetCount = Math.min(4, Math.max(policy.initialCount, selected.length));
  for (const id of policy.ids) {
    if (selected.length >= targetCount) break;
    const candidate = usable.find(item => item.id === id);
    if (candidate && !selected.some(item => item.id === id)) selected.push(candidate);
  }
  if (selected.length < 3) throw new LocalApiError(409, "研究清单中缺少三个当前账号可用、格式受支持且价格明确的候选。不会扩大到其他模型或继续付费测评。");
  return selected;
}
