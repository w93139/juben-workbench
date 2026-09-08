import { expect, test } from "@playwright/test";

const storageKey = "juben-workbench:projects:v1";

for (const width of [1440, 960, 390]) {
  test(`${width}px 五步导航可返回材料，原始样例可创建研究副本`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    const actions = page.getByRole("group", { name: "项目常用操作" });
    await page.goto("/projects/demo-names");
    const entry = actions.getByRole("link", { name: "开始自己的创作", exact: true });
    await expect(entry).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("link", { name: "继续参考研究", exact: true })).toHaveCount(0);
    await entry.click();
    await expect(page).toHaveURL(/\/projects\/new\?template=demo&start=research$/);
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
    await expect(page.getByRole("radio", { name: /使用演示副本/ })).toBeChecked();
    await page.getByLabel("项目名称", { exact: false }).fill("研究入口副本");
    await page.getByRole("button", { name: "创建并进入材料中心" }).click();
    await expect(page).toHaveURL(/\/projects\/project-[^/]+\/stages\/materials$/);
    await expect(page.getByRole("heading", { name: "准备材料", exact: true })).toBeVisible();
    const materialsUrl = page.url();
    const load = page.getByRole("button", { name: "载入研究练习包", exact: true });
    await expect(load).toBeEnabled();
    await load.click();
    await expect(page.getByRole("button", { name: "练习包已载入", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "开始模拟 OCR", exact: true })).toBeEnabled();
    await page.reload();
    await expect(page.getByRole("button", { name: "练习包已载入", exact: true })).toBeDisabled();
    await page.goto(materialsUrl.replace("/stages/materials", "/stages/blueprint"));
    await expect(page.getByRole("heading", { name: "设计故事", exact: true })).toBeVisible();
    if (width === 390) await page.getByRole("button", { name: "打开导航", exact: true }).click();
    const nav = width === 390 ? page.getByRole("dialog").getByRole("navigation", { name: "主导航" }) : page.locator(".desktop-sidebar").getByRole("navigation", { name: "主导航" });
    for (const name of ["准备材料", "确定创作方案", "设计故事", "生成与检查", "试玩与导出"]) await expect(nav.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    await expect(nav.locator('a[href*="/stages/"]')).toHaveCount(5);
    await expect(nav.getByRole("link", { name: /准备材料/ })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("five-step-navigation.png") });
    await nav.getByRole("link", { name: /准备材料/ }).click();
    await expect(page).toHaveURL(materialsUrl);
    await expect(page.getByRole("button", { name: "练习包已载入", exact: true })).toBeDisabled();
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
    expect(saved.projects).toHaveLength(1);
    expect(saved.projects[0].readOnly).toBe(false);
    expect(saved.projects[0].research.documents).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("materials-entry.png"), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("只读材料页载入入口引导创建，不是无法操作的灰按钮", async ({ page }) => {
  await page.goto("/projects/demo-names/stages/materials");
  const load = page.getByRole("link", { name: "载入研究练习包", exact: true });
  await expect(load).toBeVisible();
  await load.click();
  await expect(page).toHaveURL(/\/projects\/new\?template=demo&start=research$/);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
});

test("空白研究项目入口与保存失败仍保留输入，重试后只创建一份项目", async ({ page }) => {
  await page.goto("/projects/new?start=research");
  await expect(page.getByRole("radio", { name: /空白原创项目/ })).toBeChecked();
  await page.getByLabel("项目名称", { exact: false }).fill("空白研究入口");
  await page.evaluate((key) => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && sessionStorage.getItem("allow-research-write") !== "1") throw new DOMException("quota", "QuotaExceededError");
      write.call(this, name, value);
    };
  }, storageKey);
  await page.getByRole("button", { name: "创建并进入材料中心" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("保存失败");
  await expect(page.getByLabel("项目名称", { exact: false })).toHaveValue("空白研究入口");
  await expect(page).toHaveURL(/\/projects\/new\?start=research$/);
  await page.evaluate(() => sessionStorage.setItem("allow-research-write", "1"));
  await page.getByRole("button", { name: "创建并进入材料中心" }).click();
  await expect(page.getByRole("button", { name: "载入研究练习包", exact: true })).toBeEnabled();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
  expect(saved.projects).toHaveLength(1);
  expect(saved.projects[0].template).toBe("blank");
});
