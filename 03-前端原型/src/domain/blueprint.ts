import { z } from "zod";

const text = z.string().max(12000);
const id = z.string().trim().min(1).max(100);
const ref = z.string().max(100);
const refs = z.array(id).max(200);
const rows = <T extends z.ZodType<{ id: string }>>(schema: T, maximum = 200) => z.array(schema).max(maximum).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: "同一类记录的编号不能重复" });
    seen.add(item.id);
  });
});

export const blueprintDataSchema = z.object({
  premise: text,
  truth: text,
  characters: rows(z.object({ id, name: text, publicIdentity: text, goal: text, privateInformation: text, choice: text, contribution: text }), 40),
  relationships: rows(z.object({ id, fromId: ref, toId: ref, publicVersion: text, truth: text, consequence: text })),
  events: rows(z.object({ id, time: text, location: text, action: text, causes: refs })),
  knowledge: rows(z.object({ id, characterId: ref, factId: ref, roundId: ref, state: z.enum(["known", "partial", "hidden", "false", "unknown"]), detail: text }), 2000),
  claims: rows(z.object({ id, statement: text, required: z.boolean() })),
  clues: rows(z.object({ id, name: text, content: text, supports: refs, roundId: ref, characterIds: refs, cost: z.number().int().min(0).max(100000), access: text })),
  rounds: rows(z.object({ id, name: text, minutes: z.number().int().min(0).max(1440), activity: text, reveal: text }), 100),
  triggers: rows(z.object({ id, roundId: ref, condition: text, action: text, fallback: text })),
  endings: rows(z.object({ id, name: text, condition: text, choice: text, consequence: text }), 100),
});
export type BlueprintData = z.infer<typeof blueprintDataSchema>;
export type BlueprintSection = "overview" | Exclude<keyof BlueprintData, "premise" | "truth">;
export interface BlueprintIssue { id: string; severity: "error" | "warning"; section: BlueprintSection; recordId?: string; message: string }

export const blueprintWorkspaceSchema = z.object({
  draft: blueprintDataSchema,
  versions: rows(z.object({ id, label: z.string().trim().min(1).max(80), createdAt: z.iso.datetime(), data: blueprintDataSchema }), 20),
  savedAt: z.iso.datetime().nullable(),
  revision: z.number().int().nonnegative(),
  sourceLabel: z.string().max(500),
});
export type BlueprintWorkspace = z.infer<typeof blueprintWorkspaceSchema>;

export function emptyBlueprintData(): BlueprintData {
  return { premise: "", truth: "", characters: [], relationships: [], events: [], knowledge: [], claims: [], clues: [], rounds: [], triggers: [], endings: [] };
}

/** Author-side draft checks only. These are not AI review, historical script checks or playtesting. */
export function checkBlueprint(data: BlueprintData): BlueprintIssue[] {
  const issues: BlueprintIssue[] = [];
  const add = (section: BlueprintSection, recordId: string | undefined, code: string, message: string, severity: BlueprintIssue["severity"] = "error") => {
    issues.push({ id: `${section}:${recordId ?? "all"}:${code}`, section, ...(recordId ? { recordId } : {}), severity, message });
  };
  const missing = (values: string[]) => values.some((value) => !value.trim());
  const characters = new Set(data.characters.map((v) => v.id));
  const events = new Map(data.events.map((v) => [v.id, v]));
  const rounds = new Set(data.rounds.map((v) => v.id));
  const claims = new Set(data.claims.map((v) => v.id));
  if (missing([data.premise, data.truth])) add("overview", undefined, "truth", "请补充故事简介和客观真相。");
  for (const section of ["characters", "events", "knowledge", "claims", "clues", "rounds", "triggers", "endings"] as const) {
    if (!data[section].length) add(section, undefined, "empty", "这部分尚未填写，请补充设计。");
  }
  data.characters.forEach((v) => {
    if (missing([v.name, v.publicIdentity, v.goal, v.privateInformation, v.choice, v.contribution])) add("characters", v.id, "fields", "请补齐角色姓名、身份、目标、秘密、有后果的选择和推进贡献。");
    if (!data.relationships.some((r) => r.fromId !== r.toId && characters.has(r.fromId) && characters.has(r.toId) && (r.fromId === v.id || r.toId === v.id) && !missing([r.truth, r.consequence]))) add("characters", v.id, "relationship", "角色还缺少一条完整的重要关系。");
  });
  data.relationships.forEach((v) => {
    if (!characters.has(v.fromId) || !characters.has(v.toId) || v.fromId === v.toId) add("relationships", v.id, "reference", "关系需要连接两个不同且仍存在的角色。");
    if (missing([v.publicVersion, v.truth, v.consequence])) add("relationships", v.id, "fields", "请补充公开关系、实际关系及其后果。");
  });
  data.events.forEach((v) => {
    if (missing([v.time, v.location, v.action])) add("events", v.id, "fields", "请补齐时间、地点和发生的事情。");
    if (v.causes.some((cause) => !events.has(cause))) add("events", v.id, "reference", "前因引用了不存在的事件，内容已保留，请重新关联。");
    const visit = (current: string, seen: Set<string>): boolean => {
      if (current === v.id) return true;
      if (seen.has(current)) return false;
      seen.add(current);
      return events.get(current)?.causes.some((cause) => visit(cause, seen)) ?? false;
    };
    if (v.causes.some((cause) => visit(cause, new Set()))) add("events", v.id, "cycle", "事件的前因形成循环，请检查事情发生的先后因果。");
  });
  if (data.events.length > 1 && !data.events.some((v) => v.causes.length)) add("events", undefined, "causes", "尚未关联事件前因，请补充事件之间的因果关系。", "warning");
  data.knowledge.forEach((v) => {
    if (!characters.has(v.characterId) || !events.has(v.factId) || !rounds.has(v.roundId)) add("knowledge", v.id, "reference", "请关联仍存在的角色、事实事件和轮次。");
    if (!v.detail.trim()) add("knowledge", v.id, "fields", "请说明角色在这一轮知道或误解什么。");
  });
  data.clues.forEach((v) => {
    if (missing([v.name, v.content, v.access])) add("clues", v.id, "fields", "请补充线索名称、内容和获取方式。");
    if (!rounds.has(v.roundId) || v.characterIds.some((key) => !characters.has(key))) add("clues", v.id, "access", "线索的发放轮次或可获得角色不存在。");
    if (v.supports.some((key) => !claims.has(key))) add("clues", v.id, "reference", "线索引用了不存在的结论。");
    if (!v.supports.length) add("clues", v.id, "unused", "这条线索尚未关联结论，可说明它的体验作用。", "warning");
  });
  data.claims.forEach((v) => {
    if (!v.statement.trim()) add("claims", v.id, "fields", "请填写结论内容。");
    if (v.required && !data.clues.some((clue) => clue.supports.includes(v.id) && !missing([clue.name, clue.content, clue.access]) && rounds.has(clue.roundId) && clue.characterIds.every((key) => characters.has(key)))) add("claims", v.id, "unsupported", "必要结论缺少一条已注明有效发放轮次、获取方式和可获得对象的线索。");
  });
  data.rounds.forEach((v) => { if (missing([v.name, v.activity, v.reveal]) || v.minutes <= 0) add("rounds", v.id, "fields", "请补齐轮次名称、正数时长、玩家行动和揭示信息。"); });
  data.triggers.forEach((v) => {
    if (!rounds.has(v.roundId)) add("triggers", v.id, "reference", "主持触发条件引用的轮次不存在。");
    if (missing([v.condition, v.action, v.fallback])) add("triggers", v.id, "fields", "请补齐触发条件、主持操作和未触发时的处理。");
  });
  data.endings.forEach((v) => { if (missing([v.name, v.condition, v.choice, v.consequence])) add("endings", v.id, "fields", "请补齐结局名称、条件、玩家选择和后果。"); });
  return issues;
}
