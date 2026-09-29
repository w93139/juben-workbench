import { expect, test, type Page } from "@playwright/test";

async function preseedDatabase(page: Page, version = 1, store: "legacy-sentinel" | "projects" | null = null) {
  await page.route("**/__idb_preseed__", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>IndexedDB preseed</title>" }));
  await page.addInitScript(({ version, store }) => {
    if (location.pathname !== "/__idb_preseed__") return;
    const request = indexedDB.open("juben-workbench:authoring:v1", version);
    request.onupgradeneeded = () => {
      if (store) request.result.createObjectStore(store);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!store) { db.close(); sessionStorage.setItem("idb-preseed", "ready"); return; }
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put({ marker: "keep-existing-data" }, "record");
      tx.oncomplete = () => { db.close(); sessionStorage.setItem("idb-preseed", "ready"); };
      tx.onerror = () => { db.close(); sessionStorage.setItem("idb-preseed", "failed"); };
    };
    request.onerror = () => sessionStorage.setItem("idb-preseed", "failed");
  }, { version, store });
  await page.goto("/__idb_preseed__");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("idb-preseed"))).toBe("ready");
}

test("已有空 v1 数据库时补建 projects，首页和创建项目恢复可用", async ({ page }) => {
  await preseedDatabase(page);
  await page.goto("/");
  await expect(page.getByText("项目读取失败，点击重试")).toHaveCount(0);
  await expect(page.getByText(/当前浏览器和地址下暂无项目/).first()).toBeVisible();
  expect(await page.evaluate(async () => {
    const request = indexedDB.open("juben-workbench:authoring:v1");
    return new Promise<{ version: number; stores: string[] }>((resolve, reject) => {
      request.onsuccess = () => { const db = request.result; resolve({ version: db.version, stores: [...db.objectStoreNames] }); db.close(); };
      request.onerror = () => reject(request.error);
    });
  })).toEqual({ version: 2, stores: ["projects"] });

  await page.goto("/projects/new");
  await page.locator('input[aria-label="选择剧本文件"]').setInputFiles({ name: "自造存储回归.txt", mimeType: "text/plain", buffer: Buffer.from("自造的浏览器存储回归材料。") });
  await expect(page).toHaveURL(/\/projects\/project-[^/]+\/stages\/materials$/);
  await expect(page.locator(".project-nav-row")).toHaveCount(1);
  await expect(page.getByText("项目读取失败，点击重试")).toHaveCount(0);
});

test("补建 projects 时按现有版本升级并保留其他对象仓库及记录", async ({ page }) => {
  await preseedDatabase(page, 3, "legacy-sentinel");
  await page.goto("/");
  await expect(page.getByText(/当前浏览器和地址下暂无项目/).first()).toBeVisible();
  const stored = await page.evaluate(async () => {
    const request = indexedDB.open("juben-workbench:authoring:v1");
    return new Promise<{ version: number; stores: string[]; marker: string }>((resolve, reject) => {
      request.onsuccess = () => {
        const db = request.result;
        const item = db.transaction("legacy-sentinel").objectStore("legacy-sentinel").get("record");
        item.onsuccess = () => { resolve({ version: db.version, stores: [...db.objectStoreNames], marker: item.result.marker }); db.close(); };
        item.onerror = () => { reject(item.error); db.close(); };
      };
      request.onerror = () => reject(request.error);
    });
  });
  expect(stored).toEqual({ version: 4, stores: ["legacy-sentinel", "projects"], marker: "keep-existing-data" });
});

test("已有 projects 数据库保持原版本与记录", async ({ page }) => {
  await preseedDatabase(page, 1, "projects");
  await page.goto("/");
  await expect(page.getByText(/当前浏览器和地址下暂无项目/).first()).toBeVisible();
  const stored = await page.evaluate(async () => {
    const request = indexedDB.open("juben-workbench:authoring:v1");
    return new Promise<{ version: number; marker: string }>((resolve, reject) => {
      request.onsuccess = () => {
        const db = request.result;
        const item = db.transaction("projects").objectStore("projects").get("record");
        item.onsuccess = () => { resolve({ version: db.version, marker: item.result.marker }); db.close(); };
        item.onerror = () => { reject(item.error); db.close(); };
      };
      request.onerror = () => reject(request.error);
    });
  });
  expect(stored).toEqual({ version: 1, marker: "keep-existing-data" });
});
