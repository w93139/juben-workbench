import { expect, test } from "@playwright/test";

test("总览直接修改剧本名称，刷新后保留", async ({ page }) => {
  await page.goto("/projects/new");
  await page.getByLabel("项目名称", { exact: false }).fill("改名前的剧本");
  await page.getByRole("button", { name: "创建并进入工作台" }).click();
  const rename = page.getByRole("button", { name: "修改剧本名称", exact: true });
  await expect(rename).toBeInViewport({ ratio: 1 });
  await rename.click();
  await page.getByRole("dialog").getByLabel("项目名称", { exact: true }).fill("改名后的剧本");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "改名后的剧本", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "改名后的剧本", exact: true })).toBeVisible();
});

test("不支持目录选择时显示原因并可保存手动路径，原样例有副本入口", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true }));
  await page.goto("/projects/new");
  await page.getByLabel("项目名称", { exact: false }).fill("目录兼容测试");
  await page.getByRole("button", { name: "创建并进入工作台" }).click();
  await page.getByText("更改输出位置", { exact: true }).click();
  const panel = page.getByRole("region", { name: "输出储存位置", exact: true });
  await expect(panel.getByText("此浏览器暂不支持直接选择输出文件夹", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "选择文件夹", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("不支持文件夹选择");
  await panel.getByText("选择窗口没有打开？", { exact: true }).click();
  await expect(panel.getByText(/Option \+ Command \+ C/)).toBeVisible();
  await panel.getByLabel("项目总输出目录").fill("/Users/作者/Desktop/剧本输出");
  await panel.getByRole("button", { name: "保存输出路径", exact: true }).click();
  await expect(panel.getByText(/输出路径已保存/)).toBeVisible();
  await page.reload(); await page.getByText("更改输出位置", { exact: true }).click();
  await expect(panel.getByLabel("项目总输出目录")).toHaveValue("/Users/作者/Desktop/剧本输出");
  await page.goto("/projects/demo-names"); await page.getByText("更改输出位置", { exact: true }).click();
  await expect(panel.getByText("原始样例不能修改输出位置", { exact: true })).toBeVisible();
  await panel.getByRole("link", { name: "创建可编辑副本 →", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/new\?template=demo$/);
});

test("切换阶段仅正文渐入，保存不重播，减少动态效果时停用", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/projects/new");
  await page.getByLabel("项目名称", { exact: false }).fill("动效测试");
  await page.getByRole("button", { name: "创建并进入工作台" }).click();
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: /确定创作方案/ }).click();
  const body = page.locator(".stage-content-enter");
  await expect(body).toHaveCSS("animation-name", "stage-arrive");
  await expect(page.locator(".workspace-fixed-header")).toHaveCSS("animation-name", "none");
  await expect.poll(() => body.evaluate((el) => el.getAnimations().every((animation) => animation.playState === "finished"))).toBe(true);
  await body.evaluate((el) => { el.setAttribute("data-continuity", "preserve"); });
  await page.getByLabel("补充创意", { exact: true }).fill("保存不应该重复播放进入动效");
  await page.getByRole("button", { name: "保存方案草稿", exact: true }).click();
  await expect(page.getByRole("region", { name: "创作方案", exact: true }).getByText("已保存", { exact: true })).toBeVisible();
  await expect(body).toHaveAttribute("data-continuity", "preserve");
  expect(await body.evaluate((el) => el.getAnimations().every((animation) => animation.playState === "finished"))).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: /设计故事/ }).click();
  await expect(body).toHaveCSS("animation-name", "none");
  await expect(body).not.toHaveAttribute("data-continuity", "preserve");
});
