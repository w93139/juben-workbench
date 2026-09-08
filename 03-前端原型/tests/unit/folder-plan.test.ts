import { afterEach, describe, expect, it, vi } from "vitest";
import { MockProjectService } from "@/services/mock-project-service";
import { ServiceError, type StoragePort, type SourceImportOptions } from "@/services/contracts";
import { defaultDirection } from "@/domain/research";
import { folderPlanCurrent, folderPlanSchema, usesFolderPlan } from "@/domain/folder-plan";
import { folderPlanChoices } from "@/mocks/folder-plans";
import type { SourceFileInput } from "@/domain/source-import";

class Memory implements StoragePort {
  raw: string | null = null; writes = 0; fail = false;
  read() { return this.raw; }
  write(value: string) { if (this.fail) throw new ServiceError("STORAGE_UNAVAILABLE", "容量不足"); this.raw = value; this.writes++; }
  exclusive<T>(operation: () => Promise<T>) { return operation(); }
}
function setup() { const storage = new Memory(); let id = 0; const service = new MockProjectService(storage, () => "2026-09-08T02:00:00.000Z", () => String(++id)); return { storage, service }; }
const files: SourceFileInput[] = [
  { name: "主持.pdf", relativePath: "我的完整剧本/主持/主持.pdf", size: 100, mime: "application/pdf" },
  { name: "人物.txt", relativePath: "我的完整剧本/角色/人物.txt", size: 120, mime: "text/plain" },
];
async function imported(service: MockProjectService, options?: SourceImportOptions) {
  vi.useFakeTimers(); const result = service.createFromSources(files, options); await vi.runAllTimersAsync(); return result;
}
afterEach(() => vi.useRealTimers());

describe("完整文件夹创建与原创方向", () => {
  it("创建与材料原子写入，原目录名作为作品名，无演示内容或正文识别", async () => {
    const { service, storage } = setup();
    const phases: string[] = [];
    const { project } = await imported(service, { onProgress: (p) => phases.push(p.phase) });
    expect(project.title).toBe("我的完整剧本"); expect(project.template).toBe("blank");
    expect(storage.writes).toBe(1); expect(phases.at(-1)).toBe("complete");
    expect(project.research.documents.map((d) => d.relativePath)).toEqual(files.map((f) => f.relativePath));
    expect(project.research.documents.every((d) => d.status === "registered" && d.origin === "local-metadata" && d.fixtureId === null)).toBe(true);
    expect(await service.getContent(project.id)).toBeNull(); expect(project.folderPlan).toBeNull();
    expect(project.research.analysisRevision).toBeNull(); expect(project.research.issues).toEqual([]);
  });

  it("无效批次、取消和保存失败不留下空项目，重试单次写入", async () => {
    const { service, storage } = setup();
    await expect(service.createFromSources([])).rejects.toMatchObject({ code: "INVALID_INPUT" });
    vi.useFakeTimers();
    const invalid = service.createFromSources([{ name: ".DS_Store", size: 1, mime: "" }]);
    const checked = expect(invalid).rejects.toMatchObject({ code: "INVALID_INPUT" }); await vi.runAllTimersAsync(); await checked;
    expect(storage.raw).toBeNull();
    const controller = new AbortController();
    const cancelled = service.createFromSources(files, { signal: controller.signal, onProgress: (progress) => { if (progress.phase === "saving") controller.abort(); } });
    const rejected = expect(cancelled).rejects.toMatchObject({ code: "CANCELLED" }); await vi.runAllTimersAsync(); await rejected;
    expect(storage.raw).toBeNull();
    storage.fail = true;
    const failed = service.createFromSources(files); const quota = expect(failed).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" }); await vi.runAllTimersAsync(); await quota;
    expect(storage.raw).toBeNull(); storage.fail = false;
    await imported(service); expect(storage.writes).toBe(1); expect((await service.list()).filter((p) => !p.readOnly)).toHaveLength(1);
  });

  it("模拟拆解两步持久化，取消可重试，方向选择与大纲草稿不会伪造原案事实", async () => {
    const { service, storage } = setup(); let { project } = await imported(service);
    project = await service.startFolderPlan(project.id, project.revision);
    project = await service.cancelFolderPlan(project.id, project.revision);
    expect(project.folderPlan?.status).toBe("cancelled");
    project = await service.startFolderPlan(project.id, project.revision);
    project = await service.advanceFolderPlan(project.id, project.revision); expect(project.folderPlan?.progress).toBe(50);
    const restored = new MockProjectService(storage); project = await restored.advanceFolderPlan(project.id, project.revision);
    expect(folderPlanCurrent(project)).toBe(true);
    expect(project.research.analysisRevision).toBeNull(); expect(project.research.auditRevision).toBeNull();
    await expect(service.saveFolderDirection(project.id, project.revision, "invalid")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    project = await service.saveFolderDirection(project.id, project.revision, "emotion");
    expect((await restored.get(project.id)).folderPlan?.selectedChoiceId).toBe("emotion");
    project = await service.initializeFolderBlueprint(project.id, project.revision);
    expect(project.blueprint?.draft.premise).toContain(folderPlanChoices[1].premise);
    expect(project.blueprint?.draft.premise).toContain("第3幕");
    expect(project.blueprint?.draft.truth).toContain("通用结构草稿"); expect(project.blueprint?.draft.characters).toHaveLength(5); expect(project.blueprint?.draft.clues).toHaveLength(3);
    expect(project.decisions.filter((d) => d.id === "cast" || d.id === "experience").every((d) => d.status === "provisional" && d.nature === "original")).toBe(true);
    const before = storage.raw;
    await expect(service.initializeFolderBlueprint(project.id, project.revision)).rejects.toMatchObject({ code: "INVALID_INPUT" }); expect(storage.raw).toBe(before);
  });

  it("材料变化让旧建议失效，运行中材料变化取消旧任务，旧revision不覆盖新状态", async () => {
    const { service, storage } = setup(); let { project } = await imported(service);
    project = await service.startFolderPlan(project.id, project.revision);
    const old = project;
    project = await service.registerSourceFiles(project.id, project.revision, [{ name: "补充.txt", size: 1, mime: "" }]);
    await expect(service.advanceFolderPlan(old.id, old.revision)).rejects.toMatchObject({ code: "CONFLICT" });
    project = await service.advanceFolderPlan(project.id, project.revision); expect(project.folderPlan?.status).toBe("cancelled");
    project = await service.startFolderPlan(project.id, project.revision);
    project = await service.advanceFolderPlan(project.id, project.revision); project = await service.advanceFolderPlan(project.id, project.revision);
    project = await service.saveFolderDirection(project.id, project.revision, "deduction");
    project = await service.registerSourceFiles(project.id, project.revision, [{ name: "补充2.txt", size: 1, mime: "" }]);
    expect(folderPlanCurrent(project)).toBe(false); const before = storage.raw;
    await expect(service.saveFolderDirection(project.id, project.revision, "emotion")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.initializeFolderBlueprint(project.id, project.revision)).rejects.toMatchObject({ code: "INVALID_INPUT" }); expect(storage.raw).toBe(before);
  });

  it("已有空白项目方向草稿保留旧编辑入口，不被文件夹流程隐藏", async () => {
    const { service } = setup(); const { project } = await imported(service);
    expect(usesFolderPlan(project)).toBe(true);
    const legacy = { ...project, research: { ...project.research, direction: { ...defaultDirection, idea: "我已填写的创意" } } };
    expect(usesFolderPlan(legacy)).toBe(false);
    const started = await service.startFolderPlan(project.id, project.revision);
    expect(usesFolderPlan({ ...legacy, folderPlan: started.folderPlan })).toBe(true);
  });

  it("拆解锁定开始时计划目录，后续改目录不改写历史计划；旧计划缺省为空", async () => {
    const { service, storage } = setup(); let { project } = await imported(service);
    project = await service.saveOutputSettings(project.id, project.revision, { rootPath: "/mock/output-one", stage: "analysis", folder: "拆解" });
    project = await service.startFolderPlan(project.id, project.revision);
    expect(project.folderPlan?.plannedPath).toBe("/mock/output-one/拆解");
    project = await service.saveOutputSettings(project.id, project.revision, { rootPath: "/mock/output-two", stage: "analysis", folder: "新拆解" });
    project = await service.advanceFolderPlan(project.id, project.revision);
    project = await service.advanceFolderPlan(project.id, project.revision);
    expect((await new MockProjectService(storage).get(project.id)).folderPlan?.plannedPath).toBe("/mock/output-one/拆解");
    const { plannedPath: removed, ...old } = project.folderPlan!; void removed;
    expect(folderPlanSchema.parse(old).plannedPath).toBeNull();
    project = await service.startFolderPlan(project.id, project.revision);
    expect(project.folderPlan?.plannedPath).toBe("/mock/output-two/新拆解");
  });

  it("旧schema3缺省字段读为null且不写回；无材料/样例不允许启动", async () => {
    const { service, storage } = setup(); const project = await service.create({ title: "旧作", note: "", template: "blank" });
    const { folderPlan: removed, ...old } = project; void removed;
    storage.raw = JSON.stringify({ schemaVersion: 3, projects: [old] }); const before = storage.raw;
    expect((await service.get(project.id)).folderPlan).toBeNull(); expect(storage.raw).toBe(before);
    await expect(service.startFolderPlan(project.id, project.revision)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.startFolderPlan("demo-names", 0)).rejects.toMatchObject({ code: "READ_ONLY" }); expect(storage.raw).toBe(before);
  });
});

it("方案对话按材料和方向绑定，编辑采用结构蓝图且保留历史和用户选择", async () => {
  const { service, storage } = setup(); let { project } = await imported(service);
  project = await service.startFolderPlan(project.id, project.revision);
  project = await service.advanceFolderPlan(project.id, project.revision); project = await service.advanceFolderPlan(project.id, project.revision);
  project = await service.saveFolderDirection(project.id, project.revision, "emotion");
  const old = project;
  project = await service.sendFolderMessage(project.id, project.revision, "第二幕少一点阅读，多交流");
  expect(project.folderPlan?.messages).toHaveLength(2);
  expect(project.folderPlan?.messages[1].text).toContain("本地模拟回复");
  expect(project.folderPlan?.messages.every(m => m.sourceRevision === project.research.materialRevision && m.choiceId === "emotion")).toBe(true);
  await expect(service.saveFolderProposal(old.id, old.revision, old.folderPlan!.proposal!)).rejects.toMatchObject({ code: "CONFLICT" });
  const draft = structuredClone(project.folderPlan!.proposal!); draft.premise = "作者在上下文讨论后确定的大纲";
  project = await service.saveFolderProposal(project.id, project.revision, draft);
  expect((await new MockProjectService(storage).get(project.id)).folderPlan!.proposal!.premise).toBe(draft.premise);
  project = await service.initializeFolderBlueprint(project.id, project.revision);
  expect(project.blueprint!.draft).toEqual(draft);
  expect(project.blueprint!.draft.rounds).toHaveLength(3);
  const blueprint = structuredClone(project.blueprint);
  project = await service.saveFolderDirection(project.id, project.revision, "deduction");
  expect(project.folderPlan?.messages[0].choiceId).toBe("emotion");
  expect(project.folderPlan!.proposalHistory.some(h => h.data.premise === draft.premise)).toBe(true);
  project = await service.startFolderPlan(project.id, project.revision);
  expect(project.folderPlan!.proposalHistory.some(h => h.choiceId === "deduction")).toBe(true);
  expect(project.blueprint).toEqual(blueprint);
  project = await service.registerSourceFiles(project.id, project.revision, [{ name: "新材料.txt", size: 20, mime: "text/plain" }]);
  const before = storage.raw;
  await expect(service.sendFolderMessage(project.id, project.revision, "继续讨论")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(service.saveFolderProposal(project.id, project.revision, draft)).rejects.toMatchObject({ code: "INVALID_INPUT" }); expect(storage.raw).toBe(before);
});
it("对话保存失败或超长输入不写入半条消息，结构化方案可关联且不导入原本内容", async () => {
  const { service, storage } = setup(); let { project } = await imported(service);
  project = await service.startFolderPlan(project.id, project.revision);
  project = await service.advanceFolderPlan(project.id, project.revision); project = await service.advanceFolderPlan(project.id, project.revision);
  project = await service.saveFolderDirection(project.id, project.revision, "interaction");
  const before = storage.raw; storage.fail = true;
  await expect(service.sendFolderMessage(project.id, project.revision, "保留合作决策")).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" }); expect(storage.raw).toBe(before);
  storage.fail = false;
  await expect(service.sendFolderMessage(project.id, project.revision, "长".repeat(3001))).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const draft = project.folderPlan!.proposal!;
  expect(draft.characters).toHaveLength(6);
  expect(draft.relationships.every(r => draft.characters.some(c => c.id === r.fromId) && draft.characters.some(c => c.id === r.toId))).toBe(true);
  expect(draft.claims.every(c => draft.clues.some(clue => clue.supports.includes(c.id) && draft.rounds.some(r => r.id === clue.roundId)))).toBe(true);
  expect(draft.rounds.reduce((sum, r) => sum + r.minutes, 0)).toBe(240);
  expect(JSON.stringify(draft)).not.toContain("名字之外");
});
