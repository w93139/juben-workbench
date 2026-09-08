"use client";

import type { Project, StageId } from "@/domain/models";
import { LoadError, Loading } from "../shared";
import { useResearchCatalog, ResearchBoundary } from "./common";
import { MaterialsStage } from "./materials";
import { AnalysisStage } from "./analysis";
import { MechanismsStage } from "./mechanisms";
import { DirectionStage } from "./direction";

export function ResearchStage({ project, stageId }: { project: Project; stageId: StageId }) {
  const catalog = useResearchCatalog();
  if (!catalog.data) return catalog.error ? <LoadError error={catalog.error} retry={() => void catalog.refetch()} /> : <Loading />;
  return <><ResearchBoundary readOnly={project.readOnly} />{stageId === "materials" && <MaterialsStage project={project} catalog={catalog.data} />}{stageId === "analysis" && <AnalysisStage project={project} catalog={catalog.data} />}{stageId === "mechanisms" && <MechanismsStage project={project} catalog={catalog.data} />}{stageId === "direction" && <DirectionStage project={project} catalog={catalog.data} />}</>;
}
