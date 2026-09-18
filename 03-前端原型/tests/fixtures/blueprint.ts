import type { BlueprintData } from "../../src/domain/blueprint";

export function completeBlueprint(): BlueprintData {
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
