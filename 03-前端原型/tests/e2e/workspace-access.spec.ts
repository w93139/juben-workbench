import { expect, test } from "@playwright/test";

for (const width of [1440, 960, 390]) {
  test(`${width}px 项目顶部可直接修改状态与查看检查`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/projects/new?template=demo");
    await page.getByLabel("项目名称", { exact: false }).fill("入口验收副本");
    await page.getByRole("button", { name: "创建并进入工作台" }).click();
    await expect(page.getByRole("heading", { name: "入口验收副本", exact: true })).toBeVisible();
    const projectUrl = page.url();
    const edit = page.getByRole("button", { name: "修改决定状态", exact: true });
    const checks = page.getByRole("button", { name: "检查与试玩", exact: true });
    await expect(edit).toBeInViewport({ ratio: 1 });
    await expect(checks).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("project-shortcuts.png") });
    await edit.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("修改状态", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("decision-dialog.png") });
    await dialog.getByRole("combobox").first().selectOption("provisional");
    await expect(dialog.getByText("决定状态已保存")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(edit).toBeFocused();
    await page.reload();
    await edit.click();
    await expect(page.getByRole("dialog").getByRole("combobox").first()).toHaveValue("provisional");
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
    await checks.click();
    await expect(page.getByRole("dialog").getByText("134 / 134 项通过", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByText("尚未真人试玩", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("checks-dialog.png") });
    await page.keyboard.press("Escape");
    await expect(checks).toBeFocused();

    // The shortcuts also work without returning from a stage to the overview.
    await page.goto(`${projectUrl}/stages/blueprint`);
    await expect(edit).toBeInViewport({ ratio: 1 });
    await checks.click();
    await expect(page.getByRole("dialog").getByText("尚未真人试玩", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await edit.click();
    await expect(page.getByRole("dialog").getByRole("combobox").first()).toHaveValue("provisional");
  });
}

test("只读样例明确说明复制后才能改状态，检查可直接打开", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/projects/demo-names");
  await expect(page.getByRole("button", { name: "查看创作决定", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "修改决定状态", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "查看创作决定", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/原始样例为只读/)).toBeVisible();
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await dialog.getByRole("link", { name: "创建演示副本", exact: true }).click();
  await expect(page.getByRole("radio", { name: /使用演示副本/ })).toBeChecked();
  await page.goto("/projects/demo-names");
  await page.getByRole("button", { name: "检查与试玩", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("尚未真人试玩", { exact: true })).toBeVisible();
});
