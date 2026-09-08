"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PlanDiscussion } from "./plan-discussion";
import type { Project } from "@/domain/models";
import { folderPlanCurrent } from "@/domain/folder-plan";
import { folderArchitecture, folderPlanChoices } from "@/mocks/folder-plans";
import { ServiceError } from "@/services/contracts";
import { useService } from "../providers";
import { Button } from "../ui/button";
import { ErrorMessage } from "../shared";
import { useResearchAction } from "./common";

export function FolderPlan({ project }: { project: Project }) {
  const service = useService();
  const client = useQueryClient();
  const action = useResearchAction(project);
  const mounted = useRef(true);
  const [runnerError, setRunnerError] = useState<unknown>(null);
  const plan = project.folderPlan;
  const current = folderPlanCurrent(project);
  const stale = !!plan && plan.sourceRevision !== project.research.materialRevision;
  const running = plan?.status === "running";
  const selected = folderPlanChoices.find((choice) => choice.id === plan?.selectedChoiceId);
  const count = project.research.documents.filter((document) => document.origin === "local-metadata").length;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!running || runnerError || action.isPending) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const next = await service.advanceFolderPlan(project.id, project.revision);
        client.setQueryData(["project", next.id], next);
        void client.invalidateQueries({ queryKey: ["projects"] });
      } catch (error) {
        if (!active) return;
        if (error instanceof ServiceError && error.code === "CONFLICT") void client.invalidateQueries({ queryKey: ["project", project.id] });
        else setRunnerError(error);
      }
    }, 700);
    return () => { active = false; clearTimeout(timer); };
  }, [running, runnerError, action.isPending, project.id, project.revision, service, client]);
  function start() { setRunnerError(null); action.mutate((revision) => service.startFolderPlan(project.id, revision)); }
  return <>
    <section className="panel" aria-label="剧本架构拆解">
      <div className="panel-title"><h2>拆解剧本架构</h2><span>本地模拟</span></div>
      <p className="story-premise">已登记 {count} 份文件。正式接入后，将先识别正文、核对材料，再提炼结构并提出原创方向。</p>
      <p className="stage-callout mt-3">当前仅保存文件名称和相对路径，未读取正文、未调用 OCR 或 AI。下面展示处理框架与通用预设建议，不是上传剧本的拆解结论。</p>
      <div className="flex flex-wrap gap-3 mt-4">
        {!running && <Button disabled={!count || action.isPending} onClick={start}>{plan ? "重新模拟拆解" : "开始模拟拆解"}</Button>}
        {running && <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate((revision) => service.cancelFolderPlan(project.id, revision))}>取消模拟拆解</Button>}
        <Link className="button-link secondary" href={`/projects/${project.id}/stages/materials`}>查看或补充材料</Link>
      </div>
      {plan && <div className="research-job mt-4"><p role="status">{stale ? "材料清单已变化，旧建议已过期；请重新模拟拆解。" : running ? plan.progress === 0 ? "正在模拟整理材料清单…" : "正在模拟安排拆解框架与建议…" : plan.status === "cancelled" ? "模拟已取消，材料清单保留。" : "流程模拟完成，正文待识别。"}</p><progress value={plan.progress} max={100} aria-label="拆解流程模拟进度" /><p className="field-hint output-path">本次计划目录：{plan.plannedPath ?? "未设置输出文件夹"}。仅记录位置，结果保存在浏览器中，尚未写出文件。</p></div>}
      {!!runnerError && <><ErrorMessage error={runnerError} /><Button variant="outline" onClick={() => setRunnerError(null)}>重试保存处理进度</Button></>}
      {action.feedback}
      <details className="archive-details mt-5" open={!current}><summary>查看六项架构拆解维度</summary><div className="research-form-grid p-4">{folderArchitecture.map((dimension) => <article className="record-card" key={dimension.title}><div className="panel-title"><h3>{dimension.title}</h3><span>待真实识别</span></div><p>{dimension.detail}</p><p className="field-hint">内容与来源位置：尚未提取。</p></article>)}</div></details>
    </section>
    <section className="panel" id="folder-plan" aria-label="大纲与写作方向建议">
      <div className="panel-title"><h2>选择大纲与写作方向</h2><span>原创方案 · 暂定</span></div>
      <p className="story-premise">{current ? "以下三个方向是独立的通用预设，仅用于体验选方案的流程，没有从你的文件内容推断故事。选好后可把大纲带入故事草稿，再细化人物、因果和线索。" : "先完成上方流程模拟，再比较三个通用方向。真实建议需在后续接入正文识别与模型服务后生成。"}</p>
      {current && <div className="record-list mt-5">{folderPlanChoices.map((choice) => <article className="record-card mb-4" key={choice.id}>
        <div className="panel-title"><h3>{choice.title}</h3><span>{selected?.id === choice.id ? "已选择 · 暂定" : "通用预设"}</span></div>
        <p>{choice.genre} · {choice.players} 人 · {choice.minutes} 分钟</p><p className="mt-2">{choice.experience}</p><p className="mt-3">{choice.premise}</p>
        <ol className="list-decimal pl-5 mt-3 space-y-2">{choice.outline.map((act) => <li key={act}>{act}</li>)}</ol>
        <p className="mt-3"><strong>可借鉴的抽象机制：</strong>{choice.mechanism}</p><p className="field-hint"><strong>迁移风险：</strong>{choice.risk}</p>
        <Button className="mt-4" variant={selected?.id === choice.id ? "default" : "outline"} aria-pressed={selected?.id === choice.id} disabled={action.isPending || selected?.id === choice.id} onClick={() => action.mutate((revision) => service.saveFolderDirection(project.id, revision, choice.id))}>{selected?.id === choice.id ? "已选择此方向" : `选择${choice.title.split("：")[1]}`}</Button>
      </article>)}</div>}

    </section>
    {!!plan?.proposalHistory.length && <details className="archive-details"><summary>已保存的方案历史（{plan.proposalHistory.length}）</summary><div className="p-4">{[...plan.proposalHistory].reverse().map(history => <details className="archive-details mt-3" key={history.id}><summary>{history.reason} · 材料版本 {history.sourceRevision}</summary><div className="p-4"><p className="field-hint">只读快照 · {history.savedAt} · {folderPlanChoices.find(c => c.id === history.choiceId)?.title}</p><p className="whitespace-pre-wrap">{history.data.premise}</p><p className="whitespace-pre-wrap mt-4">{history.data.truth}</p><p className="field-hint">{history.data.characters.length} 位角色、{history.data.clues.length} 条线索、{history.data.rounds.length} 轮。旧方案不会覆盖当前蓝图。</p></div></details>)}</div></details>}
    {current && selected && <PlanDiscussion key={`${project.id}:${plan?.sourceRevision}:${selected.id}`} project={project} />}
  </>;
}
