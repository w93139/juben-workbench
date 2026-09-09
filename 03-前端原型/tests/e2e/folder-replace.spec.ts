import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedProject } from "./project-fixture";

let root: string;
test.beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),"juben-folder-test-"));});
test.afterEach(async()=>{await rm(root,{recursive:true,force:true});});
async function makeFolder(name: string, filename: string) {const dir=join(root,name);await mkdir(dir);await writeFile(join(dir,filename),`这是${name}的自有测试正文`);return dir;}

test("正文保存失败后侧栏仍显示已建项目，重试不重复创建或读取", async ({ page }) => {
  await page.route("**/api/studio/capability", route => route.fulfill({ json: { configured: false } }));
  let reads = 0; page.on("request", request => { if (request.url().endsWith("/api/local/materials/read")) reads++; });
  await page.goto("/");
  const folder = await makeFolder("保存失败仍保留的剧本", "角色.txt");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "projects") {
        IDBObjectStore.prototype.put = original;
        throw new DOMException("测试正文存储配额不足", "QuotaExceededError");
      }
      return original.apply(this, args);
    };
  });
  await page.locator('input[aria-label="选择剧本文件夹"]').setInputFiles(folder);
  await expect(page.getByRole("dialog")).toContainText("项目已建立，正文保存尚未完成");
  const entries = () => page.evaluate(() => JSON.parse(localStorage.getItem("juben-workbench:projects:v1")!).projects.map((p: { id: string; title: string }) => ({ id: p.id, title: p.title })));
  const created = await entries(); expect(created).toHaveLength(1);
  const sidebarLink = page.locator('.desktop-sidebar a.nav-item').filter({ hasText: "保存失败仍保留的剧本" });
  await expect(sidebarLink).toBeVisible({ timeout: 3000 });
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${created[0].id}/stages/materials$`));
  expect(await entries()).toEqual(created); expect(reads).toBe(1);
  await page.reload();
  await expect(sidebarLink).toBeVisible();
  await page.getByText("查看文件明细", { exact: true }).click();
  await expect(page.getByText("保存失败仍保留的剧本/角色.txt", { exact: true })).toBeVisible();
});

test("首页红框成为整块拖拽区，拖入文件直接读取并建项目",async({page})=>{
  await page.goto("/");await expect(page.getByRole("region",{name:"剧本文件夹拖拽区"})).toBeVisible();
  await expect(page.getByRole("button",{name:"上传文件夹",exact:true})).toHaveCount(1);
  await expect(page.getByText("01 · 上传完整材料")).toHaveCount(0);await expect(page.getByRole("heading",{name:"最近项目"})).toHaveCount(0);
  const transfer=await page.evaluateHandle(()=>{const data=new DataTransfer();data.items.add(new File(["拖拽自有测试正文"],"拖拽剧本.txt",{type:"text/plain"}));return data;});
  await page.getByRole("region",{name:"剧本文件夹拖拽区"}).dispatchEvent("dragenter",{dataTransfer:transfer});
  await expect(page.getByText("松开，读取这个文件夹")).toBeVisible();
  await page.getByRole("region",{name:"剧本文件夹拖拽区"}).dispatchEvent("drop",{dataTransfer:transfer});
  await expect(page).toHaveURL(/\/stages\/materials$/);await page.getByText("查看文件明细",{exact:true}).click();await expect(page.getByText("拖拽剧本.txt",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"更改文件夹",exact:true})).toBeVisible();
});

test("更改文件夹整批替换，取消或读取失败保留旧材料，刷新不混入旧文件",async({page})=>{
  await seedProject(page,"更换验收");const original=await makeFolder("旧剧本","旧角色.txt"),replacement=await makeFolder("新剧本","新角色.txt");
  const input=page.locator('input[aria-label="上传原剧本文件夹"]');
  await input.setInputFiles(original);await page.getByText("查看文件明细",{exact:true}).click();await expect(page.getByText("旧剧本/旧角色.txt",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"更改文件夹",exact:true})).toBeVisible();
  await input.dispatchEvent("cancel");await expect(page.getByText("旧剧本/旧角色.txt",{exact:true})).toBeVisible();
  await page.route("**/api/local/materials/read",r=>r.fulfill({status:503,json:{error:"读取暂时失败"}}));
  await input.setInputFiles(replacement);await expect(page.getByText("读取暂时失败")).toBeVisible();await expect(page.getByText("旧剧本/旧角色.txt",{exact:true})).toBeVisible();
  await page.unroute("**/api/local/materials/read");await page.getByRole("button",{name:"重试读取"}).click();
  await expect(page.getByText("新剧本/新角色.txt",{exact:true})).toBeVisible();await expect(page.getByText("旧剧本/旧角色.txt",{exact:true})).toHaveCount(0);
  await page.reload();await page.getByText("查看文件明细",{exact:true}).click();await expect(page.getByRole("heading",{name:"新剧本",exact:true})).toBeVisible();await expect(page.getByText("旧剧本/旧角色.txt",{exact:true})).toHaveCount(0);
  await page.screenshot({path:"test-results/replaced-folder.png"});
  const mixed=await makeFolder("混合失败", "good.txt");await writeFile(join(mixed,"broken.txt"),"broken");
  await page.route("**/api/local/materials/read", r=>r.request().postData()?.includes("broken.txt") ? r.fulfill({json:{status:"error",text:"",method:"ocr",warnings:["识别失败"]}}) : r.continue());
  await input.setInputFiles(mixed);await expect(page.getByText(/有1份材料读取失败，原材料保持不变/)).toBeVisible();
  await expect(page.getByText("新剧本/新角色.txt",{exact:true})).toBeVisible();await expect(page.getByText("混合失败/good.txt",{exact:true})).toHaveCount(0);

});

test("首页桌面与窄屏拖拽入口可用",async({page})=>{
  await page.goto("/");await page.screenshot({path:"test-results/folder-home-desktop.png"});
  await page.setViewportSize({width:390,height:844});await expect(page.getByRole("button",{name:"上传文件夹",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.screenshot({path:"test-results/folder-home-mobile.png"});
});

test("更改文件夹读取阶段可取消；进入保存阶段后禁用取消直到提交",async({page})=>{
  await seedProject(page,"保存边界");const original=await makeFolder("原材料","a.txt"),replacement=await makeFolder("替换材料","b.txt");const input=page.locator('input[aria-label="上传原剧本文件夹"]');
  await input.setInputFiles(original);await page.getByText("查看文件明细",{exact:true}).click();await expect(page.getByText("原材料/a.txt",{exact:true})).toBeVisible();
  await page.route("**/api/local/materials/read",async r=>{await new Promise(resolve=>setTimeout(resolve,1200));await r.continue().catch(()=>{});});
  await input.setInputFiles(replacement);await page.getByRole("button",{name:"取消",exact:true}).click();await expect(page.getByRole("button",{name:"取消",exact:true})).toHaveCount(0);await expect(page.getByText("原材料/a.txt",{exact:true})).toBeVisible();
  await page.unroute("**/api/local/materials/read");
  // Delay database opening so the real save phase can be observed.
  await page.evaluate(()=>{
    const originalOpen=indexedDB.open.bind(indexedDB);
    indexedDB.open=function(...args: Parameters<IDBFactory["open"]>){
      const request=originalOpen(...args);const descriptor=Object.getOwnPropertyDescriptor(IDBRequest.prototype,"onsuccess")!;
      Object.defineProperty(request,"onsuccess",{configurable:true,set(callback){descriptor.set!.call(request,(event:Event)=>setTimeout(()=>callback.call(request,event),700));}});
      return request;
    };
  });
  await input.setInputFiles(replacement);await expect(page.getByText("正在保存新材料，请稍候…")).toBeVisible();await expect(page.getByRole("button",{name:"取消",exact:true})).toBeDisabled();
  await expect(page.getByText("替换材料/b.txt",{exact:true})).toBeVisible();await expect(page.getByText("原材料/a.txt",{exact:true})).toHaveCount(0);
});
