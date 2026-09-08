"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, ListChecks, ShieldCheck } from "lucide-react";
import type { DemoContent, Project, StageId, WorkflowStage } from "@/domain/models";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";
import { ChecksPanel, DecisionPanel } from "./workspace-panels";

export function WorkspaceActions({ project, content, stageId, workflow }: { project: Project; content: DemoContent | null; stageId?: StageId; workflow: WorkflowStage[] }) {
  const currentIndex = workflow.findIndex((stage) => stage.id === stageId);
  const nextStage = currentIndex >= 0 ? workflow[currentIndex + 1] : undefined;
  const researchHref = project.readOnly ? "/projects/new?template=demo&start=research" : `/projects/${project.id}/stages/materials`;
  return <div className="workspace-actions" role="group" aria-label="项目常用操作">
    <div className="workspace-action-buttons">
      {stageId && <Button asChild className="workspace-next"><Link href={nextStage ? `/projects/${project.id}/stages/${nextStage.id}` : `/projects/${project.id}`}><ArrowRight size={15} />{nextStage ? `下一步：${nextStage.name}` : "返回项目总览"}</Link></Button>}
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
      {stageId !== "materials" && <Button asChild variant={stageId ? "outline" : "default"}><Link href={researchHref}><BookOpen size={15} />继续参考研究</Link></Button>}
    </div>
  </div>;
}

export function WorkspaceActionHint({ project, stageId }: { project: Project; stageId?: StageId }) {
  return <p className="field-hint workspace-action-hint">{stageId === "materials" ? "点击“下一步：参考本拆解”进入下一页。开始拆解前仍需完成校对和阅读范围确认；原始样例仅供浏览。" : project.readOnly ? "原始样例为只读。点击“继续参考研究”先创建副本，再到材料中心载入练习包；修改决定状态也需要副本。" : "点击“继续参考研究”进入材料中心，载入练习包或继续已有进度；点击“修改决定状态”可选择“暂定”等状态。"}{stageId && " 顶部下一步仅切换页面，不代表本阶段已完成；尚未开放的功能仍为只读摘要。"}</p>;
}
