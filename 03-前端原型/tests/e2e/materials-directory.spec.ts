import { seedProject } from "./project-fixture";
import { chromium, expect, test as base, type Page } from "@playwright/test";
import { rm } from "node:fs/promises";

// On this macOS runtime, incognito Chromium crashes deserializing OPFS handles.
// Use a separate disposable profile per test, never the user's browser profile.
const test = base.extend({
  context: async ({ baseURL }, provide, testInfo) => {
    const profile = testInfo.outputPath("directory-browser-profile");
    const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, baseURL });
    try { await provide(context); }
    finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
  },
});
async function openOutput(page: Page) {
  await page.getByText("无法选择？备用方式", { exact: true }).click();
}
const key = "juben-workbench:projects:v1";
async function create(page: Page) {
  const base = await seedProject(page, "材料下一步测试", true);
  await page.goto(`${base}/stages/materials`);
  await expect(page.getByRole("heading", { name: "准备材料", exact: true })).toBeVisible();
  return page.url().replace("/stages/materials", "");
}
async function installPicker(page: Page, pending = false) {
  await page.evaluate(async (pending) => {
    // Real serializable browser handle in isolated origin-private storage;
    // only the native picker boundary is substituted, no personal files accessed.
    const sandbox = await navigator.storage.getDirectory();
    const handle = await sandbox.getDirectoryHandle("桌面测试输出", { create: true });
    Object.assign(window, {
      showDirectoryPicker: (options: unknown) => {
        Object.assign(window, { pickerCall: { options, active: navigator.userActivation.isActive } });
        return pending ? new Promise((resolve) => { Object.assign(window, { finishPicker: () => resolve(handle) }); }) : Promise.resolve(handle);
      },
    });
  }, pending);
}
const panel = (page: Page) => page.getByRole("region", { name: "输出储存位置" });

for (const width of [1440, 390]) test(`材料中心下一步跳转拆解，门槛仍生效 ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const url = await create(page);
  const next = page.getByRole("group", { name: "项目常用操作" }).getByRole("link", { name: "下一步：确定创作方案", exact: true });
  await expect(next).toBeInViewport({ ratio: 1 });
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await next.click();
  await expect(page).toHaveURL(`${url}/stages/analysis`);
  await expect(page.getByRole("button", { name: "开始模拟拆解", exact: true })).toBeDisabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before);
  await expect(panel(page).getByRole("button", { name: "选择输出文件夹" })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("next-step-directory.png"), fullPage: true });
  await page.goto("/projects/demo-names/stages/materials"); await next.click();
  await expect(page).toHaveURL(/\/demo-names\/stages\/analysis$/);
  await expect(page.getByRole("button", { name: "开始模拟拆解", exact: true })).toBeDisabled();
});

for (const width of [1440, 390]) test(`选完文件夹自动保存，真实引用刷新后可用 ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const url = await create(page); await page.goto(url);
  await installPicker(page);
  await panel(page).getByRole("button", { name: "选择输出文件夹" }).click();
  await expect(panel(page).getByText("已保存", { exact: true })).toBeVisible();
  await expect(panel(page).getByTestId("output-directory-name")).toHaveText("桌面测试输出");
  await expect(panel(page).getByText("已保存输出位置：桌面测试输出。所有步骤共用。", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { pickerCall: unknown }).pickerCall)).toEqual({ options: { startIn: "desktop", mode: "read" }, active: true });
  await expect(panel(page).getByRole("button", { name: "保存路径", exact: true })).toBeHidden();
  const saved = await page.evaluate((key) => localStorage.getItem(key), key);
  for (const stage of ["materials", "analysis", "blueprint", "generation", "export"]) {
    await page.goto(`${url}/stages/${stage}`);
    await expect(panel(page).getByTestId("output-directory-name")).toHaveText("桌面测试输出");
  }
  await page.goto(`${url}/stages/materials`);
  await page.screenshot({ path: testInfo.outputPath(`output-name-materials-${width}.png`), fullPage: true });
  await page.reload();
  await expect(panel(page).getByTestId("output-directory-name")).toHaveText("桌面测试输出");
  await installPicker(page);
  await panel(page).getByRole("button", { name: "更换输出文件夹" }).click();
  await expect(panel(page).getByText("已保存", { exact: true })).toBeVisible();
  await page.goto(`${url}/stages/export`); await openOutput(page);
  await expect(page.getByTestId("output-path-preview")).toHaveText("所选文件夹「桌面测试输出」/08-成品导出");
  await page.screenshot({ path: testInfo.outputPath("picked-output-directory.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel(page).getByLabel("项目总输出目录").fill("/tmp/手动路径");
  await panel(page).getByRole("button", { name: "保存路径", exact: true }).click();
  await expect(panel(page).getByText("已保存", { exact: true })).toBeVisible();
  const state = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(state.projects[0].outputSettings.directory).toBeNull();
  expect(JSON.parse(saved!).projects[0].outputSettings.directory.name).toBe("桌面测试输出");
  expect(errors).toEqual([]);
});

test("选择取消、不支持、拒绝和引用存储失败保留原路径", async ({ page }) => {
  const url = await create(page); await page.goto(`${url}/stages/analysis`); await openOutput(page);
  await panel(page).getByLabel("项目总输出目录").fill("/tmp/原输出");
  await panel(page).getByRole("button", { name: "保存路径", exact: true }).click();
  await expect(panel(page).getByText("已保存", { exact: true })).toBeVisible();
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.evaluate(() => Object.assign(window, { showDirectoryPicker: () => Promise.reject(new DOMException("cancel", "AbortError")) }));
  await panel(page).getByRole("button", { name: "更换输出文件夹" }).click();
  await expect(panel(page).getByText(/^已取消，原设置保持不变。/)).toBeVisible();
  await expect(panel(page).getByText("当前输入尚未保存。", { exact: true })).toHaveCount(0);
  await page.evaluate(() => Object.assign(window, { showDirectoryPicker: undefined }));
  await panel(page).getByRole("button", { name: "更换输出文件夹" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("不支持文件夹选择");
  await page.evaluate(() => Object.assign(window, { showDirectoryPicker: () => Promise.reject(new DOMException("denied", "SecurityError")) }));
  await panel(page).getByRole("button", { name: "更换输出文件夹" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("未能打开或访问");
  await installPicker(page);
  await page.evaluate(() => {
    const original = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => { throw new DOMException("denied", "SecurityError"); };
    Object.assign(window, { restoreDirectoryDB: () => { indexedDB.open = original; } });
  });
  await panel(page).getByRole("button", { name: "更换输出文件夹" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("无法保存或读取文件夹引用");
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before);
  await page.evaluate(() => (window as unknown as { restoreDirectoryDB: () => void }).restoreDirectoryDB());
  await panel(page).getByRole("button", { name: "更换输出文件夹" }).click();
  await expect(panel(page).getByText("已保存", { exact: true })).toBeVisible();
});

test("选择期间跨页变更会冲突，离开后迟到选择不改项目", async ({ page, context }) => {
  const url = await create(page); await page.goto(`${url}/stages/analysis`);
  const other = await context.newPage(); await other.goto(`${url}/stages/generation`); await openOutput(other);
  await installPicker(page, true);
  await panel(page).getByRole("button", { name: "选择输出文件夹" }).click();
  await expect(panel(page).getByRole("button", { name: "正在选择文件夹…" })).toBeDisabled();
  await panel(other).getByLabel("项目总输出目录").fill("/tmp/另一页输出");
  await panel(other).getByRole("button", { name: "保存路径", exact: true }).click();
  await expect(panel(other).getByText("已保存", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { finishPicker: () => void }).finishPicker());
  await expect(panel(page).getByRole("alert")).toContainText("其他页面更新");
  await expect(panel(page).getByTestId("output-directory-name")).toHaveText("/tmp/另一页输出");
  await expect(panel(page).getByText(/待保存：桌面测试输出/)).toBeVisible();
  await panel(page).getByRole("button", { name: "保留输入，载入最新状态" }).click();
  await panel(page).getByRole("button", { name: "重试保存文件夹" }).click();
  await expect(panel(page).getByText("已保存", { exact: true })).toBeVisible();
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await installPicker(page, true);
  await panel(page).getByRole("button", { name: "更换输出文件夹" }).click();
  await page.getByRole("navigation", { name: "创作流程" }).getByRole("link", { name: /生成与检查/ }).click();
  await expect(page).toHaveURL(`${url}/stages/generation`);
  await page.evaluate(() => (window as unknown as { finishPicker: () => void }).finishPicker());
  await expect(panel(page).getByTestId("output-directory-name")).toHaveText("桌面测试输出");
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before);
});

test("自动保存失败保留选择，重试无需再次打开目录", async ({ page }) => {
  await create(page); await installPicker(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) { if (name === key && !sessionStorage.getItem("allow-output")) throw new DOMException("quota", "QuotaExceededError"); original.call(this, name, value); };
  }, key);
  await panel(page).getByRole("button", { name: "选择输出文件夹" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("保存失败");
  await expect(panel(page).getByTestId("output-directory-name")).toHaveText("尚未选择");
  await expect(panel(page).getByText(/待保存：桌面测试输出/)).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("allow-output", "1"));
  await panel(page).getByRole("button", { name: "重试保存文件夹" }).click();
  await expect(panel(page).getByText("已保存", { exact: true })).toBeVisible();
  await page.reload(); await expect(panel(page).getByTestId("output-directory-name")).toHaveText("桌面测试输出");
});
