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
const key = "juben-workbench:projects:v1";
async function create(page: Page) {
  await page.goto("/projects/new?start=research");
  await page.getByLabel("项目名称", { exact: false }).fill("材料下一步测试");
  await page.getByRole("button", { name: "创建并进入材料中心" }).click();
  await expect(page.getByRole("heading", { name: "材料中心", exact: true })).toBeVisible();
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
  const next = page.getByRole("group", { name: "项目常用操作" }).getByRole("link", { name: "下一步：参考本拆解", exact: true });
  await expect(next).toBeInViewport({ ratio: 1 });
  await expect(next).toHaveAttribute("href", new URL(`${url}/stages/analysis`).pathname);
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await next.click();
  await expect(page).toHaveURL(`${url}/stages/analysis`);
  await expect(page.getByRole("heading", { name: "参考本拆解", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始模拟拆解", exact: true })).toBeDisabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before);
  await expect(panel(page).getByRole("button", { name: "选择文件夹", exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("next-step-directory.png"), fullPage: true });
  await page.goto("/projects/demo-names/stages/materials"); await next.click();
  await expect(page).toHaveURL(/\/demo-names\/stages\/analysis$/);
  await expect(page.getByRole("button", { name: "开始模拟拆解", exact: true })).toBeDisabled();
});

for (const width of [1440, 390]) test(`系统目录选择边界与引用保存刷新 ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const url = await create(page); await page.goto(`${url}/stages/analysis`);
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await installPicker(page);
  await panel(page).getByRole("button", { name: "选择文件夹", exact: true }).click();
  await expect(panel(page).getByLabel("项目总输出目录")).toHaveValue("所选文件夹：桌面测试输出");
  expect(await page.evaluate(() => (window as unknown as { pickerCall: unknown }).pickerCall)).toEqual({ options: { startIn: "desktop", mode: "read" }, active: true });
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before);
  await expect(page.getByTestId("output-path-preview")).toHaveText("所选文件夹「桌面测试输出」/01-参考本拆解");
  await panel(page).getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel(page).getByText(/输出路径已保存/)).toBeVisible();
  const saved = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.reload();
  await expect(panel(page).getByLabel("项目总输出目录")).toHaveValue("所选文件夹：桌面测试输出");
  await panel(page).getByLabel("本阶段子目录").fill("再次保存/拆解");
  await panel(page).getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel(page).getByText(/输出路径已保存/)).toBeVisible(); // checks restored IndexedDB handle
  await page.goto(`${url}/stages/export`);
  await expect(page.getByTestId("output-path-preview")).toHaveText("所选文件夹「桌面测试输出」/08-成品导出");
  await page.screenshot({ path: testInfo.outputPath("picked-output-directory.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel(page).getByRole("button", { name: "改为手动填写路径" }).click();
  await panel(page).getByLabel("项目总输出目录").fill("/tmp/手动路径");
  await panel(page).getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel(page).getByText(/输出路径已保存/)).toBeVisible();
  const state = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(state.projects[0].outputSettings.directory).toBeNull();
  expect(JSON.parse(saved!).projects[0].outputSettings.directory.name).toBe("桌面测试输出");
  await page.goto("/projects/demo-names/stages/analysis");
  await expect(panel(page).getByRole("button", { name: "选择文件夹", exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("选择取消、不支持、拒绝和引用存储失败保留原路径", async ({ page }) => {
  const url = await create(page); await page.goto(`${url}/stages/analysis`);
  await panel(page).getByLabel("项目总输出目录").fill("/tmp/原输出");
  await panel(page).getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel(page).getByText(/输出路径已保存/)).toBeVisible();
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.evaluate(() => Object.assign(window, { showDirectoryPicker: () => Promise.reject(new DOMException("cancel", "AbortError")) }));
  await panel(page).getByRole("button", { name: "选择文件夹", exact: true }).click();
  await expect(panel(page).getByText("未更改文件夹，原设置和输入已保留。", { exact: true })).toBeVisible();
  await page.evaluate(() => Object.assign(window, { showDirectoryPicker: undefined }));
  await panel(page).getByRole("button", { name: "选择文件夹", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("不支持文件夹选择");
  await page.evaluate(() => Object.assign(window, { showDirectoryPicker: () => Promise.reject(new DOMException("denied", "SecurityError")) }));
  await panel(page).getByRole("button", { name: "选择文件夹", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("未能打开或访问");
  await installPicker(page);
  await page.evaluate(() => {
    const original = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => { throw new DOMException("denied", "SecurityError"); };
    Object.assign(window, { restoreDirectoryDB: () => { indexedDB.open = original; } });
  });
  await panel(page).getByRole("button", { name: "选择文件夹", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("无法保存或读取文件夹引用");
  await expect(panel(page).getByLabel("项目总输出目录")).toHaveValue("/tmp/原输出");
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before);
  await page.evaluate(() => (window as unknown as { restoreDirectoryDB: () => void }).restoreDirectoryDB());
  await panel(page).getByRole("button", { name: "选择文件夹", exact: true }).click();
  await expect(panel(page).getByLabel("项目总输出目录")).toHaveValue("所选文件夹：桌面测试输出");
  await panel(page).getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel(page).getByText(/输出路径已保存/)).toBeVisible();
});

test("选择窗口等待期间跨页变更会冲突，离开后迟到选择不改项目", async ({ page, context }) => {
  const url = await create(page); await page.goto(`${url}/stages/analysis`);
  const other = await context.newPage(); await other.goto(`${url}/stages/generation`);
  await installPicker(page, true);
  await panel(page).getByRole("button", { name: "选择文件夹", exact: true }).click();
  await expect(panel(page).getByRole("button", { name: "正在选择文件夹…" })).toBeDisabled();
  await panel(other).getByLabel("项目总输出目录").fill("/tmp/另一页输出");
  await panel(other).getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel(other).getByText(/输出路径已保存/)).toBeVisible();
  await page.evaluate(() => (window as unknown as { finishPicker: () => void }).finishPicker());
  await expect(panel(page).getByLabel("项目总输出目录")).toHaveValue("所选文件夹：桌面测试输出");
  await panel(page).getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("其他页面更新");
  await panel(page).getByRole("button", { name: "保留输入，载入最新状态" }).click();
  await panel(page).getByRole("button", { name: "保存输出路径" }).click();
  await expect(panel(page).getByText(/输出路径已保存/)).toBeVisible();
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await installPicker(page, true);
  await panel(page).getByRole("button", { name: "重新选择文件夹" }).click();
  await page.getByRole("link", { name: /正文生成/ }).click();
  await expect(page).toHaveURL(`${url}/stages/generation`);
  await page.evaluate(() => (window as unknown as { finishPicker: () => void }).finishPicker());
  await expect(panel(page).getByLabel("本阶段子目录")).toHaveValue("05-正文生成");
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before);
});
