"use client";

import type { Project, StageId } from "@/domain/models";
import { LoadError, Loading } from "../shared";
import { useResearchCatalog, ResearchBoundary } from "./common";
import { MaterialsStage } from "./materials";
import { CreativePlan } from "./plan";

export function ResearchStage({ project, stageId }: { project: Project; stageId: StageId }) {
  const catalog = useResearchCatalog();
  if (!catalog.data) return catalog.error ? <LoadError error={catalog.error} retry={() => void catalog.refetch()} /> : <Loading />;
  return <><ResearchBoundary readOnly={project.readOnly} />{stageId === "materials" ? <MaterialsStage project={project} catalog={catalog.data} /> : <CreativePlan key={project.id} project={project} catalog={catalog.data} />}</>;
}
