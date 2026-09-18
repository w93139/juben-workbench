import { test, expect, type Page } from "@playwright/test";
import { completeBlueprint } from "../fixtures/blueprint";
import { offlineCapability, prepared, readState, writeState } from "./workbench-fixture";
import { seedProject } from "./project-fixture";
import type { WorkbenchState } from "../../src/domain/workbench";

async function setup(page: Page, modify?: (state: WorkbenchState) => void) {
  await offlineCapability(page); const base = await seedProject(page, "结构蓝图修订"); const state = prepared(); state.blueprint = completeBlueprint(); modify?.(state); await writeState(page, base, state); await page.goto(`${base}/stages/blueprint`); return base;
}
async function chapter(page: Page, label: string) { await page.getByRole("navigation", { name: "蓝图章节" }).getByRole("button", { name: new RegExp(`^${label}（`) }).click(); return page.getByRole("region", { name: `${label}编辑`, exact: true }); }
async function saved(page: Page) { await expect(page.getByText("草稿已在本机保存 · 尚未提交蓝图", { exact: true })).toBeVisible(); }
async function submit(page: Page) { await page.getByRole("button", { name: "预览并保存修改", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "保存调整", exact: true }).click(); }
async function history(page: Page, index = 0) { const region = page.getByRole("region", { name: "蓝图历史版本" }); const details = region.locator("details"); if ((await details.getAttribute("open")) === null) await region.locator("summary").click(); await region.getByRole("button", { name: "查看与当前版本对照", exact: true }).nth(index).click(); }

test("九类节点完整字段编辑、刷新恢复并正式提交，全程不调用模型", async ({ page }) => {
  const base = await setup(page); let requests = 0; page.on("request", r => { if (r.method() === "POST" && /\/api\/studio\/(analyze|blueprint|review)$/.test(r.url())) requests++; });
  let region = await chapter(page, "角色");
  for (const [label, value] of [["姓名", "甲"], ["公开身份", "保管员"], ["个人目标", "还原事件"], ["私密信息", "主动交换了文件"], ["有后果的选择", "公开记录并承担责任"], ["对游戏推进的贡献", "提供唯一校验钥匙"]]) await region.getByLabel(label, { exact: true }).fill(value);
  region = await chapter(page, "关系"); await region.getByLabel("关系中的角色一").selectOption("B"); await region.getByLabel("关系中的角色二").selectOption("A");
  for (const [label, value] of [["表面关系", "旧友"], ["真实关系", "互相保护"], ["关系如何影响选择", "公开后必须解除协议"]]) await region.getByLabel(label, { exact: true }).fill(value);
  region = await chapter(page, "事件"); await region.getByLabel("发生时间", { exact: true }).fill("11:50"); await region.getByLabel("发生地点", { exact: true }).fill("保管室"); await region.getByLabel("实际发生的事", { exact: true }).fill("甲交换了档案");
  await region.getByRole("button", { name: /编辑事件：发现空柜/ }).click(); await region.getByRole("group", { name: "这件事由哪些事件引起" }).getByRole("checkbox", { name: /（E1）/ }).uncheck();
  region = await chapter(page, "信息发放"); await region.getByLabel("谁收到信息").selectOption("A"); await region.getByLabel("对应的真实事件").selectOption("E2"); await region.getByLabel("何时得到信息").selectOption("R1"); await region.getByLabel("了解程度").selectOption("false"); await region.getByLabel("玩家看到或相信的内容").fill("误以为档案被销毁");
  region = await chapter(page, "推理结论"); await region.getByLabel("需要玩家得出的结论").fill("档案实际被交换"); await region.getByLabel("这是推进游戏的必要结论").uncheck();
  region = await chapter(page, "线索"); await region.getByLabel("线索名称", { exact: true }).fill("封签"); await region.getByLabel("线索内容", { exact: true }).fill("封签上有两次签名"); await region.getByRole("group", { name: "支持哪些推理结论" }).getByRole("checkbox").uncheck(); await region.getByLabel("可获得的轮次").selectOption("R1"); await region.getByRole("group", { name: "哪些角色能获得" }).getByRole("checkbox", { name: /B（B）/ }).check(); await region.getByLabel("获取成本").fill("5"); await region.getByLabel("玩家如何获得").fill("交出记录后获得");
  region = await chapter(page, "轮次"); for (const [label, value] of [["轮次名称", "核验"], ["计划分钟数", "35"], ["这一轮玩家做什么", "比对签名"], ["这一轮揭示什么", "封签被更换"]]) await region.getByLabel(label, { exact: true }).fill(value);
  region = await chapter(page, "主持触发"); await region.getByLabel("发生在哪一轮").selectOption("R1"); for (const [label, value] of [["什么时候触发", "有人交出记录"], ["主持人具体做什么", "交付封签"], ["条件未满足时怎么办", "展示残缺副本"]]) await region.getByLabel(label, { exact: true }).fill(value);
  region = await chapter(page, "终局"); for (const [label, value] of [["终局名称", "承担"], ["进入条件", "共同公开"], ["玩家要做的选择", "署名还是匿名"], ["选择带来的后果", "改变保管制度"]]) await region.getByLabel(label, { exact: true }).fill(value);
  await saved(page); let state = await readState(page, base); expect(state.blueprint).toEqual(completeBlueprint());
  const draft = state.blueprintDrafts[0].data; expect(draft.characters[0]).toMatchObject({ id: "A", name: "甲", publicIdentity: "保管员", goal: "还原事件", privateInformation: "主动交换了文件", choice: "公开记录并承担责任", contribution: "提供唯一校验钥匙" }); expect(draft.relationships[0]).toMatchObject({ fromId: "B", toId: "A", publicVersion: "旧友", truth: "互相保护", consequence: "公开后必须解除协议" }); expect(draft.events[0]).toMatchObject({ time: "11:50", location: "保管室", action: "甲交换了档案" }); expect(draft.events[1].causes).toEqual([]); expect(draft.knowledge[0]).toMatchObject({ characterId: "A", factId: "E2", roundId: "R1", state: "false", detail: "误以为档案被销毁" }); expect(draft.claims[0]).toMatchObject({ statement: "档案实际被交换", required: false }); expect(draft.clues[0]).toMatchObject({ name: "封签", content: "封签上有两次签名", supports: [], characterIds: ["B"], cost: 5, access: "交出记录后获得" }); expect(draft.rounds[0]).toMatchObject({ name: "核验", minutes: 35, activity: "比对签名", reveal: "封签被更换" }); expect(draft.triggers[0]).toMatchObject({ roundId: "R1", condition: "有人交出记录", action: "交付封签", fallback: "展示残缺副本" }); expect(draft.endings[0]).toMatchObject({ name: "承担", condition: "共同公开", choice: "署名还是匿名", consequence: "改变保管制度" });
  await page.reload(); await page.getByText(/查看已保存草稿/).click(); await page.getByRole("button", { name: "对照并恢复草稿", exact: true }).click(); await page.getByRole("button", { name: "恢复草稿继续编辑", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await submit(page); await expect(page.getByRole("dialog")).toHaveCount(0); state = await readState(page, base); expect(state.blueprint).toEqual(draft); expect(state.historyRevision).toBe(1); expect(state.versions[0].data).toEqual(completeBlueprint()); expect(requests).toBe(0);
});
test("移除被引用角色保留私人线索限制，撤销恢复；定位缺失关联可显式修正", async ({ page }) => {
  const base = await setup(page, s => { s.blueprint!.clues[0].characterIds = ["B"]; }); const region = await chapter(page, "角色"); await region.getByRole("button", { name: /编辑角色：B/ }).click(); await region.getByRole("button", { name: "移除当前角色", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("受影响的关联记录：3 条"); await page.getByRole("button", { name: "确认移除", exact: true }).click(); await saved(page);
  let draft = (await readState(page, base)).blueprintDrafts[0].data; expect(draft.characters.map(c => c.id)).toEqual(["A"]); expect(draft.clues[0].characterIds).toEqual(["B"]); await region.getByRole("button", { name: "撤销移除", exact: true }).click(); await saved(page); expect((await readState(page, base)).blueprintDrafts[0].data.characters.map(c => c.id)).toEqual(["A", "B"]);
  await region.getByRole("button", { name: "移除当前角色", exact: true }).click(); await page.getByRole("button", { name: "确认移除", exact: true }).click(); await saved(page); await page.getByText(/查看并定位问题/).click(); await page.getByRole("button", { name: /待修正 · 线索（C1）.*不存在/ }).click();
  const clues = page.getByRole("region", { name: "线索编辑", exact: true }); await expect(clues.getByRole("heading", { level: 3 })).toBeFocused(); await expect(clues.getByRole("checkbox", { name: "已失效：B", exact: true })).toBeChecked(); await clues.getByRole("checkbox", { name: /A（A）/ }).check(); await clues.getByRole("checkbox", { name: "已失效：B", exact: true }).click(); await saved(page); draft = (await readState(page, base)).blueprintDrafts[0].data; expect(draft.clues[0].characterIds).toEqual(["A"]); expect(draft.knowledge[0].characterId).toBe("B");
});
test("九类新增记录保留独立编号，切换后仍在同一草稿，空节点也可落盘", async ({ page }) => {
  const base = await setup(page); for (const label of ["角色", "关系", "事件", "信息发放", "推理结论", "线索", "轮次", "主持触发", "终局"]) { const region = await chapter(page, label); await region.getByRole("button", { name: `添加${label}`, exact: true }).click(); }
  await saved(page); const state = await readState(page, base), draft = state.blueprintDrafts[0].data; expect(state.blueprintDrafts).toHaveLength(1);
  for (const section of ["characters", "relationships", "events", "knowledge", "claims", "clues", "rounds", "triggers", "endings"] as const) { expect(draft[section].length).toBe(completeBlueprint()[section].length + 1); expect(new Set(draft[section].map(row => row.id)).size).toBe(draft[section].length); }
  await page.reload(); expect((await readState(page, base)).blueprintDrafts[0].data).toEqual(draft);
});
test("2000条信息分页搜索，定位末页问题只挂载一条完整表单，窄屏可编辑", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const base = await setup(page, s => { s.blueprint!.knowledge = Array.from({ length: 2000 }, (_, i) => ({ ...s.blueprint!.knowledge[0], id: `K${i}`, detail: i === 1999 ? "" : `自造信息${i}` })); });
  let region = await chapter(page, "信息发放"); await expect(region.getByRole("button", { name: /^编辑信息发放：/ })).toHaveCount(30); await expect(region.getByRole("button", { name: "添加信息发放", exact: true })).toBeDisabled(); await region.getByLabel("搜索信息发放记录", { exact: true }).fill("K1998"); await region.getByRole("button", { name: /K1998/ }).click(); await region.getByLabel("玩家看到或相信的内容").fill("末页修改不丢失"); await saved(page);
  await page.getByText(/查看并定位问题/).click(); await page.getByRole("button", { name: /信息发放（K1999）/ }).click(); region = page.getByRole("region", { name: "信息发放编辑", exact: true }); await expect(region.getByRole("heading", { level: 3 })).toBeFocused(); await expect(region.getByLabel("搜索信息发放记录", { exact: true })).toHaveValue(""); await expect(region.getByLabel("玩家看到或相信的内容")).toHaveValue(""); await expect(region.locator("textarea")).toHaveCount(1); await region.getByLabel("玩家看到或相信的内容").fill("补齐最后一条"); await saved(page);
  const state = await readState(page, base); expect(state.blueprintDrafts[0].data.knowledge[1998].detail).toBe("末页修改不丢失"); expect(state.blueprintDrafts[0].data.knowledge[1999].detail).toBe("补齐最后一条"); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("历史满额先对照取消，再明确清理一份，原草稿可继续提交", async ({ page }) => {
  const base = await setup(page, s => { s.versions = Array.from({ length: 20 }, (_, revision) => ({ revision, data: { ...completeBlueprint(), premise: `自造历史${revision}` } })); });
  await page.getByRole("textbox", { name: "大纲", exact: true }).fill("清理后继续提交的蓝图"); await submit(page); await expect(page.getByRole("dialog")).toContainText("蓝图历史已达20份"); await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click(); const before = await readState(page, base);
  await history(page); await expect(page.getByRole("dialog")).toContainText("自造历史0"); await page.getByRole("button", { name: "删除此历史版本", exact: true }).click(); await page.getByRole("button", { name: "取消删除", exact: true }).click(); expect(await readState(page, base)).toEqual(before); await page.getByRole("button", { name: "删除此历史版本", exact: true }).click(); await page.getByRole("button", { name: "确认删除此历史版本", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  const cleaned = await readState(page, base); expect(cleaned.revision).toBe(before.revision); expect(cleaned.blueprintDrafts).toEqual(before.blueprintDrafts); expect(cleaned.historyRevision).toBe(1); await submit(page); await expect(page.getByRole("dialog")).toHaveCount(0); const next = await readState(page, base); expect(next.blueprint?.premise).toBe("清理后继续提交的蓝图"); expect(next.versions).toHaveLength(20); expect(next.historyRevision).toBe(2);
});
test("历史恢复先生成独立草稿，预览不改正式稿；另一页变化时拒绝过期恢复或删除", async ({ page, context }) => {
  const base = await setup(page, s => { s.versions = [{ revision: 0, data: { ...completeBlueprint(), premise: "历史完整故事" } }]; }); await history(page); const before = await readState(page, base); expect(before.blueprintDrafts).toHaveLength(0);
  await page.getByRole("button", { name: "对照后载入为新草稿", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await saved(page); let state = await readState(page, base); expect(state.blueprint?.premise).toBe(completeBlueprint().premise); expect(state.blueprintDrafts[0].data.premise).toBe("历史完整故事"); expect(state.versions).toEqual(before.versions); await submit(page); await expect(page.getByRole("dialog")).toHaveCount(0); state = await readState(page, base); expect(state.blueprintRevision).toBe(2); expect(state.versions).toHaveLength(2);
  await history(page); const other = await context.newPage(); await offlineCapability(other); await other.goto(`${base}/stages/blueprint`); await history(other); await other.getByRole("button", { name: "删除此历史版本", exact: true }).click(); await other.getByRole("button", { name: "确认删除此历史版本", exact: true }).click(); await expect(other.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "对照后载入为新草稿", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("历史版本已在其他页面变化"); await page.getByRole("button", { name: "删除此历史版本", exact: true }).click(); await page.getByRole("button", { name: "确认删除此历史版本", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("历史版本已在其他页面变化"); expect((await readState(page, base)).versions).toHaveLength(1); expect((await readState(page, base)).blueprintDrafts).toHaveLength(0); await other.close();
});
test("历史清理写失败保留历史及草稿，恢复存储后可重试", async ({ page }) => {
  const base = await setup(page, s => { s.versions = [{ revision: 0, data: completeBlueprint() }]; }); await page.getByRole("textbox", { name: "大纲", exact: true }).fill("历史失败时保留草稿"); await saved(page); const before = await readState(page, base); await history(page); await page.getByRole("button", { name: "删除此历史版本", exact: true }).click();
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(value, ...keys) { if (value.historyRevision === 1) { IDBObjectStore.prototype.put = put; throw new DOMException("自造历史写失败", "QuotaExceededError"); } return put.call(this, value, ...keys); }; }); await page.getByRole("button", { name: "确认删除此历史版本", exact: true }).click(); await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible(); expect(await readState(page, base)).toEqual(before); await page.getByRole("button", { name: "确认删除此历史版本", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); expect((await readState(page, base)).versions).toHaveLength(0); expect((await readState(page, base)).blueprintDrafts).toEqual(before.blueprintDrafts);
});
test("历史前读后另一次事务清理，首次草稿保存原子拒绝，另存也不能绕过", async ({ page }) => {
  const base = await setup(page, s => { s.versions = [{ revision: 0, data: { ...completeBlueprint(), premise: "竞争历史内容" } }]; }); await history(page);
  await page.evaluate(() => {
    const open = IDBFactory.prototype.open; let calls = 0;
    IDBFactory.prototype.open = function(...args) {
      const request = open.apply(this, args);
      if (++calls !== 2) return request;
      IDBFactory.prototype.open = open;
      let callback: ((event: Event) => unknown) | null = null;
      Object.defineProperty(request, "onsuccess", { get: () => callback, set: value => { callback = value; } });
      request.addEventListener("success", event => {
        // Insert another committed native IDB transaction before the app starts its write.
        const tx = request.result.transaction("projects", "readwrite"), store = tx.objectStore("projects"), cursor = store.openCursor();
        cursor.onsuccess = () => { if (cursor.result) { const state = cursor.result.value; if (state.versions?.length) { state.versions = []; state.historyRevision++; cursor.result.update(state); } cursor.result.continue(); } };
        tx.oncomplete = () => callback?.call(request, event);
      });
      return request;
    };
  });
  await page.getByRole("button", { name: "对照后载入为新草稿", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("历史版本已在其他页面变化");
  let state = await readState(page, base); expect(state.versions).toHaveLength(0); expect(state.blueprintDrafts).toHaveLength(0); expect(state.blueprint?.premise).toBe(completeBlueprint().premise);
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click(); await page.getByRole("button", { name: "另存为新草稿", exact: true }).click(); await expect(page.getByText("草稿尚未保存成功", { exact: true })).toBeVisible(); state = await readState(page, base); expect(state.blueprintDrafts).toHaveLength(0);
});
test("外页正式更新不清除本页未提交的撤销记录，撤销后提交仍受旧基准保护", async ({ page, context }) => {
  const base = await setup(page); const region = await chapter(page, "角色"); await region.getByRole("button", { name: /编辑角色：B/ }).click(); await region.getByRole("button", { name: "移除当前角色", exact: true }).click(); await page.getByRole("button", { name: "确认移除", exact: true }).click(); await saved(page);
  const other = await context.newPage(); await offlineCapability(other); await other.goto(`${base}/stages/blueprint`); await other.getByRole("textbox", { name: "大纲", exact: true }).fill("另一页正式更新"); await submit(other); await expect(other.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "蓝图历史版本" })).toContainText("1/20 份"); await expect(region.getByRole("button", { name: "撤销移除", exact: true })).toBeEnabled(); await region.getByRole("button", { name: "撤销移除", exact: true }).click(); await saved(page); expect((await readState(page, base)).blueprintDrafts[0].data.characters.map(c => c.id)).toEqual(["A", "B"]); await submit(page); await expect(page.getByRole("dialog")).toContainText("项目已在其他页面更新"); expect((await readState(page, base)).blueprint?.premise).toBe("另一页正式更新"); await other.close();
});
test("移除确认期间记录被另一页改写，拒绝移除未经对照的新内容", async ({ page, context }) => {
  const base = await setup(page); const region = await chapter(page, "角色"); await region.getByRole("button", { name: /编辑角色：B/ }).click(); await region.getByRole("button", { name: "移除当前角色", exact: true }).click();
  const other = await context.newPage(); await offlineCapability(other); await other.goto(`${base}/stages/blueprint`); const otherRegion = await chapter(other, "角色"); await otherRegion.getByRole("button", { name: /编辑角色：B/ }).click(); await otherRegion.getByLabel("姓名", { exact: true }).fill("B的新身份"); await submit(other); await expect(other.getByRole("dialog")).toHaveCount(0); await expect(page.locator('button[aria-label^="编辑角色：B的新身份"]')).toBeAttached();
  await page.getByRole("button", { name: "确认移除", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("选中记录已变化"); const state = await readState(page, base); expect(state.blueprintDrafts).toHaveLength(0); expect(state.blueprint?.characters[1].name).toBe("B的新身份"); await other.close();
});
test("历史恢复读取尚未返回时离页往返，不在新编辑器背后建立游离草稿", async ({ page }) => {
  const base = await setup(page, s => { s.versions = [{ revision: 0, data: { ...completeBlueprint(), premise: "不应迟到恢复的历史" } }]; });
  const nav = page.getByRole("navigation", { name: "创作流程" }); await nav.getByRole("link", { name: /拆解与方向/ }).click(); await nav.getByRole("link", { name: /创作蓝图/ }).click(); await history(page);
  await page.evaluate(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(...args) {
      IDBFactory.prototype.open = open; const request = open.apply(this, args); let callback: ((event: Event) => unknown) | null = null;
      Object.defineProperty(request, "onsuccess", { get: () => callback, set: value => { callback = value; } });
      request.addEventListener("success", event => {
        const close = request.result.close.bind(request.result);
        request.result.close = () => { close(); Reflect.set(window, "historyReadClosed", true); };
        Reflect.set(window, "releaseHistoryRead", () => callback?.call(request, event));
      }); return request;
    };
  });
  await page.getByRole("button", { name: "对照后载入为新草稿", exact: true }).click(); await page.waitForFunction(() => typeof Reflect.get(window, "releaseHistoryRead") === "function"); await page.goBack(); await expect(page).toHaveURL(`${base}/stages/analysis`); await page.goForward(); await expect(page).toHaveURL(`${base}/stages/blueprint`);
  await page.evaluate(() => (Reflect.get(window, "releaseHistoryRead") as () => void)()); await page.waitForFunction(() => Reflect.get(window, "historyReadClosed") === true);
  await expect(page.getByText("正在查看正式蓝图", { exact: true })).toBeVisible(); expect((await readState(page, base)).blueprintDrafts).toHaveLength(0); await page.getByRole("textbox", { name: "大纲", exact: true }).fill("往返之后正常新草稿"); await saved(page); expect((await readState(page, base)).blueprintDrafts[0].data.premise).toBe("往返之后正常新草稿");
});
