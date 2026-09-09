import { test, expect, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { seedProject } from "./project-fixture";
import { emptyWorkbench, workbenchSchema, type WorkbenchState } from "../../src/domain/workbench";
import { emptyBlueprintData } from "../../src/domain/blueprint";
import type { StudioAudit } from "../../src/domain/studio";

const dbName = "juben-workbench:authoring:v1";
const analysis = { outline: "原始灯塔材料的事件和信息顺序。", directions: [{ id: "one", title: "责任与选择", summary: "围绕共同选择重建原创故事", outline: "发现—核验—选择", risk: "节奏待真人试玩" }, { id: "two", title: "孤岛谜案", summary: "围绕证据还原新事件", outline: "调查—矛盾—还原", risk: "核对每个角色的贡献" }], sourceRefs: [{ documentId: "doc", location: "正文开头", quote: "自有测试原文" }], unknowns: [] };
function prepared(): WorkbenchState {
  const state = emptyWorkbench(); state.revision = 1; state.sourceRevision = 1;
  state.documents = [{ id: "doc", name: "原始剧本.txt", size: 18, text: "自有测试原文", status: "read", method: "text", warnings: [], excluded: false }];
  state.analysis = analysis; state.analysisSourceRevision = 1; state.choiceId = "one";
  const blueprint = emptyBlueprintData(); blueprint.premise = "原创蓝图的最初大纲"; blueprint.truth = "两份记录的差异来自一次主动替换";
  state.blueprint = blueprint; state.blueprintRevision = 1; state.blueprintSourceRevision = 1; state.blueprintChoiceId = "one";
  return state;
}
async function writeState(page: Page, base: string, state: WorkbenchState) {
  const valid = workbenchSchema.parse(state); const id = base.split("/projects/")[1].split("/")[0];
  await page.evaluate(async ({ id, valid, dbName }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("projects");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const tx = db.transaction("projects", "readwrite"); tx.objectStore("projects").put(valid, id); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; };
  }), { id, valid, dbName });
}
async function readState(page: Page, base: string): Promise<WorkbenchState> {
  const id = base.split("/projects/")[1].split("/")[0];
  return page.evaluate(async ({ id, dbName }) => new Promise<WorkbenchState>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const req = db.transaction("projects").objectStore("projects").get(id); req.onsuccess = () => { db.close(); resolve(req.result); }; req.onerror = () => { db.close(); reject(req.error); }; };
  }), { id, dbName });
}
async function offlineCapability(page: Page) {
  await page.route("**/api/studio/capability", route => route.fulfill({ json: { configured: true, message: "自动化测试连接状态，不调用模型" } }));
  await page.route("**/api/studio/analyze", route => route.abort());
  await page.route("**/api/studio/blueprint", route => route.abort());
  await page.route("**/api/studio/review", route => route.abort());
}

test("首页直接上传真实TXT只读取一次，进入首阶段并刷新保留正文", async ({ page }) => {
  await offlineCapability(page);
  let reads = 0;
  page.on("request", request => { if (request.url().includes("/api/local/materials/read")) reads++; });
  await page.goto("/");
  const text = "首页直接导入的自有测试正文。两位守塔人在凌晨核对了潮汐表。";
  // Use the file fallback of the same homepage upload action. The real local reader handles these bytes.
  await page.locator('input[aria-label="选择剧本文件"]').setInputFiles({ name: "首页完整剧本.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await expect(page).toHaveURL(/\/projects\/project-[^/]+\/stages\/materials$/);
  const base = page.url().replace(/\/stages\/materials$/, "");
  await expect(page.getByText("首页完整剧本.txt", { exact: true })).not.toBeVisible();
  await expect(page.locator(".material-details > summary")).toContainText("共 1 份 · 已读取 1 份");
  await page.getByText("查看文件明细", { exact: true }).click();
  await expect(page.getByText("首页完整剧本.txt", { exact: true })).toBeVisible();
  await expect(page.getByText(/已读取 · .* 字/)).toBeVisible();
  await expect(page.getByRole("button", { name: "拆解大纲", exact: true })).toBeEnabled();
  expect((await readState(page, base)).documents[0].text).toBe(text);
  await page.reload();
  await expect(page.getByText("首页完整剧本.txt", { exact: true })).not.toBeVisible();
  await expect(page.locator(".material-details > summary")).toContainText("共 1 份 · 已读取 1 份");
  await page.getByText("查看文件明细", { exact: true }).click();
  await expect(page.getByText("首页完整剧本.txt", { exact: true })).toBeVisible();
  expect((await readState(page, base)).documents[0].text).toBe(text);
  expect(reads).toBe(1);
  const count = await page.evaluate(() => JSON.parse(localStorage.getItem("juben-workbench:projects:v1")!).projects.length);
  expect(count).toBe(1);
});

test("蓝图本地草稿不会覆盖另一个标签页保存的新版本", async ({ page, context }) => {
  await offlineCapability(page);
  const base = await seedProject(page, "跨页恢复检查"); await writeState(page, base, prepared());
  await page.goto(`${base}/stages/blueprint`);
  await page.getByRole("textbox", { name: "大纲", exact: true }).fill("第一个页面尚未保存的改写");
  const other = await context.newPage(); await offlineCapability(other); await other.goto(`${base}/stages/blueprint`);
  await other.getByRole("textbox", { name: "大纲", exact: true }).fill("第二个页面已经保存的新大纲");
  await other.getByRole("button", { name: "预览并保存修改", exact: true }).click();
  await other.getByRole("dialog").getByRole("button", { name: "保存调整", exact: true }).click();
  await expect(other.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await readState(page, base)).blueprint?.premise).toBe("第二个页面已经保存的新大纲");
  await expect(page.getByRole("textbox", { name: "大纲", exact: true })).toHaveValue("第一个页面尚未保存的改写");
  await page.getByRole("button", { name: "预览并保存修改", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "保存调整", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("项目已在其他页面更新");
  expect((await readState(page, base)).blueprint?.premise).toBe("第二个页面已经保存的新大纲");
  expect((await readState(page, base)).versions).toHaveLength(1);
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "大纲", exact: true })).toHaveValue("第一个页面尚未保存的改写");
  await other.close();
});

test("修改创作要求后重新选择原方向也不会恢复旧审查的导出资格", async ({ page }) => {
  await offlineCapability(page);
  const base = await seedProject(page, "创作要求失效检查"); const state = prepared();
  const report: StudioAudit = { summary: "隔离UI测试快照，不是服务端通过记录", blocking: [], warnings: [], evidence: [{ location: "蓝图简介", quote: state.blueprint!.premise, conclusion: "固定引用" }], contentComplete: true, playerHostIsolation: true, findingsAddressed: true, humanPlaytest: "not-run" };
  // Schema-valid UI fixture only. Never sent to the server write API or used as a genuine validation token.
  state.review = { kind: "review", passed: true, issues: [], validationId: randomUUID(), blueprintFingerprint: createHash("sha256").update(JSON.stringify(state.blueprint)).digest("hex"), blueprint: state.blueprint!, humanPlaytest: "not-run", reports: { designGate: report, independentA: report, independentB: report, mutualA: report, mutualB: report, coordinator: report }, artifacts: (["character", "private", "updates", "clues", "host", "ending"] as const).map((moduleId, index) => ({ id: `test-artifact-${index}`, module: moduleId, audience: index >= 4 ? "host" : "player", characterId: null, roundId: null, title: "自有测试材料", content: "UI隔离测试内容", sourceIds: [] })) };
  state.reviewBlueprintRevision = 1;
  await writeState(page, base, state);
  await page.goto(`${base}/stages/generation`);
  await expect(page.getByRole("button", { name: "导出完整档案", exact: true })).toBeEnabled();
  await page.goto(`${base}/stages/analysis`);
  await page.getByText("补充你的创作要求", { exact: true }).click();
  await page.getByRole("textbox", { name: "补充创作要求", exact: true }).fill("将主题改为互相信任，保留两轮调查。");
  await page.getByRole("heading", { name: "选择改写方向", exact: true }).click();
  await expect.poll(async () => (await readState(page, base)).instructions).toBe("将主题改为互相信任，保留两轮调查。");
  const direction = page.getByRole("button", { name: /责任与选择/ }); await direction.click();
  await expect(direction).toHaveAttribute("aria-pressed", "true");
  await page.goto(`${base}/stages/generation`); await page.reload();
  await expect(page.getByRole("button", { name: "导出完整档案", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "返回修改蓝图", exact: true })).toBeVisible();
  const saved = await readState(page, base); expect(saved.choiceId).toBe("one"); expect(saved.blueprintSourceRevision).toBeNull(); expect(saved.review?.validationId).toBe(state.review.validationId);
});

test("通过快照导出使用已选位置并打开目录，客户端不提交正文", async ({ page }) => {
  await offlineCapability(page); const base = await seedProject(page, "导出交互"); const state = prepared();
  const report: StudioAudit = { summary: "UI边界夹具", blocking: [], warnings: [], evidence: [{location:"蓝图",quote:state.blueprint!.premise,conclusion:"测试"}], contentComplete:true,playerHostIsolation:true,findingsAddressed:true,humanPlaytest:"not-run" };
  state.review = {kind:"review",passed:true,issues:[],validationId:randomUUID(),blueprintFingerprint:createHash("sha256").update(JSON.stringify(state.blueprint)).digest("hex"),humanPlaytest:"not-run",reports:{designGate:report,independentA:report,independentB:report,mutualA:report,mutualB:report,coordinator:report},artifacts:(["character","private","updates","clues","host","ending"] as const).map((module,i)=>({id:`a${i}`,module,audience:i>=4?"host":"player",characterId:null,roundId:null,title:"UI测试材料",content:"不发送此正文",sourceIds:[]}))};state.reviewBlueprintRevision=1;
  await writeState(page,base,state); const directoryId=randomUUID(); let writes=0;let reveals=0;
  await page.route("**/api/local/status",r=>r.fulfill({json:{directoryPicker:true}}));
  await page.route("**/api/local/directories/choose",r=>r.fulfill({json:{id:directoryId,name:"测试输出",kind:"directory"}}));
  await page.route(`**/api/local/directories/${directoryId}`,r=>r.fulfill({json:{name:"测试输出",kind:"directory"}}));
  await page.route("**/api/local/directories/write",r=>{writes++;expect(r.request().postDataJSON()).toEqual({directoryId,validationId:state.review!.validationId,title:"导出交互"});return r.fulfill({json:{filename:"导出交互.zip",name:"测试输出",written:true}});});
  await page.route("**/api/local/directories/reveal",r=>{reveals++;expect(r.request().postDataJSON()).toEqual({directoryId});return r.fulfill({json:{opened:true}});});
  await page.goto(`${base}/stages/generation`);
  await page.getByRole("button",{name:"导出完整档案",exact:true}).click();
  await expect(page.getByText("已保存：导出交互.zip")).toBeVisible();await expect(page.getByTestId("output-directory-name")).toHaveText("测试输出");expect(writes).toBe(1);await expect.poll(()=>reveals).toBe(1);
  await expect(page.getByText("尚未真人试玩",{exact:true})).toBeVisible();
});

test("更换整本后旧分析与蓝图失效，新文件不会混入旧材料", async ({page}) => {
  await offlineCapability(page); const base=await seedProject(page,"换本失效检查"); const state=prepared(); await writeState(page,base,state);
  await page.goto(`${base}/stages/materials`);
  await page.locator('input[aria-label="上传原剧本文件"]').setInputFiles({name:"新的参考本.txt",mimeType:"text/plain",buffer:Buffer.from("全新参考本的正文")});
  await page.getByText("查看文件明细", { exact: true }).click();
  await expect(page.getByText("新的参考本.txt",{exact:true})).toBeVisible();
  const after=await readState(page,base);expect(after.documents).toHaveLength(1);expect(after.documents[0].name).toBe("新的参考本.txt");expect(after.sourceRevision).toBe(2);expect(after.blueprint).toEqual(state.blueprint);
  await page.goto(`${base}/stages/analysis`);await expect(page.getByRole("button",{name:"生成蓝图",exact:true})).toBeDisabled();
  await page.goto(`${base}/stages/blueprint`);await expect(page.getByText(/这份蓝图对应旧的材料或创作要求/)).toBeVisible();await expect(page.getByRole("button",{name:"开始交叉验证",exact:true})).toBeDisabled();
});

test("拆解POST被拒绝时显示具体原因、恢复按钮且刷新保留材料", async ({ page }) => {
  await offlineCapability(page); const base = await seedProject(page, "拆解拒绝恢复"); const state = prepared(); await writeState(page, base, state);
  let posts = 0;
  await page.route("**/api/studio/analyze", route => { posts++; return route.fulfill({ status: 413, json: { error: { code: "CONTEXT_TOO_LARGE", message: "当前材料超过单次完整上下文限制，未发起模型调用。" } } }); });
  await page.goto(`${base}/stages/materials`);
  await page.getByRole("button", { name: "拆解大纲", exact: true }).click();
  await expect(page.getByText("当前材料超过单次完整上下文限制，未发起模型调用。", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "拆解大纲", exact: true })).toBeEnabled();
  expect((await readState(page, base)).job).toBeNull();
  await page.reload(); await expect(page.getByRole("button", { name: "拆解大纲", exact: true })).toBeEnabled();
  expect((await readState(page, base)).documents).toEqual(state.documents); expect(posts).toBe(1);
});

test("超过600KB原剧本进入分段处理，完成后显示覆盖数量且刷新保留", async ({ page }) => {
  await offlineCapability(page); const base = await seedProject(page, "长剧本拆解入口"); const state = prepared();
  state.analysis = null; state.analysisSourceRevision = null; state.choiceId = null;
  state.documents = Array.from({ length: 3 }, (_, index) => ({ ...state.documents[0], id: `doc-${index}`, name: `第${index + 1}部分.txt`, text: "自有长剧本测试正文".repeat(10000) }));
  await writeState(page, base, state);
  let submitted = ""; let jobId = ""; let finished = false;
  await page.route("**/api/studio/analyze", route => {
    submitted = route.request().postData()!; jobId = route.request().headers()["x-studio-request-id"];
    return route.fulfill({ status: 202, json: { jobId, status: "running", phase: "正在分段读取 1/3" } });
  });
  const completedAnalysis = { ...analysis, coverage: { method: "segmented", documents: 3, parts: 3 } };
  await page.route("**/api/studio/status?*", route => route.fulfill({ json: finished
    ? { jobId, status: "completed", phase: "已完成", result: { kind: "analysis", analysis: completedAnalysis } }
    : { jobId, status: "running", phase: "正在分段读取 1/3" } }));
  await page.goto(`${base}/stages/materials`);
  await page.getByRole("button", { name: "拆解大纲", exact: true }).click();
  await expect(page).toHaveURL(`${base}/stages/analysis`);
  await expect(page.getByRole("heading", { name: "正在分段读取 1/3", exact: true })).toBeVisible();
  expect(Buffer.byteLength(submitted)).toBeGreaterThan(600000);
  expect(JSON.parse(submitted).documents.map((doc: { text: string }) => doc.text)).toEqual(state.documents.map(doc => doc.text));
  finished = true;
  await expect(page.getByText("已分段处理 3 份材料 · 3 段", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /责任与选择/ })).toBeEnabled();
  await page.reload();
  await expect(page.getByText("已分段处理 3 份材料 · 3 段", { exact: true })).toBeVisible();
  expect((await readState(page, base)).documents).toEqual(state.documents);
});

test("旧任务404自动结束等待并解锁更改文件夹，刷新不重发模型", async ({ page }) => {
  await offlineCapability(page); const base = await seedProject(page, "旧拆解恢复"); const state = prepared();
  state.job = { jobId: randomUUID(), operation: "analyze", phase: "正在提交资料", sourceRevision: state.sourceRevision, blueprintRevision: state.blueprintRevision };
  await writeState(page, base, state); let posts = 0; page.on("request", req => { if (req.url().includes("/api/studio/") && req.method() === "POST") posts++; });
  await page.route("**/api/studio/status?*", route => route.fulfill({ status: 404, json: { error: { code: "JOB_NOT_FOUND", message: "任务不存在" } } }));
  await page.goto(`${base}/stages/materials`);
  await expect(page.getByText(/上次任务记录未找到，已结束等待/)).toBeVisible();
  await expect(page.getByRole("button", { name: "更改文件夹", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "拆解大纲", exact: true })).toBeEnabled();
  expect((await readState(page, base)).documents).toEqual(state.documents); expect(posts).toBe(0);
});
