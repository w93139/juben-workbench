import { describe, expect, it } from "vitest";
import { emptyBlueprintData } from "@/domain/blueprint";
import { hasRunningProduction, isReviewStale, latestArtifacts, productionLimits } from "@/domain/production";
import type { Project } from "@/domain/models";
import { MockProjectService } from "@/services/mock-project-service";
import { ServiceError, type StoragePort } from "@/services/contracts";
class Memory implements StoragePort {
  raw: string | null = null; fail = false;
  read() { return this.raw; }
  write(raw: string) { if (this.fail) throw new ServiceError("STORAGE_UNAVAILABLE", "配额用尽"); this.raw = raw; }
  exclusive<T>(operation: () => Promise<T>) { return operation(); }
}
async function setup() {
  const storage = new Memory(); let n = 0;
  const service = new MockProjectService(storage, () => "2026-09-08T01:00:00.000Z", () => String(++n));
  let p = await service.create({ title: "正文演练", note: "", template: "blank" });
  p = await service.initializeBlueprint(p.id, p.revision, "blank");
  const data = emptyBlueprintData(); data.premise = "两人调查"; data.truth = "HOST_ONLY_SECRET";
  data.characters = ["A", "B"].map((id) => ({ id, name: id, publicIdentity: `${id}身份`, goal: `${id}目标`, privateInformation: `${id}_PRIVATE`, choice: "交出证物", contribution: "说明来历" }));
  data.rounds = [{ id: "R1", name: "第一轮", minutes: 20, activity: "调查", reveal: "HOST_ROUND_REVEAL" }];
  data.events = [{ id: "E1", time: "12:00", location: "馆内", action: "HOST_EVENT", causes: [] }];
  data.knowledge = ["known", "partial", "false", "hidden", "unknown"].map((state, index) => ({ id: `K${index}`, characterId: "A", factId: "E1", roundId: "R1", state: state as "known", detail: `A_${state}` }));
  data.knowledge.push({ id: "KB", characterId: "B", factId: "E1", roundId: "R1", state: "known", detail: "B_KNOWS" });
  data.clues = [{ id: "C1", name: "公开纸条", content: "PUBLIC_CLUE", supports: [], roundId: "R1", characterIds: [], cost: 0, access: "公开" }, { id: "C2", name: "限定纸条", content: "RESTRICTED_CLUE", supports: [], roundId: "R1", characterIds: ["B"], cost: 0, access: "交给B" }];
  p = await service.saveBlueprint(p.id, p.revision, data);
  p = await service.publishBlueprintVersion(p.id, p.revision, "第一版");
  return { service, storage, p, versionId: p.blueprint!.versions[0].id };
}
async function complete(service: MockProjectService, p: Project) {
  const id = p.production!.jobs.at(-1)!.id;
  p = await service.advanceGeneration(p.id, p.revision, id);
  return service.advanceGeneration(p.id, p.revision, id);
}
describe("Mock正文与版本化审查", () => {
  it("旧数据production默认null，读取不写入；只读及未发布蓝图无法开始", async () => {
    const { service, storage, p } = await setup(); const envelope = JSON.parse(storage.raw!); delete envelope.projects[0].production; storage.raw = JSON.stringify(envelope); const before = storage.raw;
    expect((await service.get(p.id)).production).toBeNull(); expect(storage.raw).toBe(before);
    await expect(service.startGeneration("demo-names", 0, "host", "x")).rejects.toMatchObject({ code: "READ_ONLY" });
    await expect(service.startGeneration(p.id, p.revision, "host", "x")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.raw).toBe(before);
  });
  it("取消无正文，失败可重试，完成按模块留下新版本且不覆盖蓝图与旧稿", async () => {
    const { service, p: initial, versionId } = await setup(); let p = initial; const original = structuredClone(p.blueprint);
    p = await service.startGeneration(p.id, p.revision, "character", versionId);
    const job = p.production!.jobs[0].id;
    p = await service.cancelGeneration(p.id, p.revision, job); expect(p.production!.artifacts).toEqual([]);
    p = await service.retryGeneration(p.id, p.revision, job); p = await complete(service, p);
    const first = structuredClone(p.production!.artifacts);
    expect(first).toHaveLength(2); expect(first.every((a) => a.version === 1 && a.origin === "mock" && a.content.includes("模板模拟"))).toBe(true);
    p = await service.startGeneration(p.id, p.revision, "character", versionId, true); p = await complete(service, p);
    expect(p.production!.jobs.at(-1)!.status).toBe("failed"); expect(p.production!.artifacts).toEqual(first);
    p = await service.retryGeneration(p.id, p.revision, p.production!.jobs.at(-1)!.id); p = await complete(service, p);
    expect(p.production!.artifacts.slice(0, 2)).toEqual(first); expect(latestArtifacts(p.production).every((a) => a.version === 2)).toBe(true); expect(p.blueprint).toEqual(original);
  });
  it("玩家资料按角色和轮次投影，谜底、隐藏信息、其他角色秘密不会混入", async () => {
    const { service, p: initial, versionId } = await setup(); let p = initial;
    for (const kind of ["character", "private", "updates", "clues", "host", "ending"] as const) { p = await service.startGeneration(p.id, p.revision, kind, versionId); p = await complete(service, p); }
    const artifacts = latestArtifacts(p.production); const players = artifacts.filter((a) => a.audience === "player");
    players.forEach((a) => { expect(a.content).not.toMatch(/HOST_ONLY_SECRET|HOST_EVENT|HOST_ROUND_REVEAL|A_unknown|RESTRICTED_CLUE/); if (a.characterId === "A") expect(a.content).not.toContain("B_PRIVATE"); });
    expect(players.find((a) => a.module === "updates" && a.characterId === "A")?.content).toContain("A_false");
    expect(players.find((a) => a.module === "updates" && a.characterId === "A")?.content).toContain("A_hidden");
    expect(players.find((a) => a.module === "updates" && a.characterId === "B")?.content).not.toContain("A_hidden");
    expect(players.find((a) => a.module === "updates" && a.characterId === "A")?.content).not.toContain("B_KNOWS");
    expect(artifacts.find((a) => a.module === "host")?.content).toContain("HOST_ONLY_SECRET");
    expect(artifacts.filter((a) => a.module === "ending").every((a) => a.audience === "host")).toBe(true);
  });
  it("任务锁定选定旧版本；正文编辑创建新版本且固定原读者，过期稿拒绝编辑", async () => {
    const { service, p: initial, versionId } = await setup(); let p = initial;
    const draft = structuredClone(p.blueprint!.draft); draft.characters[0].name = "新版名字";
    p = await service.saveBlueprint(p.id, p.revision, draft); p = await service.publishBlueprintVersion(p.id, p.revision, "第二版");
    p = await service.startGeneration(p.id, p.revision, "private", versionId); p = await complete(service, p);
    const old = p.production!.artifacts[0]; expect(old.title).toBe("A · 私人信息");
    p = await service.saveArtifact(p.id, p.revision, old.id, "作者补充"); const next = p.production!.artifacts.at(-1)!;
    expect(next).toMatchObject({ audience: old.audience, characterId: old.characterId, blueprintVersionId: versionId, version: 2, origin: "author" });
    expect(p.production!.artifacts[0]).toEqual(old);
    await expect(service.saveArtifact(p.id, p.revision, old.id, "覆盖旧稿")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("审查单侧失败保留成功结果，单侧重试和一次互审，作者决定不是解决结论", async () => {
    const { service, p: initial, versionId } = await setup(); let p = initial; p = await service.startReview(p.id, p.revision, "blueprint", versionId, "model-b"); const id = p.production!.reviews[0].id;
    p = await service.advanceReviewModel(p.id, p.revision, id, "model-a"); const opinions = structuredClone(p.production!.reviews[0].findings);
    p = await service.advanceReviewModel(p.id, p.revision, id, "model-b"); expect(p.production!.reviews[0].findings).toEqual(opinions);
    expect(p.production!.reviews[0].models[1].status).toBe("failed");
    p = await service.decideReviewFinding(p.id, p.revision, id, opinions[0].id, "provisional", "等待试玩再判断");
    p = await service.retryReviewModel(p.id, p.revision, id, "model-b"); p = await service.advanceReviewModel(p.id, p.revision, id, "model-b");
    expect(p.production!.reviews[0].findings[0]).toMatchObject({ decision: "provisional", reason: "等待试玩再判断" });
    expect(p.production!.reviews[0].findings.every((f) => f.modelOpinions.length === 2)).toBe(true);
    p = await service.crossReview(p.id, p.revision, id); await expect(service.crossReview(p.id, p.revision, id)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(p.production!.reviews[0].staticIssues.length).toBeGreaterThan(0); expect(p.production!.reviews[0].findings[0]).not.toHaveProperty("resolved");
  });
  it("取消一侧不清除另一侧；任务互斥，模型不可重复推进", async () => {
    const { service, p: initial, versionId } = await setup(); let p = initial; p = await service.startReview(p.id, p.revision, "blueprint", versionId); const id = p.production!.reviews[0].id;
    await expect(service.startGeneration(p.id, p.revision, "host", versionId)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    p = await service.advanceReviewModel(p.id, p.revision, id, "model-a"); p = await service.cancelReviewModel(p.id, p.revision, id, "model-b");
    expect(hasRunningProduction(p.production)).toBe(false); expect(p.production!.reviews[0].findings).toHaveLength(2);
    await expect(service.advanceReviewModel(p.id, p.revision, id, "model-a")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    p = await service.retryReviewModel(p.id, p.revision, id, "model-b"); expect(hasRunningProduction(p.production)).toBe(true);
  });
  it("正文审查固定manifest/证据，后续正文或草稿变化显示过期，重审不改旧结果", async () => {
    const { service, p: initial, versionId } = await setup(); let p = initial; p = await service.startGeneration(p.id, p.revision, "host", versionId); p = await complete(service, p);
    p = await service.startReview(p.id, p.revision, "manuscript", versionId); const id = p.production!.reviews[0].id;
    p = await service.advanceReviewModel(p.id, p.revision, id, "model-a"); p = await service.advanceReviewModel(p.id, p.revision, id, "model-b");
    const old = structuredClone(p.production!.reviews[0]); expect(isReviewStale(p, old)).toBe(false);
    p = await service.saveArtifact(p.id, p.revision, p.production!.artifacts[0].id, "新正文"); expect(isReviewStale(p, old)).toBe(true);
    p = await service.startReview(p.id, p.revision, "manuscript", versionId); expect(p.production!.reviews[0]).toEqual(old); expect(p.production!.reviews[1].artifactIds).not.toEqual(old.artifactIds);
    p = await service.cancelReviewModel(p.id, p.revision, p.production!.reviews[1].id, "model-a"); p = await service.cancelReviewModel(p.id, p.revision, p.production!.reviews[1].id, "model-b");
    p = await service.saveBlueprint(p.id, p.revision, { ...p.blueprint!.draft, premise: "变化" }); expect(isReviewStale(p, p.production!.reviews[1])).toBe(true);
  });
  it("配额失败和revision冲突不留下半份正文或审查记录", async () => {
    const { service, storage, p: initial, versionId } = await setup(); let p = initial; p = await service.startGeneration(p.id, p.revision, "host", versionId); const id = p.production!.jobs[0].id;
    p = await service.advanceGeneration(p.id, p.revision, id); const before = storage.raw; storage.fail = true;
    await expect(service.advanceGeneration(p.id, p.revision, id)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" }); expect(storage.raw).toBe(before);
    storage.fail = false; await expect(service.advanceGeneration(p.id, p.revision - 1, id)).rejects.toMatchObject({ code: "CONFLICT" }); expect(storage.raw).toBe(before);
    p = await service.advanceGeneration(p.id, p.revision, id); expect(p.production!.artifacts).toHaveLength(1);
    storage.fail = true; const beforeReview = storage.raw; await expect(service.startReview(p.id, p.revision, "manuscript", versionId)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" }); expect(storage.raw).toBe(beforeReview);
  });
  it("历史任务上限明确拒绝，旧记录完整保留", async () => {
    const { service, storage, p: initial, versionId } = await setup(); let p = initial;
    for (let n = 0; n < productionLimits.jobs; n++) { p = await service.startGeneration(p.id, p.revision, "host", versionId); p = await service.cancelGeneration(p.id, p.revision, p.production!.jobs.at(-1)!.id); }
    const before = storage.raw; await expect(service.startGeneration(p.id, p.revision, "host", versionId)).rejects.toMatchObject({ code: "INVALID_INPUT" }); expect(storage.raw).toBe(before); expect(p.production!.jobs).toHaveLength(productionLimits.jobs);
  });
  it("未安排发放条件的公共线索拒绝生成，更新中的项目不会假称版本审查适用", async () => {
    const { service, storage, p: initial, versionId } = await setup(); let p = initial;
    const draft = structuredClone(p.blueprint!.draft); draft.clues[0].access = "";
    p = await service.saveBlueprint(p.id, p.revision, draft); p = await service.publishBlueprintVersion(p.id, p.revision, "缺少发放安排");
    const version2 = p.blueprint!.versions[1].id; const before = storage.raw;
    await expect(service.startGeneration(p.id, p.revision, "clues", version2)).rejects.toMatchObject({ code: "INVALID_INPUT" }); expect(storage.raw).toBe(before);
    p = await service.startReview(p.id, p.revision, "blueprint", versionId); expect(isReviewStale(p, p.production!.reviews[0])).toBe(true);
    for (const model of ["model-a", "model-b"] as const) p = await service.cancelReviewModel(p.id, p.revision, p.production!.reviews[0].id, model);
    p = await service.saveBlueprint(p.id, p.revision, { ...p.blueprint!.draft, premise: "未发布的新构想" });
    p = await service.startReview(p.id, p.revision, "blueprint", version2); expect(isReviewStale(p, p.production!.reviews[1])).toBe(true);
  });
  it("不同蓝图版本正文各自可追溯，审查只收集选中版本并保留计划路径", async () => {
    const { service, p: initial, versionId } = await setup(); let p = initial;
    p = await service.saveOutputSettings(p.id, p.revision, { rootPath: "/planned-output", stage: "review", folder: "审查" });
    p = await service.startGeneration(p.id, p.revision, "host", versionId); p = await complete(service, p);
    const first = p.production!.artifacts[0];
    p = await service.publishBlueprintVersion(p.id, p.revision, "第二版");
    p = await service.startGeneration(p.id, p.revision, "host", p.blueprint!.versions[1].id); p = await complete(service, p);
    expect(latestArtifacts(p.production, versionId)).toEqual([first]);
    p = await service.startReview(p.id, p.revision, "manuscript", versionId);
    expect(p.production!.reviews[0].artifactIds).toEqual([first.id]); expect(p.production!.reviews[0].plannedPath).toBe("/planned-output/审查");
  });
  it("正文和审查上限不会静默丢弃历史", async () => {
    const { service, storage, p: initial, versionId } = await setup(); let p = initial;
    p = await service.startGeneration(p.id, p.revision, "host", versionId); p = await complete(service, p);
    p = await service.startReview(p.id, p.revision, "blueprint", versionId);
    for (const model of ["model-a", "model-b"] as const) p = await service.cancelReviewModel(p.id, p.revision, p.production!.reviews[0].id, model);
    const envelope = JSON.parse(storage.raw!); const production = envelope.projects[0].production;
    production.artifacts = Array.from({ length: productionLimits.artifacts }, (_, index) => ({ ...production.artifacts[0], id: `artifact-limit-${index}`, version: index + 1 }));
    production.reviews = Array.from({ length: productionLimits.reviews }, (_, index) => ({ ...production.reviews[0], id: `review-limit-${index}` }));
    storage.raw = JSON.stringify(envelope); const before = storage.raw;
    await expect(service.startGeneration(p.id, p.revision, "host", versionId)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.startReview(p.id, p.revision, "blueprint", versionId)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.raw).toBe(before);
  });

  it("生成开始锁定计划目录，途中改目录与失败重试不改变原任务目录", async () => {
    const { service, p: initial, versionId } = await setup(); let p = initial;
    p = await service.saveOutputSettings(p.id, p.revision, { rootPath: "/initial-plan", stage: "generation", folder: "原正文" });
    p = await service.startGeneration(p.id, p.revision, "host", versionId, true);
    const jobId = p.production!.jobs[0].id;
    expect(p.production!.jobs[0].plannedPath).toBe("/initial-plan/原正文");
    p = await service.saveOutputSettings(p.id, p.revision, { rootPath: "/changed-plan", stage: "generation", folder: "新正文" });
    p = await complete(service, p); expect(p.production!.jobs[0].status).toBe("failed");
    p = await service.retryGeneration(p.id, p.revision, jobId);
    p = await service.saveOutputSettings(p.id, p.revision, { rootPath: "/third-plan", stage: "generation", folder: "后续正文" });
    p = await complete(service, p);
    expect(p.production!.artifacts[0].plannedPath).toBe("/initial-plan/原正文");
    expect(p.production!.jobs[0].plannedPath).toBe("/initial-plan/原正文");
    expect(p.outputSettings.rootPath).toBe("/third-plan");
    p = await service.startGeneration(p.id, p.revision, "host", versionId);
    expect(p.production!.jobs[1].plannedPath).toBe("/third-plan/后续正文");
  });

});
