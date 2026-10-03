import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import { installBudgetFixture } from "./budget-fixture";
import { seedProject } from "./project-fixture";
import { analysis, readState, writeState } from "./workbench-fixture";
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

test("作者修订未保存时不丢输入，并阻止选择方向与生成蓝图", async ({ page }) => {
  const base = await seedProject(page, "作者修订保护"); const state = readyState();
  await writeState(page, base, state);
  await page.goto(`${base}/stages/analysis`);
  await page.locator("summary", { hasText: "作者修订大纲与方向" }).click();
  await page.getByLabel("作者修订大纲").fill("作者改名后的大纲内容");
  await expect(page.getByText("请先保存作者修订")).toBeVisible();
  await expect(page.getByRole("button", { name: /责任与选择/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "生成蓝图" })).toBeDisabled();
  await page.getByRole("button", { name: "生成蓝图" }).click({ force: true }).catch(() => {});
  await expect(page.getByRole("dialog", { name: "本次创作费用" })).toHaveCount(0);
  // 跨步骤往返：草稿保留在本机，不丢输入。
  await page.goto(`${base}/stages/materials`);
  await page.goto(`${base}/stages/analysis`);
  await page.locator("summary", { hasText: "作者修订大纲与方向" }).click();
  await expect(page.getByLabel("作者修订大纲")).toHaveValue("作者改名后的大纲内容");
  // 保存后方向可选、蓝图可生成。
  await page.getByRole("button", { name: "保存作者修订" }).click();
  await expect(page.getByRole("button", { name: /责任与选择/ })).toBeEnabled();
  const saved = await readState(page, base);
  expect(saved.authorOutline).toBe("作者改名后的大纲内容");
  expect(saved.authorRevision).toBe(saved.analysisSourceRevision);
});

test("导出期间另一标签页修改项目：两个文件都不下载", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      const proto = Object.getPrototypeOf(crypto.subtle) as { digest: (...args: unknown[]) => Promise<ArrayBuffer> };
      const original = proto.digest;
      proto.digest = function (...args: unknown[]) { return new Promise((resolve) => setTimeout(resolve, 700)).then(() => original.apply(this, args)); };
    } catch { /* 环境不支持时退化为无延迟，仍由最终一致性检查兵底 */ }
  });
  const base = await seedProject(page, "导出竞态"); const state = readyState();
  await writeState(page, base, state);
  await page.goto(`${base}/stages/generation`);
  const downloads: import("@playwright/test").Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await page.getByRole("button", { name: "导出策划交接包" }).click();
  // 首次读取之后、异步构包（被延迟的摘要）完成之前，由“另一标签页”修改项目。
  await page.waitForTimeout(250);
  const bumped = structuredClone(state); bumped.revision += 1; bumped.blueprint = { ...state.blueprint!, premise: "另一标签页修改后的简介" };
  await writeState(page, base, bumped);
  await expect(page.getByText("导出期间项目已被更新，两个文件都未下载；请刷新后重新导出。")).toBeVisible();
  await expect.poll(() => downloads.length).toBe(0);
  expect((await readState(page, base)).handoffExportedAt).toBeNull();
});
