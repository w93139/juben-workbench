import { expect, test } from "@playwright/test";

const storageKey = "juben-workbench:projects:v1";

for (const width of [1440, 960, 390]) {
  test(`${width}px 原始样例和各阶段都能找到参考研究并创建副本进入材料中心`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    const entry = page.getByRole("group", { name: "项目常用操作" }).getByRole("link", { name: "继续参考研究", exact: true });
    await page.goto("/projects/demo-names");
    await expect(entry).toBeInViewport({ ratio: 1 });
    await expect(page.getByText(/点击“继续参考研究”先创建副本/)).toBeVisible();
    await page.goto("/projects/demo-names/stages/blueprint");
    await expect(entry).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("research-shortcut.png") });
    await entry.click();
    await expect(page).toHaveURL(/\/projects\/new\?template=demo&start=research$/);
    await expect(page.getByText("创建后会直接进入材料中心，再点击“载入研究练习包”开始。", { exact: true })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
    await expect(page.getByRole("radio", { name: /使用演示副本/ })).toBeChecked();
    await page.getByLabel("项目名称", { exact: false }).fill("研究入口副本");
    await page.getByRole("button", { name: "创建并进入材料中心" }).click();
    await expect(page).toHaveURL(/\/projects\/project-[^/]+\/stages\/materials$/);
    const materialsUrl = page.url();
    const load = page.getByRole("button", { name: "载入研究练习包", exact: true });
    await expect(load).toBeEnabled();
    await expect(load).toBeInViewport({ ratio: 1 });
    await load.click();
    await expect(page.getByRole("button", { name: "练习包已载入", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "开始模拟 OCR", exact: true })).toBeEnabled();
    await page.reload();
    await expect(page.getByText("练习包已经在这个项目中，无需重复载入。下一步：点击“开始模拟 OCR”。", { exact: true })).toBeVisible();
    await page.goto(materialsUrl.replace("/stages/materials", "/stages/blueprint"));
    await expect(entry).toBeInViewport({ ratio: 1 });
    await entry.click();
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
