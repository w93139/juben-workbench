import { describe, expect, it } from "vitest";
import { reviewBlueprint } from "../fixtures/studio-review";
import { HANDOFF_FORMAT, HANDOFF_VERSION, buildHandoffPackage, checkHandoffPackage, deriveTaskCards, isPublicClue, renderHandoffMarkdown, type HandoffPackage, type HandoffPackageInput } from "@/domain/handoff-package";
import { blueprintDataSchema } from "@/domain/blueprint";
import { studioAnalysisSchema } from "@/domain/studio";

const analysis = () => studioAnalysisSchema.parse({
  outline: "自造拆解大纲：两案镜像与三层责任。",
  directions: [
    { id: "d1", title: "方向一", summary: "自造方向一概要", outline: "起因—选择", risk: "待真人试玩" },
    { id: "d2", title: "方向二", summary: "自造方向二概要", outline: "发现—揭示", risk: "待核对证据" },
  ],
  sourceRefs: [{ documentId: "doc", location: "角色本/甲 · 开场", quote: "【自造原文摘录】不得入包" }],
  unknowns: ["待核对：某角色的知情时间"],
});

const documents = [
  { id: "doc", name: "自造角色本-甲.md", status: "read" as const, excluded: false, text: "【机密原文】材料正文不得进入交接包" },
  { id: "doc2", name: "自造主持人手册.md", status: "read" as const, excluded: false, text: "主持谜底不得进入交接包" },
  { id: "py", name: "静态检查.py", status: "unsupported" as const, excluded: true },
];

/** 一个带“仅特定角色可得线索”的自造蓝图。 */
function restrictedClueBlueprint() {
  const bp = reviewBlueprint();
  bp.rounds.push({ id: "R2", name: "第二轮", minutes: 25, activity: "复核", reveal: "发现差异" });
  bp.clues.push({ id: "C2", name: "私密照片", content: "只有甲能看到的照片", supports: ["Q1"], roundId: "R1", characterIds: ["A"], cost: 1, access: "仅甲可领" });
  bp.knowledge.push({ id: "K2", characterId: "A", factId: "E1", roundId: "R1", state: "known", detail: "甲知道自己拿了照片" });
  return bp;
}

function baseState(overrides: Partial<HandoffPackageInput["state"]> = {}): HandoffPackageInput["state"] {
  return { revision: 7, sourceRevision: 2, analysis: analysis(), analysisSourceRevision: 2, choiceId: "d1", blueprint: reviewBlueprint(), blueprintRevision: 3, blueprintSourceRevision: 2, blueprintChoiceId: "d1", instructions: "自造创作要求", documents, ...overrides };
}
async function build(overrides: Partial<HandoffPackageInput["state"]> = {}, extra: Partial<HandoffPackageInput> = {}) {
  return buildHandoffPackage({ project: { id: "project-sample", title: "自造样例作品", note: "仅用于回归。" }, state: baseState(overrides), packageId: "pkg-sample-0001", exportedAt: "2026-10-03T00:00:00.000Z", ...extra });
}

describe("策划交接包", () => {
  it("当前性一致时标记 ready、自检无阻断、Markdown 可渲染", async () => {
    const pkg = await build();
    expect(pkg.format).toBe(HANDOFF_FORMAT);
    expect(pkg.version).toBe(HANDOFF_VERSION);
    expect(pkg.readiness).toEqual({ state: "ready", blockers: [], referencesChecked: true });
    expect(pkg.disclosure).toEqual({ playerSafe: false, containsHostSecrets: true, note: expect.any(String) });
    expect(checkHandoffPackage(pkg)).toEqual([]);
    expect(pkg.writingTasks.length).toBe(deriveTaskCards(reviewBlueprint()).length);
    expect(renderHandoffMarkdown(pkg)).toContain("正文未生成");
    expect(renderHandoffMarkdown(pkg)).toContain("不得作为玩家材料分发");
  });

  it("材料/方向改变后过期蓝图只能作为草稿，不得标记 ready 或正式导出", async () => {
    const staleRevision = await build({ sourceRevision: 3 });
    expect(staleRevision.readiness.state).toBe("draft");
    expect(staleRevision.readiness.blockers.join("")).toContain("不对应当前材料版本");
    const staleChoice = await build({ choiceId: "d2" });
    expect(staleChoice.readiness.blockers.join("")).toContain("创作方向");
    const missingBlueprint = await build({ blueprint: null, blueprintSourceRevision: null, blueprintChoiceId: null });
    expect(missingBlueprint.readiness.state).toBe("draft");
    expect(missingBlueprint.readiness.blockers.join("")).toContain("尚未提交正式蓝图");
  });

  it("结构阻断或缺少可核对来源时不得标记 ready；伪造 ready 会被自检拒绝", async () => {
    const broken = await build({ analysis: studioAnalysisSchema.parse({ ...analysis(), sourceRefs: [{ documentId: "不存在", location: "未知", quote: "x" }] }) });
    expect(broken.readiness.state).toBe("draft");
    expect(broken.readiness.referencesChecked).toBe(false);
    expect(broken.readiness.blockers.join("")).toContain("来源定位无法在当前材料中核对");
    const forged = { ...broken, readiness: { state: "ready", blockers: [], referencesChecked: false } } as HandoffPackage;
    expect(checkHandoffPackage(forged).map((issue) => issue.code)).toContain("ready-references");
    const noBlueprintReady = { ...(await build({ blueprint: null, blueprintSourceRevision: null, blueprintChoiceId: null })), readiness: { state: "ready", blockers: [], referencesChecked: false } } as HandoffPackage;
    expect(checkHandoffPackage(noBlueprintReady).map((issue) => issue.code)).toContain("ready-no-blueprint");
  });

  it("公共线索卡不含仅特定角色可得的线索；错误角色的更新也不含", async () => {
    const bp = restrictedClueBlueprint();
    const cards = deriveTaskCards(bp);
    const publicR1 = cards.find((card) => card.id === "task-R1-clues")!;
    expect(publicR1.blueprintScope).toContain("C1");
    expect(publicR1.blueprintScope).not.toContain("C2");
    const updatesA = cards.find((card) => card.id === "task-A-R1-updates")!;
    expect(updatesA.blueprintScope).toContain("C2");
    const updatesB = cards.find((card) => card.id === "task-B-R1-updates")!;
    expect(updatesB.blueprintScope).not.toContain("C2");
    expect(isPublicClue(bp.clues.find((clue) => clue.id === "C1")!)).toBe(true);
    expect(isPublicClue(bp.clues.find((clue) => clue.id === "C2")!)).toBe(false);
    const pkg = await build({ blueprint: bp });
    expect(checkHandoffPackage(pkg)).toEqual([]);
  });

  it("来源定位保留 documentId/location，但不装原文摘录；序列化后不含材料正文", async () => {
    const pkg = await build();
    expect(pkg.analysis!.sourceRefs).toEqual([{ documentId: "doc", location: "角色本/甲 · 开场" }]);
    const serialized = JSON.stringify(pkg);
    expect(serialized).not.toContain("【机密原文】");
    expect(serialized).not.toContain("主持谜底不得进入交接包");
    expect(serialized).not.toContain("【自造原文摘录】");
    for (const material of pkg.materials) expect(material).not.toHaveProperty("text");
  });

  it("蓝图较大时任务卡数量随角色/轮次增长且不超上限，文案按实际人数", async () => {
    const big = blueprintDataSchema.parse({
      premise: "自造大蓝图", truth: "自造真相",
      characters: Array.from({ length: 6 }, (_, i) => ({ id: `P${i}`, name: `角色${i}`, publicIdentity: "身份", goal: "目标", privateInformation: "秘密", choice: "选择", contribution: "贡献" })),
      relationships: [], events: [{ id: "E1", time: "t", location: "地", action: "事", causes: [] }],
      knowledge: [], claims: [{ id: "Q1", statement: "结论", required: true }],
      clues: [{ id: "C1", name: "公共", content: "内容", supports: ["Q1"], roundId: "R0", characterIds: [], cost: 0, access: "公开" }],
      rounds: Array.from({ length: 10 }, (_, i) => ({ id: `R${i}`, name: `轮${i}`, minutes: 10, activity: "活动", reveal: "揭示" })),
      triggers: [], endings: [{ id: "END1", name: "终局", condition: "条件", choice: "选择", consequence: "后果" }],
    });
    const cards = deriveTaskCards(big);
    expect(cards.length).toBe(6 * 2 + 6 * 10 + 10 + 1 + 10 + 1);
    const pkg = await build({ blueprint: big });
    expect(pkg.checks.taskCards).toBe(cards.length);
    expect(pkg.reviewPlan.playtest[0]).toContain("6");
    expect(pkg.reviewPlan.playtest.join("")).not.toContain("五席");
  });
});
