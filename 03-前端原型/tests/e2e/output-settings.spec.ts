import { expect, test, type Page } from "@playwright/test";
const key = "juben-workbench:projects:v1";
const panel = (page: Page) => page.getByRole("region", { name: "输出储存位置" });
async function fallback(page: Page) { await panel(page).getByText("无法选择？备用方式", { exact: true }).click(); }
async function create(page: Page) {
  await page.goto("/projects/new");
  await page.getByLabel("项目名称", { exact: false }).fill("输出位置测试");
  await page.getByRole("button", { name: "创建并进入工作台" }).click();
  await expect(page.getByRole("heading", { name: "输出位置测试", exact: true })).toBeVisible();
  return page.url();
}
for (const width of [1440, 390]) test(`目录默认直接选择，备用路径跨阶段共用并保留旧子目录 ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const url = await create(page);
  // A previous version's customized folder is preserved without exposing a setup form.
  await page.evaluate((key) => { const state = JSON.parse(localStorage.getItem(key)!); state.projects[0].outputSettings.folders.analysis = "参考研究/拆解结果"; localStorage.setItem(key, JSON.stringify(state)); }, key);
  await page.goto(`${url}/stages/analysis`);
  await expect(panel(page).getByRole("button", { name: "选择输出文件夹" })).toBeVisible();
  await expect(panel(page).getByLabel("项目总输出目录")).toBeHidden();
  await expect(panel(page).getByLabel("本阶段子目录")).toHaveCount(0);
  await fallback(page);
  await panel(page).getByLabel("项目总输出目录").fill("/Users/作者/Desktop/创作输出");
  await expect(page.getByTestId("output-path-preview")).toHaveText("/Users/作者/Desktop/创作输出/参考研究/拆解结果");
  await panel(page).getByRole("button", { name: "保存路径", exact: true }).click();
  await expect(panel(page).getByText("已保存", { exact: true })).toBeVisible();
  await page.reload(); await fallback(page);
  await expect(panel(page).getByLabel("项目总输出目录")).toHaveValue("/Users/作者/Desktop/创作输出");
  await expect(page.getByTestId("output-path-preview")).toHaveText("/Users/作者/Desktop/创作输出/参考研究/拆解结果");
  for (const stage of ["mechanisms", "direction", "blueprint", "generation", "review", "playtest", "export"]) {
    await page.goto(`${url}/stages/${stage}`);
    await expect(panel(page).getByTestId("output-directory-name")).toHaveText("/Users/作者/Desktop/创作输出");
  }
  await fallback(page);
  const saved = await page.evaluate((key) => localStorage.getItem(key), key);
  await panel(page).getByLabel("项目总输出目录").fill("../参考原件");
  await expect(panel(page).getByRole("button", { name: "保存路径", exact: true })).toBeDisabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(saved);
  await page.screenshot({ path: testInfo.outputPath("output-settings.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/projects/demo-names/stages/analysis");
  await expect(panel(page).getByRole("button", { name: "选择输出文件夹" })).toBeEnabled();
  await expect(panel(page).getByRole("link", { name: "选择输出文件夹" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("备用路径保存失败保留草稿，跨页冲突不覆盖且可明确重试", async ({ page, context }) => {
  const url = await create(page); await page.goto(`${url}/stages/analysis`); await fallback(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && !sessionStorage.getItem("allow-output")) throw new DOMException("quota", "QuotaExceededError");
      original.call(this, name, value);
    };
  }, key);
  await panel(page).getByLabel("项目总输出目录").fill("/tmp/本页输出");
  await panel(page).getByRole("button", { name: "保存路径", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("保存失败");
  await expect(panel(page).getByLabel("项目总输出目录")).toHaveValue("/tmp/本页输出");
  await page.evaluate(() => sessionStorage.setItem("allow-output", "1"));
  await panel(page).getByRole("button", { name: "保存路径", exact: true }).click();
  await expect(panel(page).getByText("已保存", { exact: true })).toBeVisible();
  const other = await context.newPage(); await other.goto(`${url}/stages/generation`); await fallback(other);
  await panel(page).getByLabel("项目总输出目录").fill("/tmp/本页草稿");
  await panel(other).getByLabel("项目总输出目录").fill("/tmp/另一页输出");
  await panel(other).getByRole("button", { name: "保存路径", exact: true }).click();
  await expect(panel(other).getByText("已保存", { exact: true })).toBeVisible();
  await expect(panel(page).getByLabel("项目总输出目录")).toHaveValue("/tmp/本页草稿");
  await panel(page).getByRole("button", { name: "保存路径", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("其他页面更新");
  await panel(page).getByRole("button", { name: "保留输入，载入最新状态" }).click();
  await panel(page).getByRole("button", { name: "保存路径", exact: true }).click();
  await expect(panel(page).getByText("已保存", { exact: true })).toBeVisible();
  await expect(panel(other).getByLabel("项目总输出目录")).toHaveValue("/tmp/本页草稿");
});
