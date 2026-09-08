import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { mkdtemp, mkdir, open, readFile, rm, stat, symlink } from "node:fs/promises";
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
