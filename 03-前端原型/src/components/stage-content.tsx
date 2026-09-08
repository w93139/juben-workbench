"use client";

import { workflowStep } from "@/domain/workflow-view";
import { FileText } from "lucide-react";
import type { DemoContent, Project, WorkflowStage } from "@/domain/models";
import { SourcePreview } from "./shared";
import { ResearchStage } from "./research";
import { BlueprintWorkbench } from "./blueprint";
import { ProductionWorkbench } from "./production";

export function StageContent({ stage, content, project }: { stage: WorkflowStage; content: DemoContent | null; project: Project }) {
  if (stage.nextPhase === "B") return <ResearchStage project={project} stageId={stage.id} />;
  if (stage.id === "blueprint") return <BlueprintWorkbench project={project} />;
  const step = workflowStep(stage.id);
  if (step.id === "generation") return <ProductionWorkbench project={project} content={content} reviewFirst={stage.id === "review"} />;
  return <>
    <p className="field-hint">当前可浏览试玩与导出样例档案。试玩录入及导出将在E阶段开放。</p>
    <section className="panel"><div className="panel-title"><h2>{step.name}档案</h2><span>{content ? "原始样例 · 只读" : "尚未准备"}</span></div>
      {!content ? <div className="empty-state"><FileText size={26} className="mx-auto" /><h2>这部分内容还未建立</h2><p>先在项目总览记录备注与决定。后续将开放{step.name}的具体操作。</p></div> : <>

        {step.id === "export" && <><h3 className="mt-6 mb-3 font-medium">试玩记录</h3><span className="tag amber">尚未真人试玩</span><h3 className="serif text-lg mt-5">纸面之外，还需要一桌玩家。</h3><p className="story-premise mt-4">此项目没有真实试玩记录。计划时长与角色参与度均不能作为已验证的体验结论。</p><div className="record-grid">{["实际时长与各轮卡点", "每个角色的参与和选择", "线索购买与推理结果", "主持执行问题与修改建议"].map((item) => <div className="record-card" key={item}><p>{item}</p><span className="tag neutral mt-3">待记录</span></div>)}</div></>}
        {step.id === "export" && <><h3 className="mt-6 mb-3 font-medium">开本包与导出</h3><p className="field-hint">可以先导出标注“未试玩”的试玩包，再记录真人试玩、修改剧本并重新导出。当前导出功能尚未开放。</p><p className="story-premise">原始开本包 {content.kitVersion} 的使用说明可只读查看。导出与玩家材料隔离将在后续阶段实现，当前没有生成新的下载文件。</p>{content.documents.filter((d) => d.id === "kit").map((doc) => <SourcePreview key={doc.id} document={doc} />)}<div className="stage-callout mt-5"><strong>作者资料含谜底</strong><br />未来导出将区分玩家包与主持包，并明确标注审查范围及真人试玩状态。</div></>}
      </>}
    </section>
  </>;
}
