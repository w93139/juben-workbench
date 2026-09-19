import { expect, it } from "vitest";
import { createProjectBackup, parseProjectBackup, serializeProjectBackup, restoredProject } from "@/domain/project-backup";
import { studioReviewResultSchema } from "@/domain/studio";
import { segmentedSummaries } from "@/server/segmented-review";
import { segmentedFixture } from "../fixtures/segmented-review";
import { backupFixture } from "../fixtures/project-backup";

it("v4部分分段报告/完整原文往返，运行态与执行身份剥离，旧版本不冒充支持", () => {
  const { project, state } = backupFixture(), fixture = segmentedFixture();
  fixture.segmented.units[1].state = "running"; delete fixture.segmented.units[1].report;
  state.review = fixture.checkpoint.review;
  state.reviewArchives = [{ id: crypto.randomUUID(), origin: "backup-import", importedAt: new Date().toISOString(), blueprintRevision: 1, review: fixture.checkpoint.review }];
  state.reviewProgress = { jobId: crypto.randomUUID(), blueprintRevision: state.blueprintRevision, checkpoint: fixture.checkpoint };
  const backup = parseProjectBackup(serializeProjectBackup(createProjectBackup(project, state, true)));
  expect(backup.schemaVersion).toBe(4); const progress = backup.workbench.reviewProgress!;
  expect(progress.jobId).toBeNull(); expect(progress.checkpoint.runId).toBeNull(); expect(progress.checkpoint.review.segmented!.units[1].state).toBe("interrupted");
  expect(progress.checkpoint.review.segmented!.units[0].report).toEqual(fixture.segmented.units[0].report);
  expect(progress.checkpoint.review.artifacts).toEqual(fixture.artifacts);
  expect(backup.workbench.review!.segmented!.units[1].state).toBe("interrupted");
  expect(backup.workbench.reviewArchives[0].review.segmented!.units[1].state).toBe("interrupted");
  // Import is another trust boundary: even a syntactically valid edited archive must not look active.
  backup.workbench.review!.segmented!.units[1].state = "running";
  backup.workbench.reviewArchives[0].review.segmented!.units[1].state = "running";
  const restored = restoredProject(backup, crypto.randomUUID(), "a".repeat(64), new Date().toISOString());
  expect(restored.workbench.reviewProgress!.checkpoint.review.segmented).toEqual(progress.checkpoint.review.segmented);
  expect(restored.workbench.review).toBeNull(); expect(restored.workbench.job).toBeNull();
  expect(restored.workbench.reviewArchives.every(archive => archive.review.segmented?.units[1].state === "interrupted")).toBe(true);
  expect(() => parseProjectBackup(JSON.stringify({ ...backup, schemaVersion: 3 }))).toThrow();
});

it.each(["missingPart", "missingReport", "repeatedReport", "wrongRange", "missingCoverage", "blocking"])("分段通过凭证拒绝%s", mode => {
  const { checkpoint, segmented } = segmentedFixture();
  const result = { ...checkpoint.review, passed: true, issues: [], validationId: crypto.randomUUID(), reports: { ...checkpoint.review.reports, ...segmentedSummaries(segmented) } };
  expect(studioReviewResultSchema.safeParse(result).success).toBe(true);
  if (mode === "missingPart") segmented.plan.parts.pop();
  if (mode === "missingReport") delete segmented.units[0].report;
  if (mode === "repeatedReport") segmented.units[1] = segmented.units[0];
  if (mode === "wrongRange") segmented.plan.parts[0].start++;
  if (mode === "missingCoverage") segmented.units[0].report!.coverage[0].partId = "other";
  if (mode === "blocking") segmented.units[0].report!.blocking.push("早期未修复问题");
  expect(studioReviewResultSchema.safeParse(result).success).toBe(false);
});
