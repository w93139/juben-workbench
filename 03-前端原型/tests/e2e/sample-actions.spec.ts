import { chromium, expect, test as base, type Page } from "@playwright/test";
import { rm } from "node:fs/promises";

// OPFS handles need a persistent Chromium profile on this macOS runtime.
// Each test owns and removes its isolated profile; no personal directory is read.
const test = base.extend({
  context: async ({ baseURL }, provide, testInfo) => {
    const profile = testInfo.outputPath("sample-actions-profile");
    const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, baseURL });
    try { await provide(context); }
    finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
  },
});
const storageKey = "juben-workbench:projects:v1";
const directoryDB = "juben-workbench:output-directories:v1";
const panel = (page: Page) => page.getByRole("region", { name: "输出储存位置", exact: true });
const rawProjects = (page: Page) => page.evaluate((key) => localStorage.getItem(key), storageKey);
const projects = async (page: Page) => JSON.parse((await rawProjects(page)) ?? '{"projects":[]}').projects;

async function installPicker(page: Page, pending = false) {
  await page.evaluate(async (pending) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getDirectoryHandle("样例创作输出", { create: true });
    let calls = 0;
    // Only replace the native window boundary; persist a real serializable handle.
    Object.assign(window, { showDirectoryPicker: (options: unknown) => {
      calls += 1;
      Object.assign(window, { pickerCall: { options, active: navigator.userActivation.isActive, calls } });
      return pending ? new Promise((resolve) => Object.assign(window, { finishPicker: () => resolve(handle) })) : Promise.resolve(handle);
    } });
  }, pending);
}

async function finishPicker(page: Page) {
  await page.evaluate(() => (window as unknown as { finishPicker: () => void }).finishPicker());
}

async function storedDirectoryCount(page: Page) {
  return page.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some((database) => database.name === name)) return 0;
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("directories", "readonly");
        const count = transaction.objectStore("directories").count();
        transaction.oncomplete = () => { db.close(); resolve(count.result); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
  }, directoryDB);
}

for (const stage of ["", "/stages/blueprint"]) test(`样例小笔直接改名，取消不创建，保存留在原位置 ${stage || "总览"}`, async ({ page }, testInfo) => {
  const original = `/projects/demo-names${stage}`;
  await page.goto(original);
  const before = await rawProjects(page);
  await page.getByRole("button", { name: "改名", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "修改剧本名称", exact: true });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("sample-rename-dialog.png"), animations: "disabled" });
  await expect(dialog.getByLabel("项目名称", { exact: true })).toHaveValue("名字之外");
  await expect(page).toHaveURL(new RegExp(`/projects/demo-names${stage}$`));
  await dialog.getByLabel("项目名称", { exact: true }).fill("取消的草稿名");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await rawProjects(page)).toBe(before);
  await page.getByRole("button", { name: "改名", exact: true }).click();
  await dialog.getByLabel("项目名称", { exact: true }).fill("我的名字之外");
  if (stage) {
    await page.evaluate((key) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key && !sessionStorage.getItem("allow-sample-rename")) throw new DOMException("quota", "QuotaExceededError");
        original.call(this, name, value);
      };
    }, storageKey);
    await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("保存失败");
    await expect(dialog.getByLabel("项目名称", { exact: true })).toHaveValue("我的名字之外");
    expect(await rawProjects(page)).toBe(before);
    await expect(page).toHaveURL(/\/projects\/demo-names\/stages\/blueprint$/);
    await page.evaluate(() => sessionStorage.setItem("allow-sample-rename", "1"));
  }
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/projects/(?!demo-names)[^/]+${stage}$`));
  await expect(page.locator(".project-title-row").getByText("我的名字之外", { exact: true })).toBeVisible();
  const saved = await projects(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ title: "我的名字之外", readOnly: false });
  const copyURL = page.url();
  await page.reload();
  await expect(page.locator(".project-title-row").getByText("我的名字之外", { exact: true })).toBeVisible();
  await page.goto(original);
  await expect(page.locator(".project-title-row").getByText("名字之外", { exact: true })).toBeVisible();
  expect(await projects(page)).toEqual(saved);
  await page.goto(copyURL);
  expect(await projects(page)).toHaveLength(1);
});

test("样例先打开目录选择，选好后仅创建一个带真实引用的同阶段副本", async ({ page }) => {
  await page.goto("/projects/demo-names/stages/analysis");
  await installPicker(page, true);
  const before = await rawProjects(page);
  await panel(page).getByRole("button", { name: "选择输出文件夹", exact: true }).click();
  await expect(panel(page).getByRole("button", { name: "正在选择文件夹…", exact: true })).toBeDisabled();
  expect(await rawProjects(page)).toBe(before);
  await expect(page).toHaveURL(/\/projects\/demo-names\/stages\/analysis$/);
  expect(await page.evaluate(() => (window as unknown as { pickerCall: unknown }).pickerCall)).toEqual({ options: { startIn: "desktop", mode: "read" }, active: true, calls: 1 });
  await finishPicker(page);
  await expect(page).toHaveURL(/\/projects\/(?!demo-names)[^/]+\/stages\/analysis$/);
  await expect(panel(page).getByTestId("output-directory-name")).toHaveText("样例创作输出");
  const saved = await projects(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ readOnly: false, outputSettings: { rootPath: "", directory: { name: "样例创作输出" } } });
  const id = saved[0].outputSettings.directory.id;
  const directory = await page.evaluate(async ({ name, id }) => new Promise<{ kind: string; name: string }>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("directories", "readonly");
      const record = transaction.objectStore("directories").get(id);
      transaction.oncomplete = () => { db.close(); resolve({ kind: record.result.handle.kind, name: record.result.handle.name }); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }), { name: directoryDB, id });
  expect(directory).toEqual({ kind: "directory", name: "样例创作输出" });
  await page.reload();
  await expect(panel(page).getByTestId("output-directory-name")).toHaveText("样例创作输出");
  expect(await projects(page)).toHaveLength(1);
  await page.goto("/projects/demo-names/stages/analysis");
  await expect(panel(page).getByTestId("output-directory-name")).toHaveText("尚未选择");
  expect(await projects(page)).toEqual(saved);
});

test("样例目录取消、不支持、拒绝和引用失败不创建副本", async ({ page }) => {
  await page.goto("/projects/demo-names/stages/analysis");
  const before = await rawProjects(page);
  const choose = panel(page).getByRole("button", { name: "选择输出文件夹", exact: true });
  await page.evaluate(() => Object.assign(window, { showDirectoryPicker: () => Promise.reject(new DOMException("cancel", "AbortError")) }));
  await choose.click();
  await expect(panel(page).getByText("已取消，原设置保持不变。", { exact: true })).toBeVisible();
  expect(await rawProjects(page)).toBe(before);
  await page.evaluate(() => Object.assign(window, { showDirectoryPicker: undefined }));
  await choose.click();
  await expect(panel(page).getByRole("alert")).toContainText("不支持文件夹选择");
  expect(await rawProjects(page)).toBe(before);
  await page.evaluate(() => Object.assign(window, { showDirectoryPicker: () => Promise.reject(new DOMException("denied", "SecurityError")) }));
  await choose.click();
  await expect(panel(page).getByRole("alert")).toContainText("未能打开或访问");
  expect(await rawProjects(page)).toBe(before);
  await installPicker(page);
  await page.evaluate(() => { indexedDB.open = () => { throw new DOMException("denied", "SecurityError"); }; });
  await choose.click();
  await expect(panel(page).getByRole("alert")).toContainText("无法保存或读取文件夹引用");
  expect(await rawProjects(page)).toBe(before);
  await expect(page).toHaveURL(/\/projects\/demo-names\/stages\/analysis$/);
  await expect(panel(page).getByTestId("output-directory-name")).toHaveText("尚未选择");
});

test("样例目录保存失败无半成品，重试不重开选择且只创建一个副本", async ({ page }) => {
  await page.goto("/projects/demo-names/stages/analysis");
  await installPicker(page);
  const before = await rawProjects(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && !sessionStorage.getItem("allow-sample-output")) throw new DOMException("quota", "QuotaExceededError");
      original.call(this, name, value);
    };
  }, storageKey);
  await panel(page).getByRole("button", { name: "选择输出文件夹", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("保存失败");
  await expect(panel(page).getByText(/待保存：样例创作输出/)).toBeVisible();
  expect(await rawProjects(page)).toBe(before);
  await expect(page).toHaveURL(/\/projects\/demo-names\/stages\/analysis$/);
  await page.evaluate(() => sessionStorage.setItem("allow-sample-output", "1"));
  await panel(page).getByRole("button", { name: "重试保存文件夹", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/(?!demo-names)[^/]+\/stages\/analysis$/);
  await expect(panel(page).getByTestId("output-directory-name")).toHaveText("样例创作输出");
  expect(await projects(page)).toHaveLength(1);
  expect(await page.evaluate(() => (window as unknown as { pickerCall: { calls: number } }).pickerCall.calls)).toBe(1);
  await page.reload();
  await expect(panel(page).getByTestId("output-directory-name")).toHaveText("样例创作输出");
  expect(await projects(page)).toHaveLength(1);
});

test("样例选择期间离开阶段，迟到目录不会创建副本或跳回", async ({ page }) => {
  await page.goto("/projects/demo-names/stages/analysis");
  await installPicker(page, true);
  const before = await rawProjects(page);
  await panel(page).getByRole("button", { name: "选择输出文件夹", exact: true }).click();
  await expect(panel(page).getByRole("button", { name: "正在选择文件夹…", exact: true })).toBeDisabled();
  await page.getByRole("navigation", { name: "创作流程" }).getByRole("link", { name: /设计故事/ }).click();
  await expect(page).toHaveURL(/\/projects\/demo-names\/stages\/blueprint$/);
  await finishPicker(page);
  // Wait for the late picker result to finish its real IndexedDB transaction.
  await expect.poll(() => storedDirectoryCount(page)).toBe(1);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await rawProjects(page)).toBe(before);
  await expect(page).toHaveURL(/\/projects\/demo-names\/stages\/blueprint$/);
  await expect(panel(page).getByTestId("output-directory-name")).toHaveText("尚未选择");
});
