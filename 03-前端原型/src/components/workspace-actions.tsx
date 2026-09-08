"use client";

import Link from "next/link";
import { ArrowRight, ListChecks, ShieldCheck } from "lucide-react";
import type { DemoContent, Project, StageId } from "@/domain/models";
import { workflowStep, workflowSteps } from "@/domain/workflow-view";
import { researchStep } from "@/domain/research";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";
import { ChecksPanel, DecisionPanel } from "./workspace-panels";

export function WorkspaceActions({ project, content, stageId }: { project: Project; content: DemoContent | null; stageId?: StageId }) {
  const step = stageId ? workflowStep(stageId) : undefined;
  const nextStep = step ? workflowSteps[workflowSteps.indexOf(step) + 1] : undefined;
  const resume = workflowStep(researchStep(project.research));
  const needsConfirmation = step?.id === "analysis" && !project.readOnly && !project.research.directionConfirmed;
  const href = needsConfirmation ? "#creative-plan-form" : stageId ? nextStep ? `/projects/${project.id}/stages/${nextStep.id}` : `/projects/${project.id}` : project.readOnly ? "/projects/new?template=demo&start=research" : `/projects/${project.id}/stages/${resume.id}`;
  const label = needsConfirmation ? "下一步：确认方案" : stageId ? nextStep ? `下一步：${nextStep.name}` : "返回项目总览" : project.readOnly ? "开始自己的创作" : `继续：${resume.name}`;
  return <div className="workspace-actions" role="group" aria-label="项目常用操作">
    <div className="workspace-action-buttons">
      <Button asChild className="workspace-next"><Link href={href}><ArrowRight size={15} />{label}</Link></Button>
      <Dialog>
        <DialogTrigger asChild><Button variant="outline"><ListChecks size={15} />{project.readOnly ? "查看创作决定" : "修改决定状态"}</Button></DialogTrigger>
        <DialogContent className="workspace-action-dialog sm:max-w-2xl">
          <DialogTitle>{project.readOnly ? "创作决定说明" : "修改决定状态"}</DialogTitle>
          <DialogDescription>{project.readOnly ? "这里展示原始样例的决定记录。" : "在每条决定的下拉框中选择“已确定”“暂定”或“待解决”，选择后自动保存。"}</DialogDescription>
          <DecisionPanel project={project} />
        </DialogContent>
      </Dialog>
      <Dialog>
        <DialogTrigger asChild><Button variant="outline"><ShieldCheck size={15} />检查与试玩</Button></DialogTrigger>
        <DialogContent className="workspace-action-dialog">
          <DialogTitle>项目检查与试玩</DialogTitle>
          <DialogDescription>分别查看各类检查的范围和试玩状态，历史通过记录不代表已完成真人试玩。</DialogDescription>
          <ChecksPanel content={content} />
        </DialogContent>
      </Dialog>

    </div>
  </div>;
}
