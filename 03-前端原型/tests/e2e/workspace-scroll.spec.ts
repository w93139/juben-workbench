import { expect, test } from "@playwright/test";

const storageKey = "juben-workbench:projects:v1";
const stages = [
  ["materials", "准备材料"], ["analysis", "确定创作方案"], ["blueprint", "设计故事"],
  ["generation", "生成与检查"], ["export", "试玩与导出"],
];

for (const viewport of [{ width: 1440, height: 844 }, { width: 960, height: 844 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`${viewport.width}×${viewport.height} 只有具体内容滚动，常用操作可用`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/projects/new?template=demo");
    const title = "长项目名称检验固定顶部不挤掉按钮和下面内容".repeat(2).slice(0, 40);
    await page.getByLabel("项目名称", { exact: false }).fill(title);
    await page.getByRole("button", { name: "创建并进入工作台" }).click();
    const heading = page.getByRole("heading", { name: title, exact: true });
    await expect(heading).toBeVisible();
    const url = page.url();
    const details = page.getByRole("region", { name: "具体功能内容", exact: true });
    const before = await heading.boundingBox();
    await details.focus();
    await page.keyboard.press("PageDown");
    await expect.poll(() => details.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    expect(await heading.boundingBox()).toEqual(before);
    const edit = page.getByRole("group", { name: "项目常用操作" }).getByRole("button", { name: "修改决定状态", exact: true });
    await expect(edit).toBeInViewport({ ratio: 1 });
    await edit.click();
    await page.getByRole("dialog").getByRole("combobox").first().selectOption("provisional");
    await expect(page.getByRole("dialog").getByText("决定状态已保存")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(edit).toBeFocused();
    await expect.poll(() => details.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);

    // Client-side navigation resets the detail pane, without mutating project state.
    await page.getByRole("group", { name: "项目常用操作" }).getByRole("link", { name: "继续：准备材料", exact: true }).click();
    await expect(page).toHaveURL(`${url}/stages/materials`);
    await expect.poll(() => details.evaluate((el) => el.scrollTop)).toBe(0);
    await page.goto(`${url}/stages/blueprint`);
    const blueprintHeading = page.getByRole("heading", { name: "设计故事", exact: true });
    await expect(blueprintHeading).toBeVisible();
    const blueprintBefore = await blueprintHeading.boundingBox();
    const box = await details.boundingBox();
    expect(box!.height).toBeGreaterThan(100);
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 1000);
    await expect.poll(() => details.evaluate((el) => el.scrollTop)).toBeGreaterThan(200);
    expect(await blueprintHeading.boundingBox()).toEqual(blueprintBefore);
    await expect(edit).toBeInViewport({ ratio: 1 });
    const next = page.getByRole("group", { name: "项目常用操作" }).getByRole("link", { name: "下一步：生成与检查", exact: true });
    await expect(next).toBeInViewport({ ratio: 1 });
    const checks = page.getByRole("button", { name: "检查与试玩", exact: true });
    await expect(checks).toBeInViewport({ ratio: 1 });
    await checks.click();
    await expect(page.getByRole("dialog").getByText("尚未真人试玩", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(checks).toBeFocused();
    expect(await page.evaluate(() => ({ top: window.scrollY, overflow: document.documentElement.scrollWidth > innerWidth }))).toEqual({ top: 0, overflow: false });
    await page.screenshot({ path: testInfo.outputPath("fixed-workspace.png") });
    const saved = await page.evaluate((key) => localStorage.getItem(key), storageKey);
    await next.click();
    await expect(page).toHaveURL(`${url}/stages/generation`);
    await expect.poll(() => details.evaluate((el) => el.scrollTop)).toBe(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(saved);
    expect(errors).toEqual([]);
  });
}

for (const width of [1440, 390]) test(`${width}px 五个步骤顶部下一步逐页导航，不写完成状态`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/projects/demo-names/stages/materials");
  for (const [index, [id, name]] of stages.entries()) {
    await expect(page).toHaveURL(new RegExp(`/stages/${id}$`));
    await expect(page.getByRole("heading", { name, exact: true })).toBeInViewport({ ratio: 1 });
    const next = page.getByRole("group", { name: "项目常用操作" }).getByRole("link", { name: stages[index + 1] ? `下一步：${stages[index + 1][1]}` : "返回项目总览", exact: true });
    await expect(next).toBeInViewport({ ratio: 1 });
    await next.click();
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
  }
  await expect(page).toHaveURL(/\/projects\/demo-names$/);
});
