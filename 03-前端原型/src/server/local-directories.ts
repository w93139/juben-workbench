import { execFile } from "node:child_process";
import { access, chmod, lstat, mkdir, open, readFile, realpath, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalApiError } from "./local-security";

export const runtimeRoot = resolve(process.cwd(), "runtime-data");
const registryFile = join(runtimeRoot, "directories.json");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Directory = { id: string; name: string; path: string };
let writeQueue = Promise.resolve();
export async function ensureRuntimeRoot() { await mkdir(runtimeRoot, { recursive: true, mode: 0o700 }); await chmod(runtimeRoot, 0o700); }
export async function hasNativeDirectoryPicker(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try { await access("/usr/bin/osascript"); return true; } catch { return false; }
}
export function runLocalTool(command: string, args: string[], options: { timeout?: number; maxBuffer?: number; signal?: AbortSignal } = {}): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile(command, args, { timeout: options.timeout ?? 60000, maxBuffer: options.maxBuffer ?? 2 * 1024 * 1024, signal: options.signal, encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
      if (error) { Object.assign(error, { toolStderr: stderr }); reject(error); } else resolveOutput(stdout);
    });
  });
}
async function readRegistry(): Promise<Directory[]> {
  try {
    const value: unknown = JSON.parse(await readFile(registryFile, "utf8"));
    if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || !uuid.test(item.id) || typeof item.name !== "string" || typeof item.path !== "string")) throw new Error();
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new LocalApiError(500, "本机目录记录无法读取，原记录未覆盖。");
  }
}
/** Internal-only registration; no HTTP endpoint accepts a filesystem path. */
export async function registerChosenDirectory(path: string): Promise<{ id: string; name: string; kind: "directory" }> {
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory()) throw new LocalApiError(400, "所选位置不是文件夹。");
  const name = basename(canonical) || "磁盘根目录";
  let result: { id: string; name: string; kind: "directory" } | undefined;
  const operation = writeQueue.then(async () => {
    await ensureRuntimeRoot();
    const records = await readRegistry();
    const previous = records.find((record) => record.path === canonical);
    const record = previous ?? { id: randomUUID(), name, path: canonical };
    if (!previous) {
      if (records.length >= 1000) throw new LocalApiError(409, "本机目录记录已达上限，请先整理旧记录。");
      const temp = `${registryFile}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify([...records, record]), { mode: 0o600, flag: "wx" });
      await rename(temp, registryFile);
    }
    result = { id: record.id, name: record.name, kind: "directory" };
  });
  writeQueue = operation.catch(() => undefined); await operation; return result!;
}
async function selectedDirectory(id: unknown): Promise<Directory> {
  if (typeof id !== "string" || !uuid.test(id)) throw new LocalApiError(400, "文件夹编号无效，请重新选择。");
  const record = (await readRegistry()).find((item) => item.id === id);
  if (!record) throw new LocalApiError(404, "本机未找到这个已选文件夹，请重新选择。");
  try { if (!(await stat(record.path)).isDirectory() || await realpath(record.path) !== record.path) throw new Error(); }
  catch { throw new LocalApiError(404, "原文件夹已移动、移除或无法访问，请重新选择。"); }
  return record;
}
export async function getLocalDirectory(id: unknown) { const directory = await selectedDirectory(id); return { name: directory.name, kind: "directory" as const }; }
/** Creates a fresh child in the chosen parent. Existing folders/files are never reused. */
export async function createChosenOutputDirectory(parentPath: string, signal?: AbortSignal) {
  const parent = await realpath(parentPath);
  if (!(await stat(parent)).isDirectory()) throw new LocalApiError(400, "所选位置不是文件夹。");
  for (let suffix = 1; suffix <= 1000; suffix += 1) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const name = suffix === 1 ? "剧本工作台成果" : `剧本工作台成果（${suffix}）`;
    const target = join(parent, name);
    try { await mkdir(target, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw new LocalApiError(503, "无法在所选文件夹中新建成果文件夹，请检查写入权限和可用空间。原输出设置已保留。");
    }
    const created = await lstat(target);
    try {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return await registerChosenDirectory(target);
    } catch (error) {
      // Remove only our still-empty directory; never delete user files added meanwhile.
      try {
        const current = await lstat(target);
        if (current.isDirectory() && current.dev === created.dev && current.ino === created.ino) await rmdir(target);
      } catch { /* A changed or nonempty folder must be preserved. */ }
      throw error;
    }
  }
  throw new LocalApiError(409, "成果文件夹重名过多，请选择其他位置。原输出设置已保留。");
}
export async function chooseLocalDirectory(signal?: AbortSignal) {
  if (!await hasNativeDirectoryPicker()) throw new LocalApiError(501, "当前系统不支持本机文件夹选择。");
  try {
    const answer = await runLocalTool("/usr/bin/osascript", ["-e", 'POSIX path of (choose folder with prompt "选择保存位置，将在其中新建剧本工作台成果文件夹")'], { timeout: 180000, maxBuffer: 16384, signal });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return await createChosenOutputDirectory(answer.trim(), signal);
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (error instanceof Error && /\(-128\)/.test(String((error as Error & { toolStderr?: string }).toolStderr))) return null;
    if (error instanceof LocalApiError) throw error;
    throw new LocalApiError(503, "系统文件夹窗口未能完成选择。请检查是否被其他窗口遮挡，或允许本机应用访问文件夹后重试。");
  }
}
export async function revealLocalDirectory(id: unknown) {
  const directory = await selectedDirectory(id);
  if (process.platform !== "darwin") throw new LocalApiError(501, "当前系统暂不支持打开文件夹。");
  await runLocalTool("/usr/bin/open", ["-a", "Finder", directory.path], { timeout: 10000, maxBuffer: 16384 });
  return { opened: true, name: directory.name };
}
/** Writes one server-generated ZIP; exclusive creation never overwrites files. */
export async function writeSelectedZip(id: unknown, filename: string, bytes: Uint8Array) {
  if (!filename || filename.length > 200 || /[\/\\\x00-\x1f\x7f]/.test(filename) || filename === ".." || !filename.endsWith(".zip")) throw new LocalApiError(400, "导出文件名无效。");
  if (bytes.length > 64 * 1024 * 1024) throw new LocalApiError(413, "导出包超过本机写入大小限制。");
  const directory = await selectedDirectory(id);
  const target = join(directory.path, filename);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let created: { dev: number; ino: number } | undefined;
  try {
    handle = await open(target, "wx", 0o600);
    created = await handle.stat();
    await handle.writeFile(bytes);
    await handle.close(); handle = undefined;
  }
  catch (error) {
    if (handle) { await handle.close().catch(() => undefined); handle = undefined; }
    // Never unlink a pre-existing file, symlink or a file replaced by another
    // process. Only remove the inode opened exclusively by this failed write.
    if (created) {
      try { const current = await lstat(target); if (current.dev === created.dev && current.ino === created.ino && current.isFile()) await unlink(target); }
      catch { /* Cleanup cannot safely proceed after an external filesystem change. */ }
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new LocalApiError(409, "同名文件已存在，请更换导出名称；已有文件没有覆盖。");
    throw new LocalApiError(503, "无法写入所选文件夹，请检查访问权限和可用空间。");
  }
  return { written: true, filename, name: directory.name };
}
