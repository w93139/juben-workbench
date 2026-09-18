import { blueprintCurrent, type WorkbenchState } from "@/domain/workbench";
import { reviewUnits } from "@/domain/studio-production";
import { StudioReviewContent } from "./review-content";

const stateLabels = { pending: "尚未开始", running: "正在处理", saved: "已保存", interrupted: "结果尚未保存，继续前请核对费用" };
export function StudioReviewProgress({ state }: { state: WorkbenchState }) {
  const saved = state.reviewProgress;
  if (saved) {
    const checkpoint = saved.checkpoint, current = blueprintCurrent(state) && saved.blueprintRevision === state.blueprintRevision && checkpoint.runId !== null;
    return <section className="panel mt-5" aria-label="已保存的阶段成果"><h2>{current ? "已保存的阶段成果" : checkpoint.runId === null ? "备份中的未完成成果" : "旧蓝图的阶段成果"}</h2><p className="mt-3">已保存 {checkpoint.steps.filter(step => step.state === "saved").length}/{reviewUnits.length} 阶段 · 尚未完成整套验证</p><p className="field-hint mt-2">{current ? "刷新只查询进度。手动继续会复用相同蓝图和模型配置的已保存阶段；未保存请求可能已收费，再次调用仍可能产生费用。" : "以下内容仅供查阅；导入文件不能恢复原项目的执行权限，旧蓝图成果不能用于当前导出。"}</p><ul className="mt-3 space-y-1">{checkpoint.steps.map(step => <li key={step.id}>{reviewUnits.find(unit => unit.id === step.id)?.label}：{({ pending: "尚未开始", running: "正在处理", saved: "已保存", interrupted: "结果尚未保存，继续前请核对费用" })[step.state]}</li>)}</ul>{checkpoint.generation && <details className="archive-details mt-4"><summary>正文生成单元：已保存 {checkpoint.generation.units.filter(unit => unit.state === "saved").length}/{checkpoint.generation.units.length}</summary><ul className="p-4 space-y-2">{checkpoint.generation.units.map(unit => <li className="break-all" key={unit.id}>{unit.label}：{stateLabels[unit.state]}</li>)}</ul></details>}<StudioReviewContent review={checkpoint.review} /></section>;
  }
  return state.review ? <section className="panel mt-5" aria-label="正文与完整报告"><h2>{blueprintCurrent(state) && state.reviewBlueprintRevision === state.blueprintRevision ? "正文与完整报告" : "旧蓝图的正文与报告"}</h2><p className="field-hint">模型意见及原文依据；体验仍待真人试玩。</p><StudioReviewContent review={state.review} /></section> : null;
}
