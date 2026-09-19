import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { segmentedFixture } from "../fixtures/segmented-review";
import { seedProject } from "./project-fixture";
import { offlineCapability, prepared, writeState, readState } from "./workbench-fixture";
import { parseProjectBackup } from "../../src/domain/project-backup";

async function setup(page: Page, partial = false) {
  await offlineCapability(page);
  const fixture = segmentedFixture(), base = await seedProject(page, "分段审查回归"), state = prepared();
  if (partial) for (const [index, unit] of fixture.segmented.units.entries()) if (index >= 4) { unit.state = index === 4 ? "running" : "pending"; delete unit.report; }
  state.blueprint = fixture.blueprint; state.review = fixture.checkpoint.review; state.reviewBlueprintRevision = 1;
  state.reviewProgress = { jobId: null, blueprintRevision: 1, checkpoint: fixture.checkpoint };
  await writeState(page, base, state); return { base, fixture };
}

test("分段报告30份分页按需展开，末页原始意见和精确原文可读，窄屏不溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const { base, fixture } = await setup(page);
  await page.goto(`${base}/stages/generation`);
  const region = page.getByRole("region", { name: "分段审查与覆盖" });
  await expect(region).toContainText(`已保存 ${fixture.segmented.units.length}/${fixture.segmented.plan.callsMax} 份报告`);
  await expect(region.locator(":scope > details")).toHaveCount(30); await expect(region.locator("pre")).toHaveCount(0);
  const pages = Math.ceil(fixture.segmented.units.length / 30);
  for (let index = 1; index < pages; index++) await region.getByRole("button", { name: "下一页报告" }).click();
  const last = region.locator(":scope > details").last(); await last.locator(":scope > summary").click();
  await expect(last).toContainText(fixture.segmented.units.at(-1)!.report!.summary);
  await last.locator("summary").filter({ hasText: "查看指定原文" }).first().click(); await expect(last.locator("pre")).toHaveCount(1);
  const scopeId = fixture.segmented.units.at(-1)!.scopeId;
  const partId = fixture.segmented.plan.links.find(link => link.id === scopeId)?.parts[0] ?? scopeId;
  const part = fixture.segmented.plan.parts.find(part => part.id === partId)!;
  const artifact = fixture.artifacts.find(artifact => artifact.id === part.artifactId)!;
  await expect(last.locator("pre")).toHaveText(artifact.content.slice(part.start, part.end));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); expect((await readState(page, base)).reviewProgress!.checkpoint.review.segmented!.units).toHaveLength(fixture.segmented.units.length);
});

test("部分分段成果v4下载和新副本恢复，原始报告保留而运行态/执行资格清空", async ({ page }) => {
  const { base, fixture } = await setup(page, true); let calls = 0;
  page.on("request", request => { if (request.method() === "POST" && /\/api\/studio\/(analyze|blueprint|review)$/.test(request.url())) calls++; });
  await page.goto(`${base}/stages/generation`); await page.getByRole("button", { name: "备份项目", exact: true }).click();
  const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "下载完整项目备份", exact: true }).click();
  const download = await downloaded, text = await readFile((await download.path())!, "utf8"), backup = parseProjectBackup(text);
  expect(backup.schemaVersion).toBe(4); const checkpoint = backup.workbench.reviewProgress!.checkpoint;
  expect(checkpoint.runId).toBeNull(); expect(checkpoint.review.segmented!.units[4].state).toBe("interrupted");
  expect(backup.workbench.review!.segmented!.units[4].state).toBe("interrupted");
  expect(checkpoint.review.segmented!.units[0].report).toEqual(fixture.segmented.units[0].report);
  await page.goto("/projects"); await page.getByLabel("选择完整项目备份").setInputFiles({ name: "分段备份.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await page.getByRole("button", { name: "恢复为新副本", exact: true }).click(); await page.getByRole("button", { name: "打开恢复的副本", exact: true }).click();
  await page.getByRole("navigation", { name: "创作流程" }).getByRole("link", { name: /交叉验证与导出/ }).click();
  await expect(page.getByRole("heading", { name: "备份中的未完成成果", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "分段审查与覆盖" })).toContainText(`已保存 4/${fixture.segmented.plan.callsMax} 份报告`);
  await expect(page.getByRole("button", { name: "查看继续费用" })).toHaveCount(0); await expect(page.getByRole("button", { name: "导出完整档案", exact: true })).toHaveCount(0);
  expect(calls).toBe(0);
});
