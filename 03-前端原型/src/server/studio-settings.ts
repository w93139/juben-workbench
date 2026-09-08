import { chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LocalApiError } from "./local-security";
import type { StudioConfig } from "./studio-models";

const MAX_FILE_BYTES = 16384;
const model = z.string().trim().min(1).max(200).refine(value => !/[\x00-\x20\x7f]/.test(value), "模型编号不能包含空格或控制字符");
const base = z.string().trim().min(1).max(2048).transform(value => value.replace(/\/+$/, "")).refine(value => {
  try { const url = new URL(value); return !url.username && !url.password && !url.search && !url.hash && (url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)); } catch { return false; }
}, "请填写HTTPS服务地址，本机服务可使用回环HTTP地址；不要在地址中填写密钥");
const secret = z.string().trim().min(1).max(4096).refine(value => !/[\x00-\x20\x7f]/.test(value), "密钥格式无效");
export const studioSettingsConfigSchema = z.object({ baseUrl: base, apiKey: secret, mainModel: model, reviewA: model, reviewB: model }).strict().refine(value => new Set([value.mainModel, value.reviewA, value.reviewB]).size === 3, "主模型和两路审查模型必须使用三个不同的模型编号");
const fileSchema = z.object({ version: z.literal(1), revision: z.number().int().positive(), config: studioSettingsConfigSchema }).strict();
const inputSchema = z.object({ baseUrl: base, apiKey: z.string().max(4096).default(""), mainModel: model, reviewA: model, reviewB: model, revision: z.number().int().nonnegative() }).strict();
export interface SafeStudioSettings { baseUrl: string; mainModel: string; reviewA: string; reviewB: string; hasApiKey: boolean; configured: boolean; source: "environment" | "local" | "none"; revision: number; environmentLocked: boolean }
const keys = ["STUDIO_API_BASE_URL", "STUDIO_API_KEY", "STUDIO_MAIN_MODEL", "STUDIO_REVIEW_A_MODEL", "STUDIO_REVIEW_B_MODEL"] as const;
function environmentPresent(env: Record<string, string | undefined>) { return keys.some(key => !!env[key]?.trim()); }
function fromEnvironment(env: Record<string, string | undefined>) { return { baseUrl: env.STUDIO_API_BASE_URL, apiKey: env.STUDIO_API_KEY, mainModel: env.STUDIO_MAIN_MODEL, reviewA: env.STUDIO_REVIEW_A_MODEL, reviewB: env.STUDIO_REVIEW_B_MODEL }; }
const storageError = () => new LocalApiError(503, "本机模型配置无法安全读取或保存，原配置已保留。请检查本机权限。");
export class StudioSettingsStore {
  private file: string;
  constructor(private root = resolve(process.cwd(), "runtime-data")) { this.file = join(root, "studio-settings.json"); }
  private read() {
    let fd: number | undefined;
    try {
      const root = lstatSync(this.root); if (!root.isDirectory() || root.isSymbolicLink()) throw storageError();
      fd = openSync(this.file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = fstatSync(fd); if (!info.isFile() || info.size > MAX_FILE_BYTES || (process.platform !== "win32" && (info.mode & 0o077) !== 0)) throw storageError();
      return fileSchema.parse(JSON.parse(readFileSync(fd, "utf8")));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw storageError(); }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  config(env: Record<string, string | undefined> = process.env): StudioConfig | null {
    if (environmentPresent(env)) {
      const parsed = studioSettingsConfigSchema.safeParse(fromEnvironment(env));
      if (!parsed.success) throw new LocalApiError(503, "服务端环境变量中的模型配置不完整或无效，请检查后重试。");
      return parsed.data;
    }
    return this.read()?.config ?? null;
  }
  safe(env: Record<string, string | undefined> = process.env): SafeStudioSettings {
    if (environmentPresent(env)) {
      const parsed = studioSettingsConfigSchema.safeParse(fromEnvironment(env));
      return parsed.success ? { baseUrl: parsed.data.baseUrl, mainModel: parsed.data.mainModel, reviewA: parsed.data.reviewA, reviewB: parsed.data.reviewB, hasApiKey: true, configured: true, source: "environment", revision: 0, environmentLocked: true } : { baseUrl: "", mainModel: "", reviewA: "", reviewB: "", hasApiKey: false, configured: false, source: "environment", revision: 0, environmentLocked: true };
    }
    const stored = this.read();
    return stored ? { baseUrl: stored.config.baseUrl, mainModel: stored.config.mainModel, reviewA: stored.config.reviewA, reviewB: stored.config.reviewB, hasApiKey: true, configured: true, source: "local", revision: stored.revision, environmentLocked: false } : { baseUrl: "", mainModel: "", reviewA: "", reviewB: "", hasApiKey: false, configured: false, source: "none", revision: 0, environmentLocked: false };
  }
  save(input: unknown, env: Record<string, string | undefined> = process.env): SafeStudioSettings {
    if (environmentPresent(env)) throw new LocalApiError(409, "当前连接由服务端环境变量管理，请先调整环境变量；页面不会覆盖它。");
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new LocalApiError(400, parsed.error.issues[0]?.message || "模型配置格式不正确。");
    const previous = this.read();
    if (parsed.data.revision !== (previous?.revision ?? 0)) throw new LocalApiError(409, "模型配置已在其他页面更新，请关闭并重新打开配置窗口后再保存。");
    if (!parsed.data.apiKey.trim() && previous?.config.baseUrl !== parsed.data.baseUrl) throw new LocalApiError(400, "新服务地址需要重新填写密钥，不会把旧密钥发送到其他服务。");
    const validated = studioSettingsConfigSchema.safeParse({ baseUrl: parsed.data.baseUrl, apiKey: parsed.data.apiKey.trim() || previous?.config.apiKey, mainModel: parsed.data.mainModel, reviewA: parsed.data.reviewA, reviewB: parsed.data.reviewB });
    if (!validated.success) throw new LocalApiError(400, validated.error.issues[0]?.message || "请完整填写连接信息。");
    const serialized = JSON.stringify({ version: 1, revision: (previous?.revision ?? 0) + 1, config: validated.data });
    if (Buffer.byteLength(serialized, "utf8") > MAX_FILE_BYTES) throw new LocalApiError(413, "连接配置过长，原配置保持不变。请缩短服务地址或模型编号后重试。");
    const temporary = join(this.root, `studio-settings.${randomUUID()}.tmp`);
    try {
      mkdirSync(this.root, { recursive: true, mode: 0o700 });
      const root = lstatSync(this.root); if (!root.isDirectory() || root.isSymbolicLink()) throw storageError();
      chmodSync(this.root, 0o700);
      writeFileSync(temporary, serialized, { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.file);
    } catch { throw storageError(); }
    finally { try { unlinkSync(temporary); } catch { /* successful rename leaves no temporary file */ } }
    return this.safe(env);
  }
}
export const studioSettingsStore = new StudioSettingsStore();
