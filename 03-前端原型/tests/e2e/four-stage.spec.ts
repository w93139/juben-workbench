import { test, expect } from "@playwright/test";
import { seedProject } from "./project-fixture";
import { emptyWorkbench, workbenchSchema } from "../../src/domain/workbench";
import { emptyBlueprintData } from "../../src/domain/blueprint";
import { randomUUID } from "node:crypto";

const txt = { name: "完整剧本.txt", mimeType: "text/plain", buffer: Buffer.from("自有测试剧本。灯塔中有两份潮汐记录。") };
const analysis = { outline: "灯塔故事按发现、核对、选择展开。", directions: [{ id: "one", title: "记忆与责任", summary: "让角色承担不同的责任", outline: "发现记录到共同选择", risk: "时长待试玩" }, { id: "two", title: "潮汐谜案", summary: "侧重信息推理", outline: "两条线索交叉验证", risk: "参与度待试玩" }], sourceRefs: [{ documentId: "doc", location: "开头", quote: "潮汐记录" }], unknowns: [] };
async function seedState(page: import("@playwright/test").Page, base: string, state: ReturnType<typeof emptyWorkbench>) {
  const valid = workbenchSchema.parse(state); const id = base.split("/projects/")[1].split("/")[0];
  await page.evaluate(async ({id, valid}) => { await new Promise<void>((resolve, reject) => { const request = indexedDB.open("juben-workbench:authoring:v1", 1); request.onupgradeneeded = () => request.result.createObjectStore("projects"); request.onsuccess = () => { const db = request.result; const tx = db.transaction("projects", "readwrite"); tx.objectStore("projects").put(valid, id); tx.oncomplete = () => {db.close(); resolve();}; tx.onerror = () => reject(tx.error); }; }); }, {id, valid});
  await page.reload();
}

test("四步导航、紧凑目录选择与跨页面刷新持久化", async ({ page }) => {
  const id = randomUUID();
  await page.route("**/api/local/status", route => route.fulfill({ json: { directoryPicker:true } }));
  await page.route("**/api/local/directories/choose", route => route.fulfill({ json: {id, name:"我的新作成果", kind:"directory"} }));
  await page.route(`**/api/local/directories/${id}`, route => route.fulfill({ json: {name:"我的新作成果",kind:"directory"} }));
  const base = await seedProject(page, "四步验收");
  await expect(page.getByRole("navigation", {name:"创作流程"}).getByRole("link")).toHaveCount(4);
  await page.getByRole("button", {name:"选择文件夹",exact:true}).click();
  await expect(page.getByTestId("output-directory-name")).toHaveText("我的新作成果");
  await expect(page.getByRole("button", {name:"更换",exact:true})).toBeEnabled();
  await page.goto(base + "/stages/analysis"); await page.reload();
  await expect(page.getByTestId("output-directory-name")).toHaveText("我的新作成果");
  expect((await page.getByLabel("输出储存位置").boundingBox())!.height).toBeLessThan(100);
  await expect(page.getByRole("button", {name:"修改决定状态"})).toHaveCount(0);
  await expect(page.getByText("模拟材料说明")).toHaveCount(0);
  await page.screenshot({path:"test-results/four-stage-desktop.png"});
});

test("实际读取TXT并刷新保留正文，未配置模型不伪造分析", async ({page}) => {
  await page.route("**/api/studio/capability", route => route.fulfill({ json: { configured: false, message: "模型尚未连接，请配置主模型与两路审查模型后使用。" } }));
  await seedProject(page,"实际读取");
  await page.getByLabel("上传原剧本文件",{exact:true}).filter({hasNot:page.locator("h2")}).setInputFiles(txt);
  await page.getByText("查看文件明细",{exact:true}).click();
  await expect(page.getByText(/已读取 · .*字/)).toBeVisible();
  await expect(page.getByRole("button",{name:"拆解大纲"})).toBeDisabled();
  await expect(page.getByText("模型尚未连接，请配置主模型与两路审查模型后使用。")).toBeVisible();
  await page.reload(); await page.getByText("查看文件明细",{exact:true}).click(); await expect(page.getByText("完整剧本.txt",{exact:true})).toBeVisible();
  const saved = await page.evaluate(async () => new Promise<unknown>(resolve => { const request = indexedDB.open("juben-workbench:authoring:v1"); request.onsuccess = () => {const db=request.result;const r=db.transaction("projects").objectStore("projects").getAll();r.onsuccess=()=>{resolve(r.result);db.close();};};}));
  expect(JSON.stringify(saved)).toContain("灯塔中有两份潮汐记录");
});

test("不支持的音频不可伪装读取成功，明确排除后才能继续",async({page})=>{
  await page.route("**/api/studio/capability",r=>r.fulfill({json:{configured:true,message:"测试连接"}}));
  await seedProject(page,"音频边界");
  await page.locator('input[aria-label="上传原剧本文件"]').setInputFiles([txt,{name:"访谈.mp3",mimeType:"audio/mpeg",buffer:Buffer.from("test only")}]);
  await expect(page.locator(".material-details > summary")).toContainText("1 份待处理");
  await expect(page.getByText(/尚未读取/)).not.toBeVisible();
  await page.getByText("查看文件明细",{exact:true}).click();
  await expect(page.getByText(/尚未读取/)).toBeVisible();
  await expect(page.getByRole("button",{name:"拆解大纲"})).toBeDisabled();
  await page.getByRole("listitem").filter({hasText:"访谈.mp3"}).getByRole("button",{name:"本轮不使用"}).click();
  await expect(page.getByRole("button",{name:"拆解大纲"})).toBeEnabled();
  await page.getByText("查看文件明细",{exact:true}).click();
  await expect(page.locator(".material-details > summary")).toContainText("已排除 1 份");
  await expect(page.locator(".studio-files")).not.toBeVisible();
});

test("拆解与蓝图使用任务结果，失败不能导出",async({page})=>{
  await page.route("**/api/studio/capability",r=>r.fulfill({json:{configured:true,message:"测试连接"}}));
  const base=await seedProject(page,"任务交互");
  const state=emptyWorkbench(); state.documents=[{id:"doc",name:txt.name,size:30,text:"潮汐记录",status:"read",method:"text",warnings:[],excluded:false}]; state.sourceRevision=1;
  await seedState(page,base,state);
  let requestId="";
  await page.route("**/api/studio/analyze", async r=> {requestId=r.request().headers()["x-studio-request-id"]; await r.fulfill({status:202,json:{jobId:requestId,status:"running",phase:"正在拆解"}});});
  let polls=0;
  await page.route("**/api/studio/status?**",r=>{polls++;return r.fulfill({json:polls<3?{jobId:requestId,status:"running",phase:"正在拆解"}:{jobId:requestId,status:"completed",phase:"已完成",result:{kind:"analysis",analysis}}});});
  await page.getByRole("button",{name:"拆解大纲"}).click();
  await expect(page.getByRole("heading",{name:"原剧本拆解大纲"})).toBeVisible();
  await page.getByRole("button",{name:/记忆与责任/}).click();
  await expect(page.getByRole("button",{name:"生成蓝图"})).toBeEnabled();
  const blueprint=emptyBlueprintData();blueprint.premise="原创灯塔蓝图";blueprint.truth="记录被替换";
  await page.route("**/api/studio/blueprint",async r=>{requestId=r.request().headers()["x-studio-request-id"];await r.fulfill({status:202,json:{jobId:requestId,status:"running",phase:"生成蓝图"}});});
  await page.route("**/api/studio/status?**",r=>r.fulfill({json:{jobId:requestId,status:"completed",phase:"已完成",result:{kind:"blueprint",blueprint}}}));
  await page.getByRole("button",{name:"生成蓝图"}).click();await expect(page.getByRole("textbox",{name:"大纲",exact:true})).toHaveValue("原创灯塔蓝图");
  await page.route("**/api/studio/review",async r=>{requestId=r.request().headers()["x-studio-request-id"];await r.fulfill({status:202,json:{jobId:requestId,status:"running",phase:"主模型正在核对"}});});
  await page.route("**/api/studio/status?**",r=>r.fulfill({json:{jobId:requestId,status:"failed",phase:"未完成",error:{code:"MODEL_TIMEOUT",message:"模型请求超时，请重试。"}}}));
  await page.getByRole("button",{name:"开始交叉验证"}).click();
  await expect(page.getByText("模型请求超时，请重试。")).toBeVisible();
  await expect(page.getByRole("button",{name:"导出完整档案"})).toHaveCount(0);
});

test("手机尺寸只有内容区滚动，右下角操作可见",async({page})=>{
  await page.setViewportSize({width:390,height:844});await seedProject(page,"窄屏验收");
  await expect(page.getByRole("button",{name:"拆解大纲"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:"test-results/four-stage-mobile.png"});
});

test("存储失败时不得先调用模型",async({page})=>{
  await page.route("**/api/studio/capability",r=>r.fulfill({json:{configured:true}}));
  const base=await seedProject(page,"任务先保存");const state=emptyWorkbench();state.documents=[{id:"doc",name:"剧本.txt",size:10,text:"完整文本",status:"read",method:"text",warnings:[],excluded:false}];await seedState(page,base,state);
  let calls=0;await page.route("**/api/studio/analyze",r=>{calls++;return r.abort();});
  await page.evaluate(()=>{IDBObjectStore.prototype.put=function(){throw new DOMException("测试存储配额不足","QuotaExceededError");};});
  await page.getByRole("button",{name:"拆解大纲"}).click();
  await expect(page.getByRole("alert").filter({hasText:"存储配额不足"})).toBeVisible();expect(calls).toBe(0);
});
