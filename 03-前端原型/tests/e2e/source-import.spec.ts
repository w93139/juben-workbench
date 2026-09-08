import { expect, test, type Page } from "@playwright/test";
import { mkdir, rm, truncate, writeFile } from "node:fs/promises";
import path from "node:path";

const storageKey = "juben-workbench:projects:v1";
async function create(page: Page) {
  await page.goto("/projects/new?start=research");
  await page.getByLabel("项目名称", { exact: false }).fill("多格式素材项目");
  await page.getByRole("button", { name: "创建并进入材料中心" }).click();
  await expect(page.getByRole("heading", { name: "准备材料", exact: true })).toBeVisible();
}

for (const width of [1440, 390]) test(`整文件夹自动导入、多格式、大文件和重复略过 ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const folder = testInfo.outputPath("材料包");
  const valid = ["玩家甲/001.jpg", "玩家乙/001.jpg", "音频/主持录音.wav", "视频/试玩录像.MP4", "字幕/对白.srt", "归档/原始.7z", "主持/说明.docx", "扫描/整本.pdf", ...Array.from({ length: 31 }, (_, i) => `图片/页${i + 1}.png`)];
  const skipped = [".DS_Store", "工具.exe", "空.txt"];
  try {
    for (const relative of [...valid, ...skipped]) {
      const target = path.join(folder, relative); await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, relative === "空.txt" ? "" : "只有元信息用于导入测试，未识别的正文");
    }
    // Sparse files exercise real browser File.size without reading media bytes.
    await truncate(path.join(folder, "视频/试玩录像.MP4"), 3 * 1024 ** 3);
    await truncate(path.join(folder, "扫描/整本.pdf"), 300 * 1024 ** 2);
    await create(page);
    await expect(page.getByRole("button", { name: "导入文件夹", exact: true })).toBeInViewport({ ratio: 1 });
    const before = await page.evaluate((key) => localStorage.getItem(key), storageKey);
    await page.getByLabel("选择参考文件夹", { exact: true }).setInputFiles(folder);
    const preview = page.getByRole("region", { name: "本次导入进度" });
    await expect(page.getByRole("progressbar", { name: "模拟上传进度" })).toBeVisible();
    await expect(preview).toContainText("正在");
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(before);
    await expect(preview).toContainText(`已自动保存${valid.length}份材料，略过3份`);
    await expect(page.getByRole("progressbar", { name: "模拟上传进度" })).toHaveAttribute("value", "100");
    await expect(page.getByRole("button", { name: /登记 .* 份材料|确认完成/ })).toHaveCount(0);
    await preview.getByText("查看本批文件与略过原因", { exact: true }).click();
    await expect(preview).toContainText(`共${valid.length + skipped.length}份，有效${valid.length}份，略过3份`);
    await page.getByLabel("搜索本批文件").fill("001.jpg");
    await expect(preview.getByRole("article")).toHaveCount(2);
    await expect(preview.getByText("材料包/玩家甲/001.jpg", { exact: true })).toBeVisible();
    await expect(preview.getByText("材料包/玩家乙/001.jpg", { exact: true })).toBeVisible();
    await page.getByLabel("搜索本批文件").fill("");
    await page.getByLabel("筛选本批文件").selectOption("skipped");
    await expect(preview.getByText("隐藏或系统文件，已略过", { exact: true })).toBeVisible();
    await expect(preview.getByText("空文件，已略过", { exact: true })).toBeVisible();
    await expect(preview.getByText("不支持的格式，已略过", { exact: true })).toBeVisible();
    await page.getByLabel("筛选本批文件").selectOption("all");
    await page.getByLabel("搜索本批文件").fill("试玩录像");
    await expect(preview.getByText(/大文件可登记/)).toBeVisible();
    await expect(preview).toContainText("3 GB");
    await page.screenshot({ path: testInfo.outputPath("media-preview.png"), fullPage: true });
    const inventory = page.getByRole("region", { name: "已登记材料" });
    await expect(inventory.getByRole("article")).toHaveCount(30);
    await page.getByRole("button", { name: "材料下一页" }).click();
    await expect(inventory.getByRole("article")).toHaveCount(valid.length - 30);
    await page.getByLabel("筛选材料类型").selectOption("video");
    await expect(inventory).toContainText("3 GB / 仅登记，未识别");
    await expect(inventory).toContainText("待语音转写／画面文字识别");
    await expect(page.getByRole("button", { name: "开始模拟 OCR", exact: true })).toHaveCount(0);
    const raw = await page.evaluate((key) => localStorage.getItem(key)!, storageKey);
    const documents = JSON.parse(raw).projects[0].research.documents;
    expect(documents).toHaveLength(valid.length);
    expect(documents.filter((doc: { name: string }) => doc.name === "001.jpg")).toHaveLength(2);
    expect(documents.every((doc: { status: string }) => doc.status === "registered")).toBe(true);
    expect(raw).not.toContain("未识别的正文");
    await page.reload();
    await expect(page.getByText(`${valid.length}份已登记`, { exact: true })).toBeVisible();
    await page.getByLabel("选择参考文件夹", { exact: true }).setInputFiles(folder);
    await expect(preview).toContainText(`已自动保存0份材料，略过${valid.length + skipped.length}份`);
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(raw);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test("自动导入可取消后重试，离开页面中断，原始样例保持只读", async ({ page }) => {
  await create(page);
  const before = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  const files = [{ name: "第一段.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("录音占位") }, { name: "字幕.vtt", mimeType: "text/vtt", buffer: Buffer.from("字幕占位") }];
  await page.getByLabel("选择参考文件", { exact: true }).setInputFiles(files);
  await page.getByRole("button", { name: "取消导入", exact: true }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(before);
  await expect(page.getByRole("heading", { name: "导入已取消" })).toBeVisible();
  await page.getByRole("button", { name: "重试导入", exact: true }).click();
  await expect(page.getByRole("region", { name: "已登记材料" }).getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "已登记材料" })).toContainText("第一段.mp3");
  const projectUrl = page.url();
  const saved = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  await page.getByLabel("选择参考文件", { exact: true }).setInputFiles({ name: "离开未保存.pdf", mimeType: "application/pdf", buffer: Buffer.from("占位") });
  await page.getByRole("navigation", { name: "创作流程" }).getByRole("link", { name: /确定创作方案/ }).click();
  await page.goto(projectUrl);
  await expect(page.getByText("2份已登记", { exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(saved);
  await page.goto("/projects/demo-names/stages/materials");
  await expect(page.getByRole("button", { name: "导入文件夹", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "选择本机文件", exact: true })).toBeDisabled();
});
