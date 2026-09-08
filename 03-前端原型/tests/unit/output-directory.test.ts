import { describe, expect, it } from "vitest";
import { MockProjectService } from "@/services/mock-project-service";
import { ServiceError, type OutputDirectoryPort, type StoragePort } from "@/services/contracts";
import { outputPath, outputSettingsInputSchema, type PickedOutputDirectory } from "@/domain/output-settings";
class Memory implements StoragePort {
  raw: string | null = null;
  fail = false;
  writes = 0;
  read() { return this.raw; }
  write(value: string) { if (this.fail) throw new ServiceError("STORAGE_UNAVAILABLE", "保存失败"); this.raw = value; this.writes += 1; }
  exclusive<T>(operation: () => Promise<T>) { return operation(); }
}
class Directories implements OutputDirectoryPort {
  selected: PickedOutputDirectory | null = { id: "d8a9c64e-e70b-447f-8498-6846c0f3e571", name: "剧本输出" };
  fail = false;
  records = new Map<string, { name: string; kind: "directory" }>();
  async pick() { if (this.selected) this.records.set(this.selected.id, { name: this.selected.name, kind: "directory" }); return this.selected; }
  async get(id: string) { if (this.fail) throw new ServiceError("STORAGE_UNAVAILABLE", "引用不可读"); return this.records.get(id) ?? null; }
}
async function setup() {
  const storage = new Memory(); const directories = new Directories(); let id = 0;
  const service = new MockProjectService(storage, undefined, () => String(++id), directories);
  const project = await service.create({ title: "目录选择", note: "", template: "blank" });
  return { service, storage, directories, project };
}

describe("输出目录引用", () => {
  it("新建副本和初始输出位置只写入一次，原始样例保持不变", async () => {
    const { service, storage } = await setup();
    const baseline = await service.get("demo-names");
    const directory = await service.pickOutputDirectory();
    const writes = storage.writes;
    const copy = await service.create({ title: "我的样例改写", note: "已选目录", template: "names-beyond" }, { rootPath: "", directory, stage: "blueprint", folder: "故事设计" });
    expect(storage.writes).toBe(writes + 1);
    expect(copy.readOnly).toBe(false);
    expect(copy.outputSettings.directory).toEqual(directory);
    expect(copy.outputSettings.folders.blueprint).toBe("故事设计");
    expect((await service.get(copy.id)).outputSettings).toEqual(copy.outputSettings);
    expect(await service.get("demo-names")).toEqual(baseline);
  });
  it("初始目录无效、引用缺失或写入失败时不留下空副本，重试只保存一个", async () => {
    const { service, storage, directories } = await setup();
    const input = { title: "样例副本", note: "", template: "names-beyond" as const };
    const directory = await service.pickOutputDirectory();
    const output = { rootPath: "", directory, stage: "analysis" as const, folder: "拆解" };
    const before = storage.raw;
    await expect(service.create(input, { ...output, rootPath: "../非法路径" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.create(input, { ...output, directory: { ...directory!, name: "伪造" } })).rejects.toMatchObject({ code: "DIRECTORY_UNAVAILABLE" });
    directories.records.clear();
    await expect(service.create(input, output)).rejects.toMatchObject({ code: "DIRECTORY_UNAVAILABLE" });
    await service.pickOutputDirectory(); storage.fail = true;
    await expect(service.create(input, output)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(storage.raw).toBe(before);
    storage.fail = false;
    await service.create(input, output);
    expect(JSON.parse(storage.raw!).projects).toHaveLength(JSON.parse(before!).projects.length + 1);
  });
  it("选择不修改项目，保存引用并刷新恢复，显示所选文件夹而不伪造绝对路径", async () => {
    const { service, storage, directories, project } = await setup(); const before = storage.raw;
    const directory = await service.pickOutputDirectory(); expect(storage.raw).toBe(before);
    const saved = await service.saveOutputSettings(project.id, 0, { rootPath: "", directory, stage: "analysis", folder: "拆解结果" });
    expect(saved.outputSettings.directory).toEqual(directory);
    expect(outputPath(saved.outputSettings, "analysis")).toBe("所选文件夹「剧本输出」/拆解结果");
    const reloaded = await new MockProjectService(storage, undefined, undefined, directories).get(project.id);
    expect(reloaded.outputSettings).toEqual(saved.outputSettings);
    const manual = await service.saveOutputSettings(project.id, saved.revision, { rootPath: "/tmp/手动输出", directory: null, stage: "analysis", folder: "拆解结果" });
    expect(manual.outputSettings.directory).toBeNull(); expect(outputPath(manual.outputSettings, "analysis")).toBe("/tmp/手动输出/拆解结果");
  });
  it("取消、缺失或伪造引用、引用存储不可读均保留项目", async () => {
    const { service, storage, directories, project } = await setup(); const before = storage.raw;
    const directory = directories.selected!;
    directories.selected = null; expect(await service.pickOutputDirectory()).toBeNull();
    const input = { rootPath: "", directory, stage: "analysis" as const, folder: "拆解" };
    await expect(service.saveOutputSettings(project.id, 0, input)).rejects.toMatchObject({ code: "DIRECTORY_UNAVAILABLE" });
    directories.selected = directory; await service.pickOutputDirectory();
    await expect(service.saveOutputSettings(project.id, 0, { ...input, directory: { ...directory, name: "伪造目录" } })).rejects.toMatchObject({ code: "DIRECTORY_UNAVAILABLE" });
    directories.fail = true;
    await expect(service.saveOutputSettings(project.id, 0, input)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(storage.raw).toBe(before);
  });
  it("同名目录用不同引用标识，保存失败/过期/只读不覆盖旧记录", async () => {
    const { service, storage, directories, project } = await setup();
    const first = await service.pickOutputDirectory();
    const saved = await service.saveOutputSettings(project.id, 0, { rootPath: "", directory: first, stage: "analysis", folder: "拆解" });
    directories.selected = { ...first!, id: "3b379398-0287-489e-bbf3-8e06d8fb740b" };
    const second = await service.pickOutputDirectory(); expect(second?.name).toBe(first?.name); expect(second?.id).not.toBe(first?.id);
    const input = { rootPath: "", directory: second, stage: "analysis" as const, folder: "新拆解" }; const before = storage.raw;
    await expect(service.saveOutputSettings(project.id, 0, input)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.saveOutputSettings("demo-names", 0, input)).rejects.toMatchObject({ code: "READ_ONLY" });
    storage.fail = true;
    await expect(service.saveOutputSettings(project.id, saved.revision, input)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(storage.raw).toBe(before); storage.fail = false;
    const next = await service.saveOutputSettings(project.id, saved.revision, input); expect(next.outputSettings.directory?.id).toBe(second?.id);
  });
  it("手动路径与目录引用互斥，旧路径不要求新增引用字段", () => {
    const input = { rootPath: "/tmp/输出", stage: "analysis", folder: "拆解" };
    expect(outputSettingsInputSchema.safeParse(input).success).toBe(true);
    expect(outputSettingsInputSchema.safeParse({ ...input, directory: new Directories().selected }).success).toBe(false);
  });
});
