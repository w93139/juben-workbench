import { describe, expect, it } from "vitest";
import { MockProjectService } from "@/services/mock-project-service";
import { ServiceError, type StoragePort } from "@/services/contracts";
import { defaultDirection, researchStep } from "@/domain/research";
import type { Project } from "@/domain/models";

class Memory implements StoragePort {
  raw: string | null = null;
  fail = false;
  read() { return this.raw; }
  write(raw: string) { if (this.fail) throw new ServiceError("STORAGE_UNAVAILABLE", "存储已满"); this.raw = raw; }
  exclusive<T>(operation: () => Promise<T>) { return operation(); }
}
async function setup() {
  const storage = new Memory(); let id = 0;
  const service = new MockProjectService(storage, () => "2026-09-08T01:00:00.000Z", () => String(++id));
  const project = await service.create({ title: "研究测试", note: "", template: "blank" });
  return { storage, service, project };
}
async function finish(service: MockProjectService, p: Project) {
  for (let i = 0; i < 4; i++) p = await service.advanceResearchJob(p.id, p.research.job!.id);
  return p;
}
async function audit(service: MockProjectService, p: Project) {
  p = await service.addResearchDemo(p.id, p.revision);
  p = await finish(service, await service.startResearchJob(p.id, p.revision, "ocr"));
  for (const issue of p.research.issues) p = await service.resolveOCRIssue(p.id, p.revision, { id: issue.id, status: issue.kind === "missing" ? "retained" : issue.kind === "duplicate" ? "excluded" : "corrected", resolution: issue.suggestion });
  return service.confirmMaterialAudit(p.id, p.revision, "3份校对摘录与8条历史研究记录，缺少原始完整材料。");
}

describe("参考研究任务与原创方向", () => {
  it("完整链路可恢复，缺口保留，选择和方向独立保存", async () => {
    const { storage, service, project } = await setup();
    let p = await audit(service, project);
    expect(researchStep(p.research)).toBe("analysis");
    p = await finish(service, await service.startResearchJob(p.id, p.revision, "analysis"));
    expect(researchStep(p.research)).toBe("mechanisms");
    p = await service.chooseMechanism(p.id, p.revision, { id: "P03", choice: "adapt", reason: "重写私人更新触发条件" });
    expect(researchStep(p.research)).toBe("direction");
    p = await service.saveDirection(p.id, p.revision, { ...defaultDirection, players: 6, idea: "原创六人故事" });
    const restored = await new MockProjectService(storage).get(p.id);
    expect(restored.research).toEqual(p.research);
    expect(researchStep(restored.research)).toBe("blueprint");
    expect(restored.research.issues.find((i) => i.kind === "missing")?.status).toBe("retained");
    expect(await service.getContent(p.id)).toBeNull();
    expect((await service.get("demo-names")).research.documents).toEqual([]);
    const catalog = await service.getResearchCatalog();
    expect(catalog.patterns).toHaveLength(8);
    expect(catalog.provenance.every((s) => /^[a-f0-9]{64}$/.test(s.sha256))).toBe(true);
    catalog.patterns[0].name = "污染";
    expect((await service.getResearchCatalog()).patterns[0].name).not.toBe("污染");
  });

  it("失败、重试、刷新继续与取消不丢材料，过期任务不会重复写入", async () => {
    const { storage, service, project } = await setup();
    let p = await service.addResearchDemo(project.id, project.revision);
    p = await finish(service, await service.startResearchJob(p.id, p.revision, "ocr", true));
    expect(p.research.job?.status).toBe("failed");
    expect(p.research.issues).toEqual([]);
    p = await service.startResearchJob(p.id, p.revision, "ocr");
    const cancelledId = p.research.job!.id;
    p = await service.cancelResearchJob(p.id, p.revision);
    expect(p.research.job?.status).toBe("cancelled");
    expect(p.research.documents).toHaveLength(1);
    p = await service.startResearchJob(p.id, p.revision, "ocr");
    p = await service.advanceResearchJob(p.id, p.research.job!.id);
    const restoredService = new MockProjectService(storage);
    p = await finish(restoredService, p);
    expect(p.research.job?.status).toBe("succeeded");
    expect(p.research.issues).toHaveLength(4);
    const before = storage.raw;
    await restoredService.advanceResearchJob(p.id, cancelledId);
    await restoredService.advanceResearchJob(p.id, p.research.job!.id);
    expect(storage.raw).toBe(before);
  });

  it("任务写入失败保留上一次进度，恢复后从原位置继续", async () => {
    const { storage, service, project } = await setup();
    let p = await service.addResearchDemo(project.id, 0);
    p = await service.startResearchJob(p.id, p.revision, "ocr");
    storage.fail = true;
    await expect(service.advanceResearchJob(p.id, p.research.job!.id)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect((await service.get(p.id)).research.job?.progress).toBe(0);
    storage.fail = false;
    expect((await service.advanceResearchJob(p.id, p.research.job!.id)).research.job?.progress).toBe(25);
  });

  it("真实文件只登记，重复或非法批次不会部分写入", async () => {
    const { storage, service, project } = await setup();
    const file = { name: "参考.pdf", size: 100, mime: "application/pdf" };
    const p = await service.registerSourceFiles(project.id, 0, [file]);
    expect(p.research.documents[0]).toMatchObject({ origin: "local-metadata", status: "registered", fixtureId: null });
    await expect(service.startResearchJob(p.id, p.revision, "ocr")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const before = storage.raw;
    for (const files of [[file], [{ ...file, name: "新文件.md" }, { ...file, name: "禁止.exe" }], [{ ...file, size: -1 }]]) {
      await expect(service.registerSourceFiles(p.id, p.revision, files)).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(storage.raw).toBe(before);
    }
  });

  it("不能跳过审计、冒充补齐材料、保存无效比例或覆盖过期版本", async () => {
    const { storage, service, project } = await setup();
    await expect(service.addResearchDemo("demo-names", 0)).rejects.toMatchObject({ code: "READ_ONLY" });
    await expect(service.startResearchJob(project.id, 0, "analysis")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.saveDirection(project.id, 0, defaultDirection)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    let p = await service.addResearchDemo(project.id, 0);
    await expect(service.addResearchDemo(p.id, 0)).rejects.toMatchObject({ code: "CONFLICT" });
    p = await finish(service, await service.startResearchJob(p.id, p.revision, "ocr"));
    const before = storage.raw;
    await expect(service.confirmMaterialAudit(p.id, p.revision, "假装已完成")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.resolveOCRIssue(p.id, p.revision, { id: "ocr-missing", status: "corrected", resolution: "全部补齐" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.raw).toBe(before);
    const other = await setup();
    p = await audit(other.service, other.project);
    p = await finish(other.service, await other.service.startResearchJob(p.id, p.revision, "analysis"));
    p = await other.service.chooseMechanism(p.id, p.revision, { id: "P01", choice: "omit", reason: "不采用" });
    await expect(other.service.saveDirection(p.id, p.revision, defaultDirection)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    p = await other.service.chooseMechanism(p.id, p.revision, { id: "P01", choice: "adapt", reason: "重新分配预算" });
    await expect(other.service.saveDirection(p.id, p.revision, { ...defaultDirection, deduction: 99 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await other.service.get(p.id)).research.directionConfirmed).toBe(false);
  });

  it("材料和阅读范围变化会使下游待复核，草稿与取舍保留", async () => {
    const { service, project } = await setup();
    let p = await audit(service, project);
    p = await finish(service, await service.startResearchJob(p.id, p.revision, "analysis"));
    p = await service.chooseMechanism(p.id, p.revision, { id: "P02", choice: "retain", reason: "保留证据解锁功能" });
    p = await service.saveDirection(p.id, p.revision, defaultDirection);
    p = await service.confirmMaterialAudit(p.id, p.revision, "改为只采用权限摘录，其他规则仍待确认。");
    expect(p.research.analysisRevision).toBeNull();
    expect(p.research.directionConfirmed).toBe(false);
    expect(researchStep(p.research)).toBe("analysis");
    p = await finish(service, await service.startResearchJob(p.id, p.revision, "analysis"));
    p = await service.saveDirection(p.id, p.revision, defaultDirection);
    p = await service.resolveOCRIssue(p.id, p.revision, { id: "ocr-time", status: "retained", resolution: "时间仍不确定" });
    expect(p.research.auditRevision).toBeNull();
    expect(p.research.analysisRevision).toBeNull();
    expect(p.research.directionConfirmed).toBe(false);
    expect(p.research.direction).toEqual(defaultDirection);
    expect(p.research.choices).toHaveLength(1);
    expect(researchStep(p.research)).toBe("materials");
  });
});

describe("A阶段数据兼容", () => {
  it("读取不改原数据，首次成功保存升级格式，失败时保留原格式", async () => {
    const { storage, service, project } = await setup();
    const legacyProject: Partial<Project> = { ...project }; delete legacyProject.research;
    storage.raw = JSON.stringify({ schemaVersion: 1, projects: [legacyProject] });
    const before = storage.raw;
    const read = await service.get(project.id);
    expect(read.title).toBe(project.title);
    expect(read.research.documents).toEqual([]);
    expect(storage.raw).toBe(before);
    storage.fail = true;
    await expect(service.addResearchDemo(read.id, read.revision)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(storage.raw).toBe(before);
    storage.fail = false;
    const updated = await service.addResearchDemo(read.id, read.revision);
    expect(updated.decisions).toEqual(project.decisions);
    expect(JSON.parse(storage.raw!).schemaVersion).toBe(3);
    expect((await service.get(project.id)).research.documents).toHaveLength(1);
  });
});
