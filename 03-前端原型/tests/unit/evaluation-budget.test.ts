import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvaluationBudgetLedger } from "@/server/evaluation-budget";

const roots: string[] = [];
function ledger() { const root = mkdtempSync(join(tmpdir(), "evaluation-budget-")); roots.push(root); return new EvaluationBudgetLedger(join(root, "budget.sqlite")); }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("模型测评人民币硬预算", () => {
  it("预留后按实际分结算，任何组合都不能超过10元", () => {
    const value = ledger();
    expect(value.reserve("s", "a", 600)).toMatchObject({ reservedFen: 600, spentFen: 0 });
    expect(() => value.reserve("s", "b", 401)).toThrow("10元估算限额");
    expect(value.settle("a", 125)).toMatchObject({ reservedFen: 0, spentFen: 125 });
    expect(value.reserve("s", "b", 875)).toMatchObject({ reservedFen: 875, spentFen: 125 });
    expect(() => value.reserve("s", "c", 1)).toThrow("10元估算限额"); value.close();
  });
  it("超时或重启后的在途费用按最高金额待核对并阻断重复调用", () => {
    const value = ledger(); value.reserve("s", "a", 300); expect(value.markUncertain("a")).toMatchObject({ uncertainFen: 300, reservedFen: 0 });
    value.reserve("s", "b", 200); expect(value.recoverPending("s")).toMatchObject({ uncertainFen: 500, reservedFen: 0 });
    expect(() => value.settle("a", 1)).toThrow("已经结算"); value.close();
  });
  it("费用结算与题目视图同一事务提交，视图失败时不留下已结算空结果", () => {
    const value = ledger(); value.reserve("s", "a", 100);
    expect(() => value.settleAndSaveView("s", "a", 25, () => { throw new Error("write failed"); })).toThrow("write failed");
    expect(value.loadView("s")).toBeNull(); expect(value.snapshot("s")).toMatchObject({ spentFen: 0, reservedFen: 100 });
    const committed = value.settleAndSaveView("s", "a", 25, budget => JSON.stringify({ budget, result: "saved" }));
    expect(committed.budget).toMatchObject({ spentFen: 25, reservedFen: 0 }); expect(JSON.parse(value.loadView("s")!)).toMatchObject({ result: "saved" }); value.close();
  });
  it("续测资格以SQLite最新视图原子校验，旧进程不能再次取得资格", () => {
    const value = ledger(); value.saveView("s", JSON.stringify({ status: "blocked", resumeCount: 0, resumeAllowed: true, viewRevision: 3 }));
    expect(() => value.claimResume("s", "owner-a", 1000, 3)).not.toThrow(); value.releaseRun("s", "owner-a", "blocked");
    value.saveView("s", JSON.stringify({ status: "blocked", resumeCount: 1, resumeAllowed: true, viewRevision: 4 }));
    expect(() => value.claimResume("s", "owner-b", 1000, 3)).toThrow("其他进程更新"); value.close();
  });
  it("陈旧运行视图不能取得恢复租约覆盖新状态", () => {
    const value = ledger(); value.saveView("s", JSON.stringify({ status: "running", viewRevision: 2 }));
    expect(() => value.claimRecovery("s", "owner-a", 1000, 2)).not.toThrow(); value.releaseRun("s", "owner-a", "blocked");
    value.saveView("s", JSON.stringify({ status: "blocked", resumeCount: 1, viewRevision: 3 }));
    expect(() => value.claimRecovery("s", "owner-b", 1000, 2)).toThrow("不使用旧状态恢复"); value.close();
  });
  it("拒绝符号链接或权限宽松的预算文件", () => {
    const root = mkdtempSync(join(tmpdir(), "evaluation-budget-unsafe-")); roots.push(root);
    const other = join(root, "other"); writeFileSync(other, "unchanged", { mode: 0o600 }); symlinkSync(other, join(root, "linked.sqlite"));
    expect(() => new EvaluationBudgetLedger(join(root, "linked.sqlite"))).toThrow("预算文件不安全");
    const loose = join(root, "loose.sqlite"); writeFileSync(loose, "", { mode: 0o644 }); chmodSync(loose, 0o644);
    expect(() => new EvaluationBudgetLedger(loose)).toThrow("预算文件不安全");
  });
});
