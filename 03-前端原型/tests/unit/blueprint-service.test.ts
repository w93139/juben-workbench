import { describe, expect, it } from "vitest";
import { blueprintDataSchema, checkBlueprint, emptyBlueprintData, type BlueprintData } from "@/domain/blueprint";
import { MockProjectService } from "@/services/mock-project-service";
import { ServiceError, type StoragePort } from "@/services/contracts";

class Memory implements StoragePort {
  raw: string | null = null;
  fail = false;
  read() { return this.raw; }
  write(value: string) { if (this.fail) throw new ServiceError("STORAGE_UNAVAILABLE", "存储已满"); this.raw = value; }
  exclusive<T>(operation: () => Promise<T>) { return operation(); }
}
async function setup(template: "blank" | "names-beyond" = "blank") {
  const storage = new Memory(); let id = 0;
  const service = new MockProjectService(storage, () => "2026-09-08T01:00:00.000Z", () => String(++id));
  const project = await service.create({ title: "蓝图测试", note: "", template });
  return { storage, service, project };
}
function completeData(): BlueprintData {
  return {
    premise: "两人的档案馆", truth: "甲藏起档案，乙目击。",
    characters: ["A", "B"].map((id) => ({ id, name: id, publicIdentity: "编辑", goal: "公开事实", privateInformation: "看到档案", choice: "公开或隐瞒", contribution: "提供证词" })),
    relationships: [{ id: "AB", fromId: "A", toId: "B", publicVersion: "同事", truth: "互相隐瞒", consequence: "交出档案会改变合作" }],
    events: [{ id: "E1", time: "12:00", location: "档案馆", action: "藏起档案", causes: [] }, { id: "E2", time: "12:10", location: "档案馆", action: "发现空柜", causes: ["E1"] }],
    knowledge: [{ id: "K1", characterId: "B", factId: "E1", roundId: "R1", state: "known", detail: "乙目击藏档案" }],
    claims: [{ id: "Q1", statement: "甲藏起档案", required: true }],
    clues: [{ id: "C1", name: "照片", content: "甲带走档案的照片", supports: ["Q1"], roundId: "R1", characterIds: [], cost: 0, access: "主持公开发放" }],
    rounds: [{ id: "R1", name: "调查", minutes: 20, activity: "分享线索", reveal: "发现照片" }],
    triggers: [{ id: "T1", roundId: "R1", condition: "开始调查", action: "发照片", fallback: "超时主动提示" }],
    endings: [{ id: "END1", name: "公开", condition: "选择公开", choice: "是否公开", consequence: "档案进入公共记录" }],
  };
}

describe("蓝图草稿与版本", () => {
  it("旧 schema3 默认未建立蓝图，读取不会写入或制造历史检查", async () => {
    const { storage, service, project } = await setup();
    const raw = JSON.parse(storage.raw!); delete raw.projects[0].blueprint;
    storage.raw = JSON.stringify(raw); const before = storage.raw;
    expect((await service.get(project.id)).blueprint).toBeNull();
    expect(await service.getBlueprint(project.id)).toBeNull();
    expect(await service.getContent(project.id)).toBeNull();
    expect(storage.raw).toBe(before);
  });

  it("演示基线只读，复制需要显式初始化，快照映射不伪造缺失的细节", async () => {
    const { storage, service, project } = await setup("names-beyond");
    const before = storage.raw;
    const demo = (await service.getBlueprint("demo-names"))!;
    expect(demo.draft.characters).toHaveLength(5);
    expect(demo.sourceLabel).toContain("历史检查不适用于本草稿");
    expect(demo.draft.triggers).toEqual([]);
    expect(demo.draft.knowledge.every((k) => k.detail.includes("历史初始状态代码") && !k.factId)).toBe(true);
    expect(demo.draft.knowledge.find((k) => k.detail.includes("代码：K"))?.state).toBe("known");
    expect(demo.draft.knowledge.find((k) => k.detail.includes("代码：C"))?.state).toBe("hidden");
    expect(demo.draft.knowledge.find((k) => k.detail.includes("代码：O"))?.state).toBe("partial");
    expect(demo.versions).toEqual([]);
    demo.draft.characters[0].name = "污染";
    expect((await service.getBlueprint("demo-names"))!.draft.characters[0].name).not.toBe("污染");
    await expect(service.initializeBlueprint("demo-names", 0, "demo")).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(storage.raw).toBe(before);
    expect(await service.getBlueprint(project.id)).toBeNull();
    const initialized = await service.initializeBlueprint(project.id, project.revision, "demo");
    expect(initialized.blueprint?.revision).toBe(1);
    expect(initialized.blueprint?.draft.characters).toHaveLength(5);
    await expect(service.initializeBlueprint(initialized.id, initialized.revision, "blank")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("空白项目可直接创作但不能误载历史样例；缺口草稿允许保存", async () => {
    const { service, project } = await setup();
    await expect(service.initializeBlueprint(project.id, project.revision, "demo")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const initialized = await service.initializeBlueprint(project.id, project.revision, "blank");
    const data = emptyBlueprintData(); data.premise = "未完成的原创构想";
    data.knowledge.push({ id: "K1", characterId: "已删除", factId: "待关联", roundId: "", state: "unknown", detail: "保留原输入" });
    const saved = await service.saveBlueprint(project.id, initialized.revision, data);
    expect(saved.blueprint?.draft).toEqual(data);
    expect(saved.blueprint?.revision).toBe(2);
    expect(checkBlueprint(saved.blueprint!.draft).some((v) => v.id === "knowledge:K1:reference")).toBe(true);
    expect((await service.get(project.id)).research.directionConfirmed).toBe(false);
  });

  it("保存失败、过期修订和非法编号均不部分写盘", async () => {
    const { storage, service, project } = await setup();
    const initialized = await service.initializeBlueprint(project.id, 0, "blank");
    const before = storage.raw;
    storage.fail = true;
    await expect(service.saveBlueprint(project.id, initialized.revision, completeData())).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(storage.raw).toBe(before);
    storage.fail = false;
    await expect(service.saveBlueprint(project.id, 0, completeData())).rejects.toMatchObject({ code: "CONFLICT" });
    const invalid = completeData(); invalid.characters.push({ ...invalid.characters[0] });
    await expect(service.saveBlueprint(project.id, initialized.revision, invalid)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.raw).toBe(before);
    expect((await service.saveBlueprint(project.id, initialized.revision, completeData())).blueprint?.revision).toBe(2);
  });

  it("版本固定保存时的内容，后续草稿编辑不改历史，20条上限不静默删历史", async () => {
    const { storage, service, project } = await setup();
    let p = await service.initializeBlueprint(project.id, 0, "blank");
    p = await service.saveBlueprint(p.id, p.revision, completeData());
    p = await service.publishBlueprintVersion(p.id, p.revision, "第一版待试玩");
    const oldData = structuredClone(p.blueprint!.versions[0].data);
    const draft = structuredClone(p.blueprint!.draft); draft.truth = "修改后的真相";
    p = await service.saveBlueprint(p.id, p.revision, draft);
    expect(p.blueprint!.versions[0].data).toEqual(oldData);
    p.blueprint!.versions[0].data.truth = "污染返回值";
    expect((await service.getBlueprint(p.id))!.versions[0].data).toEqual(oldData);
    for (let i = 2; i <= 20; i++) p = await service.publishBlueprintVersion(p.id, p.revision, `草稿版本${i}`);
    const before = storage.raw;
    await expect(service.publishBlueprintVersion(p.id, p.revision, "第21版")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.raw).toBe(before);
    expect((await service.getBlueprint(p.id))!.versions).toHaveLength(20);
  });

  it("冻结未完整草稿不声称通过检查，失败冻结不添加版本", async () => {
    const { storage, service, project } = await setup();
    let p = await service.initializeBlueprint(project.id, 0, "blank");
    const before = storage.raw; storage.fail = true;
    await expect(service.publishBlueprintVersion(p.id, p.revision, "待修订版")).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(storage.raw).toBe(before); storage.fail = false;
    p = await service.publishBlueprintVersion(p.id, p.revision, "待修订版");
    expect(checkBlueprint(p.blueprint!.versions[0].data).length).toBeGreaterThan(0);
    expect(await service.getContent(p.id)).toBeNull();
  });
});

describe("蓝图基础缺口检查", () => {
  it("完整最小结构没有缺口，但不代表AI审查或试玩通过", () => {
    expect(checkBlueprint(completeData())).toEqual([]);
  });
  it("检测删除断链、因果循环、无贡献角色、无发放条件线索、主持和终局缺口", () => {
    const data = completeData();
    data.characters[0].contribution = "";
    data.events[0].causes = ["E2", "不存在"];
    data.knowledge[0].factId = "不存在";
    data.clues[0].roundId = "不存在";
    data.clues[0].supports.push("不存在");
    data.triggers[0].fallback = "";
    data.endings[0].consequence = "";
    const before = structuredClone(data);
    const ids = checkBlueprint(data).map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(["characters:A:fields", "events:E1:reference", "events:E1:cycle", "events:E2:cycle", "knowledge:K1:reference", "clues:C1:access", "clues:C1:reference", "claims:Q1:unsupported", "triggers:T1:fields", "endings:END1:fields"]));
    expect(data).toEqual(before);
  });
  it("空内容、无效角色或无获取方式均不能支撑必要结论", () => {
    for (const invalid of [{ access: "" }, { content: "" }, { characterIds: ["已删除"] }]) {
      const data = completeData(); Object.assign(data.clues[0], invalid);
      expect(checkBlueprint(data).some((v) => v.id === "claims:Q1:unsupported")).toBe(true);
    }
    const data = completeData(); data.clues[0].characterIds = ["A"];
    expect(checkBlueprint(data)).toEqual([]);
  });
  it("结构限制拒绝过长字段、负数和重复ID，但允许缺失关联以保留编辑内容", () => {
    const data = completeData(); data.events[0].causes = ["尚未添加"];
    expect(blueprintDataSchema.safeParse(data).success).toBe(true);
    data.rounds[0].minutes = -1;
    expect(blueprintDataSchema.safeParse(data).success).toBe(false);
    data.rounds[0].minutes = 20; data.truth = "字".repeat(12001);
    expect(blueprintDataSchema.safeParse(data).success).toBe(false);
  });
});
