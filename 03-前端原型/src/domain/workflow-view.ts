import type { StageId } from "./models";

/** Presentation groups only; persisted stage IDs and historical links stay stable. */
export const workflowSteps: { id: StageId; name: string; stages: StageId[] }[] = [
  { id: "materials", name: "准备材料", stages: ["materials"] },
  { id: "analysis", name: "确定创作方案", stages: ["analysis", "mechanisms", "direction"] },
  { id: "blueprint", name: "设计故事", stages: ["blueprint"] },
  { id: "generation", name: "生成与检查", stages: ["generation", "review"] },
  { id: "export", name: "试玩与导出", stages: ["playtest", "export"] },
];

export function workflowStep(stageId: StageId) {
  return workflowSteps.find((step) => step.stages.includes(stageId))!;
}
