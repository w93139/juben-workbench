import { z } from "zod";
import { hash } from "@/server/analysis-observation";

type GuardCode = "MISSING_APPROVAL" | "INVALID_EVIDENCE" | "OUTSIDE_PLAN" | "REQUEST_MISMATCH" | "ALREADY_RECORDED" | "RECORD_UNAVAILABLE";
const guardMessages: Record<GuardCode, string> = {
  MISSING_APPROVAL: "缺少单次授权、凭据轮换确认或明确费用选择",
  INVALID_EVIDENCE: "授权、报价或额度证据无效/过期",
  OUTSIDE_PLAN: "验证请求超出单次计划",
  REQUEST_MISMATCH: "实际请求与授权不一致",
  ALREADY_RECORDED: "相同请求已有记录，禁止重复发送",
  RECORD_UNAVAILABLE: "验证预留无法安全保存",
};
export class VerificationGuardError extends Error {
  constructor(public code: GuardCode) { super(`真实验证关闭：${guardMessages[code]}；零发送。`); this.name = "VerificationGuardError"; }
}
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().nonnegative();
export const ANT_PRICE_SOURCE = "https://maas.antdigital.com/api/v1/model-service/public/page-list?page=1&pageSize=500";
const costControlSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("provider-cap"), capFen: z.number().int().positive(),
    providerCap: z.object({ limitFen: z.number().int().positive(), verifiedAt: timestamp, evidenceRef: z.string().min(1).max(200) }).strict(),
  }).strict(),
  z.object({ kind: z.literal("accepted-uncertainty"), estimatedFen: z.number().int().positive(),
    inputPricePerMillion: z.number().positive(), outputPricePerMillion: z.number().positive(),
    priceCheckedAt: timestamp, priceSource: z.literal(ANT_PRICE_SOURCE),
    acceptsNoHardMoneyCap: z.literal(true), acceptsUnknownReasoningRetryTimeoutCharges: z.literal(true),
  }).strict(),
]);
/** A human-reviewed manifest is required in BOTH modes. Estimates never become a monetary cap. */
export const singleCallApprovalSchema = z.object({
  requestHash: sha, inputFingerprint: sha, connectionHash: sha, model: z.string().min(1), maximumOutputTokens: z.literal(4096),
  timeoutMs: z.literal(240000), maximumCalls: z.literal(1), approvedAt: timestamp, expiresAt: timestamp,
  credentialRotationConfirmed: z.literal(true), credentialConfirmedAt: timestamp,
  costControl: costControlSchema,
}).strict();
export type SingleCallApproval = z.infer<typeof singleCallApprovalSchema>;
/** Validate before reading any credential file, and again immediately before sending. */
export function preflightVerificationApproval(value: unknown, now = Date.now()): SingleCallApproval {
  const parsed = singleCallApprovalSchema.safeParse(value);
  if (!parsed.success) throw new VerificationGuardError("MISSING_APPROVAL");
  const a = parsed.data;
  if (a.approvedAt > now || a.expiresAt <= now || a.expiresAt - a.approvedAt > 600000 || a.credentialConfirmedAt > a.approvedAt) throw new VerificationGuardError("INVALID_EVIDENCE");
  const cost = a.costControl, checkedAt = cost.kind === "provider-cap" ? cost.providerCap.verifiedAt : cost.priceCheckedAt;
  if (checkedAt > now || now - checkedAt > 600000 || cost.kind === "provider-cap" && cost.providerCap.limitFen > cost.capFen) throw new VerificationGuardError("INVALID_EVIDENCE");
  return a;
}
/** Planning may outlive approval; recheck at the boundary of credential I/O. */
export function readApprovedVerificationConfig<T>(approval: unknown, readConfig: () => T, now = Date.now()): T {
  preflightVerificationApproval(approval, now);
  return readConfig();
}
/** Byte-based heuristic, including 2048 framing allowance and 20% margin; NOT an upper bound. */
export function estimateRequestFen(requestBytes: number, outputTokens: number, inputPrice: number, outputPrice: number) {
  return Math.ceil(((requestBytes + 2048) * inputPrice + outputTokens * outputPrice) / 1000000 * 100 * 1.2);
}
export function verificationCostSummary(a: SingleCallApproval) {
  const c = a.costControl;
  return { mode: c.kind, actualFen: null, estimateFen: c.kind === "accepted-uncertainty" ? c.estimatedFen : null,
    providerCapFen: c.kind === "provider-cap" ? c.providerCap.limitFen : null, acceptsUnknownCost: c.kind === "accepted-uncertainty" };
}
export function guardedVerificationFetch(options: {
  network: typeof fetch; baseUrl: string; model: string; requestHash: string; inputFingerprint: string; connectionHash: string;
  approval: unknown; reserve: () => void; now?: () => number;
}): typeof fetch {
  let attempted = false;
  return async (url, init) => {
    const a = preflightVerificationApproval(options.approval, (options.now ?? Date.now)());
    if (a.connectionHash !== options.connectionHash) throw new VerificationGuardError("INVALID_EVIDENCE");
    if (attempted || a.requestHash !== options.requestHash || a.inputFingerprint !== options.inputFingerprint || a.model !== options.model || String(url) !== options.baseUrl + "/chat/completions" || init?.method !== "POST" || init.redirect !== "error" || typeof init.body !== "string" || !init.signal) throw new VerificationGuardError("OUTSIDE_PLAN");
    let body; try { body = JSON.parse(init.body); } catch { throw new VerificationGuardError("REQUEST_MISMATCH"); }
    if (body.model !== a.model || body.max_tokens !== a.maximumOutputTokens || hash({ baseUrl: options.baseUrl, request: body }) !== a.requestHash) throw new VerificationGuardError("REQUEST_MISMATCH");
    const cost = a.costControl;
    if (cost.kind === "accepted-uncertainty") {
      const estimate = estimateRequestFen(Buffer.byteLength(init.body), body.max_tokens, cost.inputPricePerMillion, cost.outputPricePerMillion);
      if (!Number.isSafeInteger(estimate) || estimate !== cost.estimatedFen) throw new VerificationGuardError("REQUEST_MISMATCH");
    }
    attempted = true;
    // Must atomically claim a persistent record and fsync it before invoking the network.
    try { options.reserve(); }
    catch (error) { throw new VerificationGuardError(error && typeof error === "object" && "code" in error && error.code === "EEXIST" ? "ALREADY_RECORDED" : "RECORD_UNAVAILABLE"); }
    return options.network(url, init);
  };
}
