import { describe, expect, it } from "vitest";
import { LocalProjectService } from "@/services/local-project-service";
import { ServiceError, type StoragePort } from "@/services/contracts";
import { emptyResearch } from "@/domain/research";
import { emptyBlueprintData } from "@/domain/blueprint";
import { emptyProduction } from "@/domain/production";
import { defaultOutputSettings } from "@/domain/output-settings";

class Memory implements StoragePort {
  raw: string | null = null;
  fail = false;
  private queue: Promise<unknown> = Promise.resolve();
  read() { return this.raw; }
  write(value: string) { if (this.fail) throw new ServiceError("STORAGE_UNAVAILABLE", "存储已满"); this.raw = value; }
  exclusive<T>(operation: () => Promise<T>) {
    const pending = this.queue.then(operation, operation);
    this.queue = pending.catch(() => undefined);
    return pending;
  }
}
const time = "2026-09-18T00:00:00.000Z";
const input = { title: "自有迁移测试", note: "保留备注", template: "blank" as const };
function setup() {
  const storage = new Memory(); let id = 0;
  return { storage, service: new LocalProjectService(storage, () => time, () => String(++id)) };
}

describe("真实本机项目服务", () => {
  it("只读样例不写存储，副本/空白项目与返回值相互隔离，重建后恢复", async () => {
    const { service, storage } = setup();
    const baseline = await service.get("demo-names");
    await expect(service.update(baseline.id, 0, { title: "改名", note: "" })).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(storage.raw).toBeNull();
    const copy = await service.create({ ...input, template: "names-beyond" });
    const blank = await service.create(input);
    expect(copy.decisions).toEqual(baseline.decisions);
    baseline.decisions[0].title = "不能污染样例";
    copy.note = "不能绕过保存";
    const restored = new LocalProjectService(storage);
    expect((await restored.get(copy.id)).note).toBe(input.note);
    expect((await restored.get(baseline.id)).decisions[0].title).not.toBe(baseline.decisions[0].title);
    expect((await restored.get(blank.id)).blueprint).toBeNull();
    expect(await restored.list()).toHaveLength(3);
  });
  it("两个页面并行提交只接受一个版本，失败不改变已保存值", async () => {
    const { service, storage } = setup(); const p = await service.create(input);
    const other = new LocalProjectService(storage);
    const results = await Promise.allSettled([
      service.update(p.id, 0, { title: "先保存", note: "A" }),
      other.update(p.id, 0, { title: "后保存", note: "B" }),
    ]);
    expect(results.map(r => r.status)).toEqual(["fulfilled", "rejected"]);
    expect((results[1] as PromiseRejectedResult).reason.code).toBe("CONFLICT");
    expect((await other.get(p.id)).note).toBe("A");
  });
  it.each(["", " ", "字".repeat(41)])("无效标题不写入：%s", async title => {
    const { service, storage } = setup();
    await expect(service.create({ ...input, title })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.raw).toBeNull();
  });
  it.each([
    ["{broken", "STORAGE_CORRUPT"],
    [JSON.stringify({ schemaVersion: 4, projects: [] }), "STORAGE_VERSION"],
    [JSON.stringify({ schemaVersion: 1, projects: [{}] }), "STORAGE_CORRUPT"],
  ])("坏数据或未知版本可备份且不会覆盖：%s", async (raw, code) => {
    const { service, storage } = setup(); storage.raw = raw;
    await expect(service.list()).rejects.toMatchObject({ code });
    await expect(service.create(input)).rejects.toMatchObject({ code });
    expect(await service.getBackup()).toBe(raw);
  });
  it("工作区恢复要求原数据匹配，失败保存保留原始备份", async () => {
    const { service, storage } = setup(); storage.raw = "broken";
    await expect(service.resetLocalProjects("stale")).rejects.toMatchObject({ code: "CONFLICT" });
    storage.fail = true;
    await expect(service.resetLocalProjects("broken")).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(storage.raw).toBe("broken"); storage.fail = false;
    await service.resetLocalProjects("broken");
    expect(await service.list()).toHaveLength(1);
  });
});

describe.each([1, 2, 3])("格式 %i 的既有数据", version => {
  it("读取不落盘，失败修改不升级，成功修改保留历史字段及其他项目", async () => {
    const { service, storage } = setup();
    const p = await service.create(input); const other = await service.create({ ...input, title: "另一个项目" });
    const draft = { ...emptyBlueprintData(), premise: "既有创意", truth: "既有真相" };
    const historical = {
      ...p,
      blueprint: { draft, versions: [{ id: "v1", label: "旧版", createdAt: time, data: draft }], savedAt: time, revision: 1, sourceLabel: "自有旧稿" },
      production: emptyProduction(),
      folderPlan: { sourceRevision: 0, status: "succeeded", progress: 100, selectedChoiceId: "deduction", updatedAt: time, messages: [{ id: "m1", role: "user", text: "保留讨论", createdAt: time, sourceRevision: 0, choiceId: "deduction" }], proposalHistory: [], proposal: draft, plannedPath: "/tmp/原输出" },
      outputSettings: { ...defaultOutputSettings(), rootPath: "/tmp/旧输出" },
      research: { ...emptyResearch(), documents: ["旧\\页.pdf", "旧\n页.pdf"].map((name, index) => ({ id: `old-${index}`, name, size: 100, mime: "application/pdf", origin: "local-metadata", kind: "待分类", audience: "待确认", edition: "待确认", status: "registered", fixtureId: null })) },
    };
    const rawProject: Record<string, unknown> = { ...historical };
    if (version === 1) delete rawProject.research;
    storage.raw = JSON.stringify({ schemaVersion: version, projects: [rawProject, other] });
    const raw = storage.raw;
    const loaded = await service.get(p.id); const loadedOther = await service.get(other.id);
    expect(await service.list()).toHaveLength(3);
    expect(storage.raw).toBe(raw);
    expect(loaded).toEqual({ ...historical, research: version === 1 ? emptyResearch() : historical.research });
    storage.fail = true;
    await expect(service.update(p.id, loaded.revision, { title: "已改名", note: "新备注" })).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(storage.raw).toBe(raw); expect(await service.get(p.id)).toEqual(loaded);
    storage.fail = false;
    const saved = await service.update(p.id, loaded.revision, { title: "已改名", note: "新备注" });
    expect(JSON.parse(storage.raw!).schemaVersion).toBe(3);
    expect(saved).toEqual({ ...loaded, title: "已改名", note: "新备注", revision: loaded.revision + 1, updatedAt: time });
    const restored = new LocalProjectService(storage);
    expect(await restored.get(p.id)).toEqual(saved);
    expect(await restored.get(other.id)).toEqual(loadedOther);
  });
  it("缺省旧字段补默认值，直到保存目录才落盘，其他项目保持独立", async () => {
    const { service, storage } = setup(); const p = await service.create(input); const other = await service.create(input);
    const rawProject: Record<string, unknown> = { ...p };
    for (const key of ["blueprint", "production", "folderPlan", "outputSettings", ...(version === 1 ? ["research"] : [])]) delete rawProject[key];
    storage.raw = JSON.stringify({ schemaVersion: version, projects: [rawProject, other] }); const before = storage.raw;
    const loaded = await service.get(p.id);
    expect(loaded).toMatchObject({ blueprint: null, production: null, folderPlan: null, outputSettings: defaultOutputSettings() });
    expect(storage.raw).toBe(before);
    const output = { rootPath: "/tmp/输出", stage: "analysis" as const, folder: "拆解" };
    storage.fail = true;
    await expect(service.saveOutputSettings(p.id, 0, output)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(storage.raw).toBe(before); storage.fail = false;
    const saved = await service.saveOutputSettings(p.id, 0, output); const written = storage.raw;
    await expect(service.saveOutputSettings(p.id, 0, output)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.saveOutputSettings("demo-names", 0, output)).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(storage.raw).toBe(written);
    const restored = new LocalProjectService(storage);
    expect(await restored.get(p.id)).toEqual(saved);
    expect((await restored.get(other.id)).outputSettings).toEqual(defaultOutputSettings());
  });
});
