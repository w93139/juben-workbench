import { z } from "zod";
import { blueprintDataSchema, checkBlueprint, type BlueprintData } from "./blueprint";
import { moduleIds, moduleLabels } from "./production";
import type { StudioAnalysis } from "./studio";

/**
 * 策划交接包：产品内最后的交付物。它只描述“待执行”的写作与验证方案，
 * 永远不表示正文已生成、审查通过或可开本。外部执行项一律 not-run。
 * 整包含主持秘密，playerSafe 恒为 false，不得直接发给玩家。
 */
export const HANDOFF_FORMAT = "juben-workbench/plan-handoff";
export const HANDOFF_VERSION = 1 as const;
export const HANDOFF_EXECUTION_STATUS = { manuscript: "not-generated", crossReview: "not-run", playtest: "not-run" } as const;
export const HANDOFF_DISCLOSURE = { playerSafe: false, containsHostSecrets: true, note: "本包含主持专用信息与谜底，不得作为玩家材料分发；玩家可见内容需另行按角色切分。" } as const;

const short = (max: number) => z.string().trim().min(1).max(max);
const ref = z.string().trim().min(1).max(120);

export const handoffMaterialSchema = z.object({
  id: ref, name: short(500), status: z.enum(["read", "unsupported", "error"]), excluded: z.boolean(),
  /** 来源定位说明；不包含原文。 */
  sourceNote: z.string().trim().max(300),
}).strict();
export type HandoffMaterial = z.infer<typeof handoffMaterialSchema>;

/** 来源定位只保留可核对的身份与位置，不装原文摘录。 */
export const handoffSourceRefSchema = z.object({ documentId: ref, location: short(1000) }).strict();
export type HandoffSourceRef = z.infer<typeof handoffSourceRefSchema>;

export const handoffTaskCardSchema = z.object({
  id: ref, module: z.enum(moduleIds), label: short(500), audience: z.enum(["player", "host"]),
  characterId: ref.nullable(), roundId: ref.nullable(), endingId: ref.nullable(),
  blueprintScope: z.array(ref).max(5000),
  outputRequirements: z.array(short(500)).min(1).max(30),
  mustNotReveal: z.array(short(500)).max(100),
  acceptance: z.array(short(500)).min(1).max(30),
}).strict();
export type HandoffTaskCard = z.infer<typeof handoffTaskCardSchema>;

export const handoffReviewPlanSchema = z.object({
  independentReaders: z.array(z.object({ id: ref, focus: short(500) }).strict()).min(2).max(4),
  mutualCheck: short(800),
  consolidation: short(800),
  playtest: z.array(short(500)).max(30),
  status: z.literal("not-run"),
}).strict();

export const handoffPackageSchema = z.object({
  format: z.literal(HANDOFF_FORMAT), version: z.literal(HANDOFF_VERSION),
  packageId: ref, exportedAt: z.string().trim().min(1).max(40),
  project: z.object({ id: ref, title: short(200), note: z.string().trim().max(2000) }).strict(),
  revision: z.object({
    workbenchRevision: z.number().int().nonnegative(), sourceRevision: z.number().int().nonnegative(),
    analysisSourceRevision: z.number().int().nonnegative().nullable(), chosenDirectionId: ref.nullable(),
    blueprintRevision: z.number().int().nonnegative().nullable(), blueprintSourceRevision: z.number().int().nonnegative().nullable(),
    blueprintChoiceId: ref.nullable(), blueprintFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  readiness: z.object({
    state: z.enum(["draft", "ready"]), blockers: z.array(short(500)).max(50), sourceRefsLocated: z.boolean(),
  }).strict(),
  disclosure: z.object({ playerSafe: z.literal(false), containsHostSecrets: z.literal(true), note: short(500) }).strict(),
  executionStatus: z.object({ manuscript: z.literal("not-generated"), crossReview: z.literal("not-run"), playtest: z.literal("not-run") }).strict(),
  scope: z.object({
    players: z.number().int().positive().max(200).nullable(), minutes: z.number().int().positive().max(200000).nullable(),
    instructions: z.string().trim().max(10000), boundaries: z.array(short(500)).max(50),
  }).strict(),
  materials: z.array(handoffMaterialSchema).max(2000),
  analysis: z.object({
    outline: short(30000),
    directions: z.array(z.object({ id: ref, title: short(200), summary: short(5000), outline: short(15000), risk: short(5000) }).strict()).max(5),
    authorEditedOutline: z.string().trim().max(30000).nullable(),
    chosenDirectionId: ref.nullable(),
    sourceRefs: z.array(handoffSourceRefSchema).max(100),
    unknowns: z.array(short(2000)).max(100),
  }).strict().nullable(),
  blueprint: blueprintDataSchema.nullable(),
  writingTasks: z.array(handoffTaskCardSchema).max(6000),
  reviewPlan: handoffReviewPlanSchema,
  openQuestions: z.array(short(2000)).max(300),
  checks: z.object({
    blueprintErrors: z.number().int().nonnegative(), blueprintWarnings: z.number().int().nonnegative(),
    materialsExcluded: z.number().int().nonnegative(), taskCards: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type HandoffPackage = z.infer<typeof handoffPackageSchema>;
export type HandoffIssue = { code: string; message: string };

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const moduleRequirements: Record<(typeof moduleIds)[number], string[]> = {
  character: ["写该角色开场经历、重要关系、目标、可隐瞒内容与有后果的选择", "行为必须与蓝图角色本一致，不得新增未登记的秘密", "不出现其他角色私人信息与主持真相"],
  private: ["写开场即可知道的私人记忆与可隐瞒事项", "不提前发放后续轮次线索", "不泄露其他角色秘密与未来公共线索"],
  updates: ["只写该角色该轮的发现、行动与选择", "按知识矩阵的五种知情状态处理", "限定角色线索只在允许角色与轮次发放"],
  clues: ["只写该轮已明确公共且未限定角色的线索及获取方式与成本", "未达触发条件不发放", "不得捏造蓝图外的线索，也不得把仅特定角色可得的线索写成公共卡"],
  host: ["写进入状态、合法行动、结算、发放、触发与兜底", "含安全边界与复位说明", "仅主持查阅，可含谜底"],
  ending: ["写该终局的条件、选择、后果与执行", "仅主持查阅", "不改变已判定的事实与责任"],
};
const visibilityRule: Record<(typeof moduleIds)[number], string[]> = {
  character: ["玩家视角：仅本角色与本轮已获知内容", "禁止：主持真相、他人秘密、未来轮次信息"],
  private: ["玩家视角：本角色私人材料", "禁止：他人秘密、未来公共线索、主持真相"],
  updates: ["玩家视角：本角色本轮更新", "禁止：其他角色秘密、未来轮次信息"],
  clues: ["玩家视角：公共线索卡", "禁止：未公开主持真相、其他角色私密、仅特定角色可得的线索"],
  host: ["主持视角：含谜底与兜底", "不得作为玩家材料发放"],
  ending: ["主持视角：终局材料", "不得作为玩家材料发放"],
};

export function blueprintFingerprintHex(blueprint: BlueprintData): Promise<string> {
  return sha256Hex(JSON.stringify(blueprint));
}

// 封闭的完整标记集合；不从自由叙述中的关键词推断发放权限。
const publicAccessLabels = new Set(["公开", "公共", "全员公开", "全体公开", "所有玩家可见", "开轮公开", "开轮即公开", "主持公开发放"]);
/**
 * 线索分发分类（只看可验证的结构与显式公共标记，不猜测自由文本含义）：
 * - character：指定了角色，只在这些角色与轮次发放；
 * - public：未指定角色且 access 完整匹配约定公共标记；
 * - undetermined：其余（含“仅甲可领”“交给甲”等限定或无法确定的描述），不得作为公共线索发放。
 */
export type ClueDistribution = "public" | "character" | "undetermined";
export function classifyClue(clue: BlueprintData["clues"][number]): ClueDistribution {
  if (clue.characterIds.length > 0) return "character";
  return publicAccessLabels.has(clue.access.trim()) ? "public" : "undetermined";
}
/** 只有能确定为公共的线索才可以进入公共玩家卡。 */
export function isPublicClue(clue: BlueprintData["clues"][number]): boolean {
  return classifyClue(clue) === "public";
}
/** 限定角色的线索只进允许角色的对应轮次；公共线索由“公共线索卡”承担。 */
export function clueAllowedFor(clue: BlueprintData["clues"][number], characterId: string, roundId: string): boolean {
  return clue.roundId === roundId && clue.characterIds.includes(characterId);
}

/** 从蓝图派生逐件写作任务卡；纯函数，不依赖服务端。安全按 clue.characterIds/roundId 收窄范围。 */
export function deriveTaskCards(blueprint: BlueprintData): HandoffTaskCard[] {
  const card = (id: string, module: HandoffTaskCard["module"], label: string, audience: HandoffTaskCard["audience"], characterId: string | null, roundId: string | null, endingId: string | null, scope: string[]): HandoffTaskCard => ({
    id, module, label, audience, characterId, roundId, endingId,
    blueprintScope: [...new Set(scope)], outputRequirements: moduleRequirements[module], mustNotReveal: visibilityRule[module],
    acceptance: ["蓝图范围与来源可追溯", "无越权泄露项", "文字完整可执行，不是摘要或占位"],
  });
  const cards: HandoffTaskCard[] = [];
  for (const character of blueprint.characters) {
    const relations = blueprint.relationships.filter((relation) => relation.fromId === character.id || relation.toId === character.id).map((relation) => relation.id);
    // 开场材料不纳入各轮知情记录，避免提前给出未来轮次信息；轮次信息只进对应 updates。
    cards.push(card(`task-${character.id}-character`, "character", `${character.name} · 角色本`, "player", character.id, null, null, [character.id, ...relations]));
    cards.push(card(`task-${character.id}-private`, "private", `${character.name} · 私人信息`, "player", character.id, null, null, [character.id]));
    for (const round of blueprint.rounds) {
      const scope = [character.id, round.id,
        ...blueprint.knowledge.filter((item) => item.characterId === character.id && item.roundId === round.id).map((item) => item.id),
        ...blueprint.clues.filter((clue) => clueAllowedFor(clue, character.id, round.id)).map((clue) => clue.id)];
      cards.push(card(`task-${character.id}-${round.id}-updates`, "updates", `${character.name} · ${round.name} · 阶段更新`, "player", character.id, round.id, null, scope));
    }
  }
  for (const round of blueprint.rounds) {
    // 公共线索卡只收明确公共且未限定角色的线索；仅特定角色可得的线索不得进入公共范围。
    const scope = [round.id, ...blueprint.clues.filter((clue) => clue.roundId === round.id && isPublicClue(clue)).map((clue) => clue.id)];
    cards.push(card(`task-${round.id}-clues`, "clues", `${round.name} · 公共线索`, "player", null, round.id, null, scope));
  }
  cards.push(card("task-host-opening", "host", "主持手册 · 开场", "host", null, null, null, []));
  for (const round of blueprint.rounds) {
    const undetermined = blueprint.clues.filter((clue) => clue.roundId === round.id && classifyClue(clue) === "undetermined").map((clue) => clue.id);
    cards.push(card(`task-host-${round.id}`, "host", `主持手册 · ${round.name}`, "host", null, round.id, null, [round.id, ...blueprint.triggers.filter((trigger) => trigger.roundId === round.id).map((trigger) => trigger.id), ...undetermined]));
  }
  for (const ending of blueprint.endings) cards.push(card(`task-ending-${ending.id}`, "ending", `终局材料 · ${ending.name}`, "host", null, null, ending.id, [ending.id]));
  return cards;
}

export interface HandoffMaterialInput { id: string; name: string; status: "read" | "unsupported" | "error"; excluded: boolean; text?: string }
export interface HandoffPackageInput {
  project: { id: string; title: string; note: string };
  state: {
    revision: number; sourceRevision: number;
    analysis: StudioAnalysis | null; analysisSourceRevision: number | null; choiceId: string | null;
    blueprint: BlueprintData | null; blueprintRevision: number; blueprintSourceRevision: number | null; blueprintChoiceId: string | null;
    instructions: string; documents: HandoffMaterialInput[];
  };
  authorEditedOutline?: string | null;
  authorDirections?: { id: string; title: string; summary: string; outline: string; risk: string }[] | null;
  packageId: string;
  exportedAt: string;
}

export function checkHandoffCurrentness(state: HandoffPackageInput["state"]): string[] {
  const blockers: string[] = [];
  if (!state.blueprint) blockers.push("尚未提交正式蓝图，不能作为正式交接包导出。");
  else {
    if (state.blueprintSourceRevision !== state.sourceRevision) blockers.push("蓝图不对应当前材料版本，请重新生成并提交蓝图后再导出。");
    if (state.blueprintChoiceId !== state.choiceId) blockers.push("蓝图所依据的创作方向与当前选择不一致，请重新提交蓝图。");
    if (state.analysisSourceRevision !== state.sourceRevision || state.analysisSourceRevision === null) blockers.push("拆解结果不对应当前材料版本。");
  }
  if (!state.analysis) blockers.push("缺少拆解大纲，无法形成交接方案。");
  const readable = new Set(state.documents.filter((document) => !document.excluded && document.status === "read").map((document) => document.id));
  const references = state.analysis?.sourceRefs ?? [];
  if (!references.length || references.some((reference) => !readable.has(reference.documentId) || !reference.location.trim())) blockers.push("来源定位无法在当前材料中对应；请回原稿核对后再导出。");
  return blockers;
}

export async function buildHandoffPackage(input: HandoffPackageInput): Promise<HandoffPackage> {
  const blueprint = input.state.blueprint;
  const structural = blueprint ? checkBlueprint(blueprint) : [];
  const errors = structural.filter((issue) => issue.severity === "error").length;
  const warnings = structural.length - errors;
  const directions = input.state.analysis?.directions ?? [];
  const readable = new Set(input.state.documents.filter((document) => !document.excluded && document.status === "read").map((document) => document.id));
  const sourceRefs = input.state.analysis?.sourceRefs ?? [];
  const sourceRefsLocated = sourceRefs.length > 0 && sourceRefs.every((reference) => readable.has(reference.documentId) && reference.location.trim().length > 0);
  const effectiveDirections = input.authorDirections ?? directions;
  const blockers = checkHandoffCurrentness(input.state);
  if (errors > 0) blockers.push(`蓝图存在 ${errors} 项结构阻断，请先在应用内修正。`);
  const undeterminedClues = blueprint ? blueprint.clues.filter((clue) => classifyClue(clue) === "undetermined") : [];
  const openQuestions = [...(input.state.analysis?.unknowns ?? []), ...undeterminedClues.map((clue) => `线索 ${clue.id}（${clue.name}）的发放方式无法判定为公共或指定角色，请指定角色或使用完整公共标记“公开”；当前保留在主持任务，未作为公共线索发放。`)];
  const writingTasks = blueprint ? deriveTaskCards(blueprint) : [];
  return handoffPackageSchema.parse({
    format: HANDOFF_FORMAT, version: HANDOFF_VERSION, packageId: input.packageId, exportedAt: input.exportedAt,
    project: { id: input.project.id, title: input.project.title, note: input.project.note },
    revision: {
      workbenchRevision: input.state.revision, sourceRevision: input.state.sourceRevision,
      analysisSourceRevision: input.state.analysisSourceRevision, chosenDirectionId: input.state.choiceId,
      blueprintRevision: blueprint ? input.state.blueprintRevision : null, blueprintSourceRevision: input.state.blueprintSourceRevision,
      blueprintChoiceId: input.state.blueprintChoiceId,
      blueprintFingerprint: blueprint ? await blueprintFingerprintHex(blueprint) : "0".repeat(64),
    },
    readiness: { state: blockers.length ? "draft" : "ready", blockers, sourceRefsLocated },
    disclosure: { ...HANDOFF_DISCLOSURE },
    executionStatus: { ...HANDOFF_EXECUTION_STATUS },
    scope: { players: blueprint?.characters.length ?? null, minutes: blueprint ? blueprint.rounds.reduce((sum, round) => sum + round.minutes, 0) : null, instructions: input.state.instructions, boundaries: blueprint ? [blueprint.premise.slice(0, 500)] : [] },
    materials: input.state.documents.map((document) => ({ id: document.id, name: document.name, status: document.status, excluded: document.excluded, sourceNote: document.excluded ? "本轮不使用" : document.status === "read" ? "已读取，正文不入包" : "未读取或不受支持" })),
    analysis: input.state.analysis ? { outline: input.state.analysis.outline, directions: effectiveDirections, authorEditedOutline: input.authorEditedOutline ?? null, chosenDirectionId: input.state.choiceId, sourceRefs: sourceRefs.map((reference) => ({ documentId: reference.documentId, location: reference.location })), unknowns: input.state.analysis.unknowns } : null,
    blueprint,
    writingTasks,
    reviewPlan: {
      independentReaders: [{ id: "reader-A", focus: "叙事、人物、关系与体验一致性" }, { id: "reader-B", focus: "证据链、轮次状态、规则与主持可执行性" }],
      mutualCheck: "两位独立审读者交换报告，逐条核对分歧与证据，不得只看结论。",
      consolidation: "统稿者按蓝图范围合并修订，问题回填到对应任务卡；未解决项保留在未决问题。",
      // v1 字段保留以兼容旧包；当前策划产品不产生试玩待办。
      playtest: [],
      status: "not-run",
    },
    openQuestions,
    checks: { blueprintErrors: errors, blueprintWarnings: warnings, materialsExcluded: input.state.documents.filter((document) => document.excluded).length, taskCards: writingTasks.length },
  });
}

/** 包内自检：只做程序可判定项；不判断剧情是否可玩。 */
export function checkHandoffPackage(pkg: HandoffPackage): HandoffIssue[] {
  const issues: HandoffIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  if (pkg.executionStatus.manuscript !== "not-generated" || pkg.executionStatus.crossReview !== "not-run" || pkg.executionStatus.playtest !== "not-run") add("status", "执行状态必须为未生成/未执行/未试玩，不得把外部结果写成本包状态。");
  if (pkg.disclosure.playerSafe !== false || pkg.disclosure.containsHostSecrets !== true) add("disclosure", "整包含主持秘密，必须标注为不可直接发给玩家。");
  if (pkg.blueprint) {
    const characters = new Set(pkg.blueprint.characters.map((character) => character.id));
    const rounds = new Set(pkg.blueprint.rounds.map((round) => round.id));
    const endings = new Set(pkg.blueprint.endings.map((ending) => ending.id));
    const clues = new Map(pkg.blueprint.clues.map((clue) => [clue.id, clue]));
    for (const task of pkg.writingTasks) {
      if (task.characterId && !characters.has(task.characterId)) add("task-character", `${task.id} 引用了不存在的角色。`);
      if (task.roundId && !rounds.has(task.roundId)) add("task-round", `${task.id} 引用了不存在的轮次。`);
      if (task.endingId && !endings.has(task.endingId)) add("task-ending", `${task.id} 引用了不存在的终局。`);
      if (task.module === "clues") {
        for (const scopeId of task.blueprintScope) {
          const clue = clues.get(scopeId);
          if (clue && classifyClue(clue) !== "public") add("clue-scope", `${task.id} 收入了非公共线索 ${clue.id}。`);
        }
      }
    }
    if (pkg.revision.blueprintRevision === null) add("revision", "包含蓝图但未记录蓝图修订。");
    if (pkg.readiness.state === "ready" && (pkg.revision.blueprintSourceRevision !== pkg.revision.sourceRevision || pkg.revision.blueprintChoiceId !== pkg.revision.chosenDirectionId)) add("stale", "标记为就绪但蓝图不对应当前材料或方向。");
    if (pkg.readiness.state === "ready" && pkg.readiness.blockers.length) add("ready-blockers", "标记为就绪但仍存在阻断项。");
    if (pkg.readiness.state === "ready" && !pkg.readiness.sourceRefsLocated) add("ready-references", "标记为就绪但来源引用未能对应到材料。");
  } else if (pkg.readiness.state === "ready") add("ready-no-blueprint", "没有正式蓝图不得标记为就绪。");
  return issues;
}

export function renderHandoffMarkdown(pkg: HandoffPackage): string {
  const lines: string[] = [];
  const ready = pkg.readiness.state === "ready";
  lines.push(`# 策划交接包（${ready ? "正式" : "草稿预览"}）· ${pkg.project.title}`, "");
  lines.push(`- 包格式/版本：\`${pkg.format}\` v${pkg.version}`);
  lines.push(`- 包编号：\`${pkg.packageId}\`　导出时间：${pkg.exportedAt}`);
  lines.push(`- 项目修订：workbench ${pkg.revision.workbenchRevision} · 材料 ${pkg.revision.sourceRevision} · 蓝图 ${pkg.revision.blueprintRevision ?? "—"}`);
  lines.push(`- 就绪状态：**${pkg.readiness.state}**　来源定位：${pkg.readiness.sourceRefsLocated ? "已对应到材料（未逐条核对原文）" : "未对应到材料"}`);
  if (pkg.readiness.blockers.length) { lines.push("- 待处理阻断："); for (const blocker of pkg.readiness.blockers) lines.push(`  - ${blocker}`); }
  lines.push(`- 分发限制：**${pkg.disclosure.note}**`);
  lines.push(`- 状态：**策划方案已导出 · 正文未生成**（后续写作与核验建议可选，不是产品验收条件）`, "");
  lines.push(`> ${pkg.project.note || "（无项目备注）"}`, "");
  lines.push("## 一、项目范围与创作约束", "");
  lines.push(`- 人数：${pkg.scope.players ?? "待定"}　时长：${pkg.scope.minutes ?? "待定"} 分钟`);
  lines.push(`- 创作要求：${pkg.scope.instructions || "（空）"}`);
  for (const boundary of pkg.scope.boundaries) lines.push(`- 边界：${boundary}`);
  lines.push("", "## 二、材料与来源定位（不含原文）", "");
  for (const material of pkg.materials) lines.push(`- ${material.name} · ${material.status}${material.excluded ? " · 本轮不使用" : ""} · ${material.sourceNote}`);
  lines.push("", "## 三、拆解摘要与作者修订", "");
  if (!pkg.analysis) lines.push("（本包不含拆解结果）");
  else {
    lines.push(`- 采用方向：${pkg.analysis.chosenDirectionId ?? "未选择"}`);
    if (pkg.analysis.sourceRefs.length) { lines.push("- 来源定位："); for (const reference of pkg.analysis.sourceRefs) lines.push(`  - ${reference.documentId} · ${reference.location}`); }
    lines.push("", "### 模型拆解大纲", "", pkg.analysis.outline, "");
    if (pkg.analysis.authorEditedOutline) lines.push("### 作者修订大纲", "", pkg.analysis.authorEditedOutline, "");
    lines.push("### 候选方向", "");
    for (const direction of pkg.analysis.directions) lines.push(`- **${direction.title}**：${direction.summary}（风险：${direction.risk}）`);
    if (pkg.analysis.unknowns.length) { lines.push("", "### 待确定事项", ""); for (const item of pkg.analysis.unknowns) lines.push(`- ${item}`); }
  }
  lines.push("", "## 四、正式蓝图", "");
  if (!pkg.blueprint) lines.push("（本包未包含蓝图：请先在应用内提交正式蓝图）");
  else {
    lines.push(`- 结构检查：${pkg.checks.blueprintErrors} 项阻断 · ${pkg.checks.blueprintWarnings} 项提示`);
    lines.push(`- 角色 ${pkg.blueprint.characters.length} · 关系 ${pkg.blueprint.relationships.length} · 事件 ${pkg.blueprint.events.length} · 信息 ${pkg.blueprint.knowledge.length} · 结论 ${pkg.blueprint.claims.length} · 线索 ${pkg.blueprint.clues.length} · 轮次 ${pkg.blueprint.rounds.length} · 触发 ${pkg.blueprint.triggers.length} · 终局 ${pkg.blueprint.endings.length}`);
    lines.push("", "（完整蓝图见同目录 JSON 的 `blueprint` 字段；含主持秘密，不得直接发给玩家）");
  }
  lines.push("", "## 五、写作任务卡", "");
  for (const task of pkg.writingTasks) {
    lines.push(`### ${task.label}`, "");
    lines.push(`- 模块/视角：${moduleLabels[task.module]} · ${task.audience === "player" ? "玩家可见" : "主持专用"}`);
    if (task.characterId) lines.push(`- 角色：${task.characterId}`);
    if (task.roundId) lines.push(`- 轮次：${task.roundId}`);
    if (task.endingId) lines.push(`- 终局：${task.endingId}`);
    lines.push(`- 允许引用范围（${task.blueprintScope.length} 项）：${task.blueprintScope.join("、") || "（无额外范围）"}`);
    lines.push("- 输出要求："); for (const item of task.outputRequirements) lines.push(`  - ${item}`);
    if (task.mustNotReveal.length) { lines.push("- 禁止泄露："); for (const item of task.mustNotReveal) lines.push(`  - ${item}`); }
    lines.push("- 验收："); for (const item of task.acceptance) lines.push(`  - ${item}`);
    lines.push("");
  }
  lines.push("## 六、后续写作核验建议（可选）", "");
  lines.push(`- 状态：**${pkg.reviewPlan.status}**`);
  for (const reader of pkg.reviewPlan.independentReaders) lines.push(`- 独立审读 ${reader.id}：${reader.focus}`);
  lines.push(`- 互审：${pkg.reviewPlan.mutualCheck}`);
  lines.push(`- 统稿：${pkg.reviewPlan.consolidation}`);
  lines.push("", "## 七、未决问题", "");
  if (!pkg.openQuestions.length) lines.push("（无）"); else for (const item of pkg.openQuestions) lines.push(`- ${item}`);
  lines.push("", "---", "", "本包由工作台从已保存的项目状态生成，交付范围为大纲、蓝图与策划方案。后续写作及核验建议由作者自行选用，不属于工作台待完成任务。");
  return lines.join("\n");
}
