import { expect, test, type Page } from "@playwright/test";
import { seedProject } from "./project-fixture";
import { emptyBlueprintData } from "../../src/domain/blueprint";

const key = "juben-workbench:projects:v1";
async function begin(page: Page) {
  const base = await seedProject(page, "主Agent协调测试");
  const draft = emptyBlueprintData(); draft.premise = "自有剧本：两名修复师核对失踪记录"; draft.truth = "主持真相尚待作者细化";
  await page.evaluate(({ key, draft }) => {
    const envelope = JSON.parse(localStorage.getItem(key)!); const project = envelope.projects[0]; const now = new Date().toISOString();
    project.blueprint = { draft, versions: [{ id: "v1", label: "审查底稿", createdAt: now, data: draft }], revision: 1, savedAt: now, sourceLabel: "自动化测试自有草稿" }; project.revision++;
    localStorage.setItem(key, JSON.stringify(envelope));
  }, { key, draft });
  await page.goto(`${base}/stages/review`);
  await page.getByRole("button", { name: "开始模拟双审", exact: true }).click();
  await expect(page.getByText("模拟意见已汇总 · 待作者处理", { exact: true })).toBeVisible();
  await page.getByText("查看审查者 A独立结果", { exact: true }).click();
  await expect(page.getByText("查看审查者 B独立结果", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "比较分歧（模拟一次互审）", exact: true }).click();
  const coordinator = page.getByRole("region", { name: "主Agent核对与修订讨论", exact: true });
  await expect(coordinator).toContainText("主 Agent 已模拟整理两路独审");
  return { base, coordinator };
}

test("主Agent在问题上下文中给修订方案，作者编辑选择后刷新保存", async ({ page }) => {
  const { coordinator } = await begin(page);
  await coordinator.getByText("查看两路相互复核结果", { exact: true }).click();
  await expect(coordinator).toContainText("审查者 A 复核 B"); await expect(coordinator).toContainText("审查者 B 复核 A");
  await coordinator.getByLabel("讨论的问题", { exact: true }).selectOption({ index: 1 });
  await coordinator.getByLabel("修订讨论输入", { exact: true }).fill("保留现有线索，只在卡住五分钟后提供提示。");
  await coordinator.getByRole("button", { name: "发送并生成修订方案（模拟）", exact: true }).click();
  const proposal = coordinator.getByRole("article", { name: "可编辑修订方案", exact: true });
  await expect(proposal.getByLabel("修订方案内容", { exact: true })).toHaveValue(/卡住五分钟/);
  await expect(coordinator.getByLabel("修订对话记录", { exact: true })).toContainText("主 Agent · 模拟回复");
  await proposal.getByLabel("修订方案内容", { exact: true }).fill("作者定稿：连续五分钟没有推进时，主持按原有线索范围提示，不新增事实。");
  await expect(proposal.getByRole("button", { name: "保存方案选择", exact: true })).toBeDisabled();
  await proposal.getByRole("button", { name: "保存修订方案", exact: true }).click();
  await expect(proposal.getByRole("heading", { name: "修订方案 · 第 2 版", exact: true })).toBeVisible();
  await proposal.getByLabel("修订方案选择", { exact: true }).selectOption("adopted");
  await proposal.getByLabel("修订方案选择理由", { exact: true }).fill("先完善条件，再通过试玩确认效果。");
  await proposal.getByRole("button", { name: "保存方案选择", exact: true }).click();
  await expect(proposal.getByText("已采纳 · 待修改与复查", { exact: true })).toBeVisible();
  await page.reload();
  await coordinator.getByLabel("讨论的问题", { exact: true }).selectOption({ index: 1 });
  await expect(proposal.getByLabel("修订方案内容", { exact: true })).toHaveValue("作者定稿：连续五分钟没有推进时，主持按原有线索范围提示，不新增事实。");
  await expect(proposal.getByLabel("修订方案选择", { exact: true })).toHaveValue("adopted");
  await expect(coordinator.getByLabel("修订对话记录", { exact: true })).toContainText("保留现有线索");
  await proposal.getByText("查看此方案旧版本（1）", { exact: true }).click();
  await expect(proposal).toContainText("根据所选问题和你的要求拼接的本地模拟方案");
  const premise = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).projects[0].blueprint.draft.premise, key);
  expect(premise).toBe("自有剧本：两名修复师核对失踪记录");
});

test("旧审查资料变化后对话方案只读保留，窄屏不溢出", async ({ page }) => {
  const { coordinator } = await begin(page);
  await coordinator.getByLabel("修订讨论输入", { exact: true }).fill("请先整理核对步骤。");
  await coordinator.getByRole("button", { name: "发送并生成修订方案（模拟）", exact: true }).click();
  await expect(coordinator.getByRole("article", { name: "可编辑修订方案", exact: true })).toBeVisible();
  await page.evaluate((key) => { const data = JSON.parse(localStorage.getItem(key)!); const p = data.projects[0]; p.blueprint.draft.premise = "新版内容"; p.blueprint.revision++; p.revision++; localStorage.setItem(key, JSON.stringify(data)); }, key);
  await page.reload();
  await expect(coordinator).toContainText("这次审查的资料已变化");
  await expect(coordinator.getByLabel("修订讨论输入", { exact: true })).toBeDisabled();
  await expect(coordinator.getByLabel("修订方案内容", { exact: true })).toBeDisabled();
  await expect(coordinator.getByRole("button", { name: "保存方案选择", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await coordinator.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/review-coordination-mobile.png", fullPage: true });
});
