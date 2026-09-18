import { createHash } from "node:crypto";
import { z } from "zod";
import { StudioBudgetLedger } from "./studio-budget";
import { StudioPrices, calculateQuotedFen, reserveQuotedFen } from "./studio-pricing";
import { LocalApiError } from "./local-security";
import type { StudioConfig } from "./studio-models";
import { REVIEW_PROTOCOL } from "@/domain/studio-production";

const tokens = z.number().int().nonnegative().max(2_147_483_647);
export function studioConfigFingerprint(config: StudioConfig) {
  // Kept only in the restricted server ledger; never return the key or its digest to clients.
  return createHash("sha256").update(JSON.stringify([config.baseUrl, config.apiKey, config.mainModel, config.reviewA, config.reviewB])).digest("hex");
}
export function studioInputFingerprint(projectId: string, operation: string, serializedInput: string) {
  return createHash("sha256").update(JSON.stringify([projectId]) + operation + serializedInput).digest("hex");
}
export function studioExecutionFingerprint(config: StudioConfig, operation: string, planHash = "") {
  const configuration = studioConfigFingerprint(config);
  return operation === "review" ? createHash("sha256").update(configuration + REVIEW_PROTOCOL + planHash).digest("hex") : configuration;
}
export function studioProductionKey(inputFingerprint: string, executionFingerprint: string) {
  return createHash("sha256").update(inputFingerprint + executionFingerprint).digest("hex");
}
const usageSchema = z.object({ model: z.string(), usage: z.object({ prompt_tokens: tokens.positive(), completion_tokens: tokens, total_tokens: tokens.optional(),
  completion_tokens_details: z.object({ reasoning_tokens: tokens.optional() }).passthrough().nullable().optional(),
}).passthrough() }).passthrough();
export interface StudioChargeTicket { callId: string; dispatch(): void; record(envelope: unknown): void; interrupt(): void }
export class StudioBilling {
  constructor(readonly ledger: StudioBudgetLedger, readonly prices = new StudioPrices()) {}
  async prepare(jobId: string, phase: string, config: StudioConfig, model: string, serializedRequest: string, maxTokens: number, signal: AbortSignal): Promise<StudioChargeTicket> {
    const [quote] = await this.prices.get(config.baseUrl, [model], signal);
    signal.throwIfAborted();
    const reservation = reserveQuotedFen(quote, Buffer.byteLength(serializedRequest), maxTokens);
    const callId = this.ledger.reserve(jobId, phase, quote, createHash("sha256").update(serializedRequest).digest("hex"), reservation);
    return {
      callId,
      dispatch: () => this.ledger.dispatch(callId),
      interrupt: () => this.ledger.interrupt(callId),
      record: envelope => {
        const parsed = usageSchema.safeParse(envelope);
        const choices = z.object({ choices: z.array(z.unknown()) }).safeParse(envelope);
        const hasContent = choices.success && choices.data.choices.some(choice => {
          const parsed = z.object({ message: z.object({ content: z.unknown().optional() }) }).safeParse(choice);
          const content = parsed.success ? parsed.data.message.content : undefined;
          return typeof content === "string" ? content.length > 0 : Array.isArray(content) && content.length > 0;
        });
        if (!parsed.success || parsed.data.model !== model
          || parsed.data.usage.completion_tokens === 0 && hasContent
          || parsed.data.usage.total_tokens != null && parsed.data.usage.total_tokens !== parsed.data.usage.prompt_tokens + parsed.data.usage.completion_tokens
          || (parsed.data.usage.completion_tokens_details?.reasoning_tokens ?? 0) > parsed.data.usage.completion_tokens) {
          this.ledger.interrupt(callId, "USAGE_OR_MODEL_UNKNOWN");
          throw new LocalApiError(409, "模型用量或实际模型身份无法核对，已保留待核对费用并停止后续调用。请核对供应商账单。");
        }
        const { prompt_tokens: prompt, completion_tokens: completion } = parsed.data.usage;
        const actual = calculateQuotedFen(quote, prompt, completion);
        if (!this.ledger.settle(callId, actual, prompt, completion)) throw new LocalApiError(409, "本次用量超出预留或费用已由人工核对，已停止后续调用。请查看费用记录。");
      },
    };
  }
}
