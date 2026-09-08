"use client";

import { usesFolderPlan } from "@/domain/folder-plan";
import { FolderPlan } from "./folder-plan";
import type { Project, StageId } from "@/domain/models";
import { LoadError, Loading } from "../shared";
import { useService } from "../providers";
import { Button } from "../ui/button";
import { useResearchAction, useResearchCatalog, ResearchBoundary } from "./common";
import { MaterialsStage } from "./materials";
import { CreativePlan } from "./plan";

export function ResearchStage({ project, stageId }: { project: Project; stageId: StageId }) {
  const catalog = useResearchCatalog();
  const service = useService();
  const action = useResearchAction(project);
  if (stageId !== "materials" && usesFolderPlan(project)) return <FolderPlan key={project.id} project={project} />;
  if (!catalog.data) return catalog.error ? <LoadError error={catalog.error} retry={() => void catalog.refetch()} /> : <Loading />;
  return <>{stageId !== "materials" && !project.readOnly && <section className="panel"><h2>在上下文里确定新方案</h2><p className="field-hint mt-3">当前保留旧版研究页。导入自己的原剧本后，可以进入“拆解→方向建议→对话→方案蓝图”；旧研究记录和已有蓝图都会保留。</p><Button className="mt-3" disabled={action.isPending || !project.research.documents.some(d => d.origin === "local-metadata")} onClick={() => action.mutate(revision => service.startFolderPlan(project.id, revision))}>使用方案对话流程</Button>{action.feedback}</section>}{!usesFolderPlan(project) && <ResearchBoundary readOnly={project.readOnly} />}{stageId === "materials" ? <MaterialsStage project={project} catalog={catalog.data} /> : <CreativePlan key={project.id} project={project} catalog={catalog.data} />}</>;
}
