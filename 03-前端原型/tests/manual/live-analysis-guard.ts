import { z } from "zod";
import { hash } from "@/server/analysis-observation";

type GuardCode = "MISSING_APPROVAL" | "INVALID_EVIDENCE" | "OUTSIDE_PLAN" | "REQUEST_MISMATCH" | "ALREADY_RECORDED" | "RECORD_UNAVAILABLE";
const guardMessages: Record<GuardCode, string> = {
  MISSING_APPROVAL: "缺少单次授权或可核对的供应商金额限额证据",
  INVALID_EVIDENCE: "授权或供应商限额证据无效/过期",
  OUTSIDE_PLAN: "验证请求超出单次计划",
  REQUEST_MISMATCH: "实际请求与授权不一致",
  ALREADY_RECORDED: "相同请求已有记录，禁止重复发送",
  RECORD_UNAVAILABLE: "验证预留无法安全保存",
};
export class VerificationGuardError extends Error {
  constructor(public code: GuardCode) { super(`真实验证关闭：${guardMessages[code]}；零发送。`); this.name = "VerificationGuardError"; }
}
const sha = z.string().regex(/^[a-f0-9]{64}$/);
/** Operator-reviewed provider-side limit is required. A token/byte estimate is not a money cap. */
export const singleCallApprovalSchema = z.object({
  requestHash: sha, inputFingerprint: sha, model: z.string().min(1), maximumOutputTokens: z.literal(4096),
  timeoutMs: z.literal(240000), maximumCalls: z.literal(1), approvedAt: z.number().int(), expiresAt: z.number().int(),
  capFen: z.number().int().positive(),
  providerCap: z.object({ connectionHash: sha, limitFen: z.number().int().positive(), verifiedAt: z.number().int(), evidenceRef: z.string().min(1).max(200) }).strict(),
}).strict();
export type SingleCallApproval = z.infer<typeof singleCallApprovalSchema>;
export function guardedVerificationFetch(options: {
  network: typeof fetch; baseUrl: string; model: string; requestHash: string; inputFingerprint: string; connectionHash: string;
  approval: unknown; reserve: () => void; now?: () => number;
}): typeof fetch {
  let attempted = false;
  return async (url, init) => {
    const now = (options.now ?? Date.now)();
    const parsed = singleCallApprovalSchema.safeParse(options.approval);
    if (!parsed.success) throw new VerificationGuardError("MISSING_APPROVAL");
    const a = parsed.data;
    if (a.approvedAt > now || a.expiresAt <= now || a.expiresAt - a.approvedAt > 600000 || a.providerCap.verifiedAt > now || now - a.providerCap.verifiedAt > 600000 || a.providerCap.limitFen > a.capFen || a.providerCap.connectionHash !== options.connectionHash) throw new VerificationGuardError("INVALID_EVIDENCE");
    if (attempted || a.requestHash !== options.requestHash || a.inputFingerprint !== options.inputFingerprint || a.model !== options.model || String(url) !== options.baseUrl + "/chat/completions" || init?.method !== "POST" || init.redirect !== "error" || typeof init.body !== "string" || !init.signal) throw new VerificationGuardError("OUTSIDE_PLAN");
    let body; try { body = JSON.parse(init.body); } catch { throw new VerificationGuardError("REQUEST_MISMATCH"); }
    if (body.model !== a.model || body.max_tokens !== a.maximumOutputTokens || hash({ baseUrl: options.baseUrl, request: body }) !== a.requestHash) throw new VerificationGuardError("REQUEST_MISMATCH");
    attempted = true;
    // Must atomically claim a persistent record and fsync it before invoking the network.
    try { options.reserve(); }
    catch (error) { throw new VerificationGuardError(error && typeof error === "object" && "code" in error && error.code === "EEXIST" ? "ALREADY_RECORDED" : "RECORD_UNAVAILABLE"); }
    return options.network(url, init);
  };
}
