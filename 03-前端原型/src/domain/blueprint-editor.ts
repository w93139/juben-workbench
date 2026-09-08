import type { BlueprintData } from "./blueprint";

export type BlueprintSection = Exclude<keyof BlueprintData, "premise" | "truth">;
export type EditorField = { key: string; label: string; type?: "text" | "number" | "boolean" | "reference" | "references" | "state"; target?: BlueprintSection; hint?: string };
export const blueprintGroups = [
  { name: "故事真相", sections: [] },
  { name: "人物与关系", sections: ["characters", "relationships"] },
  { name: "客观时间线", sections: ["events"] },
  { name: "信息与线索", sections: ["knowledge", "claims", "clues"] },
  { name: "轮次与主持", sections: ["rounds", "triggers"] },
  { name: "终局选择", sections: ["endings"] },
] as const;
export const sectionLabels: Record<BlueprintSection, string> = { characters: "角色", relationships: "关系", events: "事件", knowledge: "信息发放", claims: "推理结论", clues: "线索", rounds: "轮次", triggers: "主持触发", endings: "终局" };
export const knowledgeStates = { known: "已知", partial: "知道一部分", hidden: "知道但隐瞒", false: "持有错误认识", unknown: "不知道" };
const ref = (key: string, label: string, target: BlueprintSection): EditorField => ({ key, label, target, type: "reference" });
const refs = (key: string, label: string, target: BlueprintSection, hint?: string): EditorField => ({ key, label, target, type: "references", hint });
export const blueprintFields: Record<BlueprintSection, EditorField[]> = {
  characters: [{ key: "name", label: "姓名", type: "text" }, { key: "publicIdentity", label: "公开身份" }, { key: "goal", label: "个人目标" }, { key: "privateInformation", label: "私密信息" }, { key: "choice", label: "有后果的选择" }, { key: "contribution", label: "对游戏推进的贡献" }],
  relationships: [ref("fromId", "关系中的角色一", "characters"), ref("toId", "关系中的角色二", "characters"), { key: "publicVersion", label: "表面关系" }, { key: "truth", label: "真实关系" }, { key: "consequence", label: "关系如何影响选择" }],
  events: [{ key: "time", label: "发生时间", type: "text", hint: "可填写日期和时刻。这里只检查关联，不会自动理解自然语言先后顺序。" }, { key: "location", label: "发生地点", type: "text" }, { key: "action", label: "实际发生的事" }, refs("causes", "这件事由哪些事件引起", "events", "无前因可留空；请选择直接原因，循环因果会提示修正。")],
  knowledge: [ref("characterId", "谁收到信息", "characters"), ref("factId", "对应的真实事件", "events"), ref("roundId", "何时得到信息", "rounds"), { key: "state", label: "了解程度", type: "state" }, { key: "detail", label: "玩家看到或相信的内容", hint: "可与真相不同；错误认识要明确标记。" }],
  claims: [{ key: "statement", label: "需要玩家得出的结论" }, { key: "required", label: "这是推进游戏的必要结论", type: "boolean" }],
  clues: [{ key: "name", label: "线索名称", type: "text" }, { key: "content", label: "线索内容" }, refs("supports", "支持哪些推理结论", "claims"), ref("roundId", "可获得的轮次", "rounds"), refs("characterIds", "哪些角色能获得", "characters", "不选角色表示公共线索；选择角色后只面向所选角色。"), { key: "cost", label: "获取成本", type: "number" }, { key: "access", label: "玩家如何获得", hint: "例如：第一轮公开发放。写明可执行的获取方法。" }],
  rounds: [{ key: "name", label: "轮次名称", type: "text" }, { key: "minutes", label: "计划分钟数", type: "number" }, { key: "activity", label: "这一轮玩家做什么" }, { key: "reveal", label: "这一轮揭示什么" }],
  triggers: [ref("roundId", "发生在哪一轮", "rounds"), { key: "condition", label: "什么时候触发" }, { key: "action", label: "主持人具体做什么" }, { key: "fallback", label: "条件未满足时怎么办" }],
  endings: [{ key: "name", label: "终局名称", type: "text" }, { key: "condition", label: "进入条件" }, { key: "choice", label: "玩家要做的选择" }, { key: "consequence", label: "选择带来的后果" }],
};
export type BlueprintRow = Record<string, string | string[] | number | boolean> & { id: string };
export function newBlueprintRow(section: BlueprintSection, id: string): BlueprintRow {
  return Object.fromEntries([["id", id], ...blueprintFields[section].map((field) => [field.key, field.type === "references" ? [] : field.type === "number" ? 0 : field.type === "boolean" ? true : field.type === "state" ? "unknown" : ""])]) as BlueprintRow;
}
export function blueprintRowLabel(row: BlueprintRow, section: BlueprintSection, data: BlueprintData): string {
  if (section === "relationships") return [row.fromId, row.toId].map((id) => data.characters.find((c) => c.id === id)?.name || "待选角色").join(" ↔ ");
  if (section === "knowledge") return `${data.characters.find((c) => c.id === row.characterId)?.name || "待选角色"} · ${String(row.detail || "待写信息").slice(0, 32)}`;
  return String(row.name || row.statement || row.action || row.condition || `未命名${sectionLabels[section]}`).slice(0, 55);
}
