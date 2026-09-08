import { seedProject } from "./project-fixture";
import { expect, test, type Page } from "@playwright/test";

const key = "juben-workbench:projects:v1";
async function create(page: Page, name: string) {
  await seedProject(page, name, true);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const url = page.url();
  await page.goto(`${url}/stages/materials`);
  return url;
}
async function recognize(page: Page) {
  await page.getByText("历史研究练习资料", { exact: true }).click();
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
  await page.getByRole("link", { name: "查看创作方案" }).click();
  await page.getByRole("button", { name: "开始模拟拆解" }).click();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).projects[0].research.job.status, key)).toBe("succeeded");
  await page.getByText("查看参考分析依据与材料缺口", { exact: true }).click();
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
  await expect(page.getByRole("region", { name: "分析依据", exact: true }).getByText("参考记录明确事实", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "采用练习推荐组合" }).click();
  await expect(page.locator('[aria-label="主要迁移风险"]')).toBeVisible();
  await page.getByText("查看全部 8 条玩法与取舍", { exact: true }).click();
  const mechanism = page.getByRole("region", { name: "创作方案", exact: true }).locator("article").filter({ has: page.getByRole("heading", { name: "同一公开刺激带来不同的私人信息", exact: true }) });
  await mechanism.getByText("查看建议、来源与风险／修改理由", { exact: true }).click();
  await mechanism.getByLabel("取舍理由（可修改）").fill("保留不同私人更新，重写共同事件和人物经历。");
  await page.getByLabel("目标玩家人数").fill("6");
  await expect(page.getByText(/需要重新分配私人信息/)).toBeVisible();
  await page.getByLabel("题材", { exact: true }).fill("城市档案悬疑");
  await page.getByText("精细设置体验比例与改编方式", { exact: true }).click();
  await page.getByLabel("推理还原比例").fill("70");
  await expect(page.getByRole("button", { name: "确认创作方案" })).toBeDisabled();
  await page.getByLabel("情感关系比例").fill("15");
  await page.getByLabel("补充创意").fill("六位旧同事在封存档案中发现一项共同选择。");
  await page.getByRole("button", { name: "确认创作方案" }).click();
  await expect(page.getByRole("status").filter({ hasText: "创作方案已确认。" })).toBeVisible();
  await expect(page.getByRole("link", { name: "下一步：设计故事", exact: true })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "确认创作方案" })).toBeDisabled();
  await expect(page.getByLabel("补充创意")).toHaveValue("六位旧同事在封存档案中发现一项共同选择。");
  expect(errors).toEqual([]);
});

test("模拟失败与取消可以重试，刷新后继续任务，真实文件不冒充已识别", async ({ page }) => {
  await create(page, "任务恢复");
  await page.getByLabel("选择参考文件", { exact: true }).setInputFiles({ name: "真实参考.md", mimeType: "text/markdown", buffer: Buffer.from("不要分析此正文") });
  await expect(page.getByRole("region", { name: "已登记材料" }).getByText(/仅登记，未识别/)).toBeVisible();
  await expect(page.getByRole("button", { name: "开始模拟 OCR" })).toHaveCount(0);
  await page.getByText("历史研究练习资料", { exact: true }).click();
  await page.getByRole("button", { name: "载入研究练习包" }).click();
  await page.getByText("演示选项", { exact: true }).click();
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
  const other = await context.newPage(); await other.goto(`${url}/stages/mechanisms`);
  await other.getByRole("button", { name: "采用练习推荐组合" }).click();
  await other.getByLabel("目标玩家人数").fill("7");
  await other.getByLabel("补充创意").fill("另一页先保存的新创意");
  await other.getByRole("button", { name: "确认创作方案" }).click();
  await expect(other.getByRole("status").filter({ hasText: "创作方案已确认。" })).toBeVisible();
  await expect(page.getByLabel("目标玩家人数")).toHaveValue("7");
  await expect(page.getByLabel("补充创意")).toHaveValue("另一页先保存的新创意");
  await page.getByLabel("题材", { exact: true }).fill("保留新创意后改题材");
  await page.getByRole("button", { name: "确认创作方案" }).click();
  await expect(page.getByRole("region", { name: "创作方案", exact: true }).getByText("已保存", { exact: true })).toBeVisible();
  await expect(other.getByLabel("题材", { exact: true })).toHaveValue("保留新创意后改题材");
  await page.getByLabel("补充创意").fill("本页先编辑的草稿");
  await other.getByLabel("补充创意").fill("另一页后来保存");
  await other.getByRole("button", { name: "确认创作方案" }).click();
  await expect(other.getByRole("region", { name: "创作方案", exact: true }).getByText("已保存", { exact: true })).toBeVisible();
  await expect(page.getByLabel("补充创意")).toHaveValue("本页先编辑的草稿");
  await page.getByRole("button", { name: "确认创作方案" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("其他页面更新");
  await page.getByRole("button", { name: "保留输入，载入最新状态" }).click();
  await expect(page.getByText(/再次保存会用当前输入覆盖这一项/)).toBeVisible();
  await page.getByRole("button", { name: "确认创作方案" }).click();
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


test("研究前保存创意与暂定机制草稿，推荐组合不会自动确认", async ({ page }) => {
  const url = await create(page, "先记故事创意");
  await page.getByRole("link", { name: "下一步：确定创作方案", exact: true }).click();
  await expect(page).toHaveURL(`${url}/stages/analysis`);
  await expect(page.getByRole("heading", { name: "确定创作方案", exact: true })).toBeVisible();
  await page.getByLabel("目标玩家人数").fill("6");
  await page.getByLabel("题材", { exact: true }).fill("");
  await page.getByLabel("补充创意").fill("材料没整理完，先记住这个故事起点。");
  await page.getByRole("button", { name: "偏情感", exact: true }).click();
  await page.getByRole("button", { name: "采用练习推荐组合" }).click();
  const before = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).projects[0].research, key);
  expect(before.choices).toEqual([]);
  expect(before.direction).toBeNull();
  expect(before.directionConfirmed).toBe(false);
  await expect(page.getByRole("button", { name: "确认创作方案", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "保存方案草稿", exact: true }).click();
  await expect(page.getByRole("region", { name: "创作方案", exact: true }).getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("目标玩家人数")).toHaveValue("6");
  await expect(page.getByLabel("题材", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("补充创意")).toHaveValue("材料没整理完，先记住这个故事起点。");
  await expect(page.getByRole("button", { name: "偏情感", exact: true })).toHaveAttribute("aria-pressed", "true");
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).projects[0].research, key);
  expect(saved.choices.map((choice: { id: string }) => choice.id)).toEqual(["P02", "P03"]);
  expect(saved.directionConfirmed).toBe(false);
  expect(saved.analysisRevision).toBeNull();
  await expect(page.getByRole("link", { name: "下一步：确认方案", exact: true })).toHaveAttribute("href", /#creative-plan-form$/);
  for (const legacy of ["mechanisms", "direction"]) {
    await page.goto(`${url}/stages/${legacy}`);
    await expect(page.getByRole("heading", { name: "确定创作方案", exact: true })).toBeVisible();
    await expect(page.getByLabel("补充创意")).toHaveValue("材料没整理完，先记住这个故事起点。");
  }
});
