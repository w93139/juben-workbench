import { expect, test } from "@playwright/test";
import { seedProject } from "./project-fixture";

const key = "juben-workbench:projects:v1";
for (const stage of ["", "/stages/blueprint", "/stages/analysis"]) test(`旧样例只读，不再自动建副本 ${stage || "总览"}`, async ({ page }) => {
  await seedProject(page, "已有作品");
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.goto(`/projects/demo-names${stage}`);
  await expect(page.getByRole("button", { name: "改名", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "选择输出文件夹", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /创建演示副本/ })).toHaveCount(0);
  if (!stage) {
    const entry = page.getByRole("group", { name: "项目常用操作" }).getByRole("link", { name: "上传剧本文件夹", exact: true });
    await expect(entry).toHaveAttribute("href", "/projects/new");
    await entry.click();
    await expect(page).toHaveURL(/\/projects\/new$/);
    await expect(page.getByRole("radio")).toHaveCount(0);
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before);
});
