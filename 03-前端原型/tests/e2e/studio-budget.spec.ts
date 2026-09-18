import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { seedProject } from "./project-fixture";
import { budgetFixture, installBudgetFixture, testQuotes } from "./budget-fixture";

async function offline(page: Page) {
  await page.route("**/api/studio/capability", route => route.fulfill({ json: { configured: true, message: "自造连接" } }));
  await page.route(/\/api\/studio\/(analyze|blueprint|review)$/, route => route.abort());
}
async function material(page: Page) {
  await page.locator('input[aria-label="上传原剧本文件"]').setInputFiles({ name: "自有测试.txt", mimeType: "text/plain", buffer: Buffer.from("仅用于本地验证的自造故事，不是真实原文。") });
  await expect(page.getByRole("button", { name: "拆解大纲", exact: true })).toBeEnabled();
}
const projectId = (base: string) => new URL(base).pathname.match(/\/projects\/([^/]+)/)![1];

test("新项目无默认额度，保存后刷新保留；另一个项目仍未设置", async ({ page }) => {
  const fixture = await installBudgetFixture(page, null); await offline(page);
  const base = await seedProject(page, "预算保存"); await material(page);
  let paid = 0; page.on("request", request => { if (/\/api\/studio\/(analyze|blueprint|review)$/.test(request.url()) && request.method() === "POST") paid++; });
  await page.getByRole("button", { name: "拆解大纲", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "项目创作预算" }); await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("累计额度（元）")).toHaveValue("");
  await dialog.getByLabel("累计额度（元）").fill("12.34"); await dialog.getByRole("button", { name: "保存项目额度" }).click();
  await expect.poll(() => fixture.budgets.get(projectId(base))?.capFen).toBe(1234);
  await page.reload(); await page.getByRole("button", { name: "创作预算", exact: true }).click();
  await expect(dialog.getByLabel("累计额度（元）")).toHaveValue("12.34");
  await dialog.getByRole("button", { name: "免费刷新模型报价" }).click(); await expect(dialog.getByText(/main：输入/)).toBeVisible();
  expect(paid).toBe(0); expect(fixture.controls.previews).toBe(0);
  await page.reload(); await seedProject(page, "另一预算项目"); await page.getByRole("button", { name: "创作预算", exact: true }).click();
  await expect(dialog.getByLabel("累计额度（元）")).toHaveValue("");
});
test("两个页面预算CAS冲突保留输入，使用最新额度后重新编辑", async ({ page, context }) => {
  await installBudgetFixture(context); await offline(page); const base = await seedProject(page, "预算冲突");
  await page.getByRole("button", { name: "创作预算", exact: true }).click();
  await page.getByLabel("累计额度（元）").fill("40.00");
  const other = await context.newPage(); await offline(other); await other.goto(base);
  await other.getByRole("button", { name: "创作预算", exact: true }).click(); await other.getByLabel("累计额度（元）").fill("50.00");
  await other.getByRole("button", { name: "保存项目额度" }).click(); await expect(other.getByRole("button", { name: "保存项目额度" })).toBeDisabled();
  await page.bringToFront(); await page.getByRole("button", { name: "保存项目额度" }).click();
  await expect(page.getByRole("alert")).toContainText("另一个页面"); await expect(page.getByLabel("累计额度（元）")).toHaveValue("40.00");
  await page.getByRole("button", { name: "使用最新额度" }).click(); await expect(page.getByLabel("累计额度（元）")).toHaveValue("50.00");
});
test("预览取消不生成，确认双击只提交一次并携带项目/预算/预览绑定", async ({ page }) => {
  const fixture = await installBudgetFixture(page); await offline(page); const base = await seedProject(page, "费用预览"); await material(page);
  let posts = 0, id = "";
  await page.route("**/api/studio/analyze", async route => {
    posts++; const headers = route.request().headers(); id = headers["x-studio-request-id"];
    expect(headers["x-studio-project-id"]).toBe(projectId(base)); expect(headers["x-studio-budget-revision"]).toBe("1"); expect(headers["x-studio-budget-preview"]).toMatch(/^[a-f0-9-]{36}$/);
    await route.fulfill({ status: 202, json: { jobId: id, status: "running", phase: "自造调用中" } });
  });
  await page.route("**/api/studio/status?**", route => route.fulfill({ json: { jobId: id, status: "running", phase: "自造调用中" } }));
  await page.getByRole("button", { name: "拆解大纲", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "本次创作费用" }); await expect(dialog).toContainText("原剧本拆解最多 1 次");
  await dialog.getByRole("button", { name: "取消", exact: true }).click(); expect(posts).toBe(0);
  await page.getByRole("button", { name: "拆解大纲", exact: true }).click(); await dialog.getByRole("button", { name: "按项目额度开始" }).dblclick();
  await expect(page.getByRole("heading", { name: "自造调用中" })).toBeVisible(); expect(posts).toBe(1); expect(fixture.controls.previews).toBe(2);
  await page.reload(); await expect(page.getByRole("heading", { name: "自造调用中" })).toBeVisible(); expect(posts).toBe(1);
});
test("未知报价或待核对费用阻止生成，刷新页面不自动重试", async ({ page }) => {
  const fixture = await installBudgetFixture(page); await offline(page); const base = await seedProject(page, "预算阻断"); await material(page);
  fixture.controls.failPreview = true; let posts = 0;
  page.on("request", request => { if (/\/api\/studio\/(analyze|blueprint|review)$/.test(request.url()) && request.method() === "POST") posts++; });
  await page.getByRole("button", { name: "拆解大纲", exact: true }).click(); await expect(page.getByRole("region", { name: "具体功能内容" }).getByRole("alert")).toContainText("有效报价");
  const budget = fixture.budgets.get(projectId(base))!; budget.uncertainCalls = 1; budget.uncertainFen = 20; budget.ledgerRevision++;
  await page.reload(); await page.getByRole("button", { name: "拆解大纲", exact: true }).click(); await expect(page.getByRole("dialog", { name: "项目创作预算" })).toBeVisible();
  expect(posts).toBe(0); expect(fixture.controls.previews).toBe(1);
});
test("长费用列表和窄屏中就地核对，空白和版本冲突都在表单附近显示且保留输入", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await installBudgetFixture(page); await offline(page); const base = await seedProject(page, "费用核对");
  const id = projectId(base), budget = budgetFixture(id);
  budget.calls = Array.from({ length: 35 }, (_, index) => ({ callId: randomUUID(), jobId: randomUUID(), model: "main", phase: `自造阶段${index}`, state: index === 0 ? "uncertain" : "settled", reservedFen: 10, actualFen: index === 0 ? null : 5, version: 1, promptTokens: null, completionTokens: null, createdAt: Date.now(), updatedAt: Date.now(), quote: testQuotes()[0], reason: "", note: "" }));
  budget.totalCalls = 35; budget.uncertainCalls = 1; budget.uncertainFen = 10; budget.ledgerRevision = 2; fixture.budgets.set(id, budget);
  await page.reload(); await page.getByRole("button", { name: "创作预算", exact: true }).click(); await page.getByRole("button", { name: "核对这笔费用" }).click();
  const form = page.getByRole("region", { name: "核对待定费用" });
  await expect(form).toBeVisible(); await form.getByRole("button", { name: "保存核对金额" }).click();
  await expect(form.getByRole("alert")).toContainText("空白不代表零元");
  await form.getByLabel("账单实际金额（元）").fill("0.08"); await form.getByLabel("核对依据").fill("供应商自造账单核对");
  fixture.controls.failReconcile = true; await form.getByRole("button", { name: "保存核对金额" }).click();
  await expect(form.getByRole("alert")).toContainText("费用记录已变化"); await expect(form.getByLabel("账单实际金额（元）")).toHaveValue("0.08");
  expect(fixture.budgets.get(id)!.uncertainCalls).toBe(1);
  fixture.controls.failReconcile = false; await form.getByRole("button", { name: "保存核对金额" }).click(); await expect(form).toHaveCount(0);
  expect(fixture.budgets.get(id)!.uncertainCalls).toBe(0); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
