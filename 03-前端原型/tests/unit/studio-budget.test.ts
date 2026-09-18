import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioBudgetLedger } from "@/server/studio-budget";
import { StudioJobStore } from "@/server/studio-job-store";
import type { StudioQuote } from "@/domain/studio-budget";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.reverse().forEach(cleanup => cleanup()); cleanups.length = 0; });
const fingerprint = "a".repeat(64);
const price = (now = 1000): StudioQuote => ({ provider: "ant", baseUrl: "https://maas-api.antdigital.com/v1", modelId: "model-a", currency: "CNY", inputPriceMicroCnyPerMillion: 1_000_000, outputPriceMicroCnyPerMillion: 2_000_000, checkedAt: now, expiresAt: now + 600000 });
function setup(cap = 100) {
  const db = new DatabaseSync(":memory:"); cleanups.push(() => db.close());
  let now = 1000, alive = true;
  const ledger = new StudioBudgetLedger(db, () => now, () => alive);
  ledger.configure("project-a", cap, 0);
  const jobId = randomUUID();
  db.exec("BEGIN IMMEDIATE"); ledger.admitInTransaction({ projectId: "project-a", revision: 1 }, jobId, fingerprint); db.exec("COMMIT");
  return { ledger, db, jobId, time: (value: number) => { now = value; }, dead: () => { alive = false; } };
}
it("新项目默认无预算，CAS修改不清账、不同项目独立", () => {
  const { ledger, jobId } = setup();
  expect(ledger.snapshot("project-b")).toBeNull();
  const call = ledger.reserve(jobId, "拆解", price(), fingerprint, 30); ledger.dispatch(call); ledger.settle(call, 10, 10, 20);
  expect(() => ledger.configure("project-a", 1, 1)).toThrow("不能低于");
  expect(ledger.configure("project-a", 200, 1)).toMatchObject({ capFen: 200, spentFen: 10, revision: 2 });
  expect(() => ledger.configure("project-a", 300, 1)).toThrow("另一个页面");
  expect(ledger.configure("project-b", 50, 0)).toMatchObject({ spentFen: 0, capFen: 50 });
});
it("预留、发送和用量核算都持久化，重复结算不重复计费", () => {
  const { ledger, jobId } = setup(); const call = ledger.reserve(jobId, "蓝图", price(), fingerprint, 20);
  expect(ledger.snapshot("project-a")).toMatchObject({ spentFen: 0, reservedFen: 20, remainingFen: 80 });
  ledger.dispatch(call); expect(() => ledger.dispatch(call)).toThrow("不重复发送");
  expect(ledger.settle(call, 8, 100, 200)).toBe(true); expect(ledger.settle(call, 8, 100, 200)).toBe(true);
  expect(ledger.snapshot("project-a")).toMatchObject({ spentFen: 8, reservedFen: 0, remainingFen: 92, calls: [expect.objectContaining({ state: "settled", actualFen: 8, promptTokens: 100 })] });
});
it("两连接原子抢占剩余额度，失败保留原预留且不能通过重试清账", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-budget-test-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "jobs.sqlite"), store = new StudioJobStore(file, () => 1000); cleanups.push(() => store.close());
  store.budget.configure("project-a", 50, 0);
  const first = randomUUID(), second = randomUUID();
  for (const id of [first, second]) store.claim({ jobId: id, status: "running", phase: "开始" }, fingerprint, { projectId: "project-a", revision: 1 });
  const other = new StudioBudgetLedger(file, () => 1000); cleanups.push(() => other.close());
  store.budget.reserve(first, "独审A", price(), fingerprint, 30);
  expect(() => other.reserve(second, "独审B", price(), fingerprint, 30)).toThrow("额度不足");
  expect(other.snapshot("project-a")).toMatchObject({ reservedFen: 30, totalCalls: 1 });
});
it("未发出的预留可释放，已发送中断保持待核对并阻止所有后续调用，包括零价", () => {
  const { ledger, jobId } = setup();
  const prepared = ledger.reserve(jobId, "未发出", price(), fingerprint, 30); ledger.interrupt(prepared);
  const sent = ledger.reserve(jobId, "已发出", price(), fingerprint, 20); ledger.dispatch(sent); ledger.interrupt(sent);
  expect(ledger.snapshot("project-a")).toMatchObject({ reservedFen: 0, uncertainFen: 20, uncertainCalls: 1 });
  ledger.configure("project-a", 200, 1);
  expect(() => ledger.reserve(jobId, "重试", price(), fingerprint, 0)).toThrow("待核对");
  const record = ledger.snapshot("project-a")!.calls.find(row => row.callId === sent)!;
  expect(() => ledger.reconcile("project-a", sent, record.version, 0, " ")).toThrow();
  expect(() => ledger.reconcile("project-b", sent, record.version, 0, "账单确认未扣费")).toThrow();
  ledger.reconcile("project-a", sent, record.version, 7, "供应商账单核对为0.07元");
  expect(ledger.snapshot("project-a")).toMatchObject({ spentFen: 7, uncertainFen: 0, uncertainCalls: 0 });
  expect(() => ledger.reconcile("project-a", sent, record.version, 0, "旧窗口")).toThrow("已变化");
  ledger.settle(sent, 5, 100, 100); expect(ledger.snapshot("project-a")!.spentFen).toBe(7);
});
it.each(["dead", "expired"])("进程退出或租约过期后区分未发送和已发送，不重放：%s", condition => {
  const { ledger, jobId, dead, time } = setup();
  const prepared = ledger.reserve(jobId, "准备", price(), fingerprint, 10);
  const sent = ledger.reserve(jobId, "发送", price(), fingerprint, 20); ledger.dispatch(sent);
  if (condition === "dead") dead(); else time(301001);
  const view = ledger.snapshot("project-a")!;
  expect(view).toMatchObject({ reservedFen: 0, uncertainFen: 20 });
  expect(view.calls.find(call => call.callId === prepared)?.state).toBe("released");
  expect(view.calls.find(call => call.callId === sent)?.state).toBe("uncertain");
  expect(() => ledger.dispatch(prepared)).toThrow();
  ledger.settle(sent, 8, 10, 20); expect(ledger.snapshot("project-a")!.spentFen).toBe(8);
});
it("实际用量超过预留不裁剪金额，保留已知金额等待核对，核对后超预算仍拒绝继续", () => {
  const { ledger, jobId } = setup(20); const call = ledger.reserve(jobId, "生成", price(), fingerprint, 10); ledger.dispatch(call);
  expect(ledger.settle(call, 25, 100, 200)).toBe(false);
  const current = ledger.snapshot("project-a")!;
  expect(current).toMatchObject({ uncertainFen: 25, overrunFen: 5, calls: [expect.objectContaining({ actualFen: 25, reason: "USAGE_EXCEEDS_RESERVATION" })] });
  expect(ledger.settle(call, 8, 1, 1)).toBe(false);
  expect(ledger.snapshot("project-a")).toMatchObject({ uncertainFen: 25, uncertainCalls: 1, spentFen: 0 });
  ledger.reconcile("project-a", call, current.calls[0].version, 25, "确认账单");
  expect(() => ledger.reserve(jobId, "下一步", price(), fingerprint, 0)).toThrow("额度不足");
});
it("预算登记与任务claim同一事务，结果保留期结束不能复用旧任务号收费", () => {
  let now = 1000; const store = new StudioJobStore(":memory:", () => now); cleanups.push(() => store.close());
  const id = randomUUID(), view = { jobId: id, status: "running" as const, phase: "准备" };
  expect(() => store.claim(view, fingerprint, { projectId: "project-a", revision: 0 })).toThrow("预算");
  expect(store.read(id)).toBeNull();
  store.budget.configure("project-a", 100, 0);
  expect(store.claim(view, fingerprint, { projectId: "project-a", revision: 1 }).created).toBe(true);
  expect(store.claim(view, fingerprint, { projectId: "project-a", revision: 1 }).created).toBe(false);
  store.save({ jobId: id, status: "failed", phase: "停止", error: { code: "TEST", message: "自造失败" } });
  now += 8 * 24 * 60 * 60 * 1000;
  expect(store.read(id)).toBeNull();
  expect(() => store.claim(view, fingerprint, { projectId: "project-a", revision: 1 })).toThrow("任务编号已使用");
});
it("费用写入失败保持原金额，不能生成部分结算", () => {
  const { ledger, jobId, db } = setup(); const call = ledger.reserve(jobId, "生成", price(), fingerprint, 30); ledger.dispatch(call);
  db.exec("CREATE TRIGGER synthetic_write_failure BEFORE UPDATE ON studio_charges BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  expect(() => ledger.settle(call, 8, 10, 20)).toThrow();
  expect(ledger.snapshot("project-a")).toMatchObject({ spentFen: 0, reservedFen: 30 });
  db.exec("DROP TRIGGER synthetic_write_failure"); ledger.interrupt(call);
  expect(ledger.snapshot("project-a")).toMatchObject({ spentFen: 0, uncertainFen: 30 });
});
