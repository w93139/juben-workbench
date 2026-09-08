import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { seedProject } from "./project-fixture";

const key = "juben-workbench:projects:v1";
const saved = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{"projects":[]}').projects, key);
async function folder(testInfo: TestInfo, name = "旧城来信") {
  const root = testInfo.outputPath(name);
  for (const relative of ["角色本/甲.md", "主持/手册.pdf", "线索/信件.png", "现场/录音.mp3"]) {
    const file = join(root, relative); await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, "THIS_SOURCE_BODY_MUST_NOT_BE_READ_OR_STORED");
  }
  return root;
}

for (const width of [1440, 390]) test(`直接选整本目录自动建项目，模拟拆解并采用方向 ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/projects/new?template=demo&start=research");
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByLabel("项目名称", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /创建并进入/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath(`folder-upload-${width}.png`), fullPage: true, animations: "disabled" });
  const choose = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传完整剧本文件夹", exact: true }).click();
  await (await choose).setFiles(await folder(testInfo));
  await expect(page.getByRole("progressbar", { name: "模拟上传进度" })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/project-[^/]+\/stages\/materials$/);
  const base = page.url().replace("/stages/materials", "");
  const projects = await saved(page);
  expect(projects).toHaveLength(1);
  expect(projects[0]).toMatchObject({ title: "旧城来信", template: "blank", readOnly: false });
  expect(projects[0].research.documents).toHaveLength(4);
  expect(JSON.stringify(projects)).not.toContain("THIS_SOURCE_BODY");
  expect(projects[0].research.documents.map((item: { relativePath: string }) => item.relativePath).sort()).toEqual(["旧城来信/主持/手册.pdf", "旧城来信/现场/录音.mp3", "旧城来信/线索/信件.png", "旧城来信/角色本/甲.md"]);
  await expect(page.getByRole("button", { name: "载入研究练习包", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "模拟拆解并查看建议", exact: true }).click();
  await expect(page).toHaveURL(`${base}/stages/analysis`);
  await expect(page.getByText("流程模拟完成，正文待识别。", { exact: true })).toBeVisible();
  await expect(page.getByText(/三个方向是独立的通用预设/).first()).toBeVisible();
  await page.getByRole("region", { name: "大纲与写作方向建议", exact: true }).evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: testInfo.outputPath(`folder-options-${width}.png`), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "选择关系与抉择", exact: true }).click();
  await expect(page.getByRole("button", { name: "已选择此方向", exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "采用大纲并进入设计故事", exact: true }).click();
  await expect(page).toHaveURL(`${base}/stages/blueprint`);
  await expect(page.getByLabel("故事简介", { exact: true })).not.toHaveValue("");
  const project = (await saved(page))[0];
  expect(project.blueprint.draft.characters).toHaveLength(0);
  expect(project.blueprint.draft.events).toHaveLength(0);
  expect(JSON.stringify(project)).not.toContain("许知微");
  await page.screenshot({ path: testInfo.outputPath(`folder-direction-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("目录导入取消不建项目，重试自动保存且保留已有作品", async ({ page }, testInfo) => {
  await seedProject(page, "保留的已有项目");
  await page.goto("/projects/new");
  const before = await saved(page);
  await page.getByLabel("选择剧本文件夹", { exact: true }).setInputFiles(await folder(testInfo, "取消后重试"));
  await page.getByRole("button", { name: "取消导入", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("本次没有创建项目，已选清单保留，可重试。", { exact: true })).toBeVisible();
  expect(await saved(page)).toEqual(before);
  await page.getByRole("button", { name: "重试导入", exact: true }).click();
  await expect(page).toHaveURL(/\/stages\/materials$/);
  expect((await saved(page)).map((item: { title: string }) => item.title)).toEqual(["保留的已有项目", "取消后重试"]);
});

test("保存失败保留目录清单，重试只建立一个完整项目", async ({ page }, testInfo) => {
  await page.goto("/projects/new");
  await page.evaluate((key) => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && !sessionStorage.getItem("allow-folder-create")) throw new DOMException("quota", "QuotaExceededError");
      write.call(this, name, value);
    };
  }, key);
  await page.getByLabel("选择剧本文件夹", { exact: true }).setInputFiles(await folder(testInfo, "保存失败测试"));
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("保存失败");
  expect(await saved(page)).toHaveLength(0);
  await expect(page).toHaveURL(/\/projects\/new$/);
  await page.evaluate(() => sessionStorage.setItem("allow-folder-create", "1"));
  await page.getByRole("button", { name: "重试导入", exact: true }).click();
  await expect(page).toHaveURL(/\/stages\/materials$/);
  const projects = await saved(page);
  expect(projects).toHaveLength(1);
  expect(projects[0].research.documents).toHaveLength(4);
  await page.reload();
  expect(await saved(page)).toEqual(projects);
});

test("无有效材料不建项目，关闭后可重新选择；离开导入页取消保存", async ({ page }, testInfo) => {
  await page.goto("/projects/new");
  await page.getByLabel("选择剧本文件夹", { exact: true }).dispatchEvent("cancel");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await saved(page)).toHaveLength(0);
  await page.getByLabel("选择剧本文件", { exact: true }).setInputFiles({ name: "空白.txt", mimeType: "text/plain", buffer: Buffer.from("") });
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  expect(await saved(page)).toHaveLength(0);
  await page.keyboard.press("Escape");
  await page.getByLabel("选择剧本文件夹", { exact: true }).setInputFiles(await folder(testInfo, "离开导入页"));
  await expect(page.getByRole("progressbar", { name: "模拟上传进度" })).toBeVisible();
  await page.goto("/");
  await page.waitForTimeout(1300);
  expect(await saved(page)).toHaveLength(0);
});
