import { expect, it, vi } from "vitest";
import { openAITransport } from "@/server/studio-models";
import { sourceSelectionSchema } from "@/server/long-analysis";
import { hash } from "@/server/analysis-observation";
import { guardedVerificationFetch, VerificationGuardError } from "../manual/live-analysis-guard";
const baseUrl = "https://maas-api.antdigital.com/v1", model = "deepseek-v4-pro-0813";
const body = { model, max_tokens: 4096, messages: [{ content: "自有样例" }] };
const requestHash = hash({ baseUrl, request: body }), inputFingerprint = hash("test-input"), connectionHash = hash("test-connection");
const init = () => ({ method: "POST", body: JSON.stringify(body), redirect: "error" as const, signal: new AbortController().signal });
const approval = () => ({ requestHash, inputFingerprint, model, maximumOutputTokens: 4096, timeoutMs: 240000, maximumCalls: 1,
  approvedAt: 0, expiresAt: 600000, capFen: 100, providerCap: { connectionHash, limitFen: 100, verifiedAt: 0, evidenceRef: "self-owned-test-receipt" } });
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
  if (mode === "account") a.providerCap.connectionHash = hash("another-account");
  if (mode === "limit") a.providerCap.limitFen = 200;
  const network = vi.fn(), reserve = vi.fn(() => { if (mode === "reserve") throw new Error("记录已存在或无法保存"); });
  const request = guardedVerificationFetch({ network, baseUrl, model, requestHash, inputFingerprint, connectionHash,
    approval: mode === "unverified-money" ? { ...a, providerCap: undefined } : a, reserve, now: () => mode === "stale" ? 600001 : 0 });
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
