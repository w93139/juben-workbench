import { expect, it } from "vitest";
import { createProjectBackup, parseProjectBackup, projectBackupFingerprint, restoredProject, serializeProjectBackup, PROJECT_BACKUP_BYTES } from "@/domain/project-backup";
import { applyBlueprintDraft } from "@/domain/blueprint-drafts";
import { reviewCurrent } from "@/domain/workbench";
import { backupFixture } from "../fixtures/project-backup";

it("完整备份保留材料、要求、20历史/12草稿、旧字段、六类正文及六报告，不改变原项目", async () => {
  const { project, state, now } = backupFixture(); const original = structuredClone({ project, state });
  const backup = createProjectBackup(project, state, true, now); const serialized = serializeProjectBackup(backup); const parsed = parseProjectBackup(serialized);
  expect(parsed.workbench.documents).toEqual(state.documents); expect(parsed.workbench.analysis).toEqual(state.analysis); expect(parsed.workbench.instructions).toBe(state.instructions);
  expect(parsed.workbench.versions).toEqual(state.versions); expect(parsed.workbench.blueprintDrafts).toEqual(state.blueprintDrafts);
  expect(parsed.workbench.review?.artifacts).toEqual(state.review!.artifacts); expect(parsed.workbench.review?.reports).toEqual(state.review!.reports); expect(parsed.workbench.review?.passed).toBe(true);
  expect(parsed.project.blueprint).toEqual(project.blueprint); expect(parsed.project.production?.artifacts[0].content).toBe("保留旧版正文");
  expect(serialized).not.toContain(state.review!.validationId); expect(serialized).not.toContain("/test-output-only"); expect(parsed.project.production?.jobs[0]).toMatchObject({ status: "cancelled", simulateFailure: false });
  expect({ project, state }).toEqual(original);
  const recovered = restoredProject(parsed, crypto.randomUUID(), await projectBackupFingerprint(parsed), now);
  expect(recovered.project.id).not.toBe(project.id); expect(recovered.project.revision).toBe(0); expect(recovered.project.readOnly).toBe(false);
  expect(recovered.workbench.revision).toBe(state.revision); expect(recovered.workbench.job).toBeNull(); expect(recovered.workbench.review).toBeNull(); expect(reviewCurrent(recovered.workbench)).toBe(false);
  expect(recovered.workbench.reviewArchives[0].review).toEqual(parsed.workbench.review);
  expect(() => applyBlueprintDraft(recovered.workbench, state.blueprintDrafts[0].id, 1)).toThrow("项目已在其他页面更新");
  const again = createProjectBackup(recovered.project, recovered.workbench, true, now);
  expect(again.workbench.reviewArchives).toEqual(recovered.workbench.reviewArchives); expect(again.workbench.review).toBeNull();
});
it("部分失败审查原样保留，缺完整链的伪通过拒绝", () => {
  const { project, state } = backupFixture(); state.review!.passed = false; state.review!.reports = { designGate: state.review!.reports.designGate }; state.review!.issues = ["中途停止"];
  const backup = createProjectBackup(project, state, true); expect(backup.workbench.review).toMatchObject({ passed: false, issues: ["中途停止"] });
  backup.workbench.review!.passed = true; expect(() => parseProjectBackup(JSON.stringify(backup))).toThrow("内容不完整");
});
it("当前运行任务拒绝备份，缺失创作记录保留明确标记", () => {
  const { project, state } = backupFixture(); state.job = { jobId: crypto.randomUUID(), operation: "review", phase: "处理中", sourceRevision: 2, blueprintRevision: 3 };
  expect(() => createProjectBackup(project, state, true)).toThrow("任务"); state.job = null;
  expect(createProjectBackup(project, state, false).authoringRecordExists).toBe(false);
});
it.each(["{broken", '{"schemaVersion":3,"projects":[]}', '{"format":"juben-workbench/project-backup","schemaVersion":99}'])("损坏、旧索引或未知版本拒绝：%s", text => expect(() => parseProjectBackup(text)).toThrow());
it("超64MiB文件拒绝，不截取尾部后尝试导入", () => expect(() => parseProjectBackup(" ".repeat(PROJECT_BACKUP_BYTES + 1))).toThrow("64 MiB"));
it("传入目录授权在新副本再次清空，权限字段不能进入历史审查", async () => {
  const { project, state, now } = backupFixture(); const backup = createProjectBackup(project, state, true);
  backup.project.outputSettings.rootPath = "/should-not-restore";
  const restored = restoredProject(backup, crypto.randomUUID(), await projectBackupFingerprint(backup), now); expect(restored.project.outputSettings.rootPath).toBe("");
  const corrupted = JSON.parse(serializeProjectBackup(backup)); corrupted.workbench.review.validationId = crypto.randomUUID(); expect(() => parseProjectBackup(JSON.stringify(corrupted))).toThrow();
});
it("历史审查满额不静默丢记录，重复历史编号拒绝导入", async () => {
  const { project, state, now } = backupFixture(); const backup = createProjectBackup(project, state, true);
  const archive = { id: crypto.randomUUID(), origin: "backup-import" as const, importedAt: now, blueprintRevision: 3, review: backup.workbench.review! };
  backup.workbench.reviewArchives = Array.from({ length: 20 }, () => ({ ...archive, id: crypto.randomUUID() }));
  expect(() => restoredProject(backup, crypto.randomUUID(), "a".repeat(64), now)).toThrow("20份"); expect(backup.workbench.reviewArchives).toHaveLength(20);
  backup.workbench.reviewArchives = [archive, archive]; expect(() => parseProjectBackup(JSON.stringify(backup))).toThrow("内容不完整");
});
