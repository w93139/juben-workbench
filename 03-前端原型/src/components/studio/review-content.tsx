import type { ArchivedStudioReview, StudioAudit } from "@/domain/studio";
import { moduleLabels } from "@/domain/production";

export const reportLabels = { designGate: "蓝图检查", independentA: "独立检查A", independentB: "独立检查B", mutualA: "相互核对A", mutualB: "相互核对B", coordinator: "主模型复核" } as const;
function AuditContent({ report }: { report: StudioAudit }) {
  return <div className="p-4 space-y-4"><p className="whitespace-pre-wrap">{report.summary}</p><p>内容完整：{report.contentComplete ? "报告认为满足" : "未通过"} · 受众隔离：{report.playerHostIsolation ? "报告认为满足" : "未通过"} · 发现处理：{report.findingsAddressed ? "报告认为满足" : "未通过"}</p>{report.blocking.length > 0 && <div><h4>阻断问题</h4>{report.blocking.map((text, i) => <p className="whitespace-pre-wrap mt-2" key={i}>{text}</p>)}</div>}{report.warnings.length > 0 && <div><h4>提醒与待试玩事项</h4>{report.warnings.map((text, i) => <p className="whitespace-pre-wrap mt-2" key={i}>{text}</p>)}</div>}<div><h4>报告依据</h4>{report.evidence.map((evidence, i) => <div className="mt-4" key={i}><p className="whitespace-pre-wrap">{evidence.location}</p><blockquote className="whitespace-pre-wrap my-2 border-l-2 pl-3">{evidence.quote}</blockquote><p className="whitespace-pre-wrap">{evidence.conclusion}</p></div>)}</div><p>真人试玩：尚未进行</p></div>;
}
export function StudioReviewContent({ review }: { review: ArchivedStudioReview }) {
  return <div className="studio-review-content"><h3 className="mt-4">正文材料 · {review.artifacts.length} 份</h3>{review.artifacts.map(artifact => <details className="archive-details mt-3" key={artifact.id}><summary>{moduleLabels[artifact.module]} · {artifact.title}</summary><div className="p-4"><p className="field-hint">{artifact.audience === "host" ? "仅主持查阅" : "玩家材料"} · 角色：{artifact.characterId ? review.blueprint?.characters.find(role => role.id === artifact.characterId)?.name ?? artifact.characterId : "不限定角色"} · 轮次：{artifact.roundId ? review.blueprint?.rounds.find(round => round.id === artifact.roundId)?.name ?? artifact.roundId : "未指定"}</p><pre className="text-preview">{artifact.content}</pre><p className="field-hint break-all">蓝图关联：{artifact.sourceIds.join("、")}</p></div></details>)}<h3 className="mt-6">六阶段审查报告</h3>{Object.entries(reportLabels).map(([key, label]) => {
    const report = review.reports[key as keyof typeof reportLabels];
    return report ? <details className="archive-details mt-3" key={key}><summary>{label} · 已保存报告</summary><AuditContent report={report} /></details> : <p className="mt-3 field-hint" key={key}>{label} · 尚未完成</p>;
  })}</div>;
}
