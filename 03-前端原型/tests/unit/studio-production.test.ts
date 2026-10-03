import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioJobStore } from "@/server/studio-job-store";
import { studioReviewProgressSchema } from "@/domain/studio";
import { reviewAudit, reviewCheckpoint } from "../fixtures/studio-review";

const roots: string[] = [], stores: StudioJobStore[] = [];
const store = (path = ":memory:", now?: () => number) => { const result = new StudioJobStore(path, now); stores.push(result); return result; };
const file = () => { const root = mkdtempSync(join(tmpdir(), "production-test-")); roots.push(root); return join(root, "jobs.sqlite"); };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); for (const item of stores.splice(0)) item.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it("中断后禁止迟到写覆盖，恢复可读取最后成功但尚未广播的阶段", () => {
  let now = Date.now(); const database = store(":memory:", () => now), jobId = randomUUID(), progress = reviewCheckpoint(); progress.steps.forEach(step => step.state = "pending"); progress.review.artifacts = []; progress.review.reports = {};
  const claim = database.claim({ jobId, phase: "设计检查", status: "running", reviewProgress: progress }, "a".repeat(64), undefined, undefined, "b".repeat(64));
  const run = claim.productionId!; database.production.begin(run, "designGate", jobId, "c".repeat(64)); database.production.save(run, "designGate", jobId, "c".repeat(64), reviewAudit());
  now += 300001; const failed = database.read(jobId)!.view;
  expect(failed.status).toBe("failed"); expect(failed.reviewProgress?.review.reports.designGate).toEqual(reviewAudit());
  expect(() => database.production.save(run, "designGate", jobId, "c".repeat(64), { bad: "late" })).toThrow("执行权已失效"); expect(database.production.snapshot(run).units[0].saved).toBe(true);
});
it("检查点拒绝变更单元输入、重复发送与缺失依赖，部分成果永不携带通过权限", () => {
  const database = store(), jobId = randomUUID(), run = database.claim({ jobId, phase: "测试", status: "running" }, "a".repeat(64), undefined, undefined, "b".repeat(64)).productionId!;
  expect(() => database.production.begin(run, "artifacts", jobId, "c".repeat(64))).toThrow("前置阶段");
  database.production.begin(run, "designGate", jobId, "c".repeat(64));
  expect(() => database.production.begin(run, "designGate", jobId, "c".repeat(64))).toThrow("不能重复");
  expect(() => database.production.read(run, "designGate", "d".repeat(64))).toThrow("冻结资料");
  const progress = reviewCheckpoint(); expect(studioReviewProgressSchema.safeParse(progress).success).toBe(true);
  expect(studioReviewProgressSchema.safeParse({ ...progress, review: { ...progress.review, passed: true } }).success).toBe(false);
  expect(studioReviewProgressSchema.safeParse({ ...progress, review: { ...progress.review, validationId: randomUUID() } }).success).toBe(false);
});

it("已有无plan表的旧库只增加计划表，旧批次成果仍可读且不冒充模块化缓存", async()=>{
 const path=file(), legacy=store(path),jobId=randomUUID(),progress=reviewCheckpoint();const run=legacy.claim({jobId,status:"running",phase:"旧版阶段",reviewProgress:progress},"a".repeat(64),undefined,undefined,"b".repeat(64)).productionId!;
 legacy.production.begin(run,"designGate",jobId,"c".repeat(64));legacy.production.save(run,"designGate",jobId,"c".repeat(64),reviewAudit());
 legacy.save({jobId,status:"failed",phase:"旧版中断",error:{code:"TEST",message:"自造旧任务"},reviewProgress:progress});
 stores.splice(stores.indexOf(legacy),1);legacy.close();const db=new DatabaseSync(path);db.exec("DROP TABLE studio_production_plans");db.close();
 const reopened=store(path);expect(reopened.production.snapshot(run).plan).toBeNull();expect(reopened.production.snapshot(run).units[0].value).toEqual(reviewAudit());expect(reopened.read(jobId)?.view.reviewProgress?.generation).toBeUndefined();
 expect(reopened.production.snapshot(run).units).toHaveLength(1);
});
