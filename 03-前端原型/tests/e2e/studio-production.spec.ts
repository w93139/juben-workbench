import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { seedProject } from "./project-fixture";
import { offlineCapability, prepared, readState, writeState } from "./workbench-fixture";
import { budgetFixture, testQuotes } from "./budget-fixture";
import { reviewAudit, reviewBlueprint, reviewCheckpoint } from "../fixtures/studio-review";
import type { StudioJobView } from "../../src/domain/studio";
import { parseProjectBackup } from "../../src/domain/project-backup";

async function setup(page: Page, running = true) {
  await offlineCapability(page); const base = await seedProject(page, "阶段成果恢复");
  const state = prepared(); state.blueprint = reviewBlueprint(); const jobId = crypto.randomUUID(), progress = reviewCheckpoint();
  state.review = progress.review; state.reviewBlueprintRevision = 1;
  if (running) state.job = { jobId, operation: "review", phase: "提交资料", sourceRevision: 1, blueprintRevision: 1 };
  else state.reviewProgress = { jobId, blueprintRevision: 1, checkpoint: progress };
  await writeState(page, base, state);
  const view: StudioJobView = { jobId, status: "running", phase: "阶段处理中", reviewProgress: progress };
  return { base, state, view };
}
function failed(view: StudioJobView): StudioJobView { return { ...view, status: "failed", phase: "本轮未完成", error: { code: "SYNTHETIC", message: "自造中断，成果保留" } }; }
async function preview(page: Page, runId: string | null, savedUnits: number) {
  await page.route("**/api/studio/budget**", async route => {
    if (route.request().method() !== "POST" || route.request().postDataJSON().action !== "preview") return route.fallback();
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { projectId: body.projectId, operation: "review", previewId: crypto.randomUUID(), budget: budgetFixture(body.projectId), quotes: testQuotes(), callsMax: 16, estimateFen: 50, checkpoint: { runId, savedUnits, totalUnits: 16, allCached: false, interruptedUnits: savedUnits ? 1 : 0 } } });
  });
}
test("阶段正文和完整报告运行中落盘，失败与刷新保留，手机可读且旧通过不能导出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const s = await setup(page); let view = s.view, posts = 0;
  const state = s.state; state.review = { ...view.reviewProgress!.review, passed: true, issues: [], validationId: crypto.randomUUID(), reports: { designGate: reviewAudit(), independentA: reviewAudit(), independentB: reviewAudit(), mutualA: reviewAudit(), mutualB: reviewAudit(), coordinator: reviewAudit() } }; await writeState(page, s.base, state);
  view.reviewProgress!.review.reports.independentA!.warnings.push("长提醒".repeat(300));
  page.on("request", r => { if (r.method() === "POST" && /\/api\/studio\/review$/.test(r.url())) posts++; });
  await page.route("**/api/studio/status?**", route => route.fulfill({ json: view }));
  await page.goto(`${s.base}/stages/generation`); const region = page.getByRole("region", { name: "已保存的阶段成果" });
  await expect(region).toContainText("已保存 3/7 阶段"); await region.getByText("独立检查A · 已保存报告", { exact: true }).click(); await expect(region).toContainText("阅读负担需真人试玩"); await region.getByText("角色本 · A的character材料 · A", { exact: true }).click(); await expect(region).toContainText("A选择是否公开档案");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await readState(page, s.base)).revision).toBe(1);
  view = failed({ ...view, reviewProgress: { ...view.reviewProgress!, revision: 6 } });
  await expect(page.getByRole("button", { name: "查看继续费用" })).toBeVisible(); expect((await readState(page, s.base)).job).toBeNull(); await expect(page.getByRole("button", { name: "导出完整档案", exact: true })).toHaveCount(0);
  await page.reload(); await expect(region).toContainText("已保存 3/7 阶段"); expect(posts).toBe(0);
  await preview(page, view.reviewProgress!.runId, 3); await page.getByRole("button", { name: "查看继续费用" }).click(); await expect(page.getByRole("dialog")).toContainText("本次可复用 3/16"); await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click(); expect(posts).toBe(0);
});
test("终态保存失败保留原任务，恢复查询只GET，成功后完整保留最后报告", async ({ page }) => {
  const s = await setup(page); let posts = 0;
  page.on("request", r => { if (r.method() === "POST" && /\/api\/studio\/review$/.test(r.url())) posts++; });
  await page.route("**/api/studio/status?**", route => route.fulfill({ json: failed(s.view) }));
  await page.goto(`${s.base}/stages/generation`);
  await page.evaluate(() => { const original = IDBObjectStore.prototype.put; Reflect.set(window, "failProgress", true); IDBObjectStore.prototype.put = function(value, ...keys) { if (Reflect.get(window, "failProgress") && value.reviewProgress) throw new DOMException("自造阶段存储失败", "QuotaExceededError"); return original.call(this, value, ...keys); }; });
  await expect(page.getByRole("button", { name: "重新查询任务状态" })).toBeVisible(); expect((await readState(page, s.base)).job?.jobId).toBe(s.view.jobId);
  await page.evaluate(() => Reflect.set(window, "failProgress", false)); await page.getByRole("button", { name: "重新查询任务状态" }).click(); await expect(page.getByRole("button", { name: "查看继续费用" })).toBeVisible();
  const next = await readState(page, s.base); expect(next.job).toBeNull(); expect(next.reviewProgress?.checkpoint.review.reports).toEqual(s.view.reviewProgress!.review.reports); expect(posts).toBe(0);
});
test("两页乱序GET不回退阶段，旧查询结束后原生IDB仍保留新进度", async ({ page, context }) => {
  const s = await setup(page); let release!: () => void, held = false;
  const old = structuredClone(s.view), current = structuredClone(s.view); current.reviewProgress!.revision = 9; current.reviewProgress!.review.reports.independentB = reviewAudit(); current.reviewProgress!.steps.find(step => step.id === "independentB")!.state = "saved"; current.phase = "较新阶段";
  await page.route("**/api/studio/status?**", async route => { if (!held) { held = true; await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ json: old }); } else await route.fulfill({ json: current }); });
  await page.goto(`${s.base}/stages/generation`); await expect.poll(() => held).toBe(true);
  const other = await context.newPage(); await offlineCapability(other); await other.route("**/api/studio/status?**", route => route.fulfill({ json: current })); await other.goto(`${s.base}/stages/generation`); await expect(other.getByRole("region", { name: "已保存的阶段成果" })).toContainText("已保存 4/7 阶段");
  await page.evaluate(() => { const transaction = IDBDatabase.prototype.transaction; Reflect.set(window, "progressTransactions", 0); IDBDatabase.prototype.transaction = function(...args) { const tx = transaction.apply(this, args); if (args[1] === "readwrite") tx.addEventListener("complete", () => Reflect.set(window, "progressTransactions", Number(Reflect.get(window, "progressTransactions")) + 1)); return tx; }; });
  release(); await page.waitForFunction(() => Number(Reflect.get(window, "progressTransactions")) > 0);
  const next = await readState(page, s.base); expect(next.reviewProgress?.checkpoint.revision).toBe(9); expect(next.reviewProgress?.checkpoint.review.reports.independentB).toEqual(reviewAudit()); expect(next.job?.phase).toBe("较新阶段"); await other.close();
});
test("配置不兼容明确从头执行，手动确认才建立新任务并接受新批次低版本", async ({ page }) => {
  const s = await setup(page, false); await preview(page, null, 0); let posts = 0, view = s.view;
  await page.route("**/api/studio/review", async route => { posts++; view = { ...s.view, jobId: route.request().headers()["x-studio-request-id"], reviewProgress: reviewCheckpoint(crypto.randomUUID(), 1) }; await route.fulfill({ status: 202, json: view }); });
  await page.route("**/api/studio/status?**", route => route.fulfill({ json: failed(view) }));
  await page.goto(`${s.base}/stages/generation`); await page.getByRole("button", { name: "查看继续费用" }).click(); await expect(page.getByRole("dialog")).toContainText("本次将从头执行"); expect(posts).toBe(0);
  await page.getByRole("dialog").getByRole("button", { name: "按项目额度开始" }).click(); await expect.poll(() => posts).toBe(1); await expect.poll(async () => (await readState(page, s.base)).reviewProgress?.checkpoint.runId).toBe(view.reviewProgress!.runId);
  const next = await readState(page, s.base); expect(next.reviewProgress?.checkpoint.revision).toBe(1); expect(next.job).toBeNull(); await page.reload(); expect(posts).toBe(1);
});
test("阶段成果v3完整备份与恢复保留全文，新副本无继续或导出权限且不外呼", async ({ page }) => {
  const s = await setup(page, false); let posts = 0; page.on("request", r => { if (r.method() === "POST" && /\/api\/studio\/(review|analyze|blueprint)$/.test(r.url())) posts++; });
  await page.goto(`${s.base}/stages/generation`); await page.getByRole("button", { name: "备份项目", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("阶段成果 3/7 · 阶段正文 9 份 · 阶段报告 2 份");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "下载完整项目备份", exact: true }).click(); const file = await download, text = await readFile((await file.path())!, "utf8"), backup = parseProjectBackup(text);
  expect(backup.schemaVersion).toBe(3); expect(backup.workbench.reviewProgress?.checkpoint.runId).toBeNull(); expect(backup.workbench.reviewProgress?.checkpoint.review.artifacts).toEqual(s.view.reviewProgress!.review.artifacts);
  await page.goto("/projects"); await page.getByLabel("选择完整项目备份").setInputFiles({ name: "自造阶段备份.json", mimeType: "application/json", buffer: Buffer.from(text) }); await page.getByRole("button", { name: "恢复为新副本", exact: true }).click(); await page.getByRole("button", { name: "打开恢复的副本", exact: true }).click();
  await page.getByRole("navigation", { name: "创作流程" }).getByRole("link", { name: /交叉验证与导出/ }).click(); await expect(page.getByRole("heading", { name: "备份中的未完成成果", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "查看继续费用" })).toHaveCount(0); await expect(page.getByRole("button", { name: "导出完整档案", exact: true })).toHaveCount(0); expect(posts).toBe(0); await page.getByRole("button", { name: "备份项目", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("阶段成果 3/7 · 阶段正文 9 份 · 阶段报告 2 份");
});
test("新一轮审查尚未收到进度就404，保留正文但旧通过资格不会复活", async ({ page }) => {
  const s = await setup(page); s.state.review = { ...s.view.reviewProgress!.review, passed: true, issues: [], validationId: crypto.randomUUID(), reports: { designGate: reviewAudit(), independentA: reviewAudit(), independentB: reviewAudit(), mutualA: reviewAudit(), mutualB: reviewAudit(), coordinator: reviewAudit() } }; await writeState(page, s.base, s.state);
  await page.route("**/api/studio/status?**", route => route.fulfill({ status: 404, json: { error: { code: "JOB_NOT_FOUND", message: "未找到" } } }));
  await page.goto(`${s.base}/stages/generation`); await expect(page.getByRole("region", { name: "具体功能内容" }).getByRole("alert")).toContainText("继续生成与审查");
  const next = await readState(page, s.base); expect(next.job).toBeNull(); expect(next.review?.validationId).toBeUndefined(); expect(next.review?.passed).toBe(false); expect(next.review?.artifacts).toHaveLength(9); await expect(page.getByRole("button", { name: "导出完整档案", exact: true })).toHaveCount(0); await page.reload(); await expect(page.getByRole("button", { name: "导出完整档案", exact: true })).toHaveCount(0);
});
