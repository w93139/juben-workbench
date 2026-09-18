import { DatabaseSync } from "node:sqlite";
import { buildArtifactPlan, artifactPayload } from "@/server/artifact-plan";
import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioEngine, type ModelTransport, type StudioConfig } from "@/server/studio-models";
import { StudioJobStore } from "@/server/studio-job-store";
import { studioArtifactSchema, studioReviewProgressSchema } from "@/domain/studio";
import { plannedArtifact, reviewAudit, reviewBlueprint, reviewCheckpoint } from "../fixtures/studio-review";

const config: StudioConfig = { baseUrl: "https://example.invalid/v1", apiKey: "test-only-synthetic", mainModel: "main", reviewA: "review-a", reviewB: "review-b" };
const power = async () => ({ assertActive() {}, async release() {} });
const input = () => ({ blueprint: reviewBlueprint() });
const transport: ModelTransport = async (_config, _model, _instructions, payload, schema) => schema === studioArtifactSchema ? plannedArtifact(payload as Parameters<typeof plannedArtifact>[0]) : reviewAudit();
const roots: string[] = [], stores: StudioJobStore[] = [];
const store = (path = ":memory:", now?: () => number) => { const result = new StudioJobStore(path, now); stores.push(result); return result; };
const file = () => { const root = mkdtempSync(join(tmpdir(), "production-test-")); roots.push(root); return join(root, "jobs.sqlite"); };
const engine = (database: StudioJobStore, call = transport, now = Date.now, settings = config) => new StudioEngine(() => settings, call, now, database, power);
async function wait(service: StudioEngine, id: string) { for (let i = 0; i < 100; i++) { const view = service.get(id); if (view.status !== "running") return view; await new Promise(resolve => setImmediate(resolve)); } throw new Error("task did not settle"); }
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); for (const item of stores.splice(0)) item.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("并行B失败仍保存A，重启与手动新任务仅补缺项，阶段报告跨任务完整保留", async () => {
  const database = store(); let fail = true;
  const call = vi.fn<ModelTransport>(async (...args) => { if (args[1] === config.reviewB && args[2].includes("独立审核") && fail) throw new Error("synthetic failed B"); if (args[1] === config.reviewA) await new Promise(resolve => setImmediate(resolve)); return transport(...args); });
  const first = engine(database, call), initial = await first.start("review", input(), randomUUID());
  const failed = await wait(first, initial.jobId);
  expect(failed.status).toBe("failed"); expect(failed.result).toBeUndefined(); expect(failed.reviewProgress?.review.artifacts).toEqual(buildArtifactPlan(reviewBlueprint()).targets.map(target => plannedArtifact(artifactPayload(reviewBlueprint(), target))));
  expect(failed.reviewProgress?.steps.filter(step => step.state === "saved").map(step => step.id)).toEqual(["designGate", "artifacts", "independentA"]);
  expect(failed.reviewProgress?.review.reports.independentA).toEqual(reviewAudit()); expect(failed.reviewProgress?.review.passed).toBe(false);
  const restart = engine(database, call); expect(restart.get(initial.jobId)).toEqual(failed); expect(call).toHaveBeenCalledTimes(13);
  fail = false; const complete = await wait(restart, (await restart.start("review", input(), randomUUID())).jobId);
  expect(complete.status).toBe("completed"); expect(complete.result?.kind === "review" && complete.result.passed).toBe(true); expect(call).toHaveBeenCalledTimes(17);
  expect(call.mock.calls.filter(args => args[1] === config.reviewA && args[2].includes("独立审核"))).toHaveLength(1);
  expect(database.production.snapshot(failed.reviewProgress!.runId!).units.every(unit => unit.saved)).toBe(true);
});
it("任务七天过期不删除成功阶段；新任务复用全部阶段且旧通过凭证已失效", async () => {
  let now = Date.now(); const database = store(":memory:", () => now), call = vi.fn(transport), service = engine(database, call, () => now);
  const done = await wait(service, (await service.start("review", input(), randomUUID())).jobId);
  if (done.result?.kind !== "review") throw new Error("missing review");
  now += 8 * 24 * 3600000; expect(() => service.get(done.jobId)).toThrow("未找到"); expect(() => service.getValidated(done.result!.kind === "review" ? done.result!.validationId! : "")).toThrow("没有可用");
  const next = await wait(service, (await service.start("review", input(), randomUUID())).jobId);
  expect(next.result?.kind === "review" && next.result.passed).toBe(true); expect(call).toHaveBeenCalledTimes(16);
});
it("同批次跨连接只允许一个活动任务，变更配置创建隔离批次", async () => {
  const path = file(), a = store(path), b = store(path); let finish!: (value: unknown) => void;
  let calls = 0;
  const call = vi.fn<ModelTransport>((...args) => ++calls === 1 ? new Promise(resolve => { finish = resolve; }) : transport(...args));
  const first = engine(a, call), second = engine(b, call), started = await first.start("review", input(), randomUUID());
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  await expect(second.start("review", input(), randomUUID())).rejects.toThrow("同一批正文"); expect(call).toHaveBeenCalledTimes(1);
  finish(reviewAudit()); await wait(first, started.jobId);
  const changed = engine(b, call, Date.now, { ...config, mainModel: "other-main" });
  const newRun = await changed.start("review", input(), randomUUID());
  expect(newRun.reviewProgress?.runId).not.toBe(started.reviewProgress?.runId); await wait(changed, newRun.jobId); expect(call).toHaveBeenCalledTimes(32);
});
it("成果写失败保留未完成标记，显式继续重新调用该项，不把响应冒充已保存", async () => {
  const database = store(), call = vi.fn(transport); vi.spyOn(database.production, "save").mockImplementationOnce(() => { throw new Error("synthetic disk failure"); });
  const service = engine(database, call), failed = await wait(service, (await service.start("review", input(), randomUUID())).jobId);
  expect(failed.status).toBe("failed"); expect(failed.reviewProgress?.steps[0].state).toBe("interrupted"); expect(failed.reviewProgress?.review.reports).toEqual({});
  expect(call).toHaveBeenCalledTimes(1);
  const done = await wait(service, (await service.start("review", input(), randomUUID())).jobId); expect(done.status).toBe("completed"); expect(call).toHaveBeenCalledTimes(17);
});
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
it.each(["quote", "source"])("可程序证明的%s违约报告保留供查看但不复用，手动继续可补救", async mode => {
  const database = store(); let invalid = true;
  const call = vi.fn<ModelTransport>(async (...args) => {
    if (invalid && mode === "quote" && args[1] === config.reviewA) return { ...reviewAudit(), evidence: [{ location: "不存在位置", quote: "不存在原文", conclusion: "无效引用" }] };
    if (invalid && mode === "source" && args[4] === studioArtifactSchema) { const artifact = plannedArtifact(args[3] as Parameters<typeof plannedArtifact>[0]); artifact.sourceIds.push("unknown"); return artifact; }
    return transport(...args);
  });
  const service = engine(database, call), failed = await wait(service, (await service.start("review", input(), randomUUID())).jobId);
  expect(failed.error?.code).toBe("MODEL_RESPONSE_INVALID"); expect(failed.reviewProgress?.review.issues.join(" ")).toContain(mode === "quote" ? "引用无法" : "来源关联");
  const badUnit = database.production.snapshot(failed.reviewProgress!.runId!).units.find(unit => unit.id === (mode === "quote" ? "independentA" : buildArtifactPlan(reviewBlueprint()).targets[0].id))!;
  expect(badUnit.saved).toBe(false); expect(badUnit.value).toBeDefined();
  invalid = false; const complete = await wait(service, (await service.start("review", input(), randomUUID())).jobId);
  expect(complete.result?.kind === "review" && complete.result.passed).toBe(true); expect(call).toHaveBeenCalledTimes(17);
});

it("已有无plan表的旧库只增加计划表，旧批次成果仍可读且不冒充模块化缓存", async()=>{
 const path=file(), legacy=store(path),jobId=randomUUID(),progress=reviewCheckpoint();const run=legacy.claim({jobId,status:"running",phase:"旧版阶段",reviewProgress:progress},"a".repeat(64),undefined,undefined,"b".repeat(64)).productionId!;
 legacy.production.begin(run,"designGate",jobId,"c".repeat(64));legacy.production.save(run,"designGate",jobId,"c".repeat(64),reviewAudit());
 legacy.save({jobId,status:"failed",phase:"旧版中断",error:{code:"TEST",message:"自造旧任务"},reviewProgress:progress});
 stores.splice(stores.indexOf(legacy),1);legacy.close();const db=new DatabaseSync(path);db.exec("DROP TABLE studio_production_plans");db.close();
 const reopened=store(path);expect(reopened.production.snapshot(run).plan).toBeNull();expect(reopened.production.snapshot(run).units[0].value).toEqual(reviewAudit());expect(reopened.read(jobId)?.view.reviewProgress?.generation).toBeUndefined();
 const call=vi.fn(transport),service=engine(reopened,call);const next=await wait(service,(await service.start("review",input(),randomUUID())).jobId);expect(next.result?.kind==="review"&&next.result.passed).toBe(true);expect(call).toHaveBeenCalledTimes(16);expect(reopened.production.snapshot(run).units).toHaveLength(1);
});
