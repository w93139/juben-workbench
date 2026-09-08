import { describe, expect, it } from "vitest";
import { MockProjectService } from "@/services/mock-project-service";
import { ServiceError, type SourceImportProgress, type StoragePort } from "@/services/contracts";
import { defaultOutputSettings, outputPath, outputSettingsInputSchema } from "@/domain/output-settings";

class Memory implements StoragePort {
  raw: string | null = null;
  fail = false;
  gate: Promise<void> | null = null;
  read() { return this.raw; }
  write(value: string) { if (this.fail) throw new ServiceError("STORAGE_UNAVAILABLE", "保存失败"); this.raw = value; }
  async exclusive<T>(operation: () => Promise<T>) { if (this.gate) await this.gate; return operation(); }
}
const file = { name: "主持.mp3", mime: "audio/mpeg", size: 50 };
async function setup() {
  const storage = new Memory(); let id = 0;
  const service = new MockProjectService(storage, () => "2026-09-08T03:00:00.000Z", () => String(++id));
  const project = await service.create({ title: "自动导入", note: "", template: "blank" });
  return { storage, service, project };
}

describe("自动导入", () => {
  it("选中批次自动略过无效项，真正保存后才发出100%完成", async () => {
    const { service, storage, project } = await setup(); const before = storage.raw;
    const events: SourceImportProgress[] = [];
    const result = await service.importSourceFiles(project.id, 0, [file, { ...file, name: "空.txt", size: 0 }], { onProgress(event) {
      events.push(event);
      if (event.percent < 100) expect(storage.raw).toBe(before);
      else expect(JSON.parse(storage.raw!).projects[0].research.documents).toHaveLength(1);
    } });
    expect(events.map((event) => event.percent)).toEqual([0, 15, 25, 50, 75, 95, 100]);
    expect(result.added).toBe(1); expect(result.preview.skippedCount).toBe(1);
    const saved = storage.raw;
    const duplicate = await service.importSourceFiles(project.id, result.project.revision, [file]);
    expect(duplicate.added).toBe(0); expect(storage.raw).toBe(saved);
  });
  it("上传中取消不写入，保存排队期间取消也能拦截提交", async () => {
    const { service, storage, project } = await setup(); const before = storage.raw;
    const controller = new AbortController();
    await expect(service.importSourceFiles(project.id, 0, [file], { signal: controller.signal, onProgress(event) { if (event.percent === 25) controller.abort(); } })).rejects.toMatchObject({ code: "CANCELLED" });
    expect(storage.raw).toBe(before);
    const queued = new AbortController(); let release!: () => void;
    await expect(service.importSourceFiles(project.id, 0, [file], { signal: queued.signal, onProgress(event) {
      if (event.phase === "saving") {
        storage.gate = new Promise<void>((resolve) => { release = resolve; });
        queueMicrotask(() => { queued.abort(); release(); });
      }
    } })).rejects.toMatchObject({ code: "CANCELLED" });
    expect(storage.raw).toBe(before);
  });
  it("保存失败不显示100%，重试只写一次；跨页变更被拦截", async () => {
    const { service, storage, project } = await setup(); const before = storage.raw;
    const events: number[] = []; storage.fail = true;
    await expect(service.importSourceFiles(project.id, 0, [file], { onProgress: (event) => events.push(event.percent) })).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(events).not.toContain(100); expect(storage.raw).toBe(before); storage.fail = false;
    const saved = await service.importSourceFiles(project.id, 0, [file]);
    expect(saved.project.research.documents).toHaveLength(1);
    await expect(service.importSourceFiles(project.id, saved.project.revision, [{ ...file, name: "新材料.pdf" }], { onProgress(event) {
      if (event.percent === 25) void service.update(project.id, saved.project.revision, { title: "另一页", note: "保留这条备注" });
    } })).rejects.toMatchObject({ code: "CONFLICT" });
    const latest = await service.get(project.id);
    expect(latest.note).toBe("保留这条备注"); expect(latest.research.documents).toHaveLength(1);
    const retried = await service.importSourceFiles(project.id, latest.revision, [{ ...file, name: "新材料.pdf" }]);
    expect(retried.project.research.documents).toHaveLength(2); expect(retried.project.note).toBe(latest.note);
  }, 10000);
  it("自动入口仍拒绝超大批次和只读项目，不触发提交", async () => {
    const { service, storage, project } = await setup(); const before = storage.raw;
    await expect(service.importSourceFiles(project.id, 0, Array.from({ length: 2001 }, () => file))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.importSourceFiles("demo-names", 0, [file])).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(storage.raw).toBe(before);
  });
});

describe("输出路径", () => {
  it("校验本机完整目录及相对子目录，预览macOS和Windows路径", () => {
    const input = { rootPath: "/Users/作者/Desktop/作品", stage: "analysis", folder: "研究/拆解" };
    expect(outputSettingsInputSchema.safeParse(input).success).toBe(true);
    for (const rootPath of ["相对目录", "/tmp/../参考", "D:作品", "/tmp/坏\n路径"]) expect(outputSettingsInputSchema.safeParse({ ...input, rootPath }).success).toBe(false);
    for (const folder of ["", "/绝对目录", "../上级", "研究/../拆解", "D:\\绝对"]) expect(outputSettingsInputSchema.safeParse({ ...input, folder }).success).toBe(false);
    const settings = defaultOutputSettings();
    expect(outputPath(settings, "analysis")).toBeNull();
    settings.rootPath = "D:\\剧本输出\\"; settings.folders.analysis = "研究/拆解";
    expect(outputPath(settings, "analysis")).toBe("D:\\剧本输出\\研究\\拆解");
    settings.rootPath = "/Users/作者/旧\\目录";
    expect(outputPath(settings, "analysis")).toBe("/Users/作者/旧\\目录/研究/拆解");
  });
  it("旧项目读时不改存储，保存路径后跨Service恢复且项目隔离", async () => {
    const { service, storage, project } = await setup();
    const other = await service.create({ title: "独立项目", note: "", template: "blank" });
    const raw = JSON.parse(storage.raw!); raw.projects.forEach((p: Record<string, unknown>) => { delete p.outputSettings; });
    storage.raw = JSON.stringify(raw); const before = storage.raw;
    expect((await service.get(project.id)).outputSettings.rootPath).toBe(""); expect(storage.raw).toBe(before);
    const saved = await service.saveOutputSettings(project.id, 0, { rootPath: "/Users/作者/剧本输出", stage: "analysis", folder: "参考研究/拆解" });
    expect(saved.research).toEqual(project.research);
    const loaded = await new MockProjectService(storage).get(project.id);
    expect(outputPath(loaded.outputSettings, "analysis")).toBe("/Users/作者/剧本输出/参考研究/拆解");
    expect((await service.get(other.id)).outputSettings.rootPath).toBe("");
    expect(loaded.outputSettings.folders.generation).toBe("05-正文生成");
  });
  it("路径保存失败、过期版本和只读操作不改原数据", async () => {
    const { service, storage, project } = await setup(); const before = storage.raw;
    const input = { rootPath: "/tmp/输出", stage: "analysis" as const, folder: "拆解" };
    storage.fail = true;
    await expect(service.saveOutputSettings(project.id, 0, input)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(storage.raw).toBe(before); storage.fail = false;
    await service.saveOutputSettings(project.id, 0, input); const saved = storage.raw;
    await expect(service.saveOutputSettings(project.id, 0, { ...input, folder: "过期" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.saveOutputSettings("demo-names", 0, input)).rejects.toMatchObject({ code: "READ_ONLY" });
    await expect(service.saveOutputSettings(project.id, 1, { ...input, folder: "../逃逸" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.raw).toBe(saved);
  });
  it("拆解记录启动时路径，后续改路径不移动旧结果，重新开始采用新位置", async () => {
    const { service, storage, project } = await setup();
    let p = await service.addResearchDemo(project.id, 0);
    p = await service.startResearchJob(p.id, p.revision, "ocr");
    for (let i = 0; i < 4; i++) p = await service.advanceResearchJob(p.id, p.research.job!.id);
    for (const issue of p.research.issues) p = await service.resolveOCRIssue(p.id, p.revision, { id: issue.id, status: issue.kind === "missing" ? "retained" : issue.kind === "duplicate" ? "excluded" : "corrected", resolution: issue.suggestion });
    p = await service.confirmMaterialAudit(p.id, p.revision, "范围与缺口已记录");
    p = await service.saveOutputSettings(p.id, p.revision, { rootPath: "/tmp/旧输出", stage: "analysis", folder: "拆解" });
    p = await service.startResearchJob(p.id, p.revision, "analysis");
    expect(p.research.job?.outputLocation).toBe("/tmp/旧输出/拆解");
    p = await service.saveOutputSettings(p.id, p.revision, { rootPath: "/tmp/新输出", stage: "analysis", folder: "新拆解" });
    for (let i = 0; i < 4; i++) p = await service.advanceResearchJob(p.id, p.research.job!.id);
    expect(p.research.job?.outputLocation).toBe("/tmp/旧输出/拆解");
    const reloaded = await new MockProjectService(storage).get(p.id);
    expect(reloaded.research.analysisRevision).toBe(reloaded.research.materialRevision);
    p = await service.startResearchJob(p.id, p.revision, "analysis");
    expect(p.research.job?.outputLocation).toBe("/tmp/新输出/新拆解");
  });
});
