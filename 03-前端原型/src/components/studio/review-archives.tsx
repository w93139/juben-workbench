import type { WorkbenchState } from "@/domain/workbench";
import { moduleLabels } from "@/domain/production";
import type { StudioAudit } from "@/domain/studio";

const reportLabels = { designGate: "蓝图检查", independentA: "独立检查A", independentB: "独立检查B", mutualA: "相互核对A", mutualB: "相互核对B", coordinator: "主模型复核" } as const;
function auditText(report: StudioAudit) { return [report.summary, ...report.blocking.map(s => `待解决：${s}`), ...report.warnings.map(s => `提醒：${s}`), ...report.evidence.map(e => `${e.location}\n${e.quote}\n${e.conclusion}`)].join("\n\n"); }
export function StudioReviewArchives({ state }: { state: WorkbenchState }) {
  if (!state.reviewArchives.length) return null;
  return <section className="panel mt-5" aria-label="恢复的历史审查"><h2>备份中的历史成果</h2><p className="field-hint">以下内容来自导入文件，仅供查阅；文件中的通过声明不代表本机已重新审查或获得导出资格。</p>{state.reviewArchives.map(archive => <details className="archive-details mt-4" key={archive.id}><summary>蓝图版本 {archive.blueprintRevision ?? "未记录"} · {archive.review.passed ? "备份记录显示曾通过" : "备份记录未通过"} · {new Date(archive.importedAt).toLocaleString()}</summary><div className="p-4"><p>恢复后待重新审查 · 尚未真人试玩</p>{archive.review.issues.map((issue, i) => <p key={i}>{issue}</p>)}{archive.review.artifacts.map(artifact => <details className="archive-details mt-3" key={artifact.id}><summary>{moduleLabels[artifact.module]} · {artifact.title}</summary><pre className="text-preview">{artifact.content}</pre></details>)}{Object.entries(archive.review.reports).map(([key, report]) => report && <details className="archive-details mt-3" key={key}><summary>{reportLabels[key as keyof typeof reportLabels]}</summary><pre className="text-preview">{auditText(report)}</pre></details>)}</div></details>)}</section>;
}
