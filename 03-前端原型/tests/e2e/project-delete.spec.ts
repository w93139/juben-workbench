import { test, expect, type Page } from "@playwright/test";
import { seedProject } from "./project-fixture";
import { emptyWorkbench } from "../../src/domain/workbench";

async function writeBody(page: Page, id: string, running = false) {
  const state = emptyWorkbench();
  state.instructions = "仅供删除回归的自有正文";
  if (running) state.job = { jobId: "00000000-0000-4000-8000-000000000001", operation: "analyze", phase: "测试任务", sourceRevision: 0, blueprintRevision: 0, submittedAt: Date.now() };
  await page.evaluate(async ({ id, state }) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("juben-workbench:authoring:v1", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("projects");
    req.onsuccess = () => { const db = req.result; const tx = db.transaction("projects", "readwrite"); tx.objectStore("projects").put(state, id); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  }), { id, state });
}
async function body(page: Page, id: string) {
  return page.evaluate(async id => new Promise<unknown>(resolve => { const req = indexedDB.open("juben-workbench:authoring:v1", 1); req.onsuccess = () => { const db = req.result; const read = db.transaction("projects").objectStore("projects").get(id); read.onsuccess = () => { db.close(); resolve(read.result); }; }; }), id);
}
test("列表垃圾桶取消保留、确认删除正文并立即同步侧栏，悬停轻微动效", async ({ page }) => {
  const url = await seedProject(page, "可删除的自有项目"); const id = url.split("/projects/")[1].split("/")[0];
  await writeBody(page, id); await seedProject(page, "保留项目"); await page.goto("/projects");
  const row = page.locator("tbody tr").filter({ hasText: "可删除的自有项目" }); const button = row.getByRole("button", { name: "删除项目：可删除的自有项目" });
  await button.hover(); await expect(button).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -1)");
  await button.click(); await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(row).toBeVisible(); expect(await body(page, id)).toMatchObject({ instructions: "仅供删除回归的自有正文" });
  await button.click(); await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(row).toHaveCount(0); await expect(page.locator(".desktop-sidebar")).not.toContainText("可删除的自有项目");
  expect(await body(page, id)).toEqual({ deleted: true }); await page.reload();
  await expect(page.locator("tbody")).toContainText("保留项目"); await expect(row).toHaveCount(0);
});
test("当前项目从侧栏删除后返回列表；任务尚在运行时拒绝删除", async ({ page }) => {
  await page.route("**/api/studio/status?*", route => route.fulfill({ json: { jobId: "00000000-0000-4000-8000-000000000001", operation: "analyze", status: "running", phase: "测试任务" } }));
  const url = await seedProject(page, "任务中的自有项目"); const id = url.split("/projects/")[1].split("/")[0];
  await writeBody(page, id, true); await page.goto("/projects");
  await page.locator("tbody").getByRole("button", { name: "删除项目：任务中的自有项目" }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("仍有任务在运行"); expect(await body(page, id)).toHaveProperty("job");
  await page.getByRole("button", { name: "取消", exact: true }).click(); await writeBody(page, id); await page.goto(url);
  await page.locator(".desktop-sidebar").getByRole("button", { name: "删除项目：任务中的自有项目" }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click(); await expect(page).toHaveURL(/\/projects$/);
  expect(await body(page, id)).toEqual({ deleted: true });
});
test("索引写失败恢复完整正文，重试成功后旧标签页不能复活项目", async ({ page, context }) => {
  const url = await seedProject(page, "删除失败的自有项目"); const id = url.split("/projects/")[1].split("/")[0];
  await writeBody(page, id); const stale = await context.newPage(); await stale.goto(url);
  await page.goto("/projects");
  await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === "juben-workbench:projects:v1") { Storage.prototype.setItem = original; throw new DOMException("测试故障", "QuotaExceededError"); } original.call(this, key, value); }; });
  const button = page.locator("tbody").getByRole("button", { name: "删除项目：删除失败的自有项目" });
  await button.click(); await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("保存失败"); expect(await body(page, id)).toMatchObject({ instructions: "仅供删除回归的自有正文" });
  await page.getByRole("button", { name: "确认删除", exact: true }).click(); await expect(button).toHaveCount(0);
  await stale.reload(); await expect(stale.getByText("没有找到这个项目", { exact: false })).toBeVisible(); expect(await body(page, id)).toEqual({ deleted: true });
});
