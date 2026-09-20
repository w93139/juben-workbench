import { z } from "zod";

export const projectBudgetIdSchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);
export const moneyFenSchema = z.number().int().min(0).max(1_000_000_000);
const integer = z.number().int().nonnegative().safe();
export const studioQuoteSchema = z.object({
  provider: z.literal("ant"), baseUrl: z.literal("https://maas-api.antdigital.com/v1"),
  modelId: z.string().min(1).max(200), currency: z.literal("CNY"),
  inputPriceMicroCnyPerMillion: integer.max(1_000_000_000_000),
  outputPriceMicroCnyPerMillion: integer.max(1_000_000_000_000),
  offPeakInputPriceMicroCnyPerMillion: integer.max(1_000_000_000_000).optional(),
  offPeakOutputPriceMicroCnyPerMillion: integer.max(1_000_000_000_000).optional(),
  checkedAt: integer, expiresAt: integer,
}).strict();
export type StudioQuote = z.infer<typeof studioQuoteSchema>;
export const studioChargeSchema = z.object({
  callId: z.string().uuid(), jobId: z.string().uuid(), model: z.string().max(200), phase: z.string().max(1000),
  state: z.enum(["prepared", "dispatched", "settled", "uncertain", "reconciled", "released"]),
  reservedFen: integer, actualFen: integer.nullable(), version: integer,
  promptTokens: integer.nullable(), completionTokens: integer.nullable(),
  createdAt: integer, updatedAt: integer, quote: studioQuoteSchema,
  reason: z.string().max(100), note: z.string().max(500),
}).strict();
export type StudioCharge = z.infer<typeof studioChargeSchema>;
export const studioBudgetSchema = z.object({
  projectId: projectBudgetIdSchema, revision: integer, ledgerRevision: integer, capFen: moneyFenSchema,
  spentFen: integer, reservedFen: integer, uncertainFen: integer, remainingFen: integer, overrunFen: integer,
  totalCalls: integer, uncertainCalls: integer, offset: integer, calls: z.array(studioChargeSchema).max(100),
}).strict();
export type StudioBudget = z.infer<typeof studioBudgetSchema>;
export const studioBudgetClaimSchema = z.object({ projectId: projectBudgetIdSchema, revision: integer, previewId: z.string().uuid().optional() }).strict();
export type StudioBudgetClaim = z.infer<typeof studioBudgetClaimSchema>;
export const studioBudgetResponseSchema = z.object({ budget: studioBudgetSchema.nullable() }).strict();
export const studioCostPreviewSchema = z.object({
  projectId: projectBudgetIdSchema, operation: z.enum(["analyze", "blueprint", "review"]), budget: studioBudgetSchema,
  previewId: z.string().uuid(),
  reviewMode: z.enum(["generation", "segmented"]).optional(),
  quotes: z.array(studioQuoteSchema).min(1).max(3), callsMax: integer.positive(), estimateFen: integer,
  checkpoint: z.object({ runId: z.uuid().nullable(), savedUnits: integer.max(52000), interruptedUnits: integer.max(52000), totalUnits: integer.min(6).max(52000), allCached: z.boolean() }).strict().refine(value => value.savedUnits + value.interruptedUnits <= value.totalUnits && (!value.allCached || value.runId !== null && value.savedUnits === value.totalUnits), "检查点数量不一致").optional(),
}).strict();
export type StudioCostPreview = z.infer<typeof studioCostPreviewSchema>;

/** No floating-point money arithmetic, blank-to-zero coercion or exponent input. */
export function parseYuanInput(value: string): number | null {
  const match = value.trim().match(/^(0|[1-9][0-9]{0,7})(?:\.([0-9]{1,2}))?$/);
  if (!match) return null;
  const fen = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return moneyFenSchema.safeParse(fen).success ? fen : null;
}
