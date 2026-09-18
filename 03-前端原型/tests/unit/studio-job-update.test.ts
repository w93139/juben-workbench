import { expect, it } from "vitest";
import { applyStudioJobView, applyMissingStudioJob } from "@/domain/studio-job-update";
import { reviewCurrent } from "@/domain/workbench";
import type { StudioJobView } from "@/domain/studio";
import { createProjectBackup, parseProjectBackup, restoredProject } from "@/domain/project-backup";
import { backupFixture } from "../fixtures/project-backup";
import { reviewBlueprint, reviewCheckpoint } from "../fixtures/studio-review";

function fixture() {
  const value = backupFixture(); value.state.blueprint = reviewBlueprint();
  const jobId = crypto.randomUUID(); value.state.job = { jobId, operation: "review", sourceRevision: 2, blueprintRevision: 3, phase: "旧进度" };
  const view: StudioJobView = { jobId, status: "running", phase: "独立检查", reviewProgress: reviewCheckpoint() };
  return { ...value, view };
}
it("阶段进度只合并当前任务，保留同时落盘的草稿和历史CAS，不增加正式revision", () => {
  const { state, view } = fixture(), previous = structuredClone(state);
  expect(applyStudioJobView(state, view)).toBe(true); expect(state.review?.passed).toBe(false); expect(state.review?.artifacts).toHaveLength(9);
  expect(state.reviewProgress?.checkpoint).toEqual(view.reviewProgress); expect(state.revision).toBe(previous.revision);
  expect(state.blueprintDrafts).toEqual(previous.blueprintDrafts); expect(state.versions).toEqual(previous.versions); expect(state.historyRevision).toBe(previous.historyRevision);
  expect(reviewCurrent(state)).toBe(false); expect(applyStudioJobView(state, view)).toBe(false);
});
it("同批次低版本GET不回退内容或phase；终态保存最后报告后清任务，迟到GET零改动", () => {
  const { state, view } = fixture(); applyStudioJobView(state, view);
  const old = structuredClone(view); old.reviewProgress!.revision = 1; old.reviewProgress!.review.artifacts = []; old.phase = "较早阶段";
  expect(applyStudioJobView(state, old)).toBe(false); expect(state.job?.phase).toBe(view.phase); expect(state.review!.artifacts).toHaveLength(9);
  const failed = { ...view, status: "failed" as const, error: { code: "SYNTHETIC", message: "测试未完成" } }; failed.reviewProgress!.revision++;
  expect(applyStudioJobView(state, failed)).toBe(true); expect(state.job).toBeNull(); expect(state.error).toBe("测试未完成"); expect(state.reviewProgress?.checkpoint.revision).toBe(6);
  const final = structuredClone(state); expect(applyStudioJobView(state, old)).toBe(false); expect(state).toEqual(final);
});
it("新批次低版本可替换旧批次高版本，同任务换runId或换蓝图则拒绝", () => {
  const { state, view } = fixture(); applyStudioJobView(state, view);
  const second = { ...view, jobId: crypto.randomUUID(), reviewProgress: reviewCheckpoint(crypto.randomUUID(), 1) };
  state.job!.jobId = second.jobId; expect(applyStudioJobView(state, second)).toBe(true); expect(state.reviewProgress?.checkpoint.revision).toBe(1);
  const mismatch = structuredClone(second); mismatch.reviewProgress.runId = crypto.randomUUID(); expect(() => applyStudioJobView(state, mismatch)).toThrow("批次编号");
  const wrongBlueprint = structuredClone(second); wrongBlueprint.reviewProgress.review.blueprint.truth = "不同输入"; expect(() => applyStudioJobView(state, wrongBlueprint)).toThrow("蓝图与当前任务不一致");
});
it("旧通过结果不能在新失败后重新解锁，旧版无检查点失败也撤销当前导出资格", () => {
  const { state, view } = fixture(); expect(state.review?.passed).toBe(true); expect(reviewCurrent(state)).toBe(false);
  delete view.reviewProgress; applyStudioJobView(state, { ...view, status: "failed", error: { code: "OLD_SERVER", message: "未完成" } });
  expect(state.review?.passed).toBe(false); expect(state.review?.validationId).toBeUndefined(); expect(reviewCurrent(state)).toBe(false);
});
it("任务404释放也撤销旧通过资格，迟到404不能释放另一新任务", () => {
  const { state, view } = fixture(); const old = crypto.randomUUID();
  expect(applyMissingStudioJob(state, old)).toBe(false); expect(state.job?.jobId).toBe(view.jobId);
  expect(applyMissingStudioJob(state, view.jobId)).toBe(true); expect(state.job).toBeNull(); expect(state.review?.validationId).toBeUndefined(); expect(reviewCurrent(state)).toBe(false); expect(state.error).toContain("继续生成与审查");
});
it("v2备份保存阶段全文并剥离执行编号，v1仍可读但不能冒充支持部分成果", () => {
  const { project, state, view, now } = fixture(); applyStudioJobView(state, { ...view, status: "failed", error: { code: "TEST", message: "中断" } });
  const backup = createProjectBackup(project, state, true); expect(backup.schemaVersion).toBe(2);
  expect(backup.workbench.reviewProgress?.jobId).toBeNull(); expect(backup.workbench.reviewProgress?.checkpoint.runId).toBeNull();
  expect(backup.workbench.reviewProgress?.checkpoint.review).toEqual(view.reviewProgress!.review);
  const restored = restoredProject(parseProjectBackup(JSON.stringify(backup)), crypto.randomUUID(), "b".repeat(64), now).workbench;
  expect(restored.reviewProgress?.checkpoint.review.artifacts).toHaveLength(9); expect(restored.reviewProgress?.checkpoint.runId).toBeNull(); expect(restored.job).toBeNull(); expect(reviewCurrent(restored)).toBe(false);
  expect(() => parseProjectBackup(JSON.stringify({ ...backup, schemaVersion: 1 }))).toThrow("版本或内容不完整");
  const legacy = { ...backup, schemaVersion: 1, workbench: { ...backup.workbench, reviewProgress: undefined } };
  expect(parseProjectBackup(JSON.stringify(legacy)).workbench.reviewProgress).toBeNull();
});
