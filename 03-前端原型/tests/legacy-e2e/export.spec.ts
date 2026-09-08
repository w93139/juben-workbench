import { expect, test, type Download, type Page } from "@playwright/test";
import { emptyBlueprintData } from "../../src/domain/blueprint";
import { artifactSchema, moduleIds, type ProductionModule } from "../../src/domain/production";
import { seedProject } from "./project-fixture";

const key = "juben-workbench:projects:v1";
const time = "2026-09-08T00:00:00.000Z";
async function setup(page: Page, populated = true) {
  const base = await seedProject(page, "导出测试作品");
  const data = emptyBlueprintData();
  const versions = ["v1", "v2"].map((id) => ({ id, label: id === "v1" ? "旧蓝图" : "新蓝图", createdAt: time, data }));
  const make = (module: ProductionModule, version = 1, blueprintVersionId = "v2") => artifactSchema.parse({
    id: `${blueprintVersionId}-${module}-${version}`, logicalKey: module, module, title: `${module}材料`, audience: module === "host" || module === "ending" ? "host" : "player", characterId: module === "clues" || module === "host" || module === "ending" ? null : "a", roundId: null,
    blueprintVersionId, version, content: `${blueprintVersionId}:${module}:正文第${version}版`, createdAt: time, plannedPath: null, origin: "mock",
  });
  const artifacts = populated ? [...moduleIds.map((module) => make(module)), make("character", 2), make("character", 3, "v1")] : [];
  await page.evaluate(({ key, versions, data, artifacts, time }) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    state.projects[0].blueprint = { draft: data, versions, revision: 1, savedAt: time, sourceLabel: "导出自动化自有测试数据" };
    state.projects[0].production = { artifacts, jobs: [], reviews: [] };
    localStorage.setItem(key, JSON.stringify(state));
  }, { key, versions, data, artifacts, time });
  await page.goto(`${base}/stages/export`);
  return base;
}
async function unpack(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks); const files = new Map<string, string>();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const path = bytes.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extra;
    files.set(path, bytes.subarray(start, start + length).toString("utf8")); offset = start + length;
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
  return files;
}
async function downloadFiles(page: Page, name: string) {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  const download = await event;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  await expect(page.getByRole("status")).toContainText("已发起下载");
  return unpack(download);
}

for (const width of [1440, 390]) test(`分类与全包真实下载，版本与受众隔离 ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page);
  await expect(page.getByLabel("导出哪个蓝图版本", { exact: true })).toHaveValue("v2");
  for (const name of ["角色本", "私人信息", "阶段更新", "公共线索", "主持手册", "终局材料"]) await expect(page.getByRole("button", { name: `下载${name}`, exact: true })).toBeEnabled();
  const players = await downloadFiles(page, "下载角色本");
  const playerBodies = [...players.entries()].filter(([path]) => path.startsWith("玩家材料/"));
  expect(playerBodies).toHaveLength(1); expect(playerBodies[0][1]).toBe("v2:character:正文第2版");
  expect([...players.values()].join("\n")).not.toContain("v2:host:");
  expect([...players.values()].join("\n")).not.toContain("v1:character:");
  const all = await downloadFiles(page, "下载全部资源");
  expect([...all.keys()].filter((path) => path.startsWith("主持材料-含谜底/"))).toHaveLength(2);
  expect([...all.keys()].filter((path) => path.startsWith("玩家材料/"))).toHaveLength(4);
  const manifest = JSON.parse(all.get("01-导出清单.json")!);
  expect(manifest.materials).toHaveLength(6); expect(manifest.blueprint.id).toBe("v2");
  expect(manifest.checks.humanPlaytest).toContain("尚未真人试玩");
  expect(all.get("00-使用说明.md")).toContain("没有直接写入项目所选输出文件夹");
  await page.getByLabel("导出哪个蓝图版本", { exact: true }).selectOption("v1");
  await expect(page.getByRole("button", { name: "下载主持手册", exact: true })).toBeDisabled();
  const old = await downloadFiles(page, "下载全部资源");
  expect([...old.entries()].filter(([path]) => path.startsWith("玩家材料/"))[0][1]).toBe("v1:character:正文第3版");
  await page.getByRole("region", { name: "分类与全部导出", exact: true }).evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: testInfo.outputPath(`export-${width}.png`), fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("无正文不造空包、不显示成功，旧档案不能充当本次导出", async ({ page }) => {
  await setup(page, false);
  await expect(page.getByRole("button", { name: "下载全部资源", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "下载角色本", exact: true })).toBeDisabled();
  await expect(page.getByText("没有正文时不生成空包，不显示导出成功。", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.goto("/projects/demo-names/stages/export");
  await expect(page.getByLabel("导出哪个蓝图版本", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "下载全部资源", exact: true })).toBeDisabled();
  await expect(page.getByText("尚未真人试玩", { exact: true })).toBeVisible();
});
