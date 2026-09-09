import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { mkdtemp, mkdir, open, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let root: string;
let directories: typeof import("../../src/server/local-directories");
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "juben-local-directory-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  directories = await import("../../src/server/local-directories");
  vi.restoreAllMocks();
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
test("原生选取结果保存opaque引用，返回值不含绝对路径且记录权限受限", async () => {
  const output = join(root, "自己创建的输出文件夹"); await mkdir(output);
  const selected = await directories.registerChosenDirectory(output);
  expect(selected).toMatchObject({ name: "自己创建的输出文件夹", kind: "directory" });
  expect(JSON.stringify(selected)).not.toContain(root);
  expect(await directories.getLocalDirectory(selected.id)).toEqual({ name: selected.name, kind: "directory" });
  expect(await directories.registerChosenDirectory(output)).toEqual(selected);
  const record = JSON.parse(await readFile(join(root, "runtime-data/directories.json"), "utf8"));
  expect(record).toHaveLength(1);
  expect((await stat(join(root, "runtime-data"))).mode & 0o777).toBe(0o700);
  expect((await stat(join(root, "runtime-data/directories.json"))).mode & 0o777).toBe(0o600);
});
test("写入仅使用已选ID和安全新文件名，不能越界、覆盖、写入同名软链", async () => {
  const output = join(root, "安全写入"); await mkdir(output);
  const selected = await directories.registerChosenDirectory(output);
  const bytes = new Uint8Array([0x50, 0x4b, 3, 4]);
  expect(await directories.writeSelectedZip(selected.id, "新包.zip", bytes)).toEqual({ written: true, name: "安全写入", filename: "新包.zip" });
  expect(await readFile(join(output, "新包.zip"))).toEqual(Buffer.from(bytes));
  await expect(directories.writeSelectedZip(selected.id, "新包.zip", new Uint8Array([1]))).rejects.toThrow("没有覆盖");
  await expect(directories.writeSelectedZip(selected.id, "../越界.zip", bytes)).rejects.toThrow("文件名无效");
  await expect(directories.writeSelectedZip(output, "任意路径.zip", bytes)).rejects.toThrow("编号无效");
  await expect(directories.writeSelectedZip("00000000-0000-4000-8000-000000000000", "不存在.zip", bytes)).rejects.toThrow("未找到");
  await symlink(join(output, "新包.zip"), join(output, "软链.zip"));
  await expect(directories.writeSelectedZip(selected.id, "软链.zip", bytes)).rejects.toThrow("没有覆盖");
  expect(await readFile(join(output, "新包.zip"))).toEqual(Buffer.from(bytes));
});
test("独占创建后写入失败会清理自身残包，允许安全重试", async () => {
  const output = join(root, "失败清理"); await mkdir(output);
  const selected = await directories.registerChosenDirectory(output);
  const probe = await open(join(output, "probe"), "wx");
  const prototype = Object.getPrototypeOf(probe) as typeof probe;
  const original = prototype.writeFile;
  await probe.close();
  const spy = vi.spyOn(prototype, "writeFile").mockImplementationOnce(async function (this: typeof probe) {
    await original.call(this, Buffer.from("partial"));
    throw new Error("synthetic disk failure");
  });
  try {
    await expect(directories.writeSelectedZip(selected.id, "重试.zip", new Uint8Array([1]))).rejects.toThrow("无法写入");
    await expect(stat(join(output, "重试.zip"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { spy.mockRestore(); }
  await expect(directories.writeSelectedZip(selected.id, "重试.zip", new Uint8Array([2]))).resolves.toMatchObject({ written: true });
  expect(await readFile(join(output, "重试.zip"))).toEqual(Buffer.from([2]));
});
test("选择父目录后新建成果子目录，登记和导出均指向新目录", async () => {
  const parent = join(root, "成果父目录"); await mkdir(parent);
  const selected = await directories.createChosenOutputDirectory(parent);
  expect(selected.name).toBe("剧本工作台成果");
  expect(await directories.getLocalDirectory(selected.id)).toEqual({ name: selected.name, kind: "directory" });
  expect((await stat(join(parent, selected.name))).mode & 0o777).toBe(0o700);
  await directories.writeSelectedZip(selected.id, "完整档案.zip", new Uint8Array([1, 2]));
  expect(await readFile(join(parent, selected.name, "完整档案.zip"))).toEqual(Buffer.from([1, 2]));
  expect(await readdir(parent)).toEqual([selected.name]);
});
test("同名目录、文件与软链都跳过，已有内容保持不变", async () => {
  const parent = join(root, "防重名父目录"); await mkdir(parent);
  await mkdir(join(parent, "剧本工作台成果"));
  await writeFile(join(parent, "剧本工作台成果", "原件.txt"), "原件");
  await writeFile(join(parent, "剧本工作台成果（2）"), "已有文件");
  await symlink(join(parent, "剧本工作台成果"), join(parent, "剧本工作台成果（3）"));
  const selected = await directories.createChosenOutputDirectory(parent);
  expect(selected.name).toBe("剧本工作台成果（4）");
  expect(await readFile(join(parent, "剧本工作台成果", "原件.txt"), "utf8")).toBe("原件");
  const second = await directories.createChosenOutputDirectory(parent);
  expect(second.name).toBe("剧本工作台成果（5）");
  expect(second.id).not.toBe(selected.id);
});
test("取消不新建；登记失败清理本次空目录并保留旧目录记录", async () => {
  const parent = join(root, "失败父目录"); await mkdir(parent);
  await expect(directories.createChosenOutputDirectory(parent, AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
  expect(await readdir(parent)).toEqual([]);
  const registryPath = join(root, "runtime-data/directories.json");
  const before = await readFile(registryPath, "utf8");
  try {
    await writeFile(registryPath, "损坏的记录");
    await expect(directories.createChosenOutputDirectory(parent)).rejects.toThrow("原记录未覆盖");
    expect(await readdir(parent)).toEqual([]);
    expect(await readFile(registryPath, "utf8")).toBe("损坏的记录");
  } finally { await writeFile(registryPath, before); }
});
