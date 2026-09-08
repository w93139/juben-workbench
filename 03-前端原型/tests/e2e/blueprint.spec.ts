import { seedProject } from "./project-fixture";
import { expect, test, type Page } from "@playwright/test";

const key = "juben-workbench:projects:v1";
const savePanel = (page: Page) => page.getByRole("region", { name: "蓝图保存与版本", exact: true });
const section = (page: Page, name: string) => page.getByRole("region", { name: `${name}编辑`, exact: true });
async function create(page: Page, demo = false) {
  await seedProject(page, "蓝图交互测试", demo);
  await expect(page.getByRole("heading", { name: "蓝图交互测试", exact: true })).toBeVisible();
  const url = `${page.url()}/stages/blueprint`;
  await page.goto(url);
  await page.getByRole("button", { name: demo ? "载入演示蓝图" : "建立空白蓝图", exact: true }).click();
  await expect(savePanel(page)).toBeVisible();
  return url;
}
async function save(page: Page) {
  await savePanel(page).getByRole("button", { name: "保存蓝图草稿", exact: true }).click();
  await expect(savePanel(page).getByText(/^草稿修订 \d+ · 已保存$/)).toBeVisible();
  await expect(savePanel(page).getByRole("button", { name: "保存蓝图草稿", exact: true })).toBeDisabled();
}
async function tab(page: Page, name: string) { await page.getByRole("button", { name, exact: true }).click(); }

for (const width of [1440, 390]) test(`演示蓝图改名、关系同步、刷新和历史版本独立 ${width}px`, async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await create(page, true);
  await tab(page, "人物与关系");
  await section(page, "角色").getByLabel("姓名", { exact: true }).fill("新版林舟");
  await section(page, "角色").getByLabel("个人目标", { exact: true }).fill("公开档案并承担选择后果");
  await expect(section(page, "关系").getByLabel("关系中的角色一").locator("option:checked")).toHaveText("新版林舟");
  await save(page);
  await page.reload(); await tab(page, "人物与关系");
  await expect(section(page, "角色").getByLabel("姓名", { exact: true })).toHaveValue("新版林舟");
  await expect(section(page, "角色").getByLabel("个人目标", { exact: true })).toHaveValue("公开档案并承担选择后果");
  await page.getByText("查看人物关系图", { exact: true }).click();
  await expect(page.getByRole("img", { name: "人物关系图，详细关系可在下方编辑" }).getByText("新版林舟", { exact: true })).toBeVisible();
  await page.getByLabel("版本名称", { exact: true }).fill("第一份待修订版");
  await page.getByRole("button", { name: "建立蓝图版本", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看版本：第一份待修订版", exact: true })).toBeVisible();
  await section(page, "角色").getByLabel("姓名", { exact: true }).fill("再次修改林舟");
  await page.getByLabel("版本名称", { exact: true }).fill("不应保存未存稿");
  await expect(page.getByRole("button", { name: "建立蓝图版本", exact: true })).toBeDisabled();
  await save(page);
  await page.getByRole("button", { name: "查看版本：第一份待修订版", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "人物与关系", exact: true }).click();
  await expect(dialog.getByLabel("姓名", { exact: true })).toHaveValue("新版林舟");
  await expect(dialog.getByLabel("姓名", { exact: true })).toBeDisabled();
  await dialog.getByLabel("选择角色", { exact: true }).selectOption("CH-B");
  await expect(dialog.getByLabel("姓名", { exact: true })).not.toHaveValue("新版林舟");
  await expect(dialog.getByLabel("姓名", { exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(section(page, "角色").getByLabel("姓名", { exact: true })).toHaveValue("再次修改林舟");
  await savePanel(page).getByRole("button", { name: /^检查当前草稿/ }).click();
  await expect(page.getByText(/不判断文字推理是否成立/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`blueprint-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("空白蓝图各分类可添加并保存，关联选择显示已添加内容", async ({ page }) => {
  test.setTimeout(60000);
  await create(page);
  await page.getByLabel("故事简介", { exact: true }).fill("一份失踪档案让两位编辑对质");
  await page.getByLabel("客观真相", { exact: true }).fill("甲藏起档案，乙目击。");
  await tab(page, "人物与关系");
  for (const name of ["甲", "乙"]) {
    await section(page, "角色").getByRole("button", { name: "添加角色", exact: true }).click();
    for (const [label, value] of [["姓名", name], ["公开身份", "编辑"], ["个人目标", "公开事实"], ["私密信息", "看见档案"], ["有后果的选择", "公开或隐瞒"], ["对游戏推进的贡献", "提供证词"]]) await section(page, "角色").getByLabel(label, { exact: true }).fill(value);
  }
  await section(page, "关系").getByRole("button", { name: "添加关系", exact: true }).click();
  await section(page, "关系").getByLabel("关系中的角色一").selectOption({ label: "甲" });
  await section(page, "关系").getByLabel("关系中的角色二").selectOption({ label: "乙" });
  for (const [label, value] of [["表面关系", "同事"], ["真实关系", "互相隐瞒"], ["关系如何影响选择", "决定是否合作"]]) await section(page, "关系").getByLabel(label, { exact: true }).fill(value);
  await tab(page, "客观时间线");
  await page.getByRole("button", { name: "添加事件", exact: true }).click();
  await page.getByLabel("发生时间", { exact: true }).fill("12:00");
  await page.getByLabel("发生地点", { exact: true }).fill("档案馆");
  await page.getByLabel("实际发生的事", { exact: true }).fill("甲藏起档案");
  await tab(page, "轮次与主持");
  await page.getByRole("button", { name: "添加轮次", exact: true }).click();
  await page.getByLabel("轮次名称", { exact: true }).fill("公开调查");
  await page.getByLabel("计划分钟数", { exact: true }).fill("20");
  await page.getByLabel("这一轮玩家做什么", { exact: true }).fill("分享线索");
  await page.getByLabel("这一轮揭示什么", { exact: true }).fill("甲藏起档案");
  await page.getByRole("button", { name: "添加主持触发", exact: true }).click();
  await page.getByLabel("发生在哪一轮").selectOption({ label: "公开调查" });
  await page.getByLabel("什么时候触发", { exact: true }).fill("调查开始");
  await page.getByLabel("主持人具体做什么", { exact: true }).fill("公开照片");
  await page.getByLabel("条件未满足时怎么办", { exact: true }).fill("超时主动提示");
  await tab(page, "信息与线索");
  await page.getByRole("button", { name: "添加信息发放", exact: true }).click();
  await page.getByLabel("谁收到信息").selectOption({ label: "乙" });
  await page.getByLabel("对应的真实事件").selectOption({ label: "甲藏起档案" });
  await page.getByLabel("何时得到信息").selectOption({ label: "公开调查" });
  await page.getByLabel("了解程度").selectOption("known");
  await page.getByLabel("玩家看到或相信的内容", { exact: true }).fill("乙目击藏起档案");
  await page.getByRole("button", { name: "添加推理结论", exact: true }).click();
  await page.getByLabel("需要玩家得出的结论", { exact: true }).fill("甲藏起档案");
  await page.getByRole("button", { name: "添加线索", exact: true }).click();
  await page.getByLabel("线索名称", { exact: true }).fill("现场照片");
  await page.getByLabel("线索内容", { exact: true }).fill("照片记录甲拿走档案");
  await page.getByRole("group", { name: "支持哪些推理结论", exact: true }).getByLabel("甲藏起档案").check();
  await page.getByLabel("可获得的轮次").selectOption({ label: "公开调查" });
  await page.getByLabel("玩家如何获得", { exact: true }).fill("主持公开发放");
  await tab(page, "终局选择");
  await page.getByRole("button", { name: "添加终局", exact: true }).click();
  for (const [label, value] of [["终局名称", "公开真相"], ["进入条件", "选择公开"], ["玩家要做的选择", "是否公开"], ["选择带来的后果", "档案进入公共记录"]]) await page.getByLabel(label, { exact: true }).fill(value);
  await save(page);
  await savePanel(page).getByRole("button", { name: "检查当前草稿（0）", exact: true }).click();
  await expect(page.getByText("本轮字段与关联检查未发现问题，仍需内容审查与真人试玩。", { exact: true })).toBeVisible();
  await page.reload(); await tab(page, "信息与线索");
  await expect(page.getByLabel("线索名称", { exact: true })).toHaveValue("现场照片");
  await expect(page.getByLabel("谁收到信息").locator("option:checked")).toHaveText("乙");
  await expect(page.getByRole("group", { name: "支持哪些推理结论", exact: true }).getByLabel("甲藏起档案")).toBeChecked();
});

test("移除角色保留关联并显示缺口，可以撤销且历史样例不变", async ({ page }) => {
  await create(page, true); await tab(page, "人物与关系");
  const oldName = await section(page, "角色").getByLabel("姓名", { exact: true }).inputValue();
  await section(page, "角色").getByRole("button", { name: "移除当前角色", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认移除", exact: true }).click();
  await expect(section(page, "关系").getByLabel("关系中的角色一").locator("option:checked")).toHaveText("已缺失的关联：CH-A");
  await savePanel(page).getByRole("button", { name: /^检查当前草稿/ }).click();
  await page.getByLabel("筛选问题").selectOption("relationships");
  await expect(page.getByText("关系需要连接两个不同且仍存在的角色。", { exact: true }).first()).toBeVisible();
  await section(page, "角色").getByRole("button", { name: "撤销移除", exact: true }).click();
  await expect(section(page, "角色").getByLabel("姓名", { exact: true })).toHaveValue(oldName);
  await save(page);
  await page.goto("/projects/demo-names/stages/blueprint"); await tab(page, "人物与关系");
  await expect(section(page, "角色").getByLabel("姓名", { exact: true })).toHaveValue(oldName);
  await expect(section(page, "角色").getByLabel("姓名", { exact: true })).toBeDisabled();
});

test("蓝图存储失败与跨页冲突保留本页输入，重试需显式加载新状态", async ({ page, context }) => {
  const url = await create(page);
  await page.getByLabel("故事简介", { exact: true }).fill("本页草稿");
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && !sessionStorage.getItem("allow-blueprint")) throw new DOMException("quota", "QuotaExceededError");
      original.call(this, name, value);
    };
  }, key);
  await savePanel(page).getByRole("button", { name: "保存蓝图草稿", exact: true }).click();
  await expect(savePanel(page).getByRole("alert")).toContainText("保存失败");
  await expect(page.getByLabel("故事简介", { exact: true })).toHaveValue("本页草稿");
  await page.evaluate(() => sessionStorage.setItem("allow-blueprint", "1"));
  await save(page);
  const other = await context.newPage(); await other.goto(url);
  await page.getByLabel("故事简介", { exact: true }).fill("冲突时保留的故事");
  await other.getByLabel("故事简介", { exact: true }).fill("另一页已保存版本");
  await save(other);
  await expect(page.getByLabel("故事简介", { exact: true })).toHaveValue("冲突时保留的故事");
  await savePanel(page).getByRole("button", { name: "保存蓝图草稿", exact: true }).click();
  await expect(savePanel(page).getByRole("alert")).toContainText("其他页面更新");
  await expect(page.getByLabel("故事简介", { exact: true })).toHaveValue("冲突时保留的故事");
  await savePanel(page).getByRole("button", { name: "保留输入，载入最新状态", exact: true }).click();
  await expect(savePanel(page).getByText(/输入已保留。再次保存/)).toBeVisible();
  await save(page);
  await other.reload();
  await expect(other.getByLabel("故事简介", { exact: true })).toHaveValue("冲突时保留的故事");
});


test("开发进度与蓝图问题定位分别展示，不冒充AI审查", async ({ page }) => {
  await create(page, true);
  await page.getByRole("button", { name: "查看开发阶段与总体进度，80%", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("progressbar", { name: "原型总体开发进度" })).toHaveAttribute("value", "80");
  await expect(page.getByRole("dialog").getByText("本轮待你测试", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await savePanel(page).getByRole("button", { name: /^检查当前草稿/ }).click();
  await page.getByLabel("筛选问题").selectOption("knowledge");
  await page.getByRole("button", { name: "定位：信息发放", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "信息与线索", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(section(page, "信息发放")).toBeInViewport();
  await tab(page, "人物与关系");
  await section(page, "角色").getByLabel("选择角色", { exact: true }).selectOption("CH-B");
  const selectedName = await section(page, "角色").getByLabel("姓名", { exact: true }).inputValue();
  await section(page, "关系").getByLabel("选择关系", { exact: true }).selectOption({ index: 1 });
  await expect(section(page, "角色").getByLabel("姓名", { exact: true })).toHaveValue(selectedName);
});
