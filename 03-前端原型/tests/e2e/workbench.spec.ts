import { seedProject } from "./project-fixture";
import { expect, test, type Page } from "@playwright/test";
const key = "juben-workbench:projects:v1";

async function create(page: Page, name: string, demo = false) {
  await seedProject(page, name, demo, "一条自己的创意");
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return page.url();
}

test("已有项目编辑、列表与刷新恢复", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从完整剧本，走向新的故事。" })).toBeVisible();
  await seedProject(page, "空白故事");
  await expect(page.getByRole("heading", { name: "空白故事", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "改名", exact: true }).click();
  await page.getByLabel("项目名称", { exact: true }).fill("新的故事名称");
  await page.getByLabel("创作备注", { exact: true }).fill("我的创作方向：一次有后果的选择。");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("heading", { name: "新的故事名称", exact: true })).toBeVisible();
  const projects = page.getByRole("navigation", { name: "主导航" });
  await expect(projects.getByRole("link", { name: "新的故事名称", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(projects.getByRole("link", { name: "空白故事", exact: true })).toHaveCount(0);
  await expect(projects.locator('a[href*="/stages/"]')).toHaveCount(0);
  await page.getByRole("button", { name: "修改决定状态", exact: true }).click();
  await page.getByLabel("主要体验状态").selectOption("provisional");
  await expect(page.getByText("决定状态已保存")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "修改决定状态", exact: true }).click();
  await expect(page.getByLabel("主要体验状态")).toHaveValue("provisional");
  await page.keyboard.press("Escape");
  await expect(page.getByText("我的创作方向：一次有后果的选择。", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "我的项目", exact: true }).click();
  await page.getByLabel("搜索项目名称").fill("新的故事");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await page.getByLabel("搜索项目名称").fill("不存在的名字");
  await expect(page.getByRole("heading", { name: "没有找到匹配的项目" })).toBeVisible();
});

test("演示副本独立编辑，原样例与未试玩状态不变", async ({ page }) => {
  const url = await create(page, "演示副本甲", true);
  await page.getByRole("button", { name: "修改决定状态", exact: true }).click();
  const decision = page.getByRole("combobox").first();
  await decision.selectOption("open");
  await expect(page.getByText("决定状态已保存")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "修改决定状态", exact: true }).click();
  await expect(page.getByRole("combobox").first()).toHaveValue("open");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "检查与试玩", exact: true }).click();
  await expect(page.getByText("尚未真人试玩", { exact: true })).toBeVisible();
  await page.goto("/projects/demo-names");
  await expect(page.getByRole("button", { name: "改名", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "改名", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await page.getByRole("button", { name: "查看创作决定", exact: true }).click();
  await expect(page.getByText("已确定", { exact: true }).first()).toBeVisible();
  await create(page, "演示副本乙", true);
  await page.getByRole("button", { name: "修改决定状态", exact: true }).click();
  await expect(page.getByRole("combobox").first()).toHaveValue("confirmed");
  await page.goto(url);
  await page.getByRole("button", { name: "修改决定状态", exact: true }).click();
  await expect(page.getByRole("combobox").first()).toHaveValue("open");
});

test("五步可达、结构内容与来源预览可读", async ({ page }) => {
  await page.goto("/projects/demo-names");
  for (const name of ["准备材料", "确定创作方案", "设计故事", "生成与检查", "试玩与导出"]) {
    await page.getByRole("navigation", { name: "创作流程" }).getByRole("link", { name, exact: false }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("navigation", { name: "创作流程" }).getByRole("link", { name: /设计故事/ }).click();
  await page.getByText("详细结构编辑（按需展开）", { exact: true }).click();
  await page.getByRole("button", { name: "人物与关系", exact: true }).click();
  await expect(page.getByRole("heading", { name: "许知微", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "信息与线索", exact: true }).click();
  await page.getByLabel("选择信息发放", { exact: true }).selectOption("KF-01-CH-A");
  await expect(page.getByText("记录编号：KF-01-CH-A", { exact: true })).toBeVisible();
  await page.getByText("项目资料与来源", { exact: true }).click();
  await page.getByRole("button", { name: "交叉验证的范围", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText(/03-交叉验证记录/).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("侧栏切换项目，步骤标题旁改名后同步侧栏且项目互不影响", async ({ page }) => {
  const firstUrl = await create(page, "项目甲");
  const secondUrl = await create(page, "项目乙");
  const projects = page.getByRole("navigation", { name: "主导航" });
  await expect(projects.locator('a[href*="/stages/"]')).toHaveCount(0);
  await projects.getByRole("link", { name: "项目甲", exact: true }).click();
  await expect(page).toHaveURL(firstUrl);
  const workflow = page.getByRole("navigation", { name: "创作流程" });
  await workflow.getByRole("link", { name: /设计故事/ }).click();
  await expect(page.getByRole("heading", { name: "设计故事", exact: true })).toBeVisible();
  const title = page.locator(".project-title-row");
  await expect(title.getByRole("link", { name: "项目甲", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(title.getByRole("button", { name: "改名", exact: true })).toBeInViewport({ ratio: 1 });
  await title.getByRole("button", { name: "改名", exact: true }).click();
  await page.getByRole("dialog").getByLabel("项目名称", { exact: true }).fill("项目甲的新名字");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(title.getByRole("link", { name: "项目甲的新名字", exact: true })).toBeVisible();
  await expect(projects.getByRole("link", { name: "项目甲的新名字", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(projects.getByRole("link", { name: "项目甲", exact: true })).toHaveCount(0);
  await projects.getByRole("link", { name: "项目乙", exact: true }).click();
  await expect(page).toHaveURL(secondUrl);
  await expect(page.getByRole("heading", { name: "项目乙", exact: true })).toBeVisible();
  await expect(projects.getByRole("link", { name: "项目乙", exact: true })).toHaveAttribute("aria-current", "page");
  await page.reload();
  await projects.getByRole("link", { name: "项目甲的新名字", exact: true }).click();
  await expect(page).toHaveURL(firstUrl);
  await expect(page.getByRole("heading", { name: "项目甲的新名字", exact: true })).toBeVisible();
});

test("坏数据不会自动覆盖，可下载备份并明确确认恢复", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(([key, value]) => { localStorage.setItem(key, value); localStorage.setItem("unrelated-app", "keep"); }, [key, "{broken"]);
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("原数据已保留");
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe("{broken");
  await page.getByRole("button", { name: "备份与恢复" }).click();
  await expect(page.getByRole("button", { name: "清空并恢复工作区" })).toBeDisabled();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载原数据备份" }).click();
  expect((await download).suggestedFilename()).toContain("原始数据备份");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "清空并恢复工作区" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("unrelated-app"))).toBe("keep");
  await expect(page.getByRole("heading", { name: "先上传你想改写的剧本" })).toBeVisible();
});


test("多页面同时编辑会拦截过期版本", async ({ page, context }) => {
  const url = await create(page, "多人编辑边界");
  const second = await context.newPage(); await second.goto(url);
  await page.getByRole("button", { name: "改名", exact: true }).click();
  await page.getByLabel("创作备注", { exact: true }).fill("较早打开的输入");
  await second.getByRole("button", { name: "改名", exact: true }).click();
  await second.getByLabel("创作备注", { exact: true }).fill("已经保存的新内容");
  await second.getByRole("button", { name: "保存修改" }).click();
  await expect(second.getByText("已经保存的新内容", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("其他页面更新");
  await expect(page.getByLabel("创作备注", { exact: true })).toHaveValue("较早打开的输入");
  await page.getByRole("button", { name: "保留输入，载入最新版本" }).click();
  await expect(page.getByText("你的输入已保留，尚未合并。", { exact: true })).toBeVisible();
  await page.getByText("查看最新资料", { exact: true }).click();
  await expect(page.getByRole("dialog").getByText("备注：已经保存的新内容", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "使用当前输入覆盖保存" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "改名", exact: true })).toBeFocused();
  await expect(page.getByText("较早打开的输入", { exact: true })).toBeVisible();
});

test("窄屏导航与弹窗可键盘关闭，页面不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从完整剧本，走向新的故事。" })).toBeVisible();
  await page.getByRole("button", { name: "打开导航" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "打开导航" })).toBeFocused();
  await seedProject(page, "窄屏项目");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-workspace.png", fullPage: true });
  await page.getByRole("button", { name: "打开导航" }).click();
  const projects = page.getByRole("dialog").getByRole("navigation", { name: "主导航" });
  await expect(projects.locator('a[href*="/stages/"]')).toHaveCount(0);
  await projects.getByRole("link", { name: "窄屏项目", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("navigation", { name: "创作流程" }).getByRole("link", { name: /设计故事/ }).click();
  await expect(page.getByRole("heading", { name: "设计故事", exact: true })).toBeVisible();
});

test("错误项目和阶段地址不会显示伪造内容", async ({ page }) => {
  await page.goto("/projects/missing");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("没有找到这个项目");
  await page.goto("/projects/demo-names/stages/missing");
  await expect(page.getByRole("heading", { name: "没有找到这个页面" })).toBeVisible();
});

test("窄屏长备注仍可在弹窗内保存", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page, "长备注项目");
  await page.getByRole("button", { name: "改名", exact: true }).click();
  const note = "一段需要保留的创作想法。\n".repeat(100).slice(0, 1200);
  await page.getByLabel("创作备注", { exact: true }).fill(note);
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "改名", exact: true }).click();
  await expect(page.getByLabel("创作备注", { exact: true })).toHaveValue(note);
});

test("后台读取损坏数据不会卸载正在编辑的草稿", async ({ page, context }) => {
  const url = await create(page, "保留编辑草稿");
  const other = await context.newPage(); await other.goto(url);
  await page.getByRole("button", { name: "改名", exact: true }).click();
  await page.getByLabel("项目名称", { exact: true }).fill("未保存的标题");
  await page.getByLabel("创作备注", { exact: true }).fill("读取失败也要留下的草稿");
  const raw = await other.evaluate((key) => localStorage.getItem(key), key);
  await other.evaluate((key) => localStorage.setItem(key, "{broken"), key);
  // The open dialog makes background content inaccessible; inspect the underlying error by text.
  await expect(page.locator("main .error-banner")).toContainText("原数据已保留");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("创作备注", { exact: true })).toHaveValue("读取失败也要留下的草稿");
  await other.evaluate(({ key, raw }) => localStorage.setItem(key, raw!), { key, raw });
  await expect(page.locator("main .error-banner")).toHaveCount(0);
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue("未保存的标题");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("heading", { name: "未保存的标题", exact: true })).toBeVisible();
});

for (const [id, name] of [["mechanisms", "确定创作方案"], ["direction", "确定创作方案"], ["review", "生成与检查"], ["playtest", "试玩与导出"]]) {
  test(`旧入口 ${id} 仍可浏览且只激活所属步骤`, async ({ page }) => {
    await page.goto(`/projects/demo-names/stages/${id}`);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "创作流程" });
    await expect(nav.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(nav.locator('[aria-current="step"]')).toContainText(name);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  });
}
