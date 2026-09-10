import { expect, it, vi } from "vitest";
import { guardedVerificationFetch, type VerificationBudget } from "../manual/live-analysis-guard";
const url = "https://maas-api.antdigital.com/v1/chat/completions";
const init = { method: "POST", body: JSON.stringify({ model: "test-model", max_tokens: 100, messages: [{ content: "自有测试" }] }), redirect: "error" as const };
it("真实验证先持久保存预留才发请求，第四次调用被拒绝", async () => {
  const report: VerificationBudget = { capFen: 300, reservedUpperFen: 0, calls: [] };
  const save = vi.fn(); const network = vi.fn(async () => { expect(save).toHaveBeenCalledTimes(report.calls.length); return Response.json({}); });
  const request = guardedVerificationFetch({ network, baseUrl: "https://maas-api.antdigital.com/v1", model: "test-model", inputPrice: 3.375, outputPrice: 10.125, checkedAt: 0, now: () => 0, report, save });
  for (let i = 0; i < 3; i++) await request(url, init);
  const before = structuredClone(report);
  await expect(request(url, init)).rejects.toThrow("超出计划");
  expect(network).toHaveBeenCalledTimes(3); expect(report).toEqual(before);
});
it.each(["budget", "stale", "destination", "save"])("真实验证%s异常时零外呼", async (mode) => {
  const report: VerificationBudget = { capFen: 300, reservedUpperFen: mode === "budget" ? 300 : 0, calls: [] };
  const network = vi.fn();
  const request = guardedVerificationFetch({ network, baseUrl: "https://maas-api.antdigital.com/v1", model: "test-model", inputPrice: 3.375, outputPrice: 10.125, checkedAt: 0, now: () => mode === "stale" ? 600001 : 0, report, save: () => { if (mode === "save") throw new Error("磁盘失败"); } });
  await expect(request(mode === "destination" ? "https://elsewhere.invalid" : url, init)).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();
});
