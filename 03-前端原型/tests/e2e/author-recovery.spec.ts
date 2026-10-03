import { test, expect } from "@playwright/test";
import { seedProject } from "./project-fixture";
import { prepared, writeState, readState, offlineCapability } from "./workbench-fixture";

test.beforeEach(async ({ page }) => { await offlineCapability(page); });
async function openEditor(page: import("@playwright/test").Page, base: string) {
  await page.goto(`${base}/stages/analysis`);
  await page.locator("summary", { hasText: "作者修订大纲与方向" }).click();
}
test("保存其他字段不清除未保存作者大纲，刷新仍可恢复", async ({ page }) => {
  const base = await seedProject(page, "自造草稿保护"); await writeState(page, base, prepared()); await openEditor(page, base);
  await page.getByLabel("作者修订大纲").fill("必须保留的作者草稿");
  await page.locator("summary", { hasText: "补充你的创作要求" }).click();
  await page.getByLabel("补充创作要求").fill("自造新的创作要求"); await page.getByLabel("补充创作要求").blur();
  await expect.poll(async () => (await readState(page, base)).instructions).toBe("自造新的创作要求");
  await expect(page.getByLabel("作者修订大纲")).toHaveValue("必须保留的作者草稿");
  await openEditor(page, base);
  await expect(page.getByLabel("作者修订大纲")).toHaveValue("必须保留的作者草稿");
  await expect(page.getByRole("button", { name: "生成蓝图" })).toBeDisabled();
  await page.getByRole("button", { name: "保存作者修订" }).click();
  await expect.poll(async () => (await readState(page, base)).authorOutline).toBe("必须保留的作者草稿");
});
test("opener 复制标签草稿分别保留，远端作者修订变化需要显式采用", async ({ page }) => {
  const base = await seedProject(page, "自造跨标签草稿"); await writeState(page, base, prepared()); await openEditor(page, base);
  await page.getByLabel("作者修订大纲").fill("甲标签的未保存大纲");
  const opened = page.waitForEvent("popup");
  await page.evaluate(() => { window.open("about:blank"); });
  const other = await opened; await offlineCapability(other); await openEditor(other, base);
  await other.getByLabel("作者修订大纲").fill("乙标签的作者大纲"); await other.getByRole("button", { name: "保存作者修订" }).click();
  await expect.poll(async () => (await readState(other, base)).authorOutline).toBe("乙标签的作者大纲");
  await expect(page.getByText("草稿依据已变化或来自旧版本。", { exact: false })).toBeVisible();
  await expect(page.getByLabel("作者修订大纲")).toHaveValue("甲标签的未保存大纲");
  await openEditor(page, base);
  await expect(page.getByLabel("作者修订大纲")).toHaveValue("甲标签的未保存大纲");
  await expect(page.getByRole("button", { name: "保存作者修订" })).toBeDisabled();
  await page.getByRole("button", { name: "按当前分析采用本页草稿" }).click(); await page.getByRole("button", { name: "保存作者修订" }).click();
  await expect.poll(async () => (await readState(page, base)).authorOutline).toBe("甲标签的未保存大纲");
});
test("新分析后暂存草稿保持可见但不能静默作为当前依据", async ({ page }) => {
  const base = await seedProject(page, "自造重拆草稿"); const state = prepared(); await writeState(page, base, state); await openEditor(page, base);
  await page.getByLabel("作者修订大纲").fill("旧分析的暂存大纲");
  state.analysis = { ...state.analysis!, outline: "新一次拆解" }; state.analysisRevision++; state.revision++;
  await writeState(page, base, state); await openEditor(page, base);
  await expect(page.getByLabel("作者修订大纲")).toHaveValue("旧分析的暂存大纲");
  await expect(page.getByText("当前已保存大纲：新一次拆解")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存作者修订" })).toBeDisabled();
});
test("缺少旧版本绑定的作者内容可查阅并显式载入采用", async ({ page }) => {
  const base = await seedProject(page, "自造旧版本作者稿"); const state = prepared(); state.authorOutline = "升级前的作者大纲"; await writeState(page, base, state); await openEditor(page, base);
  await page.getByText("查看旧依据的作者修订（未自动采用）").click();
  await expect(page.getByText("升级前的作者大纲", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "将旧作者修订载入当前草稿" }).click();
  await page.getByRole("button", { name: "保存作者修订" }).click();
  await expect.poll(async () => (await readState(page, base)).authorAnalysisRevision).toBe(state.analysisRevision);
  expect((await readState(page, base)).authorOutline).toBe("升级前的作者大纲");
});
test("暂存写失败显示真实状态、保护输入并可重试", async ({ page }) => {
  const base = await seedProject(page, "自造暂存写失败"); await writeState(page, base, prepared()); await openEditor(page, base);
  await page.evaluate(() => { const original = Storage.prototype.setItem; (window as unknown as { restoreDraftStorage: () => void }).restoreDraftStorage = () => { Storage.prototype.setItem = original; }; Storage.prototype.setItem = function (key, value) { if (this === window.sessionStorage && key.includes("analysis-draft:")) throw new DOMException("自造存储额度已满", "QuotaExceededError"); original.call(this, key, value); }; });
  await page.getByLabel("作者修订大纲").fill("第一次写失败的作者稿");
  await expect(page.getByText("本机暂存失败", { exact: false })).toBeVisible();
  await page.getByLabel("作者修订大纲").fill("写失败仍需保留的作者稿");
  await expect(page.getByText("本机暂存失败", { exact: false })).toBeVisible();
  await expect(page.getByText("有未保存的作者修订：已暂存在本机", { exact: false })).toHaveCount(0);
  await expect(page.getByLabel("作者修订大纲")).toHaveValue("写失败仍需保留的作者稿");
  await expect(page.getByRole("button", { name: "生成蓝图" })).toBeDisabled();
  await page.locator(`a[href="${new URL(base).pathname}/stages/materials"]`).first().click();
  await page.locator(`a[href="${new URL(base).pathname}/stages/analysis"]`).first().click();
  await page.locator("summary", { hasText: "作者修订大纲与方向" }).click();
  await expect(page.getByLabel("作者修订大纲")).toHaveValue("写失败仍需保留的作者稿");
  await expect(page.getByText("本机暂存失败", { exact: false })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { restoreDraftStorage: () => void }).restoreDraftStorage(); });
  await page.getByRole("button", { name: "重试暂存" }).click();
  await expect(page.getByText("本机暂存失败", { exact: false })).toHaveCount(0);
  await openEditor(page, base); await expect(page.getByLabel("作者修订大纲")).toHaveValue("写失败仍需保留的作者稿");
});
