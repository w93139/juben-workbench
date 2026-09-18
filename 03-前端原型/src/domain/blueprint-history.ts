import type { WorkbenchState } from "./workbench";

export type BlueprintVersion = WorkbenchState["versions"][number];
export interface HistorySelection { historyRevision: number; index: number; version: BlueprintVersion }
export function assertHistoryVersion(state: WorkbenchState, historyRevision: number, index: number, selected: BlueprintVersion) {
  if (state.job) throw new Error("任务仍在处理，请结束后再整理或恢复历史。");
  if (!Number.isInteger(index) || index < 0 || !state.versions[index] || state.historyRevision !== historyRevision || JSON.stringify(state.versions[index]) !== JSON.stringify(selected)) throw new Error("历史版本已在其他页面变化，请重新查看和选择。");
}
/** History cleanup must not invalidate a pending draft's formal revision. */
export function removeBlueprintHistory(state: WorkbenchState, historyRevision: number, index: number, selected: BlueprintVersion) {
  assertHistoryVersion(state, historyRevision, index, selected);
  state.versions.splice(index, 1); state.historyRevision++;
}
export function archiveCurrentBlueprint(state: WorkbenchState) {
  if (!state.blueprint) return;
  if (state.versions.length >= 20) throw new Error("蓝图历史已达20份，请在历史版本中备份并删除不再需要的旧版后重试；当前草稿和正式蓝图保留。");
  state.versions.push({ revision: state.blueprintRevision, data: state.blueprint }); state.historyRevision++;
}
