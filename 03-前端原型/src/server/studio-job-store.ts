import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { studioJobViewSchema, type StudioJobView } from "@/domain/studio";
import { LocalApiError } from "./local-security";

// Only validated results and request hashes are retained: never credentials or input files.
const RETENTION = 7 * 24 * 60 * 60 * 1000;
const LEASE = 5 * 60 * 1000;
type Row = { fingerprint: string; view_json: string; owner_pid: number; lease_until: number };
export class StudioJobStore {
  private db: DatabaseSync;
  constructor(file = resolve(process.cwd(), "runtime-data/studio-jobs.sqlite"), private now = Date.now) {
    if (file !== ":memory:") {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const folder = lstatSync(dirname(file));
      if (!folder.isDirectory() || folder.isSymbolicLink()) throw new LocalApiError(503, "创作任务目录不安全，未发起模型调用。");
      chmodSync(dirname(file), 0o700);
      if (existsSync(file)) { const item = lstatSync(file); if (!item.isFile() || item.isSymbolicLink() || (item.mode & 0o077)) throw new LocalApiError(503, "创作任务文件不安全，未发起模型调用。"); }
    }
    this.db = new DatabaseSync(file); if (file !== ":memory:") chmodSync(file, 0o600);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS studio_jobs (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, view_json TEXT NOT NULL, status TEXT NOT NULL, owner_pid INTEGER NOT NULL, lease_until INTEGER NOT NULL, expires_at INTEGER NOT NULL, validation_id TEXT UNIQUE)");
  }
  close() { this.db.close(); }
  private recover() {
    const now = this.now();
    const rows = this.db.prepare("SELECT id, owner_pid, lease_until FROM studio_jobs WHERE status = 'running'").all() as { id: string; owner_pid: number; lease_until: number }[];
    for (const row of rows) {
      let alive = true;
      try { process.kill(row.owner_pid, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== "ESRCH"; }
      if (alive && row.lease_until > now) continue;
      const view: StudioJobView = { jobId: row.id, status: "failed", phase: "上次处理已中断", error: { code: "JOB_INTERRUPTED", message: "上次处理因服务重启或超时而中断，材料已保留。没有自动重试；重新拆解可能产生新的模型费用。" } };
      this.db.prepare("UPDATE studio_jobs SET view_json = ?, status = 'failed', expires_at = ? WHERE id = ? AND status = 'running'").run(JSON.stringify(view), now + RETENTION, row.id);
    }
    this.db.prepare("DELETE FROM studio_jobs WHERE status != 'running' AND expires_at < ?").run(now);
  }
  read(id: string): { fingerprint: string; view: StudioJobView } | null {
    this.recover();
    const row = this.db.prepare("SELECT fingerprint, view_json FROM studio_jobs WHERE id = ?").get(id) as Row | undefined;
    return row ? { fingerprint: row.fingerprint, view: studioJobViewSchema.parse(JSON.parse(row.view_json)) } : null;
  }
  claim(view: StudioJobView, fingerprint: string): { created: boolean; fingerprint: string; view: StudioJobView } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.read(view.jobId);
      if (prior) { this.db.exec("COMMIT"); return { ...prior, created: false }; }
      const count = this.db.prepare("SELECT COUNT(*) AS count FROM studio_jobs WHERE status = 'running'").get() as { count: number };
      if (count.count >= 2) throw new LocalApiError(429, "当前已有两个创作任务，请等待完成后再试。");
      this.db.prepare("INSERT INTO studio_jobs(id, fingerprint, view_json, status, owner_pid, lease_until, expires_at) VALUES (?, ?, ?, 'running', ?, ?, ?)").run(view.jobId, fingerprint, JSON.stringify(studioJobViewSchema.parse(view)), process.pid, this.now() + LEASE, this.now() + RETENTION);
      this.db.exec("COMMIT"); return { created: true, fingerprint, view };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  save(view: StudioJobView) {
    const valid = studioJobViewSchema.parse(view);
    const validation = valid.result?.kind === "review" && valid.result.passed ? valid.result.validationId ?? null : null;
    const result = this.db.prepare("UPDATE studio_jobs SET view_json = ?, status = ?, lease_until = ?, expires_at = ?, validation_id = ? WHERE id = ? AND status = 'running' AND owner_pid = ?").run(JSON.stringify(valid), valid.status, this.now() + LEASE, this.now() + RETENTION, validation, valid.jobId, process.pid);
    if (result.changes !== 1) throw new LocalApiError(409, "任务已结束或中断，不再继续调用模型。");
  }
  validated(id: string) {
    this.recover();
    const row = this.db.prepare("SELECT view_json FROM studio_jobs WHERE validation_id = ? AND status = 'completed'").get(id) as { view_json: string } | undefined;
    if (!row) return null;
    const view = studioJobViewSchema.parse(JSON.parse(row.view_json));
    return view.result?.kind === "review" && view.result.passed ? view.result : null;
  }
}
