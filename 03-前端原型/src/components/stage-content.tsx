"use client";

import type { DemoContent, Project, WorkflowStage } from "@/domain/models";
import { workflowStep } from "@/domain/workflow-view";
import { ResearchStage } from "./research";
import { BlueprintWorkbench } from "./blueprint";
import { ProductionWorkbench } from "./production";
import { ExportWorkbench } from "./export";

export function StageContent({ stage, content, project }: { stage: WorkflowStage; content: DemoContent | null; project: Project }) {
  if (stage.nextPhase === "B") return <ResearchStage project={project} stageId={stage.id} />;
  if (stage.id === "blueprint") return <BlueprintWorkbench project={project} />;
  if (workflowStep(stage.id).id === "generation") return <ProductionWorkbench project={project} content={content} reviewFirst={stage.id === "review"} />;
  return <ExportWorkbench project={project} content={content} />;
}
