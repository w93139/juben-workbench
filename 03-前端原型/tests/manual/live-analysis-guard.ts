export type VerificationCall = { inputBytes: number; maximumOutputTokens: number; reservedUpperFen: number; startedAt: number };
export interface VerificationBudget { capFen: number; reservedUpperFen: number; calls: VerificationCall[] }
export function guardedVerificationFetch(options: {
  network: typeof fetch; baseUrl: string; model: string; inputPrice: number; outputPrice: number;
  checkedAt: number; report: VerificationBudget; save: () => void; now?: () => number;
}): typeof fetch {
  return async (url, init) => {
    const now = (options.now ?? Date.now)(); const { report } = options;
    if (String(url) !== options.baseUrl + "/chat/completions" || init?.method !== "POST" || typeof init.body !== "string") throw new Error("验证拒绝计划外请求。");
    const body = JSON.parse(init.body);
    if (body.model !== options.model || !Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 16384 || report.calls.length >= 3 || now - options.checkedAt > 600000) throw new Error("验证请求或报价超出计划，停止后续调用。");
    const inputBytes = Buffer.byteLength(init.body);
    // Byte upper estimate and framing allowance, not a provider invoice guarantee.
    const upper = Math.ceil(((inputBytes + 2048) * options.inputPrice + body.max_tokens * options.outputPrice) / 1000000 * 100 * 1.2);
    if (!Number.isSafeInteger(upper) || upper < 0 || report.reservedUpperFen + upper > report.capFen) throw new Error("验证累计预留超出3元，未发起本次请求。");
    report.reservedUpperFen += upper;
    report.calls.push({ inputBytes, maximumOutputTokens: body.max_tokens, reservedUpperFen: upper, startedAt: now });
    options.save();
    return options.network(url, init);
  };
}
