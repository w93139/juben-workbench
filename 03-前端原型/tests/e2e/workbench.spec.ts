import { expect, test, type Page } from "@playwright/test";
const key = "juben-workbench:projects:v1";

async function create(page: Page, name: string, demo = false) {
  await page.goto(`/projects/new${demo ? "?template=demo" : ""}`);
  await page.getByLabel("项目名称", { exact: false }).fill(name);
  await page.getByLabel("创作备注", { exact: false }).fill("一条自己的创意");
  await page.getByRole("button", { name: "创建并进入工作台" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return page.url();
}

test("首页、空项目创建、编辑与刷新恢复", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "让好故事，经得起推敲。" })).toBeVisible();
  await page.getByRole("link", { name: "新建剧本项目" }).click();
  await page.getByLabel("项目名称", { exact: false }).fill("空白故事");
  await page.getByRole("button", { name: "创建并进入工作台" }).click();
  await expect(page.getByRole("heading", { name: "空白故事", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "修改剧本名称" }).click();
  await page.getByLabel("项目名称", { exact: true }).fill("新的故事名称");
  await page.getByLabel("创作备注", { exact: true }).fill("我的创作方向：一次有后果的选择。");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("heading", { name: "新的故事名称", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "修改决定状态", exact: true }).click();
  await page.getByLabel("主要体验状态").selectOption("provisional");
  await expect(page.getByText("决定状态已保存")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "修改决定状态", exact: true }).click();
  await expect(page.getByLabel("主要体验状态")).toHaveValue("provisional");
  await page.keyboard.press("Escape");
  await expect(page.getByText("我的创作方向：一次有后果的选择。", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "全部项目", exact: true }).click();
  await page.getByLabel("搜索项目名称").fill("新的故事");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await page.getByLabel("筛选项目").selectOption("demo");
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
  await expect(page.getByRole("button", { name: "修改剧本名称" })).toHaveCount(0);
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
    await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name, exact: false }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("navigation").getByRole("link", { name: "设计故事" }).click();
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
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
});

test("存储被禁用时保留输入，不显示保存成功", async ({ page }) => {
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException("quota", "QuotaExceededError"); original.call(this, name, value); };
  }, key);
  await page.goto("/projects/new");
  await page.getByLabel("项目名称", { exact: false }).fill("不要丢失的故事");
  await page.getByRole("button", { name: "创建并进入工作台" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("保存失败");
  await expect(page.getByLabel("项目名称", { exact: false })).toHaveValue("不要丢失的故事");
  await expect(page.getByRole("button", { name: "创建并进入工作台" })).toBeEnabled();
});

test("多页面同时编辑会拦截过期版本", async ({ page, context }) => {
  const url = await create(page, "多人编辑边界");
  const second = await context.newPage(); await second.goto(url);
  await page.getByRole("button", { name: "修改剧本名称" }).click();
  await page.getByLabel("创作备注", { exact: true }).fill("较早打开的输入");
  await second.getByRole("button", { name: "修改剧本名称" }).click();
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
  await expect(page.getByRole("button", { name: "修改剧本名称" })).toBeFocused();
  await expect(page.getByText("较早打开的输入", { exact: true })).toBeVisible();
});

test("窄屏导航与弹窗可键盘关闭，页面不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "让好故事，经得起推敲。" })).toBeVisible();
  await page.getByRole("button", { name: "打开导航" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "打开导航" })).toBeFocused();
  await page.getByRole("link", { name: "打开演示项目" }).click();
  await expect(page.getByRole("heading", { name: "名字之外", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-workspace.png", fullPage: true });
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "设计故事" }).click();
  await expect(page.getByRole("heading", { name: "设计故事", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
  await page.getByRole("button", { name: "修改剧本名称" }).click();
  const note = "一段需要保留的创作想法。\n".repeat(100).slice(0, 1200);
  await page.getByLabel("创作备注", { exact: true }).fill(note);
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "修改剧本名称" }).click();
  await expect(page.getByLabel("创作备注", { exact: true })).toHaveValue(note);
});

test("后台读取损坏数据不会卸载正在编辑的草稿", async ({ page, context }) => {
  const url = await create(page, "保留编辑草稿");
  const other = await context.newPage(); await other.goto(url);
  await page.getByRole("button", { name: "修改剧本名称" }).click();
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
    const nav = page.getByRole("navigation", { name: "主导航" });
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.locator('[aria-current="page"]')).toContainText(name);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  });
}
