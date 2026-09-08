import { describe, expect, it } from "vitest";
import { emptyBlueprintData } from "@/domain/blueprint";
import { reviewRunSchema } from "@/domain/production";
import { MockProjectService } from "@/services/mock-project-service";
import { ServiceError, type StoragePort } from "@/services/contracts";

class Memory implements StoragePort {
  raw: string | null = null; fail = false;
  read() { return this.raw; }
  write(value: string) { if (this.fail) throw new ServiceError("STORAGE_UNAVAILABLE", "模拟容量不足"); this.raw = value; }
  exclusive<T>(operation: () => Promise<T>) { return operation(); }
}
async function setup() {
  const storage = new Memory(); let id = 0;
  const service = new MockProjectService(storage, () => "2026-09-08T02:00:00.000Z", () => String(++id));
  let project = await service.create({ title: "协调审查", note: "", template: "blank" });
  project = await service.initializeBlueprint(project.id, project.revision, "blank");
  const data = emptyBlueprintData(); data.premise = "自有故事简介"; data.truth = "未公开客观真相";
  project = await service.saveBlueprint(project.id, project.revision, data);
  project = await service.publishBlueprintVersion(project.id, project.revision, "底稿一");
  project = await service.startReview(project.id, project.revision, "blueprint", project.blueprint!.versions[0].id);
  const reviewId = project.production!.reviews[0].id;
  project = await service.advanceReviewModel(project.id, project.revision, reviewId, "model-a");
  project = await service.advanceReviewModel(project.id, project.revision, reviewId, "model-b");
  return { project, reviewId, service, storage };
}

describe("主Agent协调与修订上下文", () => {
  it("互审生成两路复核与证据核对，不继承历史通过结论；旧记录兼容", async () => {
    const { service, reviewId, project: initial } = await setup();
    const run = initial.production!.reviews[0];
    const { coordination: removed, ...old } = run; void removed;
    expect(reviewRunSchema.parse(old).coordination).toBeNull();
    await expect(service.sendReviewMessage(initial.id, initial.revision, reviewId, run.findings[0].id, "补充提示")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const project = await service.crossReview(initial.id, initial.revision, reviewId);
    const coordinated = project.production!.reviews[0];
    expect(coordinated.coordination?.mutualChecks).toHaveLength(4);
    expect(coordinated.coordination?.checks.map((item) => item.outcome)).toEqual(["needs-evidence", "human-test"]);
    expect(coordinated.coordination?.summary).toContain("未运行真实 AI");
    expect(coordinated.findings).toEqual(run.findings);
    expect(coordinated.coordination?.messages).toEqual([]);
  });

  it("对话绑定问题与快照，修订方案可编辑/选择，刷新保留且原剧本不变", async () => {
    const setupResult = await setup(); const { service, storage, reviewId } = setupResult; let project = setupResult.project;
    project = await service.crossReview(project.id, project.revision, reviewId);
    const blueprint = structuredClone(project.blueprint); const findingId = project.production!.reviews[0].findings[1].id;
    project = await service.sendReviewMessage(project.id, project.revision, reviewId, findingId, "保留原有线索，只添加卡住后的主持提示。");
    let run = project.production!.reviews[0]; const proposalId = run.coordination!.proposals[0].id;
    expect(run.coordination!.messages.map((message) => message.role)).toEqual(["author", "coordinator"]);
    expect(run.coordination!.messages.every((message) => message.findingId === findingId)).toBe(true);
    expect(run.coordination!.proposals[0].content).toContain("保留原有线索"); expect(run.coordination!.proposals[0].content).toContain(run.findings[1].evidence.location);
    project = await service.saveReviewProposal(project.id, project.revision, reviewId, proposalId, "作者修订：卡住五分钟再触发；不得泄露其他角色秘密。");
    project = await service.decideReviewProposal(project.id, project.revision, reviewId, proposalId, "adopted", "先明确触发条件，再试玩验证。");
    run = (await new MockProjectService(storage).get(project.id)).production!.reviews[0];
    expect(run.coordination!.proposals[0]).toMatchObject({ revision: 2, decision: "adopted", content: "作者修订：卡住五分钟再触发；不得泄露其他角色秘密。" });
    expect(run.coordination!.proposals[0].history).toHaveLength(1); expect(run.findings[1].decision).toBe("adopted");
    expect(project.blueprint).toEqual(blueprint);
    project = await service.saveReviewProposal(project.id, project.revision, reviewId, proposalId, "调整为六分钟。");
    expect(project.production!.reviews[0].coordination!.proposals[0]).toMatchObject({ decision: "unhandled", reason: "", revision: 3 });
    expect(project.production!.reviews[0].coordination!.proposals[0].history[1].decision).toBe("adopted");
  });

  it("资料版本过期后阻止修改、旧revision冲突与quota失败保持整批对话不变", async () => {
    const setupResult = await setup(); const { service, storage, reviewId } = setupResult; let project = setupResult.project;
    project = await service.crossReview(project.id, project.revision, reviewId); const findingId = project.production!.reviews[0].findings[0].id;
    const before = storage.raw; storage.fail = true;
    await expect(service.sendReviewMessage(project.id, project.revision, reviewId, findingId, "先核对证据。")).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" }); expect(storage.raw).toBe(before);
    storage.fail = false; const old = project;
    project = await service.sendReviewMessage(project.id, project.revision, reviewId, findingId, "先核对证据。");
    await expect(service.sendReviewMessage(old.id, old.revision, reviewId, findingId, "另一个页面的输入")).rejects.toMatchObject({ code: "CONFLICT" });
    const proposalId = project.production!.reviews[0].coordination!.proposals[0].id;
    project = await service.saveBlueprint(project.id, project.revision, { ...project.blueprint!.draft, premise: "修改后的故事" }); const preserved = storage.raw;
    for (const request of [service.sendReviewMessage(project.id, project.revision, reviewId, findingId, "旧讨论"), service.saveReviewProposal(project.id, project.revision, reviewId, proposalId, "旧方案"), service.decideReviewProposal(project.id, project.revision, reviewId, proposalId, "adopted", "旧理由")]) await expect(request).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.raw).toBe(preserved);
  });
});
