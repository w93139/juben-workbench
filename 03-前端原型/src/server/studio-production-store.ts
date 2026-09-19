import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { reviewUnits } from "@/domain/studio-production";
import { artifactPlanSchema, artifactPlanDigest, type ArtifactPlan } from "./artifact-plan";
import { LocalApiError } from "./local-security";
import { reviewPlanSchema, scopedStages, scopedUnitId, type ReviewPlan } from "@/domain/review-plan";
import { reviewPlanDigest, verifyReviewPlan } from "./review-plan";
import type { BlueprintData } from "@/domain/blueprint";
import type { StudioArtifact } from "@/domain/studio";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
type Run = { id: string; revision: number; active_job_id: string };
type Unit = { unit_id: string; request_hash: string; value_json: string | null; job_id: string; call_id: string | null };
/** Shares the job database. Checkpoints have no TTL and cannot be uploaded by clients. */
export class StudioProductionStore {
  constructor(private db: DatabaseSync, private now = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS studio_production_runs (
      id TEXT PRIMARY KEY, run_key TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, active_job_id TEXT NOT NULL
    ); CREATE TABLE IF NOT EXISTS studio_production_units (
      run_id TEXT NOT NULL, unit_id TEXT NOT NULL, request_hash TEXT NOT NULL, job_id TEXT NOT NULL,
      call_id TEXT, value_json TEXT, PRIMARY KEY(run_id, unit_id)
    ); CREATE TABLE IF NOT EXISTS studio_production_attempts (
      run_id TEXT NOT NULL, unit_id TEXT NOT NULL, job_id TEXT NOT NULL, call_id TEXT,
      response_json TEXT, issues_json TEXT,
      PRIMARY KEY(run_id, unit_id, job_id)
    ); CREATE TABLE IF NOT EXISTS studio_production_plans (run_id TEXT PRIMARY KEY, plan_hash TEXT NOT NULL, plan_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS studio_review_plans (run_id TEXT PRIMARY KEY, plan_hash TEXT NOT NULL, plan_json TEXT NOT NULL)`);
  }
  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  /** Called inside the same transaction as job admission and budget preview consumption. */
  claim(runKey: string, jobId: string, plan?: ArtifactPlan) {
    if (!this.db.isTransaction) throw new Error("Production claim requires job transaction");
    hash.parse(runKey); z.uuid().parse(jobId);
    let row = this.db.prepare("SELECT id, revision, active_job_id FROM studio_production_runs WHERE run_key = ?").get(runKey) as Run | undefined;
    if (row) {
      const active = this.db.prepare("SELECT status FROM studio_jobs WHERE id = ?").get(row.active_job_id) as { status: string } | undefined;
      if (active?.status === "running") throw new LocalApiError(409, "同一批正文仍有任务在运行，请查询原任务，不能重复开始。");
      this.db.prepare("UPDATE studio_production_runs SET active_job_id = ? WHERE id = ?").run(jobId, row.id);
    } else {
      row = { id: randomUUID(), revision: 0, active_job_id: jobId };
      this.db.prepare("INSERT INTO studio_production_runs(id, run_key, revision, active_job_id) VALUES (?, ?, 0, ?)").run(row.id, runKey, jobId);
    }
    const priorPlan = this.plan(row.id);
    if (priorPlan && (!plan || artifactPlanDigest(priorPlan) !== artifactPlanDigest(plan))) throw new LocalApiError(409, "生成计划已变化，不能混用正文批次。");
    if (plan && !priorPlan) {
      const existing = this.db.prepare("SELECT 1 FROM studio_production_units WHERE run_id = ? LIMIT 1").get(row.id);
      if (existing) throw new LocalApiError(409, "旧批次不支持替换生成计划。");
      const parsed = artifactPlanSchema.parse(plan);
      this.db.prepare("INSERT INTO studio_production_plans(run_id, plan_hash, plan_json) VALUES (?, ?, ?)").run(row.id, artifactPlanDigest(parsed), JSON.stringify(parsed));
    }
    return row.id;
  }
  private owner(runId: string, jobId: string) {
    const row = this.db.prepare(`SELECT r.id FROM studio_production_runs r JOIN studio_jobs j ON j.id = r.active_job_id
      WHERE r.id = ? AND j.id = ? AND j.status = 'running' AND j.owner_pid = ? AND j.lease_until > ?`).get(runId, jobId, process.pid, this.now());
    if (!row) throw new LocalApiError(409, "正文批次的执行权已失效，未覆盖已保存成果，也没有自动重试。");
  }
  plan(runId: string): ArtifactPlan | null {
    const row = this.db.prepare("SELECT plan_json, plan_hash FROM studio_production_plans WHERE run_id = ?").get(runId) as { plan_json: string; plan_hash: string } | undefined;
    if (!row) return null;
    const plan = artifactPlanSchema.parse(JSON.parse(row.plan_json));
    if (artifactPlanDigest(plan) !== row.plan_hash) throw new LocalApiError(409, "冻结生成计划校验失败，未继续调用。");
    return plan;
  }
  private definition(runId: string, unitId: string) {
    if (unitId.startsWith("sr-")) {
      const plan = this.reviewPlan(runId);
      for (const scope of plan ? [...plan.parts, ...plan.links] : []) for (const stage of scopedStages) {
        if (scopedUnitId(scope.id, stage) !== unitId) continue;
        const stages = stage === "coordinator" ? ["mutualA", "mutualB"] as const : stage.startsWith("mutual") ? ["independentA", "independentB"] as const : [];
        return { id: unitId, dependencies: ["artifacts", ...stages.map(stage => scopedUnitId(scope.id, stage))] };
      }
      throw new LocalApiError(409, "分段审查单元不在冻结计划中，未调用模型。");
    }
    const plan = this.plan(runId);
    if (plan?.targets.some(target => target.id === unitId)) return { id: unitId, dependencies: ["designGate"] };
    const definition = reviewUnits.find(unit => unit.id === unitId);
    if (!definition) throw new Error("Unknown production unit");
    return plan && unitId === "artifacts" ? { ...definition, dependencies: plan.targets.map(target => target.id) } : definition;
  }
  reviewPlan(runId: string): ReviewPlan | null {
    const row = this.db.prepare("SELECT plan_hash, plan_json FROM studio_review_plans WHERE run_id = ?").get(runId) as { plan_hash: string; plan_json: string } | undefined;
    if (!row) return null;
    const plan = reviewPlanSchema.parse(JSON.parse(row.plan_json));
    if (reviewPlanDigest(plan) !== row.plan_hash) throw new LocalApiError(409, "分段审查计划校验失败，未继续调用。");
    return plan;
  }
  registerReviewPlan(runId: string, jobId: string, plan: ReviewPlan, blueprint: BlueprintData, artifacts: StudioArtifact[]) {
    verifyReviewPlan(plan, blueprint, artifacts);
    this.transaction(() => {
      this.owner(runId, jobId);
      const prior = this.reviewPlan(runId), digest = reviewPlanDigest(plan);
      if (prior) { if (reviewPlanDigest(prior) !== digest) throw new LocalApiError(409, "分段审查计划已变化，未覆盖已保存资料。"); return; }
      if (!this.unit(runId, "artifacts")?.value_json) throw new LocalApiError(409, "正文汇总尚未保存，未建立分段审查计划。");
      for (const artifact of artifacts) {
        const stored = this.unit(runId, artifact.id)?.value_json;
        if (!stored || stored !== JSON.stringify(artifact)) throw new LocalApiError(409, "正文与检查点不一致，未建立分段审查计划。");
      }
      this.db.prepare("INSERT INTO studio_review_plans(run_id, plan_hash, plan_json) VALUES (?, ?, ?)").run(runId, digest, JSON.stringify(plan));
      this.bump(runId);
    });
  }
  private unit(runId: string, unitId: string) {
    this.definition(runId, unitId);
    return this.db.prepare("SELECT * FROM studio_production_units WHERE run_id = ? AND unit_id = ?").get(runId, unitId) as Unit | undefined;
  }
  find(runKey: string) {
    hash.parse(runKey);
    const run = this.db.prepare("SELECT id FROM studio_production_runs WHERE run_key = ?").get(runKey) as { id: string } | undefined;
    return run ? this.snapshot(run.id) : null;
  }
  read(runId: string, unitId: string, requestHash: string): unknown {
    hash.parse(requestHash);
    const row = this.unit(runId, unitId);
    if (row && row.request_hash !== requestHash) throw new LocalApiError(409, "该阶段的冻结资料已变化，不能混用原检查点。请修改蓝图后重新建立批次。");
    return row?.value_json ? JSON.parse(row.value_json) : undefined;
  }
  begin(runId: string, unitId: string, jobId: string, requestHash: string) {
    hash.parse(requestHash);
    this.transaction(() => {
      this.owner(runId, jobId);
      const prior = this.unit(runId, unitId);
      if (prior?.value_json || prior?.job_id === jobId) throw new LocalApiError(409, "阶段已保存或已发起，本任务不能重复调用。");
      if (prior && prior.request_hash !== requestHash) throw new LocalApiError(409, "阶段输入已变化，不能覆盖原检查点。");
      const definition = this.definition(runId, unitId);
      for (const dependency of definition.dependencies) if (!this.unit(runId, dependency)?.value_json) throw new LocalApiError(409, "前置阶段尚未保存，未继续调用。");
      this.db.prepare(`INSERT INTO studio_production_units(run_id, unit_id, request_hash, job_id) VALUES (?, ?, ?, ?)
        ON CONFLICT(run_id, unit_id) DO UPDATE SET job_id = excluded.job_id, call_id = NULL`).run(runId, unitId, requestHash, jobId);
      this.db.prepare("INSERT INTO studio_production_attempts(run_id, unit_id, job_id) VALUES (?, ?, ?)").run(runId, unitId, jobId);
      this.bump(runId);
    });
  }
  private bump(runId: string) { this.db.prepare("UPDATE studio_production_runs SET revision = revision + 1 WHERE id = ?").run(runId); }
  attachCall(runId: string, unitId: string, jobId: string, callId: string) {
    z.uuid().parse(callId);
    this.transaction(() => {
      this.owner(runId, jobId);
      const changed = this.db.prepare("UPDATE studio_production_units SET call_id = ? WHERE run_id = ? AND unit_id = ? AND job_id = ? AND call_id IS NULL AND value_json IS NULL").run(callId, runId, unitId, jobId);
      if (changed.changes !== 1) throw new LocalApiError(409, "阶段费用登记已变化，未重复发送请求。");
      this.db.prepare("UPDATE studio_production_attempts SET call_id = ? WHERE run_id = ? AND unit_id = ? AND job_id = ?").run(callId, runId, unitId, jobId);
    });
  }
  save(runId: string, unitId: string, jobId: string, requestHash: string, value: unknown) {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > 2_000_000) throw new LocalApiError(413, "阶段成果超过保存容量，未继续调用。已有成果保留。");
    this.transaction(() => {
      this.owner(runId, jobId);
      const changed = this.db.prepare("UPDATE studio_production_units SET value_json = ? WHERE run_id = ? AND unit_id = ? AND job_id = ? AND request_hash = ? AND value_json IS NULL").run(serialized, runId, unitId, jobId, requestHash);
      if (changed.changes !== 1) throw new LocalApiError(409, "阶段成果已保存或执行权已变化，未覆盖现有结果。");
      this.bump(runId);
    });
  }
  reject(runId: string, unitId: string, jobId: string, value: unknown, issues: string[]) {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > 2_000_000) throw new LocalApiError(413, "阶段响应超过保存容量，未继续调用。");
    z.array(z.string()).max(2000).parse(issues);
    this.transaction(() => {
      this.owner(runId, jobId);
      const unit = this.unit(runId, unitId);
      if (unit?.job_id !== jobId || unit.value_json !== null) throw new LocalApiError(409, "阶段记录已变化，未覆盖已有成果。");
      this.db.prepare("UPDATE studio_production_attempts SET response_json = ?, issues_json = ? WHERE run_id = ? AND unit_id = ? AND job_id = ?").run(serialized, JSON.stringify(issues), runId, unitId, jobId);
      this.bump(runId);
    });
  }
  snapshot(runId: string) {
    const run = this.db.prepare("SELECT id, revision, active_job_id FROM studio_production_runs WHERE id = ?").get(runId) as Run | undefined;
    if (!run) throw new LocalApiError(409, "正文检查点不存在，未自动重试。");
    const units = this.db.prepare("SELECT * FROM studio_production_units WHERE run_id = ?").all(runId) as Unit[];
    return { runId, revision: run.revision, plan: this.plan(runId), reviewPlan: this.reviewPlan(runId), units: units.map(unit => {
      const rejected = this.db.prepare("SELECT response_json, issues_json FROM studio_production_attempts WHERE run_id = ? AND unit_id = ? AND job_id = ?").get(runId, unit.unit_id, unit.job_id) as { response_json: string | null; issues_json: string | null } | undefined;
      const value = unit.value_json ?? rejected?.response_json;
      return { id: unit.unit_id, requestHash: unit.request_hash, jobId: unit.job_id, saved: unit.value_json !== null, callId: unit.call_id, value: value ? JSON.parse(value) as unknown : undefined, issues: rejected?.issues_json ? z.array(z.string()).parse(JSON.parse(rejected.issues_json)) : [] };
    }) };
  }
}
