import type { StageId } from "./models";

/** Presentation groups only; persisted stage IDs and historical links stay stable. */
export const workflowSteps: { id: StageId; name: string; stages: StageId[] }[] = [
  { id: "materials", name: "准备材料", stages: ["materials"] },
  { id: "analysis", name: "拆解与方向", stages: ["analysis", "mechanisms", "direction"] },
  { id: "blueprint", name: "创作蓝图", stages: ["blueprint"] },
  { id: "generation", name: "交叉验证与导出", stages: ["generation", "review", "playtest", "export"] },
];

export function workflowStep(stageId: StageId) {
  return workflowSteps.find((step) => step.stages.includes(stageId))!;
}
