import { test, expect } from "@playwright/test";
import { seedProject } from "./project-fixture";

const candidate = (id: string, provider: string, price: number) => ({ id, displayName: id.toUpperCase(), provider, contextLength: 128000, inputPriceMicroCnyPerMillion: price * 1_000_000, outputPriceMicroCnyPerMillion: price * 2_000_000 });
const idle = { status: "idle", phase: "尚未读取候选模型", connectionRevision: 0, priceCheckedAt: null, updatedAt: Date.now(), budgetCapFen: 1000, spentFen: 0, reservedFen: 0, uncertainFen: 0, candidates: [], scores: [], allocation: null, completedCalls: 0, maximumCalls: 0, plannedMaximumFen: 0, error: null, taskVersion: "juben-model-eval/1.1" };

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
    return route.fulfill({ json: { ...idle, status: "discovered", phase: "候选模型已就绪，尚未产生模型费用", priceCheckedAt: Date.now(), candidates: [candidate("model-a", "A", 1), candidate("model-b", "B", 2), candidate("model-c", "C", 3)], maximumCalls: 9, plannedMaximumFen: 90, responsePolicyVersion: "openai-json/2-4096" } });
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

test("中断后明确保留已完成结果，由用户点击才继续剩余测评", async ({ page }) => {
  const models = [candidate("model-a", "A", 1), candidate("model-b", "B", 2), candidate("model-c", "C", 3)];
  const blocked = { ...idle, status: "blocked", phase: "测评因费用或服务状态停止", connectionRevision: 1, priceCheckedAt: Date.now(), spentFen: 20, uncertainFen: 2, candidates: models, scores: [{ modelId: "model-a", total: 64, structure: 71, evidence: 48, originality: 53, format: 100, latencyMs: 1000, promptTokens: 6000, completionTokens: 75, costFen: 20, usageEstimated: false, notes: ["未达到金标"] }], completedCalls: 3, maximumCalls: 9, plannedMaximumFen: 50, resumeCount: 0, error: "模型服务未返回用量" };
  await page.route("**/api/studio/capability", route => route.fulfill({ json: { configured: false, message: "待选型" } }));
  await page.route("**/api/studio/settings", route => route.fulfill({ json: { baseUrl: "https://maas-api.antdigital.com/v1", mainModel: "", reviewA: "", reviewB: "", hasApiKey: true, providerConfigured: true, configured: false, source: "local", revision: 1, environmentLocked: false } }));
  await page.route("**/api/studio/evaluation", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: blocked });
    expect(route.request().postDataJSON()).toEqual({ action: "resume" });
    return route.fulfill({ status: 202, json: { ...blocked, status: "running", phase: "已保留完成结果，正在继续剩余测评", resumeCount: 1, error: null } });
  });
  const markdown = "# 剧本工作台模型测评报告\n\n测评尚未完整结束\n\n待平台核对：¥0.02";
  await page.route("**/api/studio/evaluation/report", route => route.fulfill({ json: { filename: "模型测评报告.md", markdown, viewRevision: 0 } }));
  await page.goto("/"); await page.getByRole("button", { name: "配置模型", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog.getByText(/已完成题目不会重测/)).toBeVisible();
  await dialog.getByRole("button", { name: "查看测评报告" }).click(); await expect(dialog.getByText("# 剧本工作台模型测评报告", { exact: false })).toBeVisible();
  const download = page.waitForEvent("download"); await dialog.getByRole("button", { name: "下载报告（Markdown）" }).click(); expect((await download).suggestedFilename()).toBe("模型测评报告.md");
  await dialog.getByRole("button", { name: "核对价格并继续测评" }).click();
  await expect(dialog.getByText(/已保留完成结果，正在继续剩余测评/)).toBeVisible();
});

test("旧版length截断会解释为答题空间不足，并提供新版长度入口", async ({ page }) => {
  const models = [candidate("model-a", "A", 1), candidate("model-b", "B", 2), candidate("model-c", "C", 3)];
  const blocked = { ...idle, status: "blocked", phase: "有候选返回不兼容", connectionRevision: 1, priceCheckedAt: Date.now(), spentFen: 28, uncertainFen: 4, candidates: models, scores: [{ modelId: "model-a", total: 64, structure: 71, evidence: 48, originality: 53, format: 100, latencyMs: 1000, promptTokens: 6000, completionTokens: 75, costFen: 20, usageEstimated: false, notes: ["未达到金标"] }], excludedModels: [{ modelId: "model-b", displayName: "MODEL-B", reason: "服务以length结束，正文可能不完整", costFen: 2, usageEstimated: false, occurredAt: Date.now() }], completedCalls: 3, maximumCalls: 9, plannedMaximumFen: 45, resumeCount: 3, resumeAllowed: false, responsePolicyVersion: null, lastFailure: { modelId: "model-b", taskIndex: 0, category: "response", occurredAt: Date.now() }, error: "旧版长度不足" };
  await page.route("**/api/studio/settings", route => route.fulfill({ json: { baseUrl: "https://maas-api.antdigital.com/v1", mainModel: "", reviewA: "", reviewB: "", hasApiKey: true, providerConfigured: true, configured: false, source: "local", revision: 1, environmentLocked: false } }));
  await page.route("**/api/studio/evaluation", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: blocked });
    expect(route.request().postDataJSON()).toEqual({ action: "resume" });
    return route.fulfill({ status: 202, json: { ...blocked, status: "running", phase: "已加长答题空间，正在重新测评此前被截断的候选", excludedModels: [], resumeCount: 0, responsePolicyVersion: "openai-json/2-4096", error: null } });
  });
  await page.goto("/"); await page.getByRole("button", { name: "配置模型", exact: true }).click(); const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/回答达到旧版长度上限，正文被截断；不是模型损坏/)).toBeVisible();
  await dialog.getByRole("button", { name: "使用新版长度继续测评" }).click(); await expect(dialog.getByText(/已加长答题空间/)).toBeVisible();
});


test("旧轮停下后显示历史评分限制，免费规划不开始调用且保留历史报告入口", async ({ page }) => {
  const models = [candidate("model-a", "A", 1), candidate("model-b", "B", 2), candidate("model-c", "C", 3)];
  const blocked = { ...idle, taskVersion: null, status: "blocked", phase: "旧版笼统错误", candidates: models, spentFen: 62, uncertainFen: 24, maximumCalls: 13, completedCalls: 1, resumeAllowed: false, excludedModels: [{ modelId: "model-c", displayName: "MODEL-C", reason: "旧版length截断，保留为本轮自动替补候选", costFen: 1, usageEstimated: false, occurredAt: Date.now() }], taskResults: [{ modelId: "model-b", taskIndex: 0, structure: 0, evidence: 0, originality: 0, format: 0, latencyMs: 1, promptTokens: 1, completionTokens: 1, costFen: 1, usageEstimated: false, notes: ["旧记录"] }] };
  let prepares = 0;
  await page.route("**/api/studio/settings", route => route.fulfill({ json: { baseUrl: "https://maas-api.antdigital.com/v1", mainModel: "", reviewA: "", reviewB: "", hasApiKey: true, providerConfigured: true, configured: false, source: "local", revision: 1, environmentLocked: false } }));
  await page.route("**/api/studio/evaluation", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: blocked });
    expect(route.request().postDataJSON()).toEqual({ action: "prepare" }); prepares++;
    return route.fulfill({ json: { ...blocked, status: "discovered", taskVersion: "juben-model-eval/1.1", responsePolicyVersion: "openai-json/2-4096", archivedViewRevision: 27, taskResults: [], excludedModels: [], completedCalls: 0, maximumCalls: 9, priceCheckedAt: Date.now(), phase: "修订版测评计划已准备" } });
  });
  await page.goto("/"); await page.getByRole("button", { name: "配置模型", exact: true }).click(); const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/本轮已停止/)).toBeVisible(); await expect(dialog.getByText(/部分完成 1\/3/)).toBeVisible();
  await expect(dialog.getByText(/本轮已经停止，不会自动再测/)).toBeVisible();
  await expect(dialog.getByText(/旧版评分记录需要复核/)).toBeVisible();
  await dialog.getByRole("button", { name: "准备修订版测评计划（免费）" }).click();
  await expect(dialog.getByRole("button", { name: "开始受限测评" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "下载上一轮报告" })).toBeVisible(); expect(prepares).toBe(1);
});


test("研究依据可展开，等待首题时进度轨道和运行提示可见且不会重启测评", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/studio/settings", route => route.fulfill({ json: { baseUrl: "https://maas-api.antdigital.com/v1", mainModel: "", reviewA: "", reviewB: "", hasApiKey: true, providerConfigured: true, configured: false, source: "local", revision: 1, environmentLocked: false } }));
  await page.route("**/api/studio/capability", route => route.fulfill({ json: { configured: false, message: "等待选型" } }));
  await page.route("**/api/studio/evaluation", route => {
    if (route.request().method() === "POST") posts++;
    return route.fulfill({ json: { ...idle, status: "running", phase: "正在测评 Qwen：结构与证据拆解", candidates: [candidate("qwen3.8-max", "Qwen", 1)], maximumCalls: 9, candidatePolicyVersion: "script-research/2026-09-09" } });
  });
  await page.goto("/"); await page.getByRole("button", { name: "配置模型", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const progress = dialog.getByRole("progressbar", { name: "模型测评完成进度" });
  await expect(progress).toHaveAttribute("aria-valuenow", "0");
  expect(await progress.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(227, 222, 214)");
  await expect(dialog.getByText("正在等待本题回答，完成后更新进度。")).toBeVisible();
  await dialog.getByText("根据公开资料筛选：3 个首选＋1 个替补", { exact: true }).click();
  await expect(dialog.getByText("Kimi K3 · 跨角色信息与独立复核", { exact: true })).toBeVisible();
  expect(posts).toBe(0);
  await page.screenshot({ path: "test-results/research-shortlist-progress.png" });
});


test("停止的窗口自动显示外部准备的新计划，旧响应不能覆盖新状态或输入草稿", async ({ page }) => {
  let posts = 0, reads = 0;
  const models = [candidate("qwen3.8-max", "Qwen", 1), candidate("deepseek-v4-pro-0813", "DeepSeek", 2), candidate("kimi-k3", "Kimi", 3)];
  const blocked = { ...idle, status: "blocked", viewRevision: 42, candidates: models, completedCalls: 3, maximumCalls: 9, spentFen: 91, uncertainFen: 63, error: "旧轮服务错误", phase: "本轮已停止" };
  const ready = { ...blocked, status: "discovered", viewRevision: 43, error: null, phase: "新计划已就绪", responsePolicyVersion: "openai-json/2-4096", candidatePolicyVersion: "script-research/2026-09-09", priceCheckedAt: Date.now(), archivedViewRevision: 42, carriedBudget: { spentFen: 91, uncertainFen: 63 }, excludedModels: [{ modelId: "lingdt", displayName: "历史候选", reason: "旧轮回答被截断", costFen: 1, usageEstimated: false, occurredAt: Date.now() }] };
  let view: object = blocked;
  await page.route("**/api/studio/settings", route => route.fulfill({ json: { baseUrl: "https://maas-api.antdigital.com/v1", mainModel: "", reviewA: "", reviewB: "", hasApiKey: true, providerConfigured: true, configured: false, source: "local", revision: 1, environmentLocked: false } }));
  await page.route("**/api/studio/evaluation", route => { reads++; if (route.request().method() !== "GET") posts++; return route.fulfill({ json: view }); });
  await page.goto("/"); await page.getByRole("button", { name: "配置模型", exact: true }).click(); const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("旧轮服务错误", { exact: true })).toBeVisible();
  await dialog.getByLabel("模型API密钥", { exact: true }).fill("test-only-unsaved-draft");
  view = ready;
  await expect(dialog.getByText("新计划已准备，尚未开始", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText("旧轮服务错误", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/剩余 6 道待验证/)).toBeVisible();
  await expect(dialog.getByText(/旧轮回答被截断/)).not.toBeVisible();
  await expect(dialog.getByRole("button", { name: "开始受限测评", exact: true })).toBeEnabled();
  await expect(dialog.getByLabel("模型API密钥", { exact: true })).toHaveValue("test-only-unsaved-draft");
  view = blocked; const beforeReads = reads;
  await dialog.getByRole("button", { name: "刷新状态", exact: true }).click();
  await expect.poll(() => reads).toBeGreaterThan(beforeReads);
  await expect(dialog.getByText("新计划已准备，尚未开始", { exact: true })).toBeVisible();
  expect(posts).toBe(0);
});

test("报价过期明确提示免费刷新，回到页面同步而不开始收费", async ({ page }) => {
  let reads = 0;
  let view: object = { ...idle, status: "discovered", viewRevision: 50, candidates: [candidate("qwen3.8-max", "Qwen", 1)], completedCalls: 3, maximumCalls: 9, responsePolicyVersion: "openai-json/2-4096", priceCheckedAt: Date.now() - 11 * 60 * 1000, archivedViewRevision: 42, carriedBudget: { spentFen: 91, uncertainFen: 63 } };
  await page.route("**/api/studio/settings", route => route.fulfill({ json: { baseUrl: "https://maas-api.antdigital.com/v1", mainModel: "", reviewA: "", reviewB: "", hasApiKey: true, providerConfigured: true, configured: false, source: "local", revision: 1, environmentLocked: false } }));
  await page.route("**/api/studio/evaluation", route => { expect(route.request().method()).toBe("GET"); reads++; return route.fulfill({ json: view }); });
  await page.goto("/"); await page.getByRole("button", { name: "配置模型", exact: true }).click(); const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/报价已超过10分钟/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "开始受限测评", exact: true })).toBeDisabled();
  view = { ...view, viewRevision: 51, priceCheckedAt: Date.now() }; const before = reads;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(dialog.getByRole("button", { name: "开始受限测评", exact: true })).toBeEnabled();
});
