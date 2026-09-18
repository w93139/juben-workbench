import type { StudioJobView } from "./studio";
import type { WorkbenchState } from "./workbench";
import { archiveCurrentBlueprint } from "./blueprint-history";

export function applyMissingStudioJob(state: WorkbenchState, jobId: string): boolean {
  if (state.job?.jobId !== jobId) return false;
  const action = { analyze: "继续拆解", blueprint: "重新生成蓝图", review: "继续生成与审查" }[state.job.operation];
  return applyStudioJobView(state, { jobId, status: "failed", phase: "上次任务记录未找到", error: { code: "JOB_NOT_FOUND", message: `上次任务记录未找到，已结束等待，材料和已有成果均保留。没有自动重试模型；请核对后手动${action}（可能产生新的模型费用）。` } });
}

/** Mutates the latest IDB transaction snapshot; progress does not change the formal revision. */
export function applyStudioJobView(state: WorkbenchState, job: StudioJobView): boolean {
  if (state.job?.jobId !== job.jobId) return false;
  const active = state.job;
  if (state.sourceRevision !== active.sourceRevision || state.blueprintRevision !== active.blueprintRevision) {
    state.job = null; state.error = "材料或蓝图已变化，旧任务结果未应用。"; state.revision++; return true;
  }
  if (job.status === "running" && job.reviewProgress && state.reviewProgress?.checkpoint.runId === job.reviewProgress.runId && state.reviewProgress.checkpoint.revision > job.reviewProgress.revision) return false;
  let changed = state.job.phase !== job.phase;
  state.job.phase = job.phase;
  if (active.operation === "review" && job.reviewProgress) {
    const progress = job.reviewProgress;
    if (JSON.stringify(progress.review.blueprint) !== JSON.stringify(state.blueprint)) throw new Error("正文成果的蓝图与当前任务不一致，原成果保留。");
    const previous = state.reviewProgress;
    if (previous?.jobId === job.jobId && previous.checkpoint.runId !== progress.runId) throw new Error("正文批次编号与当前任务不一致，原成果保留。");
    const older = previous?.checkpoint.runId === progress.runId && previous.checkpoint.revision > progress.revision;
    if (!older && (previous?.jobId !== job.jobId || previous.checkpoint.revision !== progress.revision || job.status !== "running")) {
      state.reviewProgress = { jobId: job.jobId, blueprintRevision: active.blueprintRevision, checkpoint: progress };
      state.review = progress.review; state.reviewBlueprintRevision = active.blueprintRevision; changed = true;
    }
  }
  if (job.status === "running") return changed;
  state.job = null; state.revision++;
  if (job.status === "failed") {
    state.error = job.error?.message || "处理失败，请重试。";
    // A legacy server may not supply checkpoints; a failed attempt still invalidates old authority.
    if (active.operation === "review" && state.review?.passed) { state.review.passed = false; delete state.review.validationId; state.review.issues = ["本轮审查未完成，先前通过结论不用于本轮导出。"]; }
    return true;
  }
  const result = job.result;
  if (result?.kind === "analysis" && active.operation === "analyze") {
    state.analysis = result.analysis; state.analysisSourceRevision = state.sourceRevision; state.choiceId = null; state.blueprintSourceRevision = null;
  } else if (result?.kind === "blueprint" && active.operation === "blueprint") {
    if (state.blueprint) {
      if (state.versions.length >= 20) { state.error = "蓝图历史已达20份，新蓝图未替换旧稿；请先备份并整理历史，勿反复重新生成。"; return true; }
      archiveCurrentBlueprint(state);
    }
    state.blueprint = result.blueprint; state.blueprintRevision++; state.blueprintSourceRevision = state.sourceRevision; state.blueprintChoiceId = state.choiceId;
  } else if (result?.kind === "review" && active.operation === "review") {
    state.review = result; state.reviewBlueprintRevision = state.blueprintRevision; state.reviewProgress = null;
  } else throw new Error("返回结果与当前任务不一致，原内容已保留。");
  return true;
}
