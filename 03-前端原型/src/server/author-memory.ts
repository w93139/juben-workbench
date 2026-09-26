import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { LocalApiError } from "./local-security";
import { AUTHOR_MEMORY_ITEM_LIMIT, authorMemoryItemSchema, authorMemoryWriteSchema, renderAuthorMemory, supportsAuthorMemory, type AuthorMemoryBlock, type AuthorMemoryItem, type AuthorMemoryWrite } from "@/domain/author-memory";

type Row = { id: string; type: string; text: string; note: string; enabled: number; confidence: number; created_at: number; updated_at: number; last_used_at: number | null; use_count: number };

const USAGE_RETENTION = 30 * 24 * 60 * 60 * 1000;
const PROJECT_ID_MAX = 200;
const OPERATION_MAX = 100;

/** 引擎只依赖这个窄接口：默认不注入任何记忆，测试与旧行为完全一致。 */
export interface AuthorMemoryReader {
  render(operation: string, projectId: string, maxChars: number): AuthorMemoryBlock;
  record?(ids: string[], projectId: string, operation: string): void;
}
export const NO_AUTHOR_MEMORY: AuthorMemoryReader = { render: () => ({ text: "", ids: [] }) };

/** 本机受限 SQLite；只存偏好文本与来源备注，不存密钥或原剧本。 */
export class AuthorMemoryStore {
  private db: DatabaseSync;
  constructor(file = resolve(process.cwd(), "runtime-data/author-memory.sqlite"), private now = Date.now) {
    if (file !== ":memory:") {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const folder = lstatSync(dirname(file));
      if (!folder.isDirectory() || folder.isSymbolicLink()) throw new LocalApiError(503, "作者记忆目录不安全，未读取或保存记忆。");
      chmodSync(dirname(file), 0o700);
      if (existsSync(file)) { const item = lstatSync(file); if (!item.isFile() || item.isSymbolicLink() || (item.mode & 0o077)) throw new LocalApiError(503, "作者记忆文件不安全，未读取或保存记忆。"); }
    }
    this.db = new DatabaseSync(file); if (file !== ":memory:") chmodSync(file, 0o600);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS author_memory_items (id TEXT PRIMARY KEY, type TEXT NOT NULL, text TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, confidence INTEGER NOT NULL DEFAULT 100, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_used_at INTEGER, use_count INTEGER NOT NULL DEFAULT 0)");
    this.db.exec("CREATE TABLE IF NOT EXISTS author_memory_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL DEFAULT '', operation TEXT NOT NULL, memory_ids TEXT NOT NULL, created_at INTEGER NOT NULL)");
  }
  close() { this.db.close(); }
  private item(row: Row): AuthorMemoryItem {
    return authorMemoryItemSchema.parse({ id: row.id, type: row.type, text: row.text, note: row.note, enabled: row.enabled === 1, confidence: row.confidence, createdAt: row.created_at, updatedAt: row.updated_at, lastUsedAt: row.last_used_at, useCount: row.use_count });
  }
  private find(id: string): AuthorMemoryItem {
    const row = this.db.prepare("SELECT * FROM author_memory_items WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new LocalApiError(404, "要操作的作品记忆不存在，可能已在其他页面删除。");
    return this.item(row);
  }
  list(): AuthorMemoryItem[] {
    return (this.db.prepare("SELECT * FROM author_memory_items ORDER BY created_at ASC, id ASC").all() as Row[]).map((row) => this.item(row));
  }
  save(input: unknown): AuthorMemoryItem {
    const parsed = authorMemoryWriteSchema.safeParse(input);
    if (!parsed.success) throw new LocalApiError(400, parsed.error.issues[0]?.message || "作者记忆格式不正确。");
    const value: AuthorMemoryWrite = parsed.data;
    const now = this.now();
    const id = value.id ?? randomUUID();
    if (value.id) {
      const result = this.db.prepare("UPDATE author_memory_items SET type = ?, text = ?, note = ?, enabled = ?, confidence = ?, updated_at = ? WHERE id = ?").run(value.type, value.text, value.note, value.enabled ? 1 : 0, value.confidence, now, id);
      if (result.changes !== 1) throw new LocalApiError(404, "要修改的作者记忆不存在，可能已在其他页面删除。");
    } else {
      const count = this.db.prepare("SELECT COUNT(*) AS count FROM author_memory_items").get() as { count: number };
      if (count.count >= AUTHOR_MEMORY_ITEM_LIMIT) throw new LocalApiError(409, `作者记忆最多保留${AUTHOR_MEMORY_ITEM_LIMIT}条，请先整理或删除不再需要的条目。`);
      this.db.prepare("INSERT INTO author_memory_items(id, type, text, note, enabled, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, value.type, value.text, value.note, value.enabled ? 1 : 0, value.confidence, now, now);
    }
    return this.find(id);
  }
  setEnabled(id: unknown, enabled: unknown): AuthorMemoryItem {
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || typeof enabled !== "boolean") throw new LocalApiError(400, "作者记忆开关参数不正确。");
    const result = this.db.prepare("UPDATE author_memory_items SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, this.now(), id);
    if (result.changes !== 1) throw new LocalApiError(404, "要切换的作者记忆不存在，可能已在其他页面删除。");
    return this.find(id);
  }
  remove(id: unknown): string {
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new LocalApiError(400, "作者记忆编号不正确。");
    const result = this.db.prepare("DELETE FROM author_memory_items WHERE id = ?").run(id);
    if (result.changes !== 1) throw new LocalApiError(404, "要删除的作者记忆不存在，可能已在其他页面删除。");
    return id;
  }
  render(operation: string, projectId: string, maxChars: number): AuthorMemoryBlock {
    if (!supportsAuthorMemory(operation) || maxChars <= 0) return { text: "", ids: [] };
    return renderAuthorMemory(this.list(), maxChars);
  }
  record(ids: string[], projectId: string, operation: string) {
    if (!ids.length) return;
    const now = this.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const update = this.db.prepare("UPDATE author_memory_items SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?");
      for (const id of ids) update.run(now, id);
      this.db.prepare("INSERT INTO author_memory_usage(project_id, operation, memory_ids, created_at) VALUES (?, ?, ?, ?)").run(projectId.slice(0, PROJECT_ID_MAX), operation.slice(0, OPERATION_MAX), JSON.stringify(ids), now);
      this.db.prepare("DELETE FROM author_memory_usage WHERE created_at < ?").run(now - USAGE_RETENTION);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

let instance: AuthorMemoryStore | undefined;
export function getAuthorMemoryStore() { return instance ??= new AuthorMemoryStore(); }
/** 惰性代理：模块被导入时不会创建运行目录或数据库文件。 */
export const authorMemoryStore: AuthorMemoryReader = {
  render: (operation, projectId, maxChars) => getAuthorMemoryStore().render(operation, projectId, maxChars),
  record: (ids, projectId, operation) => getAuthorMemoryStore().record(ids, projectId, operation),
};
