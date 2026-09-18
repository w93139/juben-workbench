import { afterEach, expect, it, vi } from "vitest";
import { emptyBlueprintData } from "@/domain/blueprint";
import { emptyWorkbench, workbenchSchema, type BlueprintDraft } from "@/domain/workbench";
import { applyBlueprintDraft, putBlueprintDraft, removeBlueprintDraft } from "@/domain/blueprint-drafts";
import { BlueprintDraftWriter } from "@/services/blueprint-draft-writer";
import { BlueprintDraftSession, pendingBlueprintSession } from "@/services/blueprint-draft-session";

const makeDraft = (id = crypto.randomUUID()): BlueprintDraft => ({ id, revision: 1, baseRevision: 0, baseBlueprintRevision: 0, data: { ...emptyBlueprintData(), premise: "草稿内容" }, updatedAt: new Date().toISOString() });
function prepared() { const state = emptyWorkbench(); state.blueprint = emptyBlueprintData(); return state; }
afterEach(() => vi.useRealTimers());
it("旧结构默认为无草稿，重复编号拒绝读取", () => {
  const old = { ...emptyWorkbench(), blueprintDrafts: undefined }; expect(workbenchSchema.parse(old).blueprintDrafts).toEqual([]);
  const draft = makeDraft(); expect(workbenchSchema.safeParse({ ...old, blueprintDrafts: [draft, draft] }).success).toBe(false);
});
it("两页草稿分别CAS，保存不改正式修订、任务、历史或其他草稿", () => {
  const state = prepared(); const a = makeDraft(), b = makeDraft();
  state.job = { jobId: "test", operation: "review", phase: "运行中", sourceRevision: 0, blueprintRevision: 0 };
  const before = structuredClone(state);
  putBlueprintDraft(state, a, null); putBlueprintDraft(state, b, null);
  putBlueprintDraft(state, { ...a, revision: 2, data: { ...a.data, premise: "已改" } }, 1);
  expect(state.blueprintDrafts[1]).toEqual(b);
  expect({ ...state, blueprintDrafts: [] }).toEqual(before);
  expect(() => putBlueprintDraft(state, { ...a, revision: 2 }, 1)).toThrow("草稿已在其他页面变化");
  expect(() => putBlueprintDraft(state, { ...a, revision: 3, baseRevision: 1 }, 2)).toThrow("基准");
});
it("满12份不自动丢旧稿；显式删除版本过时拒绝", () => {
  const state = prepared(); for (let i = 0; i < 12; i++) putBlueprintDraft(state, makeDraft(), null);
  expect(() => putBlueprintDraft(state, makeDraft(), null)).toThrow("12份");
  expect(() => removeBlueprintDraft(state, state.blueprintDrafts[0].id, 2)).toThrow("草稿已变化");
  removeBlueprintDraft(state, state.blueprintDrafts[0].id, 1); putBlueprintDraft(state, makeDraft(), null); expect(state.blueprintDrafts).toHaveLength(12);
});
it("明确放弃本会话可清除已被别页删除的本地编辑，但不删除新版本", () => {
  const state = prepared(), draft = makeDraft(); putBlueprintDraft(state, draft, null); removeBlueprintDraft(state, draft.id, 1);
  expect(() => removeBlueprintDraft(state, draft.id, 1, true)).not.toThrow();
  putBlueprintDraft(state, draft, null); putBlueprintDraft(state, { ...draft, revision: 2 }, 1);
  expect(() => removeBlueprintDraft(state, draft.id, 1, true)).toThrow(); expect(state.blueprintDrafts[0].revision).toBe(2);
});
it.each(["revision", "job", "history", "draftVersion"])("正式提交因%s拒绝时完全保留草稿与正文", reason => {
  const state = prepared(), draft = makeDraft(); putBlueprintDraft(state, draft, null);
  if (reason === "revision") state.revision++;
  if (reason === "job") state.job = { jobId: "test", operation: "review", phase: "运行中", sourceRevision: 0, blueprintRevision: 0 };
  if (reason === "history") state.versions = Array.from({ length: 20 }, (_, revision) => ({ revision, data: emptyBlueprintData() }));
  const before = structuredClone(state);
  expect(() => applyBlueprintDraft(state, draft.id, reason === "draftVersion" ? 2 : 1)).toThrow(); expect(state).toEqual(before);
});
it("提交只清本会话，记录旧版并增加正式版本，迟到草稿版本不能复活", () => {
  const state = prepared(), a = makeDraft(), b = makeDraft(); putBlueprintDraft(state, a, null); putBlueprintDraft(state, b, null);
  applyBlueprintDraft(state, a.id, 1);
  expect(state.blueprint).toEqual(a.data); expect(state.blueprintDrafts).toEqual([b]); expect(state.versions).toHaveLength(1); expect(state.revision).toBe(1); expect(state.blueprintRevision).toBe(1);
  expect(() => putBlueprintDraft(state, { ...a, revision: 2 }, 1)).toThrow();
});
it("写入合并按最新输入保存，已成功flush后还能保存下一次输入", async () => {
  vi.useFakeTimers(); const write = vi.fn(async (draft: BlueprintDraft) => draft), notify = vi.fn(); const draft = makeDraft();
  const writer = new BlueprintDraftWriter(draft.id, 0, 0, write, notify);
  writer.change(draft.data); writer.change({ ...draft.data, premise: "最终输入" });
  expect(write).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(300);
  expect(write).toHaveBeenCalledTimes(1); expect(write.mock.calls[0][0].data.premise).toBe("最终输入");
  await writer.flush(); writer.change({ ...draft.data, premise: "下一次" }); await writer.flush();
  expect(write).toHaveBeenCalledTimes(2); expect((await writer.seal()).revision).toBe(2); expect(() => writer.change(draft.data)).toThrow("已结束");
  await vi.runAllTimersAsync(); expect(write).toHaveBeenCalledTimes(2);
});
it("在途写入串行合并，seal立即冻结编辑并等待最终内容落盘", async () => {
  const draft = makeDraft(); let release: (() => void) | undefined; let active = 0, max = 0;
  const write = vi.fn(async (record: BlueprintDraft) => { active++; max = Math.max(max, active); if (record.revision === 1) await new Promise<void>(resolve => { release = resolve; }); active--; return record; });
  const writer = new BlueprintDraftWriter(draft.id, 0, 0, write, () => {});
  writer.change(draft.data); const pending = writer.flush(); await Promise.resolve();
  writer.change({ ...draft.data, premise: "在途后输入" }); const sealing = writer.seal();
  expect(() => writer.change(draft.data)).toThrow("已结束"); release!(); await pending;
  expect((await sealing).data.premise).toBe("在途后输入"); expect(max).toBe(1); expect(write).toHaveBeenCalledTimes(2);
});
it("保存失败保留输入、失败状态和版本，显式重试后才显示已保存", async () => {
  const draft = makeDraft(); const write = vi.fn(async (record: BlueprintDraft) => record).mockRejectedValueOnce(new Error("quota")); const notify = vi.fn();
  const writer = new BlueprintDraftWriter(draft.id, 0, 0, write, notify); writer.change(draft.data);
  await expect(writer.seal()).rejects.toThrow("quota"); expect(notify.mock.lastCall?.[0]).toMatchObject({ saved: false, pending: true });
  const result = await writer.flush(); expect(result.revision).toBe(1); expect(result.data).toEqual(draft.data); expect(notify.mock.lastCall?.[0]).toEqual({ saved: true, pending: false, error: null });
});
it("放弃取消未发写入；在途放弃等落盘后才返回，可安全删除无迟到复活", async () => {
  vi.useFakeTimers(); const draft = makeDraft(); const write = vi.fn(async (record: BlueprintDraft) => record);
  const first = new BlueprintDraftWriter(draft.id, 0, 0, write, () => {}); first.change(draft.data); expect(await first.abandon()).toBeNull(); await vi.runAllTimersAsync(); expect(write).not.toHaveBeenCalled();
  let release: (() => void) | undefined;
  const next = new BlueprintDraftWriter(crypto.randomUUID(), 0, 0, async record => { await new Promise<void>(resolve => { release = resolve; }); return record; }, () => {});
  next.change(draft.data); const flight = next.flush(); await Promise.resolve(); const abandoned = next.abandon(); release!(); await flight;
  expect((await abandoned)?.revision).toBe(1); await expect(next.flush()).rejects.toThrow("没有可保存");
});
it("失败会话跨SPA卸载保留并重新订阅，另一项目隔离，成功后离页仅保留IDB", async () => {
  const write = vi.fn(async (record: BlueprintDraft) => record).mockRejectedValueOnce(new Error("quota")).mockRejectedValueOnce(new Error("quota"));
  const session = new BlueprintDraftSession("pending-project", 1, 1, write); const first = vi.fn(); session.attach(first); session.change(makeDraft().data);
  await expect(session.writer.flush()).rejects.toThrow("quota"); session.detach(); await expect(session.writer.flush()).rejects.toThrow("quota");
  expect(pendingBlueprintSession("pending-project")).toBe(session); expect(pendingBlueprintSession("different-project")).toBeUndefined();
  const second = vi.fn(); session.attach(second); const before = first.mock.calls.length; await session.writer.flush();
  expect(second.mock.lastCall?.[0]).toMatchObject({ pending: false, saved: true, error: null }); expect(first).toHaveBeenCalledTimes(before);
  session.change({ ...makeDraft().data, premise: "第二次输入" }); expect(pendingBlueprintSession("pending-project")).toBe(session);
  await session.writer.flush(); session.detach(); expect(pendingBlueprintSession("pending-project")).toBeUndefined();
});
it("已落盘但正式动作未结束时卸载仍保留会话，新订阅者收到busy及closed", async () => {
  const session = new BlueprintDraftSession("committing-project", 1, 1, async record => record); session.attach(() => {}); session.change(makeDraft().data); await session.writer.flush();
  session.begin(); await session.writer.seal(); session.detach(); expect(pendingBlueprintSession("committing-project")).toBe(session);
  const mounted = vi.fn(); session.attach(mounted); expect(mounted.mock.lastCall?.[0]).toMatchObject({ busy: true, closed: false });
  session.release(); expect(mounted.mock.lastCall?.[0]).toMatchObject({ busy: false, closed: true }); expect(pendingBlueprintSession("committing-project")).toBeUndefined();
});
it("另存在同一会话中切换writer，卸载后新订阅者继续收到新编号和状态", async () => {
  const session = new BlueprintDraftSession("forking-project", 3, 2, async record => record); session.attach(() => {}); session.change(makeDraft().data); await session.writer.flush(); const oldId = session.writer.id;
  session.begin(); session.detach(); const mounted = vi.fn(); session.attach(mounted); await session.fork(); await session.writer.flush(); session.resume();
  expect(session.writer.id).not.toBe(oldId); expect(session.writer.baseRevision).toBe(3); expect(session.writer.baseBlueprintRevision).toBe(2);
  expect(mounted.mock.lastCall?.[0]).toMatchObject({ saved: true, busy: false, closed: false }); session.release();
});
