import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
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

function readyState() {
  const state = emptyWorkbench(); state.revision = 1; state.sourceRevision = 1;
  state.documents = [{ id: "doc", name: "原始剧本.txt", size: 200, text: "【机密原文】不得进入交接包", status: "read", method: "text", warnings: [], excluded: false }];
  state.analysis = analysis; state.analysisSourceRevision = 1; state.choiceId = "one";
  state.blueprint = completeBlueprint(); state.blueprintRevision = 1; state.blueprintSourceRevision = 1; state.blueprintChoiceId = "one";
  return state;
}

test("旧项目的正文与完整报告仍可在第4步只读查阅", async ({ page }) => {
  const base = await seedProject(page, "旧成果只读"); const state = readyState();
  const report = { summary: "自造报告（非真实审查）", blocking: [], warnings: [], evidence: [{ location: "蓝图简介", quote: state.blueprint!.premise, conclusion: "固定引用" }], contentComplete: true, playerHostIsolation: true, findingsAddressed: true, humanPlaytest: "not-run" as const };
  state.review = { kind: "review", passed: false, issues: ["自造旧审查未通过记录"], validationId: randomUUID(), blueprintFingerprint: createHash("sha256").update(JSON.stringify(state.blueprint)).digest("hex"), blueprint: state.blueprint!, humanPlaytest: "not-run", reports: { designGate: report, independentA: report, independentB: report, mutualA: report, mutualB: report, coordinator: report }, artifacts: [{ id: "a1", module: "character", audience: "player", characterId: "A", roundId: null, title: "甲的角色本", content: "自造旧正文内容", sourceIds: ["A"] }] };
  state.reviewBlueprintRevision = 1;
  await writeState(page, base, state);
  await page.goto(`${base}/stages/generation`);
  await expect(page.getByRole("heading", { name: "正文与完整报告" })).toBeVisible();
  await expect(page.getByText("正文材料 · 1 份")).toBeVisible();
  await expect(page.getByText("六阶段审查报告")).toBeVisible();
  await page.getByText("角色本 · 甲的角色本").click();
  await expect(page.getByText("自造旧正文内容")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始交叉验证" })).toHaveCount(0);
});

test("跨标签页修订后导出被拒，不先下载旧包", async ({ page }) => {
  const base = await seedProject(page, "过期修订导出"); const state = readyState();
  await writeState(page, base, state);
  await page.goto(`${base}/stages/generation`);
  // 模拟另一标签页保存：IDB 修订 +1，而当前页面仍是旧修订。
  const bumped = structuredClone(state); bumped.revision += 1;
  await writeState(page, base, bumped);
  const downloads: import("@playwright/test").Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await page.getByRole("button", { name: "导出策划交接包" }).click();
  await expect(page.getByText("项目已在其他标签页更新，请刷新后重新导出。")).toBeVisible();
  expect(downloads).toHaveLength(0);
});
