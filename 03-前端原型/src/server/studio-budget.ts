import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { moneyFenSchema, projectBudgetIdSchema, studioBudgetClaimSchema, studioBudgetSchema, studioChargeSchema, studioQuoteSchema, type StudioBudgetClaim, type StudioQuote } from "@/domain/studio-budget";
import { assertFreshQuote } from "./studio-pricing";
import { LocalApiError } from "./local-security";

type BudgetRow = { project_id: string; revision: number; ledger_revision: number; cap_fen: number };
type CallRow = {
  call_id: string; project_id: string; job_id: string; model: string; phase: string; state: string; reserved_fen: number;
  actual_fen: number | null; prompt_tokens: number | null; completion_tokens: number | null; version: number;
  created_at: number; updated_at: number; quote_json: string; owner_pid: number; lease_until: number; reason: string; note: string;
};
const validId = z.string().uuid();
const safeInteger = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const unavailable = () => new LocalApiError(409, "项目尚未设置创作预算，请先填写本项目的累计额度。");

/** Durable ledger: no TTL, no reset endpoint, and no access to source text or API keys. */
export class StudioBudgetLedger {
  private db: DatabaseSync;
  private owned: boolean;
  constructor(file: string | DatabaseSync = resolve(process.cwd(), "runtime-data/studio-jobs.sqlite"), private now = Date.now, private alive = (pid: number) => {
    try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
  }) {
    this.owned = typeof file === "string";
    if (typeof file === "string") {
      if (file !== ":memory:") {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        const folder = lstatSync(dirname(file));
        if (!folder.isDirectory() || folder.isSymbolicLink()) throw new LocalApiError(503, "创作预算目录不安全，未发起调用。");
        chmodSync(dirname(file), 0o700);
        if (existsSync(file)) { const target = lstatSync(file); if (!target.isFile() || target.isSymbolicLink() || (target.mode & 0o077)) throw new LocalApiError(503, "创作预算文件不安全，未发起调用。"); }
      }
      this.db = new DatabaseSync(file); if (file !== ":memory:") chmodSync(file, 0o600);
    } else this.db = file;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS studio_budgets (
        project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, ledger_revision INTEGER NOT NULL, cap_fen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_budget_jobs (
        job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_budget_previews (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision INTEGER NOT NULL, fingerprint TEXT NOT NULL,
        config_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, used_job_id TEXT
      );
      CREATE TABLE IF NOT EXISTS studio_charges (
        call_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL, model TEXT NOT NULL, phase TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('prepared','dispatched','settled','uncertain','reconciled','released')),
        reserved_fen INTEGER NOT NULL, actual_fen INTEGER, prompt_tokens INTEGER, completion_tokens INTEGER,
        version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, quote_json TEXT NOT NULL,
        request_hash TEXT NOT NULL, owner_pid INTEGER NOT NULL, lease_until INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS studio_charge_project ON studio_charges(project_id, created_at);
      CREATE INDEX IF NOT EXISTS studio_charge_job ON studio_charges(job_id);`);
  }
  close() { if (this.owned) this.db.close(); }
  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = action(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private bump(projectId: string) { this.db.prepare("UPDATE studio_budgets SET ledger_revision = ledger_revision + 1 WHERE project_id = ?").run(projectId); }
  private recover() {
    const rows = this.db.prepare("SELECT call_id, project_id, state, owner_pid, lease_until FROM studio_charges WHERE state IN ('prepared','dispatched')").all() as CallRow[];
    for (const row of rows) {
      if (row.lease_until > this.now() && this.alive(row.owner_pid)) continue;
      this.db.prepare("UPDATE studio_charges SET state = ?, reason = ?, updated_at = ?, version = version + 1 WHERE call_id = ? AND state = ? AND lease_until = ?").run(
        row.state === "prepared" ? "released" : "uncertain", row.state === "prepared" ? "NOT_DISPATCHED" : "EXECUTION_INTERRUPTED", this.now(), row.call_id, row.state, row.lease_until,
      );
      this.bump(row.project_id);
    }
  }
  private budget(projectId: string) { return this.db.prepare("SELECT * FROM studio_budgets WHERE project_id = ?").get(projectId) as BudgetRow | undefined; }
  private totals(projectId: string) {
    const value = this.db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN state IN ('settled','reconciled') THEN actual_fen ELSE 0 END), 0) AS spentFen,
      COALESCE(SUM(CASE WHEN state IN ('prepared','dispatched') THEN reserved_fen ELSE 0 END), 0) AS reservedFen,
      COALESCE(SUM(CASE WHEN state = 'uncertain' THEN MAX(reserved_fen, COALESCE(actual_fen, 0)) ELSE 0 END), 0) AS uncertainFen,
      COUNT(*) AS totalCalls, SUM(CASE WHEN state = 'uncertain' THEN 1 ELSE 0 END) AS uncertainCalls
      FROM studio_charges WHERE project_id = ?`).get(projectId) as { spentFen: number; reservedFen: number; uncertainFen: number; totalCalls: number; uncertainCalls: number };
    for (const amount of [value.spentFen, value.reservedFen, value.uncertainFen]) safeInteger.parse(amount);
    return value;
  }
  snapshot(projectId: string, offset = 0) {
    projectBudgetIdSchema.parse(projectId); safeInteger.parse(offset);
    return this.transaction(() => { this.recover(); return this.view(projectId, offset); });
  }
  private view(projectId: string, offset = 0) {
    const budget = this.budget(projectId); if (!budget) return null;
    const { spentFen, reservedFen, uncertainFen, totalCalls, uncertainCalls } = this.totals(projectId);
    const used = spentFen + reservedFen + uncertainFen;
    const rows = this.db.prepare("SELECT * FROM studio_charges WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100 OFFSET ?").all(projectId, offset) as CallRow[];
    const calls = rows.map(row => studioChargeSchema.parse({
      callId: row.call_id, jobId: row.job_id, model: row.model, phase: row.phase, state: row.state,
      reservedFen: row.reserved_fen, actualFen: row.actual_fen, version: row.version,
      promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens, createdAt: row.created_at, updatedAt: row.updated_at,
      quote: JSON.parse(row.quote_json), reason: row.reason, note: row.note,
    }));
    return studioBudgetSchema.parse({ projectId, revision: budget.revision, ledgerRevision: budget.ledger_revision, capFen: budget.cap_fen,
      spentFen, reservedFen, uncertainFen, remainingFen: Math.max(0, budget.cap_fen - used), overrunFen: Math.max(0, used - budget.cap_fen), totalCalls, uncertainCalls: uncertainCalls ?? 0, offset, calls });
  }
  configure(projectId: string, capFen: number, expectedRevision: number) {
    projectBudgetIdSchema.parse(projectId); moneyFenSchema.parse(capFen); safeInteger.parse(expectedRevision);
    return this.transaction(() => {
      this.recover(); const prior = this.budget(projectId);
      if ((prior?.revision ?? 0) !== expectedRevision) throw new LocalApiError(409, "预算已由另一个页面修改，输入已保留，请读取最新额度后再保存。");
      const total = this.totals(projectId);
      if (capFen < total.spentFen + total.reservedFen + total.uncertainFen) throw new LocalApiError(409, "新额度不能低于已核算、预留和待核对金额之和。");
      this.db.prepare(`INSERT INTO studio_budgets(project_id, revision, ledger_revision, cap_fen) VALUES (?, 1, 1, ?)
        ON CONFLICT(project_id) DO UPDATE SET cap_fen = excluded.cap_fen, revision = revision + 1, ledger_revision = ledger_revision + 1`).run(projectId, capFen);
      return this.view(projectId)!;
    });
  }
  /** Called only inside StudioJobStore.claim's transaction, sharing its database connection. */
  admitInTransaction(claim: StudioBudgetClaim, jobId: string, fingerprint: string, configHash?: string) {
    if (!this.db.isTransaction) throw new Error("Budget admission requires the job transaction");
    studioBudgetClaimSchema.parse(claim); validId.parse(jobId); hash.parse(fingerprint); this.recover();
    if (this.db.prepare("SELECT job_id FROM studio_budget_jobs WHERE job_id = ?").get(jobId)) throw new LocalApiError(409, "任务编号已使用，不能因历史结果过期而再次收费。请查询已有记录或手动建立新任务。");
    const budget = this.budget(claim.projectId); if (!budget) throw unavailable();
    if (budget.revision !== claim.revision) throw new LocalApiError(409, "项目预算已变化，请核对最新额度后重新开始。");
    this.assertAvailable(claim.projectId, 0);
    if (configHash !== undefined || claim.previewId !== undefined) {
      hash.parse(configHash);
      const preview = this.db.prepare("SELECT * FROM studio_budget_previews WHERE id = ?").get(claim.previewId ?? "") as { project_id: string; revision: number; fingerprint: string; config_hash: string; expires_at: number; used_job_id: string | null } | undefined;
      if (!preview || preview.project_id !== claim.projectId || preview.revision !== claim.revision || preview.fingerprint !== fingerprint
        || preview.config_hash !== configHash || preview.expires_at <= this.now() || preview.used_job_id) throw new LocalApiError(409, "费用预览已过期、被使用，或模型/资料已变化，请重新预览后开始。");
      this.db.prepare("UPDATE studio_budget_previews SET used_job_id = ? WHERE id = ?").run(jobId, claim.previewId!);
    }
    this.db.prepare("INSERT INTO studio_budget_jobs(job_id, project_id, fingerprint, created_at) VALUES (?, ?, ?, ?)").run(jobId, claim.projectId, fingerprint, this.now());
  }
  preparePreview(projectId: string, revision: number, fingerprint: string, configHash: string) {
    projectBudgetIdSchema.parse(projectId); safeInteger.parse(revision); hash.parse(fingerprint); hash.parse(configHash);
    return this.transaction(() => {
      this.recover(); this.assertAvailable(projectId, 0);
      if (this.budget(projectId)?.revision !== revision) throw new LocalApiError(409, "预算已变化，请重新预览。");
      this.db.prepare("DELETE FROM studio_budget_previews WHERE expires_at <= ?").run(this.now());
      const id = randomUUID();
      this.db.prepare("INSERT INTO studio_budget_previews(id, project_id, revision, fingerprint, config_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, projectId, revision, fingerprint, configHash, this.now() + 600_000);
      return id;
    });
  }
  private assertAvailable(projectId: string, amount: number) {
    const budget = this.budget(projectId); if (!budget) throw unavailable();
    const total = this.totals(projectId);
    if (total.uncertainCalls) throw new LocalApiError(409, "项目有待核对的模型费用，请核对账单后再开始新的调用。提高额度或重试不会清除它。");
    if (total.spentFen + total.reservedFen + total.uncertainFen + amount > budget.cap_fen) throw new LocalApiError(409, "项目剩余额度不足以预留本次调用，已停止；已完成成果和费用记录保留。");
  }
  reserve(jobId: string, phase: string, quote: StudioQuote, requestHash: string, reservedFen: number) {
    validId.parse(jobId); z.string().max(1000).parse(phase); hash.parse(requestHash); safeInteger.parse(reservedFen); studioQuoteSchema.parse(quote);
    return this.transaction(() => {
      this.recover(); assertFreshQuote(quote, quote.baseUrl, quote.modelId, this.now());
      const job = this.db.prepare("SELECT project_id FROM studio_budget_jobs WHERE job_id = ?").get(jobId) as { project_id: string } | undefined;
      if (!job) throw new LocalApiError(409, "任务缺少预算登记，未发起付费调用。");
      this.assertAvailable(job.project_id, reservedFen);
      const callId = randomUUID(), now = this.now();
      this.db.prepare(`INSERT INTO studio_charges(call_id, project_id, job_id, model, phase, state, reserved_fen, version, created_at, updated_at, quote_json, request_hash, owner_pid, lease_until)
        VALUES (?, ?, ?, ?, ?, 'prepared', ?, 1, ?, ?, ?, ?, ?, ?)`).run(callId, job.project_id, jobId, quote.modelId, phase, reservedFen, now, now, JSON.stringify(quote), requestHash, process.pid, now + 300_000);
      this.bump(job.project_id); return callId;
    });
  }
  private call(callId: string) {
    validId.parse(callId);
    const row = this.db.prepare("SELECT * FROM studio_charges WHERE call_id = ?").get(callId) as CallRow | undefined;
    if (!row) throw new LocalApiError(409, "费用记录不存在，未发起新的调用。");
    return row;
  }
  dispatch(callId: string) {
    this.transaction(() => {
      this.recover(); const row = this.call(callId);
      if (row.state !== "prepared" || row.owner_pid !== process.pid) throw new LocalApiError(409, "调用已发送或执行权已失效，不重复发送。");
      const quote = studioQuoteSchema.parse(JSON.parse(row.quote_json)); assertFreshQuote(quote, quote.baseUrl, row.model, this.now());
      // An independent request may have become uncertain since this reservation.
      this.assertAvailable(row.project_id, 0);
      this.db.prepare("UPDATE studio_charges SET state = 'dispatched', updated_at = ?, version = version + 1 WHERE call_id = ?").run(this.now(), callId);
      this.bump(row.project_id);
    });
  }
  settle(callId: string, actualFen: number, promptTokens: number, completionTokens: number) {
    [actualFen, promptTokens, completionTokens].forEach(value => safeInteger.parse(value));
    return this.transaction(() => {
      const row = this.call(callId);
      // A late provider result cannot overwrite an explicit manual reconciliation.
      if (["settled", "reconciled"].includes(row.state)) return row.actual_fen === actualFen;
      if (row.state === "uncertain" && row.actual_fen !== null) return false;
      if (!["dispatched", "uncertain"].includes(row.state)) throw new LocalApiError(409, "调用未发送，不能记录为已收费。");
      const overrun = actualFen > row.reserved_fen;
      this.db.prepare(`UPDATE studio_charges SET state = ?, actual_fen = ?, prompt_tokens = ?, completion_tokens = ?,
        reason = ?, updated_at = ?, version = version + 1 WHERE call_id = ?`).run(overrun ? "uncertain" : "settled", actualFen, promptTokens, completionTokens, overrun ? "USAGE_EXCEEDS_RESERVATION" : "", this.now(), callId);
      this.bump(row.project_id); return !overrun;
    });
  }
  interrupt(callId: string, reason = "USAGE_UNKNOWN") {
    z.string().regex(/^[A-Z_]{1,100}$/).parse(reason);
    return this.transaction(() => {
      const row = this.call(callId);
      if (!["prepared", "dispatched"].includes(row.state)) return;
      this.db.prepare("UPDATE studio_charges SET state = ?, reason = ?, updated_at = ?, version = version + 1 WHERE call_id = ?").run(row.state === "prepared" ? "released" : "uncertain", row.state === "prepared" ? "NOT_DISPATCHED" : reason, this.now(), callId);
      this.bump(row.project_id);
    });
  }
  reconcile(projectId: string, callId: string, version: number, actualFen: number, note: string) {
    projectBudgetIdSchema.parse(projectId); safeInteger.parse(version); safeInteger.parse(actualFen); const normalized = z.string().trim().min(1).max(500).parse(note);
    return this.transaction(() => {
      this.recover(); const row = this.call(callId);
      if (row.project_id !== projectId || row.state !== "uncertain" || row.version !== version) throw new LocalApiError(409, "费用记录已变化，请重新核对；没有覆盖现有金额。");
      this.db.prepare("UPDATE studio_charges SET state = 'reconciled', actual_fen = ?, note = ?, updated_at = ?, version = version + 1 WHERE call_id = ?").run(actualFen, normalized, this.now(), callId);
      this.bump(projectId); return this.view(projectId)!;
    });
  }
}
