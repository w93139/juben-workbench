import type { WorkbenchState } from "@/domain/workbench";
import { StudioReviewContent } from "./review-content";

export function StudioReviewArchives({ state }: { state: WorkbenchState }) {
  if (!state.reviewArchives.length) return null;
  return <section className="panel mt-5" aria-label="恢复的历史审查"><h2>备份中的历史成果</h2><p className="field-hint">以下内容来自导入文件，仅供查阅；文件中的通过声明不代表本机已重新审查或获得导出资格。</p>{state.reviewArchives.map(archive => <details className="archive-details mt-4" key={archive.id}><summary>蓝图版本 {archive.blueprintRevision ?? "未记录"} · {archive.review.passed ? "备份记录显示曾通过" : "备份记录未通过"} · {new Date(archive.importedAt).toLocaleString()}</summary><div className="p-4"><p>恢复后待重新审查 · 尚未真人试玩</p>{archive.review.issues.map((issue, i) => <p key={i}>{issue}</p>)}<StudioReviewContent review={archive.review} /></div></details>)}</section>;
}
