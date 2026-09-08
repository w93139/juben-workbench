import { seedProject } from "./project-fixture";
import { expect, test, type Page } from "@playwright/test";

const key = "juben-workbench:projects:v1";
const draft = {
  premise: "档案馆里的两名编辑寻找失踪照片", truth: "主持独占真相：甲偷藏了底片",
  characters: [
    { id: "a", name: "甲", publicIdentity: "档案编辑", goal: "找回照片", privateInformation: "甲专属秘密", choice: "公开证词会失去工作", contribution: "提供证词" },
    { id: "b", name: "乙", publicIdentity: "摄影师", goal: "查清事件", privateInformation: "乙专属秘密", choice: "揭露好友", contribution: "辨认照片" },
  ], relationships: [{ id: "ab", fromId: "a", toId: "b", publicVersion: "同事", truth: "幕后关系谜底", consequence: "互相保护" }],
  events: [{ id: "e", time: "12:00", location: "档案馆", action: "隐藏底片", causes: [] }],
  knowledge: [{ id: "ka", characterId: "a", factId: "e", roundId: "r", state: "known", detail: "甲的本轮信息" }, { id: "kb", characterId: "b", factId: "e", roundId: "r", state: "known", detail: "乙的本轮信息" }],
  claims: [{ id: "claim", statement: "甲藏了照片", required: true }],
  clues: [{ id: "clue", name: "公开照片", content: "照片右下角有日期", supports: ["claim"], roundId: "r", characterIds: [], cost: 0, access: "本轮开始公开发放" }, { id: "secret", name: "私密照片", content: "甲的私密线索文字", supports: [], roundId: "r", characterIds: ["a"], cost: 0, access: "只给甲" }],
  rounds: [{ id: "r", name: "公开调查", minutes: 30, activity: "分享线索", reveal: "发现底片失踪" }],
  triggers: [{ id: "t", roundId: "r", condition: "玩家提出质疑", action: "补发证词", fallback: "结束前主动提示" }],
  endings: [{ id: "end", name: "公开档案", condition: "选择公开", choice: "是否公布", consequence: "档案进入公共视野" }],
};
async function create(page: Page) {
  await seedProject(page, "生成审查测试");
  await expect(page.getByRole("heading", { name: "生成审查测试", exact: true })).toBeVisible();
  const base = page.url();
  // C's editor is covered elsewhere. Seed this test's original blueprint only.
  await page.evaluate(({ key, draft }) => {
    const data = JSON.parse(localStorage.getItem(key)!);
    const p = data.projects[0];
    p.blueprint = { draft, versions: [{ id: "v1", label: "第一版", createdAt: new Date().toISOString(), data: draft }], savedAt: new Date().toISOString(), revision: 1, sourceLabel: "自动化测试自有数据" };
    p.revision++;
    localStorage.setItem(key, JSON.stringify(data));
  }, { key, draft });
  await page.goto(`${base}/stages/generation`);
  await expect(page.getByLabel("本次使用的蓝图版本")).toHaveValue("v1");
  return base;
}
const job = (page: Page) => page.getByRole("region", { name: "正文生成任务", exact: true });
const results = (page: Page) => page.getByRole("region", { name: "模拟审查结果", exact: true });
async function generate(page: Page, module: string) {
  await page.getByRole("button", { name: `模拟生成${module}`, exact: true }).click();
  await expect(job(page).getByRole("heading")).toContainText(`${module} · 模拟完成`);
}
async function reviewTab(page: Page) { await page.getByRole("button", { name: "双模型检查", exact: true }).click(); }
async function startReview(page: Page) {
  await page.getByRole("button", { name: /^(开始模拟双审|发起新一轮模拟复查)$/ }).click();
}
async function complete(page: Page) { await expect(results(page).getByText("模拟意见已汇总 · 待作者处理", { exact: true })).toBeVisible(); }

test("六类正文按角色和主持分开，重新生成保留旧版，刷新保存", async ({ page }) => {
  test.setTimeout(60000);
  await create(page);
  for (const kind of ["角色本", "私人信息", "阶段更新", "公共线索", "主持手册", "终局材料"]) await generate(page, kind);
  await page.getByRole("button", { name: "预览与编辑：甲 · 角色本", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("找回照片");
  await expect(dialog).not.toContainText("乙专属秘密");
  await expect(dialog).not.toContainText("主持独占真相");
  await expect(dialog).not.toContainText("幕后关系谜底");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "预览与编辑：甲 · 公开调查", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("甲的本轮信息"); await expect(dialog).not.toContainText("乙的本轮信息");
  await page.keyboard.press("Escape");
  const materials = page.getByRole("region", { name: "正文材料预览", exact: true });
  await expect(materials.getByRole("button", { name: "预览与编辑：私密照片", exact: true })).toHaveCount(0);
  await expect(materials.getByRole("button", { name: "预览与编辑：主持人手册", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "主持材料 · 含谜底", exact: true }).click();
  await page.getByRole("button", { name: "预览与编辑：主持人手册", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("主持独占真相");
  await page.keyboard.press("Escape");
  await generate(page, "角色本"); await page.reload();
  await expect(materials).toContainText("第 2 版");
  await materials.getByText("查看正文历史版本", { exact: true }).click();
  await materials.getByRole("button", { name: "查看历史：甲 · 角色本 第 1 版", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "编辑这份正文", exact: true })).toBeDisabled();
});

test("生成取消、刷新续跑及模拟失败重试不会覆盖既有正文", async ({ page }) => {
  await create(page);
  await page.getByRole("button", { name: "模拟生成角色本", exact: true }).click();
  await job(page).getByRole("button", { name: "取消本次生成", exact: true }).click();
  await expect(job(page)).toContainText("已取消");
  await expect(page.getByRole("button", { name: "预览与编辑：甲 · 角色本", exact: true })).toHaveCount(0);
  await job(page).getByRole("button", { name: "重试本次生成", exact: true }).click();
  await expect(job(page)).toContainText("正在模拟");
  await page.reload(); await expect(job(page)).toContainText("模拟完成");
  const panel = page.getByRole("region", { name: "分模块生成", exact: true });
  await panel.getByText("演示选项", { exact: true }).click();
  await panel.getByLabel("让下一次生成模拟失败，练习重试").check();
  await page.getByRole("button", { name: "模拟生成角色本", exact: true }).click();
  await expect(job(page).getByRole("heading")).toContainText("模拟失败");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).projects[0].production.artifacts.length, key)).toBe(2);
  await job(page).getByRole("button", { name: "重试本次生成", exact: true }).click();
  await expect(job(page)).toContainText("模拟完成");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).projects[0].production.artifacts.length, key)).toBe(4);
});

test("双审保留单侧成功，重试后比较分歧、记录暂定与不采纳，刷新不丢", async ({ page }) => {
  await create(page); await reviewTab(page);
  const panel = page.getByRole("region", { name: "发起模拟审查", exact: true });
  await panel.getByText("演示选项", { exact: true }).click();
  await panel.getByLabel("模拟单侧失败").selectOption("model-b");
  await startReview(page);
  await expect(results(page).getByRole("button", { name: "重试审查者 B", exact: true })).toBeEnabled();
  await expect(results(page).getByText("模拟完成", { exact: true })).toHaveCount(1);
  await expect(results(page).getByText("单侧意见 · 尚未完成比较", { exact: true }).first()).toBeVisible();
  await results(page).getByRole("button", { name: "重试审查者 B", exact: true }).click();
  await complete(page);
  await results(page).getByRole("button", { name: "比较分歧（模拟一次互审）", exact: true }).click();
  await expect(results(page).getByRole("button", { name: "已完成一次模拟互审", exact: true })).toBeDisabled();
  const finding = page.getByRole("article", { name: "审查问题：模拟分歧：是否现在增加提示", exact: true });
  await finding.getByLabel("处理理由").fill("先试玩再决定，保留分歧");
  await finding.getByRole("button", { name: "保存处理决定", exact: true }).click();
  await expect(finding.getByText("暂定", { exact: true })).toBeVisible();
  await page.reload(); await reviewTab(page);
  await expect(finding.getByLabel("处理理由")).toHaveValue("先试玩再决定，保留分歧");
  await finding.getByLabel("这条建议怎么处理").selectOption("rejected");
  await finding.getByRole("button", { name: "保存处理决定", exact: true }).click();
  await expect(finding.locator("span.tag").filter({ hasText: /^不采纳$/ })).toBeVisible();
  await expect(finding.getByText("存在分歧", { exact: true })).toBeVisible();
});

test("正文修改先预览且建立新版，旧审查失效，再审固定新材料", async ({ page }) => {
  await create(page); await generate(page, "角色本"); await reviewTab(page);
  await page.getByLabel("检查什么", { exact: true }).selectOption("manuscript");
  await startReview(page); await complete(page);
  const finding = page.getByRole("article", { name: "审查问题：模拟意见：核对玩家理解与主持发放", exact: true });
  await finding.getByLabel("这条建议怎么处理").selectOption("adopted");
  await finding.getByLabel("处理理由").fill("补充发放时机");
  await finding.getByRole("button", { name: "保存处理决定", exact: true }).click();
  await expect(finding.getByText("采纳 · 待修改与复查", { exact: true })).toBeVisible();
  await finding.getByRole("button", { name: "预览建议与对应正文", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("建议预览");
  await dialog.getByRole("button", { name: "编辑这份正文", exact: true }).click();
  const old = await dialog.getByLabel("正文内容").inputValue();
  await dialog.getByLabel("正文内容").fill(`${old}\n发放时机：开场仅交给甲。`);
  await dialog.getByRole("button", { name: "预览本次修改", exact: true }).click();
  await expect(dialog).toContainText("修改前"); await expect(dialog).toContainText("修改后");
  await dialog.getByRole("button", { name: "确认保存为新版", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(results(page).getByText("需要复查", { exact: true })).toBeVisible();
  await startReview(page); await complete(page);
  const manifest = await page.evaluate((key) => { const p = JSON.parse(localStorage.getItem(key)!).projects[0].production; return { old: p.reviews[0].artifactIds, current: p.reviews[1].artifactIds, body: p.artifacts }; }, key);
  expect(manifest.old).not.toEqual(manifest.current);
  expect(manifest.body[0].content).not.toContain("发放时机：开场仅交给甲。");
  await expect(finding.getByText("待处理", { exact: true })).toBeVisible();
});

test("已保存草稿改变后审查旧版本仍提示复查，未把旧版通过继承给新稿", async ({ page }) => {
  const base = await create(page); await reviewTab(page); await startReview(page); await complete(page);
  await page.goto(`${base}/stages/blueprint`);
  await page.getByLabel("故事简介", { exact: true }).fill("新版故事简介");
  await page.getByRole("button", { name: "保存蓝图草稿", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存蓝图草稿", exact: true })).toBeDisabled();
  await page.goto(`${base}/stages/review`);
  await expect(results(page).getByText("需要复查", { exact: true })).toBeVisible();
  await startReview(page);
  await expect(results(page).getByText("需要复查", { exact: true })).toBeVisible();
  await expect(results(page).getByText("模拟完成", { exact: true })).toHaveCount(2);
  await page.goto(`${base}/stages/blueprint`);
  await page.getByLabel("版本名称", { exact: true }).fill("新蓝图");
  await page.getByRole("button", { name: "建立蓝图版本", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看版本：新蓝图", exact: true })).toBeVisible();
  await page.goto(`${base}/stages/review`); await startReview(page); await complete(page);
});

for (const width of [1440, 390]) test(`D工作台与修改弹窗可访问 ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await create(page); await generate(page, "角色本");
  await page.screenshot({ path: testInfo.outputPath(`production-${width}.png`), fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "预览与编辑：甲 · 角色本", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "编辑这份正文", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("正文内容")).toBeEditable();
  await page.keyboard.press("Escape");
  await reviewTab(page); await startReview(page); await complete(page);
  await results(page).evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: testInfo.outputPath(`review-${width}.png`), fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("正文编辑保存失败与跨页冲突保留输入，显式重载后才能提交", async ({ page, context }) => {
  const base = await create(page); await generate(page, "角色本");
  await page.getByRole("button", { name: "预览与编辑：甲 · 角色本", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "编辑这份正文", exact: true }).click();
  await dialog.getByLabel("正文内容", { exact: true }).fill("修改后的甲角色正文，保存失败时不能丢失。");
  await dialog.getByRole("button", { name: "预览本次修改", exact: true }).click();
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && !sessionStorage.getItem("allow-production")) throw new DOMException("quota", "QuotaExceededError");
      original.call(this, name, value);
    };
  }, key);
  await dialog.getByRole("button", { name: "确认保存为新版", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("保存失败");
  await expect(dialog.getByLabel("正文内容", { exact: true })).toHaveValue("修改后的甲角色正文，保存失败时不能丢失。");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).projects[0].production.artifacts.length, key)).toBe(2);
  await page.evaluate(() => sessionStorage.setItem("allow-production", "1"));
  const other = await context.newPage(); await other.goto(base);
  await other.getByRole("button", { name: "改名", exact: true }).click();
  await other.getByRole("dialog").getByLabel("项目名称", { exact: false }).fill("另一页改名");
  await other.getByRole("dialog").getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(other.getByRole("dialog")).toBeHidden();
  await dialog.getByRole("button", { name: "确认保存为新版", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("其他页面更新");
  await expect(dialog.getByLabel("正文内容", { exact: true })).toHaveValue("修改后的甲角色正文，保存失败时不能丢失。");
  await dialog.getByRole("button", { name: "保留输入，载入最新状态", exact: true }).click();
  await expect(dialog.getByText(/输入已保留。再次保存/)).toBeVisible();
  await dialog.getByRole("button", { name: "确认保存为新版", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "预览与编辑：甲 · 角色本", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("修改后的甲角色正文，保存失败时不能丢失。");
});

test("后台推进保存失败明确暂停，恢复后继续且不重复生成", async ({ page }) => {
  await create(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && !sessionStorage.getItem("allow-progress")) {
        const p = JSON.parse(value).projects[0];
        if ((p.production?.jobs.at(-1)?.step ?? 0) > 0) throw new DOMException("quota", "QuotaExceededError");
      }
      original.call(this, name, value);
    };
  }, key);
  await page.getByRole("button", { name: "模拟生成角色本", exact: true }).click();
  const failure = page.getByRole("region", { name: "模拟任务保存失败", exact: true });
  await expect(failure).toBeVisible();
  await expect(failure).toContainText("保存失败");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).projects[0].production.artifacts.length, key)).toBe(0);
  await page.evaluate(() => sessionStorage.setItem("allow-progress", "1"));
  await failure.getByRole("button", { name: "继续保存生成与检查进度", exact: true }).click();
  await expect(failure).toBeHidden();
  await expect(job(page)).toContainText("模拟完成");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).projects[0].production.artifacts.length, key)).toBe(2);
  // A cancelled failed task must not keep a different, new task paused.
  await page.evaluate(() => sessionStorage.removeItem("allow-progress"));
  await page.getByRole("button", { name: "模拟生成私人信息", exact: true }).click();
  await expect(failure).toBeVisible();
  await job(page).getByRole("button", { name: "取消本次生成", exact: true }).click();
  await expect(job(page)).toContainText("已取消");
  await expect(failure).toBeHidden();
  await page.evaluate(() => sessionStorage.setItem("allow-progress", "1"));
  await generate(page, "私人信息");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).projects[0].production.artifacts.length, key)).toBe(4);
});
