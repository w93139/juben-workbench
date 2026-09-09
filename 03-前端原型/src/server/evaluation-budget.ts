import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LocalApiError } from "./local-security";

export interface BudgetSnapshot { capFen: number; spentFen: number; reservedFen: number; uncertainFen: number }
type Row = { cap_fen: number; spent_fen: number; reserved_fen: number; uncertain_fen: number };
const CAP_FEN = 1000;

export class EvaluationBudgetLedger {
  private db: DatabaseSync;
  constructor(file = resolve(process.cwd(), "runtime-data/model-evaluation.sqlite")) {
    const memory = file === ":memory:";
    if (!memory) {
      const folder = dirname(file); mkdirSync(folder, { recursive: true, mode: 0o700 }); const root = lstatSync(folder);
      if (!root.isDirectory() || root.isSymbolicLink()) throw new LocalApiError(503, "模型预算目录不安全，未发起付费调用。"); chmodSync(folder, 0o700);
      if (existsSync(file)) { const target = lstatSync(file); if (!target.isFile() || target.isSymbolicLink() || (process.platform !== "win32" && (target.mode & 0o077) !== 0)) throw new LocalApiError(503, "模型预算文件不安全，未发起付费调用。"); }
    }
    this.db = new DatabaseSync(file); if (!memory) chmodSync(file, 0o600);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS evaluation_budget (session_id TEXT PRIMARY KEY, cap_fen INTEGER NOT NULL, spent_fen INTEGER NOT NULL DEFAULT 0, reserved_fen INTEGER NOT NULL DEFAULT 0, uncertain_fen INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS evaluation_reservation (call_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, max_fen INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('reserved','settled','uncertain')), actual_fen INTEGER, FOREIGN KEY(session_id) REFERENCES evaluation_budget(session_id)); CREATE TABLE IF NOT EXISTS evaluation_result (session_id TEXT PRIMARY KEY, view_json TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS evaluation_run (session_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('running','completed','blocked','cancelled')), lease_until INTEGER NOT NULL);");
  }
  close() { this.db.close(); }
  saveView(sessionId: string, serialized: string) {
    if (Buffer.byteLength(serialized, "utf8") > 200_000) throw new LocalApiError(413, "模型测评记录过大，未能安全保存。");
    this.db.prepare("INSERT INTO evaluation_result(session_id, view_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET view_json = excluded.view_json, updated_at = excluded.updated_at").run(sessionId, serialized, Date.now());
  }
  loadView(sessionId: string) { return (this.db.prepare("SELECT view_json FROM evaluation_result WHERE session_id = ?").get(sessionId) as { view_json: string } | undefined)?.view_json ?? null; }
  claimRun(sessionId: string, ownerId: string, leaseMs: number) {
    const now = Date.now(); this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT OR IGNORE INTO evaluation_budget(session_id, cap_fen) VALUES (?, ?)").run(sessionId, CAP_FEN);
      const current = this.db.prepare("SELECT owner_id, state, lease_until FROM evaluation_run WHERE session_id = ?").get(sessionId) as { owner_id: string; state: string; lease_until: number } | undefined;
      if (current?.state === "running" && current.lease_until > now && current.owner_id !== ownerId) throw new LocalApiError(409, "另一工作台进程正在执行这轮测评，未重复发起调用。");
      const recovered = current?.state === "running" && current.owner_id !== ownerId;
      this.db.prepare("INSERT INTO evaluation_run(session_id, owner_id, state, lease_until) VALUES (?, ?, 'running', ?) ON CONFLICT(session_id) DO UPDATE SET owner_id = excluded.owner_id, state = 'running', lease_until = excluded.lease_until").run(sessionId, ownerId, now + leaseMs);
      this.db.exec("COMMIT"); return recovered;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  claimResume(sessionId: string, ownerId: string, leaseMs: number, expectedViewRevision: number, expectedResumeCount = 0) {
    const now = Date.now(); this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare("SELECT view_json FROM evaluation_result WHERE session_id = ?").get(sessionId) as { view_json: string } | undefined;
      let view: { status?: unknown; resumeCount?: unknown; resumeAllowed?: unknown; viewRevision?: unknown };
      try { view = JSON.parse(result?.view_json ?? "null"); } catch { throw new LocalApiError(409, "测评记录无法核对，未继续付费调用。"); }
      if (!view || view.status !== "blocked" || (view.resumeCount ?? 0) !== expectedResumeCount || (view.resumeAllowed ?? true) !== true || (view.viewRevision ?? 0) !== expectedViewRevision) throw new LocalApiError(409, "测评状态已由其他进程更新，未重复续测。");
      const current = this.db.prepare("SELECT owner_id, state, lease_until FROM evaluation_run WHERE session_id = ?").get(sessionId) as { owner_id: string; state: string; lease_until: number } | undefined;
      if (current?.state === "running" && current.lease_until > now) throw new LocalApiError(409, "另一工作台进程正在执行这轮测评，未重复发起调用。");
      this.db.prepare("INSERT INTO evaluation_run(session_id, owner_id, state, lease_until) VALUES (?, ?, 'running', ?) ON CONFLICT(session_id) DO UPDATE SET owner_id = excluded.owner_id, state = 'running', lease_until = excluded.lease_until").run(sessionId, ownerId, now + leaseMs);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  claimRecovery(sessionId: string, ownerId: string, leaseMs: number, expectedViewRevision: number) {
    const now = Date.now(); this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare("SELECT view_json FROM evaluation_result WHERE session_id = ?").get(sessionId) as { view_json: string } | undefined;
      let view: { status?: unknown; viewRevision?: unknown };
      try { view = JSON.parse(result?.view_json ?? "null"); } catch { throw new LocalApiError(409, "测评恢复记录无法核对。"); }
      if (!view || !["running", "cancelling"].includes(String(view.status)) || (view.viewRevision ?? 0) !== expectedViewRevision) throw new LocalApiError(409, "测评状态已由其他进程更新，不使用旧状态恢复。");
      const current = this.db.prepare("SELECT owner_id, state, lease_until FROM evaluation_run WHERE session_id = ?").get(sessionId) as { owner_id: string; state: string; lease_until: number } | undefined;
      if (current?.state === "running" && current.lease_until > now && current.owner_id !== ownerId) throw new LocalApiError(409, "另一工作台进程仍在执行测评。");
      this.db.prepare("INSERT INTO evaluation_run(session_id, owner_id, state, lease_until) VALUES (?, ?, 'running', ?) ON CONFLICT(session_id) DO UPDATE SET owner_id = excluded.owner_id, state = 'running', lease_until = excluded.lease_until").run(sessionId, ownerId, now + leaseMs);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  heartbeatRun(sessionId: string, ownerId: string, leaseMs: number) {
    const result = this.db.prepare("UPDATE evaluation_run SET lease_until = ? WHERE session_id = ? AND owner_id = ? AND state = 'running'").run(Date.now() + leaseMs, sessionId, ownerId);
    if (result.changes !== 1) throw new LocalApiError(409, "本轮测评执行权已失效，未发起新的调用。");
  }
  releaseRun(sessionId: string, ownerId: string, state: "completed" | "blocked" | "cancelled") {
    this.db.prepare("UPDATE evaluation_run SET state = ?, lease_until = 0 WHERE session_id = ? AND owner_id = ? AND state = 'running'").run(state, sessionId, ownerId);
  }
  snapshot(sessionId: string): BudgetSnapshot {
    const row = this.db.prepare("SELECT cap_fen, spent_fen, reserved_fen, uncertain_fen FROM evaluation_budget WHERE session_id = ?").get(sessionId) as Row | undefined;
    return row ? { capFen: row.cap_fen, spentFen: row.spent_fen, reservedFen: row.reserved_fen, uncertainFen: row.uncertain_fen } : { capFen: CAP_FEN, spentFen: 0, reservedFen: 0, uncertainFen: 0 };
  }
  reserve(sessionId: string, callId: string, maxFen: number): BudgetSnapshot {
    if (!Number.isSafeInteger(maxFen) || maxFen <= 0) throw new LocalApiError(400, "单次测评预算无效。");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT OR IGNORE INTO evaluation_budget(session_id, cap_fen) VALUES (?, ?)").run(sessionId, CAP_FEN);
      const existing = this.db.prepare("SELECT state FROM evaluation_reservation WHERE call_id = ?").get(callId) as { state: string } | undefined;
      if (existing) throw new LocalApiError(409, "测评调用编号已使用，未重复付费请求。");
      const row = this.snapshot(sessionId);
      if (row.spentFen + row.reservedFen + row.uncertainFen + maxFen > row.capFen) throw new LocalApiError(409, "本轮测评已触及工作台10元估算限额，未发起新的模型调用。");
      this.db.prepare("INSERT INTO evaluation_reservation(call_id, session_id, max_fen, state) VALUES (?, ?, ?, 'reserved')").run(callId, sessionId, maxFen);
      this.db.prepare("UPDATE evaluation_budget SET reserved_fen = reserved_fen + ? WHERE session_id = ?").run(maxFen, sessionId);
      this.db.exec("COMMIT"); return this.snapshot(sessionId);
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  settle(callId: string, actualFen: number): BudgetSnapshot {
    if (!Number.isSafeInteger(actualFen) || actualFen < 0) throw new LocalApiError(400, "模型实际费用无效。");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const reservation = this.db.prepare("SELECT session_id, max_fen, state FROM evaluation_reservation WHERE call_id = ?").get(callId) as { session_id: string; max_fen: number; state: string } | undefined;
      if (!reservation || reservation.state !== "reserved") throw new LocalApiError(409, "测评预算记录不存在或已经结算。");
      if (actualFen > reservation.max_fen) throw new LocalApiError(409, "实际用量超过预留上限，已停止后续测评并等待核对账单。");
      this.db.prepare("UPDATE evaluation_reservation SET state = 'settled', actual_fen = ? WHERE call_id = ?").run(actualFen, callId);
      this.db.prepare("UPDATE evaluation_budget SET reserved_fen = reserved_fen - ?, spent_fen = spent_fen + ? WHERE session_id = ?").run(reservation.max_fen, actualFen, reservation.session_id);
      this.db.exec("COMMIT"); return this.snapshot(reservation.session_id);
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  settleAndSaveView(sessionId: string, callId: string, actualFen: number, serialize: (budget: BudgetSnapshot) => string): { budget: BudgetSnapshot; serialized: string } {
    if (!Number.isSafeInteger(actualFen) || actualFen < 0) throw new LocalApiError(400, "模型实际费用无效。");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const reservation = this.db.prepare("SELECT session_id, max_fen, state FROM evaluation_reservation WHERE call_id = ?").get(callId) as { session_id: string; max_fen: number; state: string } | undefined;
      if (!reservation || reservation.session_id !== sessionId || reservation.state !== "reserved") throw new LocalApiError(409, "测评预算记录不存在或已经结算。");
      if (actualFen > reservation.max_fen) throw new LocalApiError(409, "实际用量超过预留上限，已停止后续测评并等待核对账单。");
      this.db.prepare("UPDATE evaluation_reservation SET state = 'settled', actual_fen = ? WHERE call_id = ?").run(actualFen, callId);
      this.db.prepare("UPDATE evaluation_budget SET reserved_fen = reserved_fen - ?, spent_fen = spent_fen + ? WHERE session_id = ?").run(reservation.max_fen, actualFen, sessionId);
      const budget = this.snapshot(sessionId); const serialized = serialize(budget);
      if (Buffer.byteLength(serialized, "utf8") > 200_000) throw new LocalApiError(413, "模型测评记录过大，未能安全保存。");
      this.db.prepare("INSERT INTO evaluation_result(session_id, view_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET view_json = excluded.view_json, updated_at = excluded.updated_at").run(sessionId, serialized, Date.now());
      this.db.exec("COMMIT"); return { budget, serialized };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  markUncertain(callId: string, knownMinimumFen?: number): BudgetSnapshot {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const reservation = this.db.prepare("SELECT session_id, max_fen, state FROM evaluation_reservation WHERE call_id = ?").get(callId) as { session_id: string; max_fen: number; state: string } | undefined;
      if (!reservation || reservation.state !== "reserved") throw new LocalApiError(409, "测评预算记录不存在或已经处理。");
      const uncertainFen = Math.max(reservation.max_fen, Number.isSafeInteger(knownMinimumFen) && knownMinimumFen! >= 0 ? knownMinimumFen! : 0);
      this.db.prepare("UPDATE evaluation_reservation SET state = 'uncertain', actual_fen = ? WHERE call_id = ?").run(uncertainFen, callId);
      this.db.prepare("UPDATE evaluation_budget SET reserved_fen = reserved_fen - ?, uncertain_fen = uncertain_fen + ? WHERE session_id = ?").run(reservation.max_fen, uncertainFen, reservation.session_id);
      this.db.exec("COMMIT"); return this.snapshot(reservation.session_id);
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  recoverPending(sessionId: string, ownerId?: string): BudgetSnapshot {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (ownerId) {
        const run = this.db.prepare("SELECT owner_id, state FROM evaluation_run WHERE session_id = ?").get(sessionId) as { owner_id: string; state: string } | undefined;
        if (!run || run.owner_id !== ownerId || run.state !== "running") throw new LocalApiError(409, "没有取得陈旧测评的恢复权，未改动在途费用。");
      }
      const pending = this.db.prepare("SELECT COALESCE(SUM(max_fen), 0) AS total FROM evaluation_reservation WHERE session_id = ? AND state = 'reserved'").get(sessionId) as { total: number };
      if (pending.total) {
        this.db.prepare("UPDATE evaluation_reservation SET state = 'uncertain' WHERE session_id = ? AND state = 'reserved'").run(sessionId);
        this.db.prepare("UPDATE evaluation_budget SET reserved_fen = reserved_fen - ?, uncertain_fen = uncertain_fen + ? WHERE session_id = ?").run(pending.total, pending.total, sessionId);
      }
      this.db.exec("COMMIT"); return this.snapshot(sessionId);
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
