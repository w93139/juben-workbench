import { test, expect, type Page } from "@playwright/test";
import { seedProject } from "./project-fixture";
import { offlineCapability, prepared, readState, writeState } from "./workbench-fixture";

async function setup(page: Page) {
  await offlineCapability(page); const base = await seedProject(page, "草稿恢复测试"); await writeState(page, base, prepared());
  await page.goto(`${base}/stages/blueprint`); return base;
}
const outline = (page: Page) => page.getByRole("textbox", { name: "大纲", exact: true });
async function saved(page: Page) { await expect(page.getByText("草稿已在本机保存 · 尚未提交蓝图", { exact: true })).toBeVisible(); }
async function drafts(page: Page) { const summary = page.getByText(/查看已保存草稿（\d+份）/); await summary.click(); return page.getByRole("region", { name: "蓝图草稿" }).locator("article"); }
async function submit(page: Page) { await page.getByRole("button", { name: "预览并保存修改", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "保存调整", exact: true }).click(); }

test("刷新及跨步骤后可恢复草稿，自动保存不改变正式版本且不调用模型", async ({ page }) => {
  const base = await setup(page); let posts = 0; page.on("request", r => { if (r.method() === "POST" && /\/api\/studio\/(analyze|blueprint|review)$/.test(r.url())) posts++; });
  await outline(page).fill("自动保存的完整新大纲"); await saved(page);
  const before = await readState(page, base); expect(before.revision).toBe(1); expect(before.blueprintRevision).toBe(1); expect(before.versions).toEqual([]); expect(before.blueprint?.premise).toBe("原创蓝图的最初大纲"); expect(before.blueprintDrafts).toHaveLength(1);
  await page.reload(); await expect(outline(page)).toHaveValue("原创蓝图的最初大纲");
  const cards = await drafts(page); await cards.getByRole("button", { name: "对照并恢复草稿", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "恢复草稿继续编辑", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0); await expect(outline(page)).toHaveValue("自动保存的完整新大纲"); await saved(page);
  await page.getByRole("button", { name: "暂存并返回正式蓝图", exact: true }).click(); await expect(outline(page)).toHaveValue("原创蓝图的最初大纲");
  await page.goto(`${base}/stages/materials`); await page.goto(`${base}/stages/blueprint`);
  expect((await readState(page, base)).blueprintDrafts).toHaveLength(2); expect(posts).toBe(0);
});
test("立即提交等待草稿落盘，成功只清本页且稍后不复活", async ({ page }) => {
  const base = await setup(page); await outline(page).fill("立即提交后的蓝图"); await submit(page); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(outline(page)).toHaveValue("立即提交后的蓝图"); await page.reload();
  const state = await readState(page, base); expect(state.blueprintDrafts).toEqual([]); expect(state.versions).toHaveLength(1); expect(state.revision).toBe(2); expect(state.blueprintRevision).toBe(2);
});
test("跨页各保留草稿，旧稿须对照后显式使用当前版本，窗口过期拒绝", async ({ page, context }) => {
  const base = await setup(page); await outline(page).fill("A页的独立草稿"); await saved(page);
  const other = await context.newPage(); await offlineCapability(other); await other.goto(`${base}/stages/blueprint`); await outline(other).fill("B页保存的正式蓝图"); await submit(other); await expect(other.getByRole("dialog")).toHaveCount(0);
  await page.reload(); const cards = await drafts(page); await cards.getByRole("button", { name: "对照并恢复草稿", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("这份草稿基于旧版本");
  await outline(other).fill("C次正式修改"); await submit(other); await expect(other.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "对照后以当前版本继续编辑", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("项目或草稿已变化");
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await cards.getByRole("button", { name: "对照并恢复草稿", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "对照后以当前版本继续编辑", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(outline(page)).toHaveValue("A页的独立草稿"); await submit(page); await expect(page.getByRole("dialog")).toHaveCount(0);
  const state = await readState(page, base); expect(state.blueprint?.premise).toBe("A页的独立草稿"); expect(state.versions.at(-1)?.data.premise).toBe("C次正式修改"); expect(state.blueprintDrafts).toHaveLength(1);
  await other.close();
});
test("草稿配额写失败显示且保留输入，恢复存储后重试落盘", async ({ page }) => {
  const base = await setup(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    Object.defineProperty(window, "restoreDraftWrites", { value: () => { IDBObjectStore.prototype.put = put; }, configurable: true });
    IDBObjectStore.prototype.put = function(value, ...args) { if (value.blueprintDrafts?.length) throw new DOMException("草稿存储空间不足", "QuotaExceededError"); return put.call(this, value, ...args); };
  });
  await outline(page).fill("失败后仍需保留的大纲"); await expect(page.getByText("草稿尚未保存成功", { exact: true })).toBeVisible(); await expect(outline(page)).toHaveValue("失败后仍需保留的大纲"); expect((await readState(page, base)).blueprintDrafts).toHaveLength(0);
  await page.evaluate(() => { (Reflect.get(window, "restoreDraftWrites") as () => void)(); });
  await page.getByRole("button", { name: "重试保存草稿", exact: true }).click(); await saved(page);
  expect((await readState(page, base)).blueprintDrafts[0].data.premise).toBe("失败后仍需保留的大纲");
});
test("历史满20份仍保存草稿，正式提交拒绝且刷新可恢复", async ({ page }) => {
  const base = await setup(page); const state = prepared(); state.versions = Array.from({ length: 20 }, (_, revision) => ({ revision, data: structuredClone(state.blueprint!) })); await writeState(page, base, state); await page.reload();
  await outline(page).fill("历史满额也不能丢失"); await submit(page); await expect(page.getByRole("dialog")).toContainText("蓝图历史已达20份");
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click(); await saved(page); await page.reload();
  expect((await readState(page, base)).blueprintDrafts[0].data.premise).toBe("历史满额也不能丢失"); expect((await readState(page, base)).versions).toHaveLength(20);
});
test("放弃本页草稿需确认，之后显示正式稿且无草稿复活", async ({ page }) => {
  const base = await setup(page); await outline(page).fill("准备放弃的独立草稿"); await saved(page);
  await page.getByRole("button", { name: "放弃本页草稿", exact: true }).click(); expect((await readState(page, base)).blueprintDrafts[0].data.premise).toBe("准备放弃的独立草稿");
  await page.getByRole("dialog").getByRole("button", { name: "确认删除草稿", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(outline(page)).toHaveValue("原创蓝图的最初大纲"); await page.reload(); expect((await readState(page, base)).blueprintDrafts).toHaveLength(0);
});
test("存储失败后跨阶段及跨项目导航仍保留内存草稿，别页刷新会提示未落盘", async ({ page }) => {
  await offlineCapability(page);
  const other = await seedProject(page, "隔离项目"); await writeState(page, other, prepared());
  const base = await seedProject(page, "失败导航保留"); await writeState(page, base, prepared()); await page.goto(`${base}/stages/blueprint`);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    Object.defineProperty(window, "restoreDraftWrites", { value: () => { IDBObjectStore.prototype.put = put; }, configurable: true });
    IDBObjectStore.prototype.put = function(value, ...args) { if (value.blueprintDrafts?.length) throw new DOMException("草稿写失败", "QuotaExceededError"); return put.call(this, value, ...args); };
  });
  await outline(page).fill("导航前尚未落盘的草稿"); await expect(page.getByText("草稿尚未保存成功", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "创作流程" }).getByRole("link", { name: /拆解与方向/ }).click();
  await expect(page).toHaveURL(`${base}/stages/analysis`);
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  await page.getByRole("navigation", { name: "创作流程" }).getByRole("link", { name: /创作蓝图/ }).click();
  await expect(outline(page)).toHaveValue("导航前尚未落盘的草稿"); await expect(page.getByText("草稿尚未保存成功", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "隔离项目", exact: true }).click();
  await page.getByRole("navigation", { name: "创作流程" }).getByRole("link", { name: /创作蓝图/ }).click();
  await expect(outline(page)).toHaveValue("原创蓝图的最初大纲");
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "失败导航保留", exact: true }).click();
  await page.getByRole("navigation", { name: "创作流程" }).getByRole("link", { name: /创作蓝图/ }).click();
  await expect(outline(page)).toHaveValue("导航前尚未落盘的草稿");
  await page.evaluate(() => { (Reflect.get(window, "restoreDraftWrites") as () => void)(); });
  await page.getByRole("button", { name: "重试保存草稿", exact: true }).click(); await saved(page);
  expect((await readState(page, other)).blueprintDrafts).toHaveLength(0); expect((await readState(page, base)).blueprintDrafts[0].data.premise).toBe("导航前尚未落盘的草稿");
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
});
test("另一页删除草稿后，本页可显式放弃失败输入并解除离页提示", async ({ page, context }) => {
  const base = await setup(page); await outline(page).fill("会被另页删除的草稿"); await saved(page);
  const other = await context.newPage(); await offlineCapability(other); await other.goto(`${base}/stages/blueprint`);
  const cards = await drafts(other); await cards.getByRole("button", { name: "删除此草稿", exact: true }).click(); await other.getByRole("dialog").getByRole("button", { name: "确认删除草稿", exact: true }).click(); await expect(other.getByRole("dialog")).toHaveCount(0);
  await outline(page).fill("另一页删除之后的本地输入"); await expect(page.getByText("草稿尚未保存成功", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "放弃本页草稿", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "确认删除草稿", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(outline(page)).toHaveValue("原创蓝图的最初大纲"); expect((await readState(page, base)).blueprintDrafts).toHaveLength(0);
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false); await other.close();
});
test("确认删除项目后清理其未落盘会话，不保留永久离页警告", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...args) { if (value.blueprintDrafts?.length) throw new DOMException("草稿写失败", "QuotaExceededError"); return put.call(this, value, ...args); };
  });
  await outline(page).fill("删除项目时包含的本地输入"); await expect(page.getByText("草稿尚未保存成功", { exact: true })).toBeVisible();
  await page.locator(".desktop-sidebar").getByRole("button", { name: "删除项目：草稿恢复测试", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "确认删除", exact: true }).click(); await expect(page).toHaveURL(/\/projects$/);
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
});
test("另一页移除本页草稿后，可保留当前输入另存新会话并正式提交", async ({ page, context }) => {
  const base = await setup(page); await outline(page).fill("第一次保存的本页草稿"); await saved(page); const priorId = (await readState(page, base)).blueprintDrafts[0].id;
  const other = await context.newPage(); await offlineCapability(other); await other.goto(`${base}/stages/blueprint`);
  const cards = await drafts(other); await cards.getByRole("button", { name: "删除此草稿", exact: true }).click(); await other.getByRole("dialog").getByRole("button", { name: "确认删除草稿", exact: true }).click(); await expect(other.getByRole("dialog")).toHaveCount(0);
  await outline(page).fill("别页删除后仍要保留的新输入"); await expect(page.getByText("草稿尚未保存成功", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "另存为新草稿", exact: true }).click(); await saved(page); await expect(outline(page)).toHaveValue("别页删除后仍要保留的新输入");
  const next = (await readState(page, base)).blueprintDrafts[0]; expect(next.id).not.toBe(priorId); expect(next.baseRevision).toBe(1);
  await submit(page); await expect(page.getByRole("dialog")).toHaveCount(0); expect((await readState(page, base)).blueprint?.premise).toBe("别页删除后仍要保留的新输入"); await other.close();
});
test("提交等待存储时往返页面，新页面等待同一动作结束后可继续编辑", async ({ page }) => {
  const base = await setup(page);
  const navigation = page.getByRole("navigation", { name: "创作流程" });
  await navigation.getByRole("link", { name: /拆解与方向/ }).click(); await navigation.getByRole("link", { name: /创作蓝图/ }).click(); await expect(outline(page)).toBeVisible();
  await page.evaluate(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(...args) {
      IDBFactory.prototype.open = open;
      const request = open.apply(this, args); let callback: ((event: Event) => unknown) | null = null;
      Object.defineProperty(request, "onsuccess", { set(value) { callback = value; }, get() { return callback; } });
      request.addEventListener("success", event => { setTimeout(() => callback?.call(request, event), 3500); });
      return request;
    };
  });
  await outline(page).fill("延迟写入后正式提交的蓝图"); await submit(page);
  await page.goBack(); await expect(page).toHaveURL(`${base}/stages/analysis`); await page.goForward(); await expect(page).toHaveURL(`${base}/stages/blueprint`);
  await expect(outline(page)).toBeDisabled();
  await expect(outline(page)).toBeEnabled({ timeout: 10000 }); await expect(outline(page)).toHaveValue("延迟写入后正式提交的蓝图");
  await outline(page).fill("动作结束后继续编辑的新草稿"); await saved(page);
  const state = await readState(page, base); expect(state.blueprint?.premise).toBe("延迟写入后正式提交的蓝图"); expect(state.blueprintDrafts[0].data.premise).toBe("动作结束后继续编辑的新草稿");
});
