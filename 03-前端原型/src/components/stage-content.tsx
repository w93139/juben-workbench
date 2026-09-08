"use client";

import Link from "next/link";
import { workflowStep } from "@/domain/workflow-view";
import { Check, FileText } from "lucide-react";
import type { DemoContent, Project, WorkflowStage } from "@/domain/models";
import { SourcePreview } from "./shared";
import { ResearchStage } from "./research";
import { BlueprintWorkbench } from "./blueprint";
import { checkBlueprint } from "@/domain/blueprint";

export function StageContent({ stage, content, project }: { stage: WorkflowStage; content: DemoContent | null; project: Project }) {
  if (stage.nextPhase === "B") return <ResearchStage project={project} stageId={stage.id} />;
  if (stage.id === "blueprint") return <BlueprintWorkbench project={project} />;
  const step = workflowStep(stage.id);
  const version = project.blueprint?.versions.at(-1);
  return <>
    <p className="field-hint">当前可浏览样例档案。模拟生成、双模型审查、问题处理及导出功能尚未开放。</p>
    {step.id === "generation" && <section className="panel" id="blueprint-review-ready" aria-label="蓝图审查准备"><div className="panel-title"><h2>蓝图审查准备</h2><span>未开始AI审查</span></div><p className="story-premise">{version ? `待审版本：${version.label}；该版本有 ${checkBlueprint(version.data).length} 项字段与关联提示。` : "请先在设计故事中保存草稿并建立蓝图版本。"}</p>{version && project.blueprint && JSON.stringify(version.data) !== JSON.stringify(project.blueprint.draft) && <p className="field-hint mt-3">已保存草稿与此版本不同。后续审查应明确选择版本，旧结果不会自动算作新版通过。</p>}<p className="field-hint mt-3">D阶段会提供两模型独立模拟审查、分歧与复查。当前没有运行新审查，也没有生成当前蓝图的正文。</p><Link className="text-link" href={`/projects/${project.id}/stages/blueprint`}>返回设计故事 →</Link></section>}
    <section className="panel"><div className="panel-title"><h2>{step.name}档案</h2><span>{content ? "原始样例 · 只读" : "尚未准备"}</span></div>
      {!content ? <div className="empty-state"><FileText size={26} className="mx-auto" /><h2>这部分内容还未建立</h2><p>先在项目总览记录备注与决定。后续将开放{step.name}的具体操作。</p></div> : <>

        {step.id === "generation" && <><h3 className="mt-4 mb-3 font-medium">正文材料</h3><p className="story-premise">原样例开本包 {content.kitVersion} 已包含以下材料。当前展示现有文件状态，没有调用模型重新生成。</p><div className="record-list">{content.deliverables.map((d) => <div className="record-item" key={d.label}><Check size={15} /><p>{d.label}</p><span className="tag ml-auto">{d.complete ? "原包已具备" : "待补齐"}</span></div>)}</div><p className="field-hint">后续开放分模块模拟生成、重新生成及版本差异查看。</p></>}
        {step.id === "generation" && <><h3 id="review-records" className="mt-6 mb-3 font-medium">审查记录</h3><p className="story-premise">顶部“检查与试玩”可分别查看 AI 结构审查、静态一致性检查、模拟测试与真人试玩。AI 结论来自历史蓝图审查；静态结果来自原开本包，不能外推为当前副本或真人体验已通过。</p>{content.documents.filter((d) => d.id === "review").map((doc) => <SourcePreview key={doc.id} document={doc} />)}<p className="field-hint">后续开放问题严重程度、证据位置、修改建议与处理状态。</p></>}
        {step.id === "export" && <><h3 className="mt-6 mb-3 font-medium">试玩记录</h3><span className="tag amber">尚未真人试玩</span><h3 className="serif text-lg mt-5">纸面之外，还需要一桌玩家。</h3><p className="story-premise mt-4">此项目没有真实试玩记录。计划时长与角色参与度均不能作为已验证的体验结论。</p><div className="record-grid">{["实际时长与各轮卡点", "每个角色的参与和选择", "线索购买与推理结果", "主持执行问题与修改建议"].map((item) => <div className="record-card" key={item}><p>{item}</p><span className="tag neutral mt-3">待记录</span></div>)}</div></>}
        {step.id === "export" && <><h3 className="mt-6 mb-3 font-medium">开本包与导出</h3><p className="field-hint">可以先导出标注“未试玩”的试玩包，再记录真人试玩、修改剧本并重新导出。当前导出功能尚未开放。</p><p className="story-premise">原始开本包 {content.kitVersion} 的使用说明可只读查看。导出与玩家材料隔离将在后续阶段实现，当前没有生成新的下载文件。</p>{content.documents.filter((d) => d.id === "kit").map((doc) => <SourcePreview key={doc.id} document={doc} />)}<div className="stage-callout mt-5"><strong>作者资料含谜底</strong><br />未来导出将区分玩家包与主持包，并明确标注审查范围及真人试玩状态。</div></>}
      </>}
    </section>
  </>;
}
