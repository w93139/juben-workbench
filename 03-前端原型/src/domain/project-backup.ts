import { z } from "zod";
import { projectSchema, type Project } from "./models";
import { archivedStudioReviewSchema } from "./studio";
import { workbenchSchema, type WorkbenchState } from "./workbench";
import { restoreOriginSchema } from "./project-restore";

export const PROJECT_BACKUP_BYTES = 64 * 1024 * 1024;
const portableWorkbenchSchema = workbenchSchema.omit({ review: true, job: true, error: true }).extend({
  review: archivedStudioReviewSchema.nullable(), job: z.null(), error: z.null(),
});
export const projectBackupSchema = z.object({
  format: z.literal("juben-workbench/project-backup"), schemaVersion: z.literal(1),
  id: z.uuid(), exportedAt: z.iso.datetime(),
  project: projectSchema, workbench: portableWorkbenchSchema, authoringRecordExists: z.boolean(),
}).strict();
export type ProjectBackup = z.infer<typeof projectBackupSchema>;

/** Keep content/relative naming, but never carry local output authority or active work. */
export function portableProject(input: Project): Project {
  const project = projectSchema.parse(input);
  project.outputSettings.directory = null; project.outputSettings.rootPath = "";
  project.research.job = null;
  if (project.folderPlan) {
    project.folderPlan.plannedPath = null;
    if (project.folderPlan.status === "running") project.folderPlan.status = "cancelled";
  }
  if (project.production) {
    for (const artifact of project.production.artifacts) artifact.plannedPath = null;
    for (const job of project.production.jobs) { job.plannedPath = null; job.simulateFailure = false; if (job.status === "running") job.status = "cancelled"; }
    for (const review of project.production.reviews) {
      review.plannedPath = null;
      for (const model of review.models) { model.simulateFailure = false; if (model.status === "running") model.status = "cancelled"; }
    }
  }
  return project;
}
export function createProjectBackup(project: Project, state: WorkbenchState, authoringRecordExists: boolean, now = new Date().toISOString(), id = crypto.randomUUID()): ProjectBackup {
  const valid = workbenchSchema.parse(state);
  if (valid.job) throw new Error("当前项目仍有任务在运行或等待确认，请任务结束后再备份。");
  let review: ProjectBackup["workbench"]["review"] = null;
  if (valid.review) {
    const { validationId: _authority, ...content } = valid.review;
    void _authority;
    review = archivedStudioReviewSchema.parse(content);
  }
  const backup = projectBackupSchema.parse({ format: "juben-workbench/project-backup", schemaVersion: 1, id, exportedAt: now, project: portableProject(project), workbench: { ...valid, review, job: null, error: null }, authoringRecordExists });
  serializeProjectBackup(backup); return backup;
}
export function serializeProjectBackup(backup: ProjectBackup) {
  const text = JSON.stringify(projectBackupSchema.parse(backup));
  if (new TextEncoder().encode(text).byteLength > PROJECT_BACKUP_BYTES) throw new Error("完整项目超过64 MiB备份上限，本次未截断或修改数据。");
  return text;
}
export function parseProjectBackup(text: string): ProjectBackup {
  if (new TextEncoder().encode(text).byteLength > PROJECT_BACKUP_BYTES) throw new Error("备份超过64 MiB上限，未导入。");
  let value: unknown; try { value = JSON.parse(text); } catch { throw new Error("文件不是有效的项目备份JSON，原项目未改变。"); }
  const parsed = projectBackupSchema.safeParse(value);
  if (!parsed.success) throw new Error("备份格式、版本或内容不完整，未导入。旧索引记录不包含完整创作数据，不能作为完整项目恢复。");
  return parsed.data;
}
export async function projectBackupFingerprint(backup: ProjectBackup) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serializeProjectBackup(backup)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export function restoredProject(backup: ProjectBackup, operationId: string, fingerprint: string, now: string) {
  const origin = restoreOriginSchema.parse({ operationId, backupId: backup.id, fingerprint, sourceProjectId: backup.project.id, restoredAt: now });
  const project = portableProject(backup.project);
  const suffix = "（恢复副本）"; let title = "";
  for (const char of project.title) { if (title.length + char.length + suffix.length > 40) break; title += char; }
  project.id = `project-restored-${operationId}`; project.title = title + suffix;
  project.createdAt = project.updatedAt = now; project.revision = 0; project.readOnly = false; project.restoredFrom = origin;
  const reviewArchives = [...backup.workbench.reviewArchives];
  if (backup.workbench.review) {
    if (reviewArchives.length >= 20) throw new Error("审查历史已达20份，无法完整加入本次记录，未恢复且未删除任何内容。");
    reviewArchives.push({ id: backup.id, origin: "backup-import", importedAt: now, blueprintRevision: backup.workbench.reviewBlueprintRevision, review: backup.workbench.review });
  }
  const workbench = workbenchSchema.parse({ ...backup.workbench, review: null, reviewBlueprintRevision: null, reviewArchives, restoredFrom: origin, job: null, error: null });
  return { project: projectSchema.parse(project), workbench };
}
