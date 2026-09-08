"use client";
import Link from "next/link";
import { AppFrame } from "./app-frame";
import { useProject } from "./providers";
import { LoadError, Loading } from "./shared";
import { EditProject } from "./workspace-panels";
import { workflowStep, workflowSteps } from "@/domain/workflow-view";
import { OutputLocation } from "./output-settings";
import { Studio } from "./studio";
import type { StageId } from "@/domain/models";

export function WorkspacePage({ projectId, stageId }: { projectId: string; stageId?: StageId }) {
  const query = useProject(projectId); const project = query.data;
  const step = workflowStep(stageId ?? "materials"); const number = workflowSteps.indexOf(step) + 1;
  return <AppFrame title={step.name} projectId={projectId} workspace>
    {query.isPending ? <Loading /> : !project ? <LoadError error={query.error} retry={() => void query.refetch()} /> : project.readOnly ? <section className="panel"><h1>历史样例</h1><p>原始档案保持只读。请通过左侧加号上传你要改写的剧本。</p></section> : <>
      <div className="workspace-fixed-header" aria-label="当前项目与创作流程"><header className="workspace-header"><div className="project-title-row"><h1 className="serif" title={project.title}>{project.title}</h1><EditProject project={project} label="改名" iconOnly /></div></header>
      <nav className="project-workflow" aria-label="创作流程">{workflowSteps.map((item, i) => <Link key={item.id} href={`/projects/${projectId}/stages/${item.id}`} aria-current={item === step ? "step" : undefined}><span>{i + 1}</span>{item.name}</Link>)}</nav>
      <OutputLocation key={project.id} project={project} stage="export" /></div>
      <Studio key={project.id} project={project} step={number} />
    </>}
  </AppFrame>;
}
