import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { backupFixture } from "../fixtures/project-backup";
import { createProjectBackup, parseProjectBackup, projectBackupFingerprint, restoredProject, serializeProjectBackup, type ProjectBackup } from "../../src/domain/project-backup";
import { emptyWorkbench, reviewCurrent } from "../../src/domain/workbench";
import { envelopeSchema } from "../../src/domain/models";
import { offlineCapability, prepared, readState, writeState } from "./workbench-fixture";
import { seedProject } from "./project-fixture";

const indexKey = "juben-workbench:projects:v1", dbName = "juben-workbench:authoring:v1";
async function readIndex(page: Page) { return envelopeSchema.parse(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{"schemaVersion":3,"projects":[]}'), indexKey)); }
async function records(page: Page): Promise<Array<{ key: IDBValidKey; value: unknown }>> {
  return page.evaluate(dbName => new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1); request.onupgradeneeded = () => request.result.createObjectStore("projects"); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result, tx = db.transaction("projects"), cursor = tx.objectStore("projects").openCursor(); const result: Array<{ key: IDBValidKey; value: unknown }> = [];
      cursor.onsuccess = () => { if (cursor.result) { result.push({ key: cursor.result.key, value: cursor.result.value }); cursor.result.continue(); } };
      tx.oncomplete = () => { db.close(); resolve(result); }; tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), dbName);
}
async function select(page: Page, backup: ProjectBackup | string) {
  await page.getByLabel("选择完整项目备份").setInputFiles({ name: "自造备份.json", mimeType: "application/json", buffer: Buffer.from(typeof backup === "string" ? backup : serializeProjectBackup(backup)) });
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function fullSetup(page: Page) {
  await offlineCapability(page); const { project, state, now } = backupFixture();
  await page.goto("/projects"); await page.evaluate(({ project, key }) => localStorage.setItem(key, JSON.stringify({ schemaVersion: 3, projects: [project] })), { project, key: indexKey });
  const base = `/projects/${project.id}`; await writeState(page, base, state); await page.goto(base);
  return { project, state, base, backup: createProjectBackup(project, state, true, now) };
}
test("完整下载、预览取消、新副本恢复及刷新：内容保留，历史通过不解锁导出", async ({ page }) => {
  const s = await fullSetup(page); const originalIndex = await readIndex(page); let paid = 0;
  page.on("request", r => { if ((r.method() === "POST" && /\/api\/studio\/(analyze|blueprint|review)$/.test(r.url())) || /\/api\/studio\/jobs\//.test(r.url())) paid++; });
  await page.getByRole("button", { name: "备份项目", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("蓝图历史 20 份 · 草稿 12 份");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "下载完整项目备份", exact: true }).click();
  const file = await download; expect(file.suggestedFilename()).toBe(`${s.project.title}-项目备份.json`);
  const text = await readFile((await file.path())!, "utf8"), backup = parseProjectBackup(text);
  expect(backup.workbench.documents).toEqual(s.state.documents); expect(backup.workbench.review?.reports).toEqual(s.state.review?.reports); expect(text).not.toContain(s.state.review!.validationId); expect(text).not.toContain("/test-output-only");
  await page.goto("/projects"); await select(page, backup); await expect(page.getByRole("dialog")).toContainText("项目预算需重新设置");
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click(); expect(await readIndex(page)).toEqual(originalIndex);
  await select(page, backup); await page.getByRole("button", { name: "恢复为新副本", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("项目副本已恢复");
  const index = await readIndex(page), restored = index.projects.find(p => p.id !== s.project.id)!; expect(index.projects).toHaveLength(2); expect(index.projects[0]).toEqual(originalIndex.projects[0]); expect(restored.outputSettings.rootPath).toBe(""); expect(restored.outputSettings.directory).toBeNull();
  await page.getByRole("button", { name: "打开恢复的副本", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/projects/${restored.id}/stages/materials$`)); await page.reload();
  const next = await readState(page, `/projects/${restored.id}`); expect(next.documents).toEqual(s.state.documents); expect(next.blueprintDrafts).toEqual(s.state.blueprintDrafts); expect(next.versions).toEqual(s.state.versions); expect(reviewCurrent(next)).toBe(false); expect(next.review).toBeNull(); expect(next.job).toBeNull();
  expect(next.reviewArchives[0].review.reports).toEqual(s.state.review!.reports); expect((await readState(page, s.base))).toEqual(s.state);
  await page.getByRole("navigation", { name: "创作流程" }).getByRole("link", { name: /交叉验证与导出/ }).click();
  const archive = page.getByRole("region", { name: "恢复的历史审查" }); await expect(archive).toBeVisible(); await archive.locator("summary").filter({ hasText: "备份记录显示曾通过" }).click(); await archive.getByText("角色本 · 备份正文character", { exact: true }).click(); await expect(archive).toContainText("自造正文0");
  await expect(page.getByRole("button", { name: "导出完整档案", exact: true })).toHaveCount(0); expect(paid).toBe(0);
});
test("旧索引、损坏或未知版本拒绝，不创建半成品项目", async ({ page }) => {
  await offlineCapability(page); await page.goto("/projects"); const before = await readIndex(page);
  for (const value of ['{"schemaVersion":3,"projects":[]}', "{broken", '{"format":"juben-workbench/project-backup","schemaVersion":99}']) {
    await select(page, value); await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible(); expect(await readIndex(page)).toEqual(before); await expect(page.getByRole("button", { name: "恢复为新副本", exact: true })).toHaveCount(0); await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  }
});
for (const fault of ["body", "index"]) test(`${fault} 写入失败不改变原项目，重试只生成一个完整副本`, async ({ page }) => {
  const s = await fullSetup(page); await page.goto("/projects"); const beforeIndex = await readIndex(page), beforeRecords = await records(page); await select(page, s.backup);
  await page.evaluate(fault => {
    if (fault === "body") { const add = IDBObjectStore.prototype.add; IDBObjectStore.prototype.add = function() { IDBObjectStore.prototype.add = add; throw new DOMException("自造正文写失败", "QuotaExceededError"); }; }
    else { const set = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === "juben-workbench:projects:v1") { Storage.prototype.setItem = set; throw new DOMException("自造索引写失败", "QuotaExceededError"); } return set.call(this, key, value); }; }
  }, fault);
  await page.getByRole("button", { name: "恢复为新副本", exact: true }).click(); await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible(); expect(await readIndex(page)).toEqual(beforeIndex); expect(await records(page)).toEqual(beforeRecords);
  await page.getByRole("button", { name: "恢复为新副本", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("项目副本已恢复"); expect((await readIndex(page)).projects).toHaveLength(2); expect((await records(page)).filter(r => Array.isArray(r.key))).toHaveLength(0);
});
for (const published of [false, true]) test(`恢复在索引${published ? "发布后" : "发布前"}中断，刷新自动核对原生IDB，保留其他记录`, async ({ page }) => {
  const s = await fullSetup(page), operationId = crypto.randomUUID(), fingerprint = await projectBackupFingerprint(s.backup), next = restoredProject(s.backup, operationId, fingerprint, new Date().toISOString());
  await page.evaluate(async ({ dbName, next, operationId, fingerprint, indexKey, published, unrelated }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction("projects", "readwrite"), store = tx.objectStore("projects");
        store.add(next.workbench, next.project.id); store.add({ project: next.project, operationId, fingerprint }, ["project-restore", operationId]); store.add(unrelated, "unrelated-orphan"); store.add({ deleted: true }, "unrelated-deleted"); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
    if (published) { const index = JSON.parse(localStorage.getItem(indexKey)!); index.projects.push(next.project); localStorage.setItem(indexKey, JSON.stringify(index)); }
  }, { dbName, next, operationId, fingerprint, indexKey, published, unrelated: emptyWorkbench() });
  await page.goto("/projects"); await expect(page.getByRole("table")).toBeVisible(); await expect(page.locator(".error-banner")).toHaveCount(0);
  expect((await readIndex(page)).projects).toHaveLength(published ? 2 : 1); const saved = await records(page);
  expect(saved.some(r => r.key === next.project.id)).toBe(published); expect(saved.some(r => Array.isArray(r.key))).toBe(false); expect(saved.find(r => r.key === "unrelated-orphan")?.value).toEqual(emptyWorkbench()); expect(saved.find(r => r.key === "unrelated-deleted")?.value).toEqual({ deleted: true }); expect(await readState(page, s.base)).toEqual(s.state);
});
test("草稿尚未落盘时备份等待保存，失败不下载且保留输入", async ({ page }) => {
  await offlineCapability(page); const base = await seedProject(page, "备份草稿输入"); await writeState(page, base, prepared()); await page.goto(`${base}/stages/blueprint`);
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; Reflect.set(window, "restoreWrites", () => { IDBObjectStore.prototype.put = put; }); IDBObjectStore.prototype.put = function(value, ...keys) { if (value.blueprintDrafts?.length) throw new DOMException("草稿写失败", "QuotaExceededError"); return put.call(this, value, ...keys); }; });
  const outline = page.getByRole("textbox", { name: "大纲", exact: true }); await outline.fill("备份前必须保留的新草稿"); await page.getByRole("button", { name: "备份项目", exact: true }).click(); await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible(); await expect(page.getByRole("button", { name: "下载完整项目备份", exact: true })).toBeDisabled();
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click(); await expect(outline).toHaveValue("备份前必须保留的新草稿"); await expect(outline).toBeEnabled();
  await page.evaluate(() => { (Reflect.get(window, "restoreWrites") as () => void)(); }); await page.getByRole("button", { name: "备份项目", exact: true }).click(); await expect(page.getByRole("button", { name: "下载完整项目备份", exact: true })).toBeEnabled(); expect((await readState(page, base)).blueprintDrafts[0].data.premise).toBe("备份前必须保留的新草稿"); expect((await readState(page, base)).blueprint?.premise).toBe("原创蓝图的最初大纲");
});
test("不支持跨页锁时拒绝导入，原数据不变", async ({ page }) => {
  const s = await fullSetup(page); await page.goto("/projects"); const before = await readIndex(page); await select(page, s.backup);
  await page.evaluate(() => Object.defineProperty(navigator, "locks", { value: undefined })); await page.getByRole("button", { name: "恢复为新副本", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("当前浏览器不支持跨页安全恢复"); expect(await readIndex(page)).toEqual(before); expect(await readState(page, s.base)).toEqual(s.state);
});
test("缓存项目历史切换后清除旧备份，下载快照与项目名一致", async ({ page }) => {
  await offlineCapability(page); await seedProject(page, "备份项目A"); await seedProject(page, "备份项目B");
  const nav = page.getByRole("navigation", { name: "主导航" }); await nav.getByRole("link", { name: "备份项目A", exact: true }).click(); await nav.getByRole("link", { name: "备份项目B", exact: true }).click(); await nav.getByRole("link", { name: "备份项目A", exact: true }).click();
  await page.getByRole("button", { name: "备份项目", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("项目：备份项目A"); await page.goBack(); await expect(page.getByRole("heading", { name: "备份项目B", exact: true })).toBeVisible(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "备份项目", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("项目：备份项目B");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "下载完整项目备份", exact: true }).click(); const file = await download; expect(file.suggestedFilename()).toBe("备份项目B-项目备份.json"); expect(parseProjectBackup(await readFile((await file.path())!, "utf8")).project.title).toBe("备份项目B");
});
