import { z } from "zod";
import { studioQuoteSchema, type StudioQuote } from "@/domain/studio-budget";
import { LocalApiError } from "./local-security";

export const STUDIO_QUOTE_TTL = 10 * 60 * 1000;
export const ANT_PRICE_URL = "https://maas.antdigital.com/api/v1/model-service/public/page-list?page=1&pageSize=500";
const BASE_URL = "https://maas-api.antdigital.com/v1";
const error = () => new LocalApiError(409, "无法核对当前模型的有效人民币报价，未发起付费调用。请免费刷新报价后重试。");
const catalogSchema = z.object({ success: z.literal(true), data: z.object({ items: z.array(z.object({
  name: z.string().max(200), inPrice: z.string().max(300), outPrice: z.string().max(300),
  status: z.string(), type: z.string().nullable().optional(), offShelfFlag: z.unknown().optional(),
  modelProtocolCompatibility: z.record(z.string(), z.boolean()).optional(),
  protocolParameters: z.array(z.object({ protocolName: z.string(), parameters: z.record(z.string(), z.boolean()) })).optional(),
})).max(1000) }) });

export function parseFlatMicroPrice(value: string): number | null {
  const match = value.match(/^\s*[¥￥]\s*([0-9]{1,7})(?:\.([0-9]{1,6}))?\s*\/\s*M\s*$/i);
  if (!match) return null;
  const micro = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
  return micro <= 1_000_000_000_000n ? Number(micro) : null;
}
export function assertFreshQuote(quote: StudioQuote, baseUrl: string, model: string, now: number) {
  if (!studioQuoteSchema.safeParse(quote).success || quote.baseUrl !== baseUrl || quote.modelId !== model
    || quote.checkedAt > now || quote.expiresAt <= now || quote.expiresAt <= quote.checkedAt
    || quote.expiresAt - quote.checkedAt > STUDIO_QUOTE_TTL) throw error();
}
export function calculateQuotedFen(quote: StudioQuote, promptTokens: number, completionTokens: number): number {
  studioQuoteSchema.parse(quote);
  if (![promptTokens, completionTokens].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647)) throw error();
  const micro = BigInt(promptTokens) * BigInt(quote.inputPriceMicroCnyPerMillion) + BigInt(completionTokens) * BigInt(quote.outputPriceMicroCnyPerMillion);
  const fen = (micro + 9_999_999_999n) / 10_000_000_000n;
  if (fen > BigInt(Number.MAX_SAFE_INTEGER)) throw error();
  return Number(fen);
}
/** Full serialized messages/schema plus a framing margin; this is a conservative estimate, not a tokenizer. */
export function reserveQuotedFen(quote: StudioQuote, requestBytes: number, maxTokens: number) {
  if (!Number.isSafeInteger(requestBytes) || requestBytes <= 0 || requestBytes > 3_000_000
    || !Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens > 1_000_000) throw error();
  const inputTokens = Math.ceil((requestBytes + 2048) * 1.2);
  return calculateQuotedFen(quote, inputTokens, maxTokens);
}
export async function readAntQuotes(baseUrl: string, modelIds: readonly string[], options: { fetcher?: typeof fetch; signal?: AbortSignal; now?: () => number } = {}): Promise<StudioQuote[]> {
  if (baseUrl !== BASE_URL || !modelIds.length || modelIds.length > 3 || modelIds.some(id => !id || id.length > 200)) throw error();
  const now = options.now ?? Date.now;
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  try {
    const response = await (options.fetcher ?? fetch)(ANT_PRICE_URL, { headers: { accept: "application/json" }, redirect: "error", signal });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw error(); }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.byteLength; if (bytes > 2_000_000) throw error();
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const catalog = catalogSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const checkedAt = now();
    return [...new Set(modelIds)].map(modelId => {
      const matches = catalog.data.items.filter(item => item.name === modelId);
      if (matches.length !== 1) throw error();
      const item = matches[0];
      if (item.status !== "RELEASED" || !["TEXT_GENERATE", "VISUAL_UNDERSTANDING"].includes(item.type ?? "")
        || ![undefined, null, false, 0, "0", "false"].some(flag => flag === item.offShelfFlag)
        || item.modelProtocolCompatibility?.openai_chat_completions !== true
        || item.protocolParameters?.find(p => p.protocolName === "openai_chat_completions")?.parameters.response_format !== true) throw error();
      const input = parseFlatMicroPrice(item.inPrice), output = parseFlatMicroPrice(item.outPrice);
      if (input == null || output == null) throw error();
      return studioQuoteSchema.parse({ provider: "ant", baseUrl: BASE_URL, modelId, currency: "CNY", inputPriceMicroCnyPerMillion: input, outputPriceMicroCnyPerMillion: output, checkedAt, expiresAt: checkedAt + STUDIO_QUOTE_TTL });
    });
  } catch { throw error(); }
}

export class StudioPrices {
  private quotes = new Map<string, StudioQuote>();
  private generations = new Map<string, number>();
  constructor(private fetcher: typeof fetch = fetch, private now = Date.now) {}
  async get(baseUrl: string, modelIds: string[], signal?: AbortSignal, refresh = false): Promise<StudioQuote[]> {
    const ids = [...new Set(modelIds)];
    const keys = ids.map(id => baseUrl + "\n" + id);
    if (refresh) for (const key of keys) {
      this.quotes.delete(key); this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    }
    if (!refresh) {
      try {
        return ids.map(id => { const quote = this.quotes.get(baseUrl + "\n" + id)!; assertFreshQuote(quote, baseUrl, id, this.now()); return structuredClone(quote); });
      } catch { /* Expired or absent quotes require a new free catalog read. */ }
    }
    const generations = keys.map(key => this.generations.get(key) ?? 0);
    const quotes = await readAntQuotes(baseUrl, ids, { fetcher: this.fetcher, now: this.now, signal });
    if (keys.some((key, index) => (this.generations.get(key) ?? 0) !== generations[index])) throw error();
    quotes.forEach((quote, index) => this.quotes.set(keys[index], quote));
    return structuredClone(quotes);
  }
}
