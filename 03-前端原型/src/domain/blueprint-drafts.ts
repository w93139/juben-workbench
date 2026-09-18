import { blueprintDraftSchema, type BlueprintDraft, type WorkbenchState } from "./workbench";

/** These helpers mutate only the caller's transaction snapshot. */
export function putBlueprintDraft(state: WorkbenchState, draft: BlueprintDraft, expected: number | null) {
  const valid = blueprintDraftSchema.parse(draft);
  const index = state.blueprintDrafts.findIndex(item => item.id === valid.id);
  const prior = state.blueprintDrafts[index];
  if ((prior?.revision ?? null) !== expected || valid.revision !== (expected ?? 0) + 1) throw new Error("草稿已在其他页面变化，当前输入保留，请重新查看草稿。");
  if (prior && (prior.baseRevision !== valid.baseRevision || prior.baseBlueprintRevision !== valid.baseBlueprintRevision)) throw new Error("草稿基准不能被自动改写，请另存一份。");
  if (!prior && state.blueprintDrafts.length >= 12) throw new Error("已保留12份蓝图草稿，请查看并删除不再需要的草稿后重试；当前输入保留。");
  if (prior) state.blueprintDrafts[index] = valid; else state.blueprintDrafts.push(valid);
}
export function removeBlueprintDraft(state: WorkbenchState, id: string, revision: number, allowMissing = false) {
  const prior = state.blueprintDrafts.find(item => item.id === id);
  if (!prior && allowMissing) return;
  if (!prior || prior.revision !== revision) throw new Error("草稿已变化或已移除，请重新查看。");
  state.blueprintDrafts = state.blueprintDrafts.filter(item => item.id !== id);
}
export function applyBlueprintDraft(state: WorkbenchState, id: string, revision: number) {
  const draft = state.blueprintDrafts.find(item => item.id === id);
  if (!draft || draft.revision !== revision) throw new Error("草稿已变化或已移除，请重新查看。");
  if (state.revision !== draft.baseRevision || state.blueprintRevision !== draft.baseBlueprintRevision) throw new Error("项目已在其他页面更新，草稿仍保留；请先对照当前蓝图，再决定是否应用。");
  if (state.job) throw new Error("任务仍在处理，草稿已保留，请任务结束后再提交。");
  if (!state.blueprint) throw new Error("正式蓝图尚不存在，草稿已保留。");
  if (state.versions.length >= 20) throw new Error("蓝图历史已达20份，本次未保存；草稿和现有版本已保留。历史整理入口将在后续阶段补齐，目前请保留草稿。");
  state.versions.push({ revision: state.blueprintRevision, data: state.blueprint });
  state.blueprint = draft.data; state.blueprintRevision++; state.revision++;
  removeBlueprintDraft(state, id, revision);
}
