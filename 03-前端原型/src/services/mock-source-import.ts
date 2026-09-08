import type { Project } from "@/domain/models";
import type { SourceFileInput, SourceImportPreview } from "@/domain/source-import";
import { ServiceError, type SourceImportOptions, type SourceImportResult } from "./contracts";

export function checkImportCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new ServiceError("CANCELLED", "已取消导入，本批材料未保存。");
}
function pause(signal?: AbortSignal): Promise<void> {
  checkImportCancelled(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new ServiceError("CANCELLED", "已取消导入，本批材料未保存。")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 300);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

// Mock-only progress is time based, never presented as real network byte transfer.
// Commit once, after the cancellable work; completion is emitted only after save.
export async function runMockSourceImport(
  project: Project,
  inspect: () => Promise<SourceImportPreview>,
  commit: (files: SourceFileInput[]) => Promise<Project>,
  options: SourceImportOptions = {},
): Promise<SourceImportResult> {
  const { signal, onProgress } = options;
  checkImportCancelled(signal);
  if (project.readOnly) throw new ServiceError("READ_ONLY", "原始样例保持只读，请先创建副本。");
  if (project.research.job?.status === "running") throw new ServiceError("INVALID_INPUT", "请先等待当前模拟任务完成，或取消任务。");
  onProgress?.({ phase: "checking", percent: 0 });
  await pause(signal);
  const preview = await inspect();
  checkImportCancelled(signal);
  onProgress?.({ phase: "checking", percent: 15, preview });
  const files = preview.rows.filter((row) => row.eligible).map((row) => row.file);
  if (files.length > preview.availableSlots) throw new ServiceError("INVALID_INPUT", `本批有${files.length}份有效材料，项目还可容纳${preview.availableSlots}份；本批尚未保存，请分批选择或另建项目。`);
  if (!files.length) {
    onProgress?.({ phase: "complete", percent: 100, preview });
    return { project, preview, added: 0 };
  }
  for (const percent of [25, 50, 75]) {
    onProgress?.({ phase: "transferring", percent, preview });
    await pause(signal);
  }
  checkImportCancelled(signal);
  onProgress?.({ phase: "saving", percent: 95, preview });
  const saved = await commit(files);
  onProgress?.({ phase: "complete", percent: 100, preview });
  return { project: saved, preview, added: files.length };
}
