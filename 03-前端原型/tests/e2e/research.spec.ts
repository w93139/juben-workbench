import { expect, test, type Page } from "@playwright/test";

const key = "juben-workbench:projects:v1";
async function create(page: Page, name: string) {
  await page.goto("/projects/new");
  await page.getByLabel("项目名称", { exact: false }).fill(name);
  await page.getByRole("button", { name: "创建并进入工作台" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const url = page.url();
  await page.getByRole("link", { name: "继续参考研究" }).click();
  return url;
}
async function recognize(page: Page) {
  await page.getByRole("button", { name: "载入研究练习包" }).click();
  await page.getByRole("button", { name: "开始模拟 OCR" }).click();
  await expect(page.getByRole("heading", { name: "② 校对识别问题" })).toBeVisible();
}
async function resolve(page: Page) {
  for (const heading of ["待确认文字", "模糊内容"]) {
    const issue = page.locator("article").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
    await issue.getByRole("button", { name: "保存校对", exact: true }).click();
    await expect(issue.getByText("已人工校对", { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "排除重复页", exact: true }).click();
  await expect(page.getByText("已排除重复", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保留缺口并记录" }).click();
  await expect(page.getByText("0 项待处理", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认阅读范围（含保留缺口）" }).click();
  await page.getByRole("link", { name: "继续参考本拆解" }).click();
  await page.getByRole("button", { name: "开始模拟拆解" }).click();
  await expect(page.getByRole("button", { name: "重新模拟拆解" })).toBeEnabled();
}

for (const width of [1440, 390]) test(`参考研究到原创方向完整流程 ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const url = await create(page, `参考研究 ${width}`);
  await recognize(page);
  await expect(page.getByRole("button", { name: "确认阅读范围（含保留缺口）" })).toBeDisabled();
  await resolve(page);
  await page.getByRole("button", { name: "客观真相", exact: true }).click();
  await expect(page.getByRole("heading", { name: "客观真相材料不足" })).toBeVisible();
  await page.getByRole("button", { name: "信息分配", exact: true }).click();
  await expect(page.getByText("参考记录明确事实", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "继续选择可迁移机制" }).click();
  const mechanism = page.locator("article.panel").filter({ has: page.getByRole("heading", { name: /^P03/ }) });
  await mechanism.getByLabel("取舍理由").fill("保留不同私人更新，重写共同事件和人物经历。");
  await mechanism.getByRole("button", { name: "保存机制取舍" }).click();
  await expect(mechanism.getByText("取舍已记录", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "继续设置原创方向" }).click();
  await page.getByLabel("目标玩家人数").fill("6");
  await page.getByLabel("题材", { exact: true }).fill("城市档案悬疑");
  await page.getByLabel("推理还原比例").fill("70");
  await expect(page.getByRole("button", { name: "保存原创方向" })).toBeDisabled();
  await page.getByLabel("情感关系比例").fill("15");
  await page.getByLabel("补充创意").fill("六位旧同事在封存档案中发现一项共同选择。");
  await page.getByRole("button", { name: "保存原创方向" }).click();
  await expect(page.getByText("方向已保存", { exact: true })).toBeVisible();
  await expect(page.getByText(/原有5人样例尚未随之改写/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("目标玩家人数")).toHaveValue("6");
  await expect(page.getByLabel("补充创意")).toHaveValue("六位旧同事在封存档案中发现一项共同选择。");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/research-direction-${width}.png`, fullPage: true });
  await page.goto(`${url}/stages/materials`);
  const issue = page.locator("article").filter({ has: page.getByRole("heading", { name: "待确认文字", exact: true }) });
  await issue.getByLabel("校对结果／处理说明").fill("行动时间尚待核验");
  await issue.getByRole("button", { name: "仍不确定，保留问题" }).click();
  await expect(issue.getByText("保留缺口", { exact: true })).toBeVisible();
  await page.goto(`${url}/stages/direction`);
  await expect(page.getByRole("button", { name: "保存原创方向" })).toBeDisabled();
  await expect(page.getByLabel("补充创意")).toHaveValue("六位旧同事在封存档案中发现一项共同选择。");
  expect(errors).toEqual([]);
});

test("模拟失败与取消可以重试，刷新后继续任务，真实文件不冒充已识别", async ({ page }) => {
  await create(page, "任务恢复");
  await page.getByLabel("选择参考文件", { exact: true }).setInputFiles({ name: "真实参考.md", mimeType: "text/markdown", buffer: Buffer.from("不要分析此正文") });
  await expect(page.getByRole("region", { name: "已登记材料" }).getByText(/仅登记，未识别/)).toBeVisible();
  await expect(page.getByRole("button", { name: "开始模拟 OCR" })).toHaveCount(0);
  await page.getByRole("button", { name: "载入研究练习包" }).click();
  await page.getByRole("checkbox", { name: "演示一次失败，体验重试" }).check();
  await page.getByRole("button", { name: "开始模拟 OCR" }).click();
  await expect(page.getByText("模拟处理失败，材料已保留，可以重试。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试模拟任务" }).click();
  await page.getByRole("button", { name: "取消任务" }).click();
  await expect(page.getByText("任务已取消，已登记材料保留，可重新开始。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试模拟任务" }).click();
  // The task is resumable after its creation has been saved, not merely clicked.
  await expect(page.getByRole("button", { name: "取消任务", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "② 校对识别问题" })).toBeVisible();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).projects[0].research, key);
  expect(saved.documents.find((d: { origin: string }) => d.origin === "local-metadata").status).toBe("registered");
  expect(JSON.stringify(saved)).not.toContain("不要分析此正文");
  await expect(page.getByRole("button", { name: "载入研究练习包" })).toHaveCount(0);
});

test("文件登记失败保留待登记清单，可重试后保存", async ({ page }) => {
  await create(page, "文件登记失败");
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && !sessionStorage.getItem("allow-write")) throw new DOMException("quota", "QuotaExceededError");
      original.call(this, name, value);
    };
  }, key);
  await page.getByLabel("选择参考文件", { exact: true }).setInputFiles({ name: "待保存.md", mimeType: "text/markdown", buffer: Buffer.from("资料") });
  await expect(page.getByRole("heading", { name: "导入未完成" })).toBeVisible();
  await page.getByText("查看本批文件与略过原因", { exact: true }).click();
  await expect(page.getByRole("region", { name: "本次导入进度" }).getByText("待保存.md", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "模拟上传进度" })).not.toHaveAttribute("value", "100");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("保存失败");
  await page.evaluate(() => sessionStorage.setItem("allow-write", "1"));
  await page.getByRole("button", { name: "重试导入" }).click();
  await expect(page.getByRole("region", { name: "本次导入进度" })).toContainText("已自动保存1份材料");
  await expect(page.getByRole("region", { name: "已登记材料" }).getByText(/仅登记，未识别/)).toBeVisible();
});

test("研究表单未编辑时跟随最新保存，已有草稿时拦截旧版本覆盖", async ({ page, context }) => {
  const url = await create(page, "研究多页同步");
  await recognize(page); await resolve(page);
  await page.getByRole("link", { name: "继续选择可迁移机制" }).click();
  const other = await context.newPage(); await other.goto(`${url}/stages/mechanisms`);
  const card = (p: Page) => p.locator("article.panel").filter({ has: p.getByRole("heading", { name: /^P01/ }) });
  await card(other).getByLabel("取舍理由").fill("来自另一页的最新取舍");
  await card(other).getByLabel("这条机制如何处理").selectOption("retain");
  await card(other).getByRole("button", { name: "保存机制取舍" }).click();
  await expect(card(page).getByLabel("取舍理由")).toHaveValue("来自另一页的最新取舍");
  await expect(card(page).getByLabel("这条机制如何处理")).toHaveValue("retain");
  await page.getByRole("link", { name: "继续设置原创方向" }).click();
  await other.goto(`${url}/stages/direction`);
  await other.getByLabel("目标玩家人数").fill("7");
  await other.getByLabel("补充创意").fill("另一页先保存的新创意");
  await other.getByRole("button", { name: "保存原创方向" }).click();
  await expect(page.getByLabel("目标玩家人数")).toHaveValue("7");
  await expect(page.getByLabel("补充创意")).toHaveValue("另一页先保存的新创意");
  await page.getByLabel("题材", { exact: true }).fill("保留新创意后改题材");
  await page.getByRole("button", { name: "保存原创方向" }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await expect(other.getByLabel("题材", { exact: true })).toHaveValue("保留新创意后改题材");
  await page.getByLabel("补充创意").fill("本页先编辑的草稿");
  await other.getByLabel("补充创意").fill("另一页后来保存");
  await other.getByRole("button", { name: "保存原创方向" }).click();
  await expect(other.getByText("已保存", { exact: true })).toBeVisible();
  await expect(page.getByLabel("补充创意")).toHaveValue("本页先编辑的草稿");
  await page.getByRole("button", { name: "保存原创方向" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("其他页面更新");
  await page.getByRole("button", { name: "保留输入，载入最新状态" }).click();
  await expect(page.getByText(/再次保存会用当前输入覆盖这一项/)).toBeVisible();
  await page.getByRole("button", { name: "保存原创方向" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(other.getByLabel("补充创意")).toHaveValue("本页先编辑的草稿");
  await page.goto(`${url}/stages/materials`); await other.goto(`${url}/stages/materials`);
  await other.getByLabel("缺口与影响说明").fill("新的缺口说明仍不代表补齐");
  await other.getByRole("button", { name: "保留缺口并记录" }).click();
  await expect(page.getByLabel("缺口与影响说明")).toHaveValue("新的缺口说明仍不代表补齐");
  await other.getByLabel("本轮阅读范围与限制").fill("另一页限定仅研究机制记录");
  await other.getByRole("button", { name: "确认阅读范围（含保留缺口）" }).click();
  await expect(page.getByLabel("本轮阅读范围与限制")).toHaveValue("另一页限定仅研究机制记录");
  await expect(page.getByText("上次模拟拆解已完成；材料或阅读范围已改变，当前结果待重新拆解。", { exact: true })).toBeVisible();
});
