import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { installBudgetFixture } from "./budget-fixture";
import { seedProject } from "./project-fixture";
import { analysis, writeState } from "./workbench-fixture";
import { emptyWorkbench } from "../../src/domain/workbench";
import { completeBlueprint } from "../fixtures/blueprint";

test.beforeEach(async ({ page }) => {
  await installBudgetFixture(page);
  await page.route("**/api/studio/capability", route => route.fulfill({ json: { configured: true, message: "自动化测试连接状态，不调用模型" } }));
  await page.route("**/api/studio/analyze", route => route.abort());
  await page.route("**/api/studio/blueprint", route => route.abort());
  await page.route("**/api/studio/review", route => route.abort());
});

test("第4步只导出策划交接包：无正文/审查入口，导出 Markdown+JSON 且不含原文", async ({ page }) => {
  const base = await seedProject(page, "策划交接包验收");
  const state = emptyWorkbench(); state.revision = 1; state.sourceRevision = 1;
  state.documents = [{ id: "doc", name: "原始剧本.txt", size: 200, text: "【机密原文】不得进入交接包", status: "read", method: "text", warnings: [], excluded: false }];
  state.analysis = analysis; state.analysisSourceRevision = 1; state.choiceId = "one";
  state.blueprint = completeBlueprint(); state.blueprintRevision = 1; state.blueprintSourceRevision = 1; state.blueprintChoiceId = "one";
  await writeState(page, base, state);
  await page.goto(`${base}/stages/generation`);
  await expect(page.getByRole("heading", { name: "策划交接包", exact: true })).toBeVisible();
  await expect(page.getByText(/不得直接发给玩家/)).toBeVisible();
  await expect(page.getByRole("button", { name: "开始交叉验证" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查看继续费用" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "导出完整档案" })).toHaveCount(0);
  const downloads: import("@playwright/test").Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await page.getByRole("button", { name: "导出策划交接包" }).click();
  await expect.poll(() => downloads.length).toBe(2);
  const markdownFile = downloads.find((item) => item.suggestedFilename().endsWith(".md"))!;
  const jsonFile = downloads.find((item) => item.suggestedFilename().endsWith(".json"))!;
  expect(markdownFile.suggestedFilename()).toContain("策划交接包.md");
  expect(jsonFile.suggestedFilename()).toContain("策划交接包.json");
  const text = await readFile((await jsonFile.path())!, "utf8");
  expect(text).toContain("juben-workbench/plan-handoff");
  expect(text).toContain("not-run");
  expect(text).not.toContain("【机密原文】");
});

test("第3步不再提供交叉验证启动，改为前往策划交接包", async ({ page }) => {
  const base = await seedProject(page, "退役入口检查");
  const state = emptyWorkbench(); state.revision = 1; state.sourceRevision = 1;
  state.documents = [{ id: "doc", name: "原始剧本.txt", size: 200, text: "自有测试原文", status: "read", method: "text", warnings: [], excluded: false }];
  state.analysis = analysis; state.analysisSourceRevision = 1; state.choiceId = "one";
  state.blueprint = completeBlueprint(); state.blueprintRevision = 1; state.blueprintSourceRevision = 1; state.blueprintChoiceId = "one";
  await writeState(page, base, state);
  await page.goto(`${base}/stages/blueprint`);
  await expect(page.getByRole("button", { name: "开始交叉验证" })).toHaveCount(0);
  await page.getByRole("button", { name: "前往策划交接包" }).click();
  await expect(page).toHaveURL(/\/stages\/generation$/);
});
