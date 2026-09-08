import { blueprintDataSchema, emptyBlueprintData, type BlueprintData, type BlueprintWorkspace } from "@/domain/blueprint";
import type { DemoContent, Project } from "@/domain/models";
import { ServiceError } from "./contracts";

function invalid(message: string): never { throw new ServiceError("INVALID_INPUT", message); }

export function demoBlueprint(demo: DemoContent): BlueprintWorkspace {
  const knowledgeStates: Record<string, BlueprintData["knowledge"][number]["state"]> = { K: "known", O: "partial", P: "partial", C: "hidden", F: "false", "—": "unknown" };
  const knowledgeMeanings: Record<string, string> = { K: "已知", O: "观察过现象或记录，不能等同客观真相", P: "部分知道", C: "知道但隐瞒", F: "错误认知", "—": "未知" };
  return {
    revision: 0, savedAt: null, versions: [],
    sourceLabel: `内置《${demo.title}》${demo.blueprintVersion}历史快照；缺少的关联、发放条件与主持细节需补充；历史检查不适用于本草稿`,
    draft: {
      ...emptyBlueprintData(), premise: demo.premise,
      truth: demo.claims.filter((v) => v.tier === "required").map((v) => `${v.id}：${v.statement}`).join("\n"),
      characters: structuredClone(demo.characters),
      relationships: demo.relationships.map((v) => ({ id: v.id, fromId: v.participants[0] ?? "", toId: v.participants[1] ?? "", publicVersion: v.publicVersion, truth: v.underlyingFacts, consequence: v.leverage })),
      events: demo.events.map((v) => ({ ...v, causes: [] })),
      knowledge: demo.knowledge.flatMap((v) => Object.entries(v.initial).map(([characterId, state]) => ({ id: `${v.id}-${characterId}`, characterId, factId: "", roundId: "", state: knowledgeStates[state] ?? "unknown", detail: `${v.statement}\n历史初始状态代码：${state}（${knowledgeMeanings[state] ?? "待确认原始含义"}）；知识性质：${v.kind}。具体对应事实和轮次待关联。` }))),
      claims: demo.claims.map((v) => ({ id: v.id, statement: v.statement, required: v.tier === "required" })),
      clues: demo.clues.map((v) => ({ ...structuredClone(v), roundId: "", characterIds: [], access: "" })),
      rounds: demo.rounds.map((v) => ({ ...v, activity: "", reveal: "" })),
    },
  };
}

export function initialize(project: Project, mode: "blank" | "demo", demo: DemoContent, now: string) {
  if (project.blueprint) invalid("蓝图已经建立，请编辑当前草稿，原有内容不会被覆盖。");
  if (mode !== "blank" && mode !== "demo") invalid("请选择空白蓝图或演示蓝图。");
  if (mode === "demo" && project.template !== "names-beyond") invalid("只有演示副本可以载入《名字之外》蓝图；当前项目可建立空白蓝图。");
  project.blueprint = mode === "demo" ? demoBlueprint(demo) : { draft: emptyBlueprintData(), revision: 0, savedAt: null, versions: [], sourceLabel: "用户建立的空白原创蓝图" };
  project.blueprint.savedAt = now;
  project.blueprint.revision = 1;
}

export function save(project: Project, input: BlueprintData, now: string) {
  if (!project.blueprint) invalid("请先建立蓝图。");
  const result = blueprintDataSchema.safeParse(input);
  if (!result.success) invalid(`无法保存蓝图：${result.error.issues[0]?.message ?? "请检查输入长度、编号和数字格式"}。原有草稿已保留。`);
  project.blueprint.draft = result.data;
  project.blueprint.savedAt = now;
  project.blueprint.revision += 1;
}

export function publish(project: Project, label: string, now: string, uuid: () => string) {
  if (!project.blueprint) invalid("请先建立并保存蓝图。");
  if (typeof label !== "string" || !label.trim() || label.trim().length > 80) invalid("请填写1至80个字符的版本名称。");
  if (project.blueprint.versions.length >= 20) invalid("当前项目已保留20个蓝图版本；请先备份并另建项目，现有版本不会被删除。");
  const id = `blueprint-version-${uuid()}`;
  if (project.blueprint.versions.some((v) => v.id === id)) invalid("版本编号冲突，请重试；原版本已保留。");
  project.blueprint.versions.push({ id, label: label.trim(), createdAt: now, data: structuredClone(project.blueprint.draft) });
  project.blueprint.revision += 1;
  project.blueprint.savedAt = now;
}
