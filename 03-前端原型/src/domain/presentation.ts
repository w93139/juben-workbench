import type { BlueprintData } from "./blueprint";
import { researchStep } from "./research";
import type { DemoContent, Project, StageId } from "./models";

export const knowledgeLabels: Record<string, string> = {
  K: "已知事实", O: "见过现象或文档说法", C: "知道并隐瞒", P: "只知部分", F: "持有错误信念", "—": "不知道",
};

export function knowledgeKindLabel(kind: string) {
  if (kind === "false_belief") return "角色的错误信念";
  if (kind === "document_statement") return "文档记载，未必是真相";
  if (kind.startsWith("concealed") || kind.startsWith("private")) return "角色私密信息";
  if (kind.startsWith("observ")) return "角色可见的现象";
  if (kind === "actor_intent") return "人物行为意图";
  return "作者设定的事实";
}

export function currentStage(project: Project): StageId {
  if (project.production) return "generation";
  if (project.blueprint) return "blueprint";
  if (project.research.documents.length > 0) return researchStep(project.research);
  return project.template === "names-beyond" ? "playtest" : "materials";
}

export function formatDate(iso: string | null) {
  if (!iso) return "原始样例";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function getStats(content: DemoContent | null, blueprint?: BlueprintData) {
  const current = blueprint ?? content;
  return [
    { label: "故事角色", value: current?.characters.length ?? 0, unit: "位" },
    { label: "人物关系", value: current?.relationships.length ?? 0, unit: "条" },
    { label: "信息记录", value: current?.knowledge.length ?? 0, unit: "条" },
    { label: "线索材料", value: current?.clues.length ?? 0, unit: "份" },
  ];
}
