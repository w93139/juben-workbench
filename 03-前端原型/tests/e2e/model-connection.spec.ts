import { test, expect } from "@playwright/test";
import { seedProject } from "./project-fixture";

const candidate = (id: string, provider: string, price: number) => ({ id, displayName: id.toUpperCase(), provider, contextLength: 128000, inputPriceMicroCnyPerMillion: price * 1_000_000, outputPriceMicroCnyPerMillion: price * 2_000_000 });
const idle = { status: "idle", phase: "尚未读取候选模型", connectionRevision: 0, priceCheckedAt: null, updatedAt: Date.now(), budgetCapFen: 1000, spentFen: 0, reservedFen: 0, uncertainFen: 0, candidates: [], scores: [], allocation: null, completedCalls: 0, maximumCalls: 0, plannedMaximumFen: 0, error: null };

test("先安全保存蚂蚁连接，再免费读取候选模型；不会自动发起付费调用", async ({ page }) => {
  let providerConfigured = false, contentCalls = 0, discoveryCalls = 0;
  const safe = { baseUrl: "", mainModel: "", reviewA: "", reviewB: "", hasApiKey: false, providerConfigured: false, configured: false, source: "none", revision: 0, environmentLocked: false };
  await page.route("**/api/studio/capability", route => route.fulfill({ json: { configured: false, message: "模型尚未连接" } }));
  await page.route("**/api/studio/settings", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ...safe, ...(providerConfigured ? { baseUrl: "https://maas-api.antdigital.com/v1", hasApiKey: true, providerConfigured: true, source: "local", revision: 1 } : {}) } });
    const body = route.request().postDataJSON(); expect(body.apiKey).toBe("test-only-connection-secret"); expect(body.mainModel).toBe(""); providerConfigured = true;
    return route.fulfill({ json: { ...safe, baseUrl: body.baseUrl, hasApiKey: true, providerConfigured: true, source: "local", revision: 1 } });
  });
  await page.route("**/api/studio/evaluation", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: idle });
    const body = route.request().postDataJSON(); expect(body.action).toBe("discover"); discoveryCalls++;
    return route.fulfill({ json: { ...idle, status: "discovered", phase: "候选模型已就绪，尚未产生模型费用", priceCheckedAt: Date.now(), candidates: [candidate("model-a", "A", 1), candidate("model-b", "B", 2), candidate("model-c", "C", 3)], maximumCalls: 9, plannedMaximumFen: 90 } });
  });
  await page.route(/\/api\/studio\/(analyze|blueprint|review)$/, route => { contentCalls++; return route.abort(); });
  await page.goto("/"); await seedProject(page, "连接验收"); await page.getByRole("button", { name: "配置模型", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog.getByText(/工作台按平台公开价估算/)).toBeVisible();
  await expect(dialog.getByLabel("模型服务地址", { exact: true })).toHaveValue("https://maas-api.antdigital.com/v1");
  await dialog.getByLabel("模型API密钥", { exact: true }).fill("test-only-connection-secret");
  await dialog.getByRole("button", { name: "保存平台连接" }).click(); await expect(dialog.getByText(/平台连接已保存/)).toBeVisible(); await expect(dialog.getByLabel("模型API密钥")).toHaveValue("");
  await dialog.getByRole("button", { name: "读取候选模型（免费）" }).click(); await expect(dialog.getByText("MODEL-A", { exact: true })).toBeVisible(); await expect(dialog.getByRole("button", { name: "开始受限测评" })).toBeVisible();
  expect(discoveryCalls).toBe(1); expect(contentCalls).toBe(0); expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain("test-only-connection-secret");
  await page.screenshot({ path: "test-results/model-connection-desktop.png" });
});
