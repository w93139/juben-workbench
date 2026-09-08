import { expect, test, type Page } from "@playwright/test";
async function openOutput(page: Page) {
  await page.getByText("更改输出位置", { exact: true }).click();
  await page.getByText("高级：阶段子目录", { exact: true }).click();
}
const key = "juben-workbench:projects:v1";
async function create(page: Page) {
  await page.goto("/projects/new");
  await page.getByLabel("项目名称", { exact: false }).fill("输出位置测试");
  await page.getByRole("button", { name: "创建并进入工作台" }).click();
  await expect(page.getByRole("heading", { name: "输出位置测试", exact: true })).toBeVisible();
  return page.url();
}
for (const width of [1440, 390]) test(`拆解和后续输出路径可设置并刷新保留 ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const url = await create(page);
  await page.goto(`${url}/stages/analysis`); await openOutput(page);
  const panel = page.getByRole("region", { name: "输出储存位置" });
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("output-path-preview")).toContainText("未设置本机目录");
  await panel.getByLabel("项目总输出目录").fill("/Users/作者/Desktop/创作输出");
  await panel.getByLabel("本阶段子目录").fill("参考研究/拆解结果");
  await expect(page.getByTestId("output-path-preview")).toHaveText("/Users/作者/Desktop/创作输出/参考研究/拆解结果");
  await panel.getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel.getByText(/输出路径已保存/)).toBeVisible();
  await page.reload(); await openOutput(page);
  await expect(panel.getByLabel("项目总输出目录")).toHaveValue("/Users/作者/Desktop/创作输出");
  await expect(panel.getByLabel("本阶段子目录")).toHaveValue("参考研究/拆解结果");
  await page.goto(`${url}/stages/generation`); await openOutput(page);
  await expect(page.getByTestId("output-path-preview")).toHaveText("/Users/作者/Desktop/创作输出/05-正文生成");
  await panel.getByLabel("本阶段子目录").fill("作者稿/正文");
  await panel.getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel.getByText(/输出路径已保存/)).toBeVisible();
  const saved = await page.evaluate((key) => localStorage.getItem(key), key);
  await panel.getByLabel("本阶段子目录").fill("../参考原件");
  await expect(panel.getByRole("button", { name: "保存输出路径" })).toBeDisabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(saved);
  await page.goto(`${url}/stages/analysis`); await openOutput(page);
  await expect(panel.getByLabel("本阶段子目录")).toHaveValue("参考研究/拆解结果");
  for (const stage of ["mechanisms", "direction", "blueprint", "review", "playtest", "export"]) {
    await page.goto(`${url}/stages/${stage}`); await openOutput(page);
    await expect(panel.getByLabel("项目总输出目录")).toHaveValue("/Users/作者/Desktop/创作输出");
  }
  await page.screenshot({ path: testInfo.outputPath("output-settings.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/projects/demo-names/stages/analysis"); await openOutput(page);
  await expect(panel.getByRole("button", { name: "保存输出路径" })).toBeDisabled();
  await expect(panel.getByLabel("项目总输出目录")).toHaveValue("");
  expect(errors).toEqual([]);
});

test("输出路径失败保留草稿，跨页冲突不覆盖且可明确重试", async ({ page, context }) => {
  const url = await create(page); await page.goto(`${url}/stages/analysis`); await openOutput(page);
  const panel = (p: Page) => p.getByRole("region", { name: "输出储存位置" });
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && !sessionStorage.getItem("allow-output")) throw new DOMException("quota", "QuotaExceededError");
      original.call(this, name, value);
    };
  }, key);
  await panel(page).getByLabel("项目总输出目录").fill("/tmp/本页输出");
  await panel(page).getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("保存失败");
  await expect(panel(page).getByLabel("项目总输出目录")).toHaveValue("/tmp/本页输出");
  await page.evaluate(() => sessionStorage.setItem("allow-output", "1"));
  await panel(page).getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel(page).getByText(/输出路径已保存/)).toBeVisible();
  const other = await context.newPage(); await other.goto(`${url}/stages/generation`); await openOutput(other);
  await panel(page).getByLabel("本阶段子目录").fill("本页草稿");
  await panel(other).getByLabel("项目总输出目录").fill("/tmp/另一页输出");
  await panel(other).getByLabel("本阶段子目录").fill("另一页正文");
  await panel(other).getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel(other).getByText(/输出路径已保存/)).toBeVisible();
  await expect(panel(page).getByLabel("本阶段子目录")).toHaveValue("本页草稿");
  await panel(page).getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("其他页面更新");
  await panel(page).getByRole("button", { name: "保留输入，载入最新状态" }).click();
  await panel(page).getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel(page).getByText(/输出路径已保存/)).toBeVisible();
  await expect(panel(other).getByLabel("本阶段子目录")).toHaveValue("另一页正文");
  await expect(panel(other).getByLabel("项目总输出目录")).toHaveValue("/tmp/本页输出");
});
