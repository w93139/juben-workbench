import { expect, it, vi } from "vitest";
import { openAITransport } from "@/server/studio-models";
import { sourceSelectionSchema } from "@/server/long-analysis";
import { hash } from "@/server/analysis-observation";
import { guardedVerificationFetch, VerificationGuardError, preflightVerificationApproval, readApprovedVerificationConfig, verificationCostSummary, estimateRequestFen, ANT_PRICE_SOURCE } from "../manual/live-analysis-guard";
const baseUrl = "https://maas-api.antdigital.com/v1", model = "deepseek-v4-pro-0813";
const body = { model, max_tokens: 4096, messages: [{ content: "自有样例" }] };
const requestHash = hash({ baseUrl, request: body }), inputFingerprint = hash("test-input"), connectionHash = hash("test-connection");
const init = () => ({ method: "POST", body: JSON.stringify(body), redirect: "error" as const, signal: new AbortController().signal });
const approval = () => ({ requestHash, inputFingerprint, model, maximumOutputTokens: 4096, timeoutMs: 240000, maximumCalls: 1,
  approvedAt: 0, expiresAt: 600000, connectionHash, credentialRotationConfirmed: true, credentialConfirmedAt: 0,
  costControl: { kind: "provider-cap" as const, capFen: 100, providerCap: { limitFen: 100, verifiedAt: 0, evidenceRef: "self-owned-test-receipt" } } });
it("严格一次发送，先持久预留；首次失败也不重试", async () => {
  const reserve = vi.fn(), network = vi.fn(async () => { expect(reserve).toHaveBeenCalledTimes(1); throw new Error("network failure"); });
  const request = guardedVerificationFetch({ network, baseUrl, model, requestHash, inputFingerprint, connectionHash, approval: approval(), reserve, now: () => 0 });
  await expect(request(baseUrl + "/chat/completions", init())).rejects.toThrow("network failure");
  await expect(request(baseUrl + "/chat/completions", init())).rejects.toThrow("单次计划");
  expect(network).toHaveBeenCalledTimes(1);
});
it.each(["unverified-money", "stale", "destination", "parameters", "input", "reserve", "account", "limit", "redirect"])("%s 时零外呼", async mode => {
  const a = approval();
  if (mode === "input") a.inputFingerprint = hash("different-input");
  if (mode === "account") a.connectionHash = hash("another-account");
  if (mode === "limit") a.costControl.providerCap.limitFen = 200;
  const network = vi.fn(), reserve = vi.fn(() => { if (mode === "reserve") throw new Error("记录已存在或无法保存"); });
  const request = guardedVerificationFetch({ network, baseUrl, model, requestHash, inputFingerprint, connectionHash,
    approval: mode === "unverified-money" ? { ...a, costControl: undefined } : a, reserve, now: () => mode === "stale" ? 600001 : 0 });
  const options: RequestInit = init();
  if (mode === "parameters") options.body = JSON.stringify({ ...body, max_tokens: 8192 });
  if (mode === "redirect") options.redirect = "follow";
  await expect(request(mode === "destination" ? "https://elsewhere.invalid" : baseUrl + "/chat/completions", options)).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();
});
it("重建入口仍须持久预留，既有记录阻断另一个进程的相同请求", async () => {
  let recorded = false;
  const reserve = () => { if (recorded) throw Object.assign(new Error("private path"), { code: "EEXIST" }); recorded = true; };
  const network = vi.fn(async () => Response.json({}));
  const options = { network, baseUrl, model, requestHash, inputFingerprint, connectionHash, approval: approval(), reserve, now: () => 0 };
  await guardedVerificationFetch(options)(baseUrl + "/chat/completions", init());
  await expect(guardedVerificationFetch(options)(baseUrl + "/chat/completions", init())).rejects.toThrow("已有记录");
  expect(network).toHaveBeenCalledTimes(1);
});

it("经过正式 transport 的本地授权拒绝保留安全码，未误报为已发送的供应商故障", async () => {
  const network = vi.fn();
  const request = guardedVerificationFetch({ network, baseUrl, model, requestHash, inputFingerprint, connectionHash, approval: approval(), reserve: vi.fn(), now: () => 600001 });
  vi.stubGlobal("fetch", request);
  try {
    await expect(openAITransport({ baseUrl, apiKey: "self-owned-test", mainModel: model, reviewA: "a", reviewB: "b" }, model, "test", {}, sourceSelectionSchema, new AbortController().signal, { maxTokens: 4096 })).rejects.toMatchObject({ name: "VerificationGuardError", code: "INVALID_EVIDENCE", message: expect.stringContaining("零发送") });
    expect(network).not.toHaveBeenCalled(); expect(new VerificationGuardError("RECORD_UNAVAILABLE").message).not.toContain("private path");
  } finally { vi.unstubAllGlobals(); }
});

const riskApproval = () => ({ ...approval(), costControl: {
  kind: "accepted-uncertainty" as const, estimatedFen: estimateRequestFen(Buffer.byteLength(init().body), 4096, 9, 27),
  inputPricePerMillion: 9, outputPricePerMillion: 27, priceCheckedAt: 0, priceSource: ANT_PRICE_SOURCE,
  acceptsNoHardMoneyCap: true as const, acceptsUnknownReasoningRetryTimeoutCharges: true as const,
} });
it("明确接受费用不确定性可只发一次，报告不伪造金额上限或实际费用", async () => {
  const a = riskApproval(), reserve = vi.fn(), network = vi.fn(async () => Response.json({}));
  const request = guardedVerificationFetch({ network, baseUrl, model, requestHash, inputFingerprint, connectionHash, approval: a, reserve, now: () => 0 });
  await request(baseUrl + "/chat/completions", init());
  await expect(request(baseUrl + "/chat/completions", init())).rejects.toThrow("单次计划");
  expect(network).toHaveBeenCalledTimes(1); expect(reserve).toHaveBeenCalledTimes(1);
  expect(verificationCostSummary(preflightVerificationApproval(a, 0))).toMatchObject({ mode: "accepted-uncertainty", actualFen: null, providerCapFen: null, acceptsUnknownCost: true });
});
it.each(["no-cap-ack", "unknown-charges-ack", "unconfirmed-rotation", "old-approval", "quote-stale", "quote-changed", "wrong-account"])("费用不确定模式 %s 时零外呼", async mode => {
  const original = riskApproval();
  const a = { ...original, credentialRotationConfirmed: mode !== "unconfirmed-rotation", costControl: { ...original.costControl,
    acceptsNoHardMoneyCap: mode !== "no-cap-ack", acceptsUnknownReasoningRetryTimeoutCharges: mode !== "unknown-charges-ack" } };
  if (mode === "old-approval") { a.approvedAt = 1; a.expiresAt = 2; }
  if (mode === "quote-stale") { a.approvedAt = 600001; a.expiresAt = 900000; }
  if (mode === "quote-changed") a.costControl.estimatedFen++;
  if (mode === "wrong-account") a.connectionHash = hash("different-new-key");
  const network = vi.fn(), reserve = vi.fn();
  const request = guardedVerificationFetch({ network, baseUrl, model, requestHash, inputFingerprint, connectionHash, approval: a, reserve, now: () => mode === "quote-stale" ? 600001 : 3 });
  await expect(request(baseUrl + "/chat/completions", init())).rejects.toThrow(VerificationGuardError);
  expect(network).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
});
it("显式选择费用方式及凭据轮换确认均不可缺失，不接受旧宽松授权", () => {
  for (const value of [{ ...approval(), credentialRotationConfirmed: undefined }, { ...riskApproval(), costControl: undefined }, { ...approval(), credentialConfirmedAt: 1 }]) {
    expect(() => preflightVerificationApproval(value, 0)).toThrow(VerificationGuardError);
  }
});
it("规划期间授权或报价过期时，不打开凭据配置", () => {
  const readConfig = vi.fn();
  for (const a of [approval(), riskApproval()]) {
    const initiallyValid = preflightVerificationApproval(a, 0);
    expect(() => readApprovedVerificationConfig(initiallyValid, readConfig, 600001)).toThrow(VerificationGuardError);
  }
  expect(readConfig).not.toHaveBeenCalled();
});
