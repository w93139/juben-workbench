vi.mock("@/server/task-power", async importOriginal => ({ ...await importOriginal<typeof import("@/server/task-power")>(), acquireTaskPower: async () => ({ assertActive: () => {}, release: async () => {} }) }));
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StudioJobStore } from "@/server/studio-job-store";
import { StudioEngine, type StudioConfig } from "@/server/studio-models";
const roots: string[] = []; const stores: StudioJobStore[] = [];
function file() { const root = mkdtempSync(join(tmpdir(), "studio-jobs-")); roots.push(root); return join(root, "jobs.sqlite"); }
function store(path: string, now?: () => number) { const result = new StudioJobStore(path, now); stores.push(result); return result; }
const config: StudioConfig = { baseUrl: "https://example.invalid/v1", apiKey: "test-fixture", mainModel: "main", reviewA: "a", reviewB: "b" };
const analysis = { outline: "测试拆解", directions: ["a", "b"].map(id => ({ id, title: id, summary: "方向", outline: "起承转合", risk: "待试玩" })), sourceRefs: [{ documentId: "d", location: "第一行", quote: "自有原文" }], unknowns: [] };
afterEach(() => { for (const item of stores.splice(0)) item.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it("跨服务实例可读进度及完成结果，同一编号不会再次调用模型，文件仅本人可读", async () => {
  const path = file(); const firstStore = store(path); const secondStore = store(path);
  let resolve!: (value: unknown) => void;
  const transport = vi.fn(() => new Promise<unknown>(done => { resolve = done; }));
  const first = new StudioEngine(() => config, transport, Date.now, firstStore);
  const second = new StudioEngine(() => config, transport, Date.now, secondStore);
  const id = randomUUID(); const input = { documents: [{ id: "d", name: "测试.txt", text: "自有原文" }] };
  await first.start("analyze", input, id);
  await vi.waitFor(() => expect(second.get(id).phase).toContain("主模型"));
  await second.start("analyze", input, id); expect(transport).toHaveBeenCalledTimes(1);
  resolve(analysis);
  await vi.waitFor(() => expect(second.get(id).status).toBe("completed"));
  const restarted = new StudioEngine(() => config, transport, Date.now, store(path));
  expect(restarted.get(id).result).toEqual({ kind: "analysis", analysis });
  await restarted.start("analyze", input, id); expect(transport).toHaveBeenCalledTimes(1);
  await expect(restarted.start("analyze", { ...input, instructions: "new" }, id)).rejects.toMatchObject({ code: "REQUEST_ID_CONFLICT" });
  expect(statSync(path).mode & 0o077).toBe(0);
});
it("中断记录保留为失败而非404，不重发；迟到结果不覆盖中断记录", () => {
  let now = Date.now(); const ledger = store(file(), () => now); const id = randomUUID();
  const view = { jobId: id, status: "running" as const, phase: "等待响应" };
  ledger.claim(view, "hash"); now += 5 * 60 * 1000 + 1;
  expect(ledger.read(id)?.view.error?.code).toBe("HOST_EXECUTION_PAUSED");
  expect(() => ledger.save({ jobId: id, status: "completed", phase: "完成", result: { kind: "analysis", analysis } })).toThrow("任务已结束或中断");
  expect(ledger.read(id)?.view.status).toBe("failed");
  expect(ledger.claim(view, "hash").created).toBe(false);
});
it("任务数量限制跨实例一致，伪造通过编号不可读取", () => {
  const path = file(); const a = store(path); const b = store(path);
  for (let i = 0; i < 2; i++) a.claim({ jobId: randomUUID(), status: "running", phase: "测试" }, `hash${i}`);
  expect(() => b.claim({ jobId: randomUUID(), status: "running", phase: "测试" }, "third")).toThrow("两个创作任务");
  expect(b.validated(randomUUID())).toBeNull();
});
it("分段检查点跨连接可读并按保留期过期", () => {
  let now = Date.now(); const path = file(); const a = store(path, () => now); const b = store(path, () => now);
  const key = "a".repeat(64); const note = { summary: "自有测试摘要", sourceRefs: [], unknowns: [] };
  a.saveAnalysisNote(key, note); expect(b.readAnalysisNote(key)).toEqual(note);
  expect(() => a.saveAnalysisNote("invalid", note)).toThrow("保存限制");
  now += 8 * 24 * 60 * 60 * 1000; expect(b.readAnalysisNote(key)).toBeNull();
});

it("另一连接在恢复探测间续租，旧快照不得中断正常任务", () => {
  let now = Date.now(); const path = file(); const a = store(path, () => now); const b = store(path, () => now);
  const id = randomUUID(); a.claim({ jobId: id, status: "running", phase: "等待模型" }, "hash");
  now += 300001;
  const probe = vi.spyOn(process, "kill").mockImplementation(() => { b.heartbeat(id); return true; });
  try { expect(a.read(id)?.view.status).toBe("running"); }
  finally { probe.mockRestore(); }
});
