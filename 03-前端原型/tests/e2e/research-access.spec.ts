import { seedProject } from "./project-fixture";
import { expect, test } from "@playwright/test";

const storageKey = "juben-workbench:projects:v1";

for (const width of [1440, 960, 390]) {
  test(`${width}px 五步导航可返回材料，旧练习数据继续可用`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    const base = await seedProject(page, "研究入口副本", true);
    await page.goto(`${base}/stages/materials`);
    await expect(page.getByRole("heading", { name: "准备材料", exact: true })).toBeVisible();
    const materialsUrl = page.url();
    await page.getByText("历史研究练习资料", { exact: true }).click();
    const load = page.getByRole("button", { name: "载入研究练习包", exact: true });
    await expect(load).toBeEnabled();
    await load.click();
    await expect(page.getByRole("button", { name: "练习包已载入", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "开始模拟 OCR", exact: true })).toBeEnabled();
    await page.reload();
    await page.getByText("历史研究练习资料", { exact: true }).click();
    await expect(page.getByRole("button", { name: "练习包已载入", exact: true })).toBeDisabled();
    await page.goto(materialsUrl.replace("/stages/materials", "/stages/blueprint"));
    await expect(page.getByRole("heading", { name: "设计故事", exact: true })).toBeVisible();
    if (width === 390) await page.getByRole("button", { name: "打开导航", exact: true }).click();
    const projects = width === 390 ? page.getByRole("dialog").getByRole("navigation", { name: "主导航" }) : page.locator(".desktop-sidebar").getByRole("navigation", { name: "主导航" });
    await expect(projects.locator('a[href*="/stages/"]')).toHaveCount(0);
    await expect(projects.getByRole("link", { name: "研究入口副本", exact: true })).toHaveAttribute("aria-current", "page");
    if (width === 390) await page.keyboard.press("Escape");
    const nav = page.getByRole("navigation", { name: "创作流程" });
    await expect(nav.getByRole("link", { name: "总览", exact: true })).toBeVisible();
    for (const name of ["准备材料", "确定创作方案", "设计故事", "生成与检查", "试玩与导出"]) await expect(nav.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    await expect(nav.locator('a[href*="/stages/"]')).toHaveCount(5);
    await expect(nav.getByRole("link", { name: /准备材料/ })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("five-step-navigation.png") });
    await nav.getByRole("link", { name: /准备材料/ }).click();
    await expect(page).toHaveURL(materialsUrl);
    await page.getByText("历史研究练习资料", { exact: true }).click();
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


test("新项目不展示样例练习入口，已有数据保留", async ({ page }) => {
  const base = await seedProject(page, "我的参考材料");
  await page.goto(`${base}/stages/materials`);
  await expect(page.getByRole("button", { name: "载入研究练习包", exact: true })).toHaveCount(0);
  await expect(page.getByText("历史研究练习资料", { exact: true })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "打开演示项目", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "名字之外", exact: true })).toHaveCount(0);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
  expect(saved.projects).toHaveLength(1);
  expect(saved.projects[0].title).toBe("我的参考材料");
});

test("已有空白项目的原创方向草稿继续可编辑，不被文件夹新流程替换", async ({ page }) => {
  const base = await seedProject(page, "已经写了创意的旧项目");
  await page.evaluate((key) => {
    const data = JSON.parse(localStorage.getItem(key)!);
    data.projects[0].research.direction = {
      players: 6, genre: "历史项目题材", minutes: 180,
      deduction: 50, emotion: 30, mechanics: 20, forbidden: "不要丢失旧设定",
      intensity: "mechanisms", idea: "已经保存的原创创意，应当继续能修改",
    };
    data.projects[0].revision++;
    localStorage.setItem(key, JSON.stringify(data));
  }, storageKey);
  await page.goto(`${base}/stages/analysis`);
  await expect(page.getByLabel("补充创意", { exact: true })).toHaveValue("已经保存的原创创意，应当继续能修改");
  await expect(page.getByLabel("目标玩家人数", { exact: true })).toHaveValue("6");
  await expect(page.getByRole("region", { name: "大纲与写作方向建议", exact: true })).toHaveCount(0);
  await page.getByLabel("补充创意", { exact: true }).fill("从旧创意继续修改");
  await page.getByRole("button", { name: "保存方案草稿", exact: true }).click();
  await expect(page.getByRole("region", { name: "创作方案", exact: true }).getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("补充创意", { exact: true })).toHaveValue("从旧创意继续修改");
  const projects = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).projects, storageKey);
  expect(projects).toHaveLength(1);
  expect(projects[0].folderPlan).toBeNull();
});
