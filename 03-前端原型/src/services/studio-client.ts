import { materialSchema, type Material, type WorkbenchState } from "@/domain/workbench";
import { studioJobViewSchema, type StudioOperation } from "@/domain/studio";
import { changeWorkbench } from "./workbench-store";

export async function localJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, credentials: "same-origin" });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || data.message || "操作未完成，请重试。");
  return data;
}
export async function readMaterials(files: File[], onProgress: (done: number, total: number, name: string) => void, signal?: AbortSignal): Promise<Material[]> {
  if (!files.length || files.length > 2000) throw new Error("请分批选择1至2000份剧本文件。");
  const documents: Material[] = [];
  for (const file of files) {
    if (signal?.aborted) throw new Error("读取已取消，原材料保持不变。");
    onProgress(documents.length, files.length, file.name);
    const form = new FormData(); form.set("file", file);
    const result = await localJson("/api/local/materials/read", { method: "POST", body: form, signal });
    documents.push(materialSchema.parse({ id: crypto.randomUUID(), name: file.webkitRelativePath || file.name, size: file.size, ...result, excluded: false }));
  }
  onProgress(documents.length, files.length, "读取完成");
  return documents;
}
export function appendMaterials(id: string, revision: number, documents: Material[]) {
  return changeWorkbench(id, revision, (state) => {
    if (state.job) throw new Error("请等待当前任务完成后再补充材料。");
    const incoming = new Map(documents.map(d => [d.name, d]));
    state.documents = [...state.documents.filter(d => !incoming.has(d.name)), ...incoming.values()];
    state.sourceRevision++; state.error = null;
  });
}
/** Replace only after all new bytes are read; CAS protects the previous batch on failure. */
export function replaceMaterials(id: string, revision: number, documents: Material[]) {
  const failed = documents.filter(document => document.status === "error");
  if (failed.length) return Promise.reject(new Error(`有${failed.length}份材料读取失败，原材料保持不变：${failed.slice(0, 3).map(document => document.name).join("、")}。请处理后重新选择文件夹。`));
  if (!documents.some(document => document.status === "read" && document.text.trim())) return Promise.reject(new Error("新文件夹中没有成功读取的正文，原材料保持不变。请检查文件格式后重试。"));
  return changeWorkbench(id, revision, state => {
    if (state.job) throw new Error("当前任务还在处理，请完成后再更改文件夹。");
    state.documents = documents; state.sourceRevision++; state.error = null;
  });
}
export async function startStudioJob(projectId: string, state: WorkbenchState, operation: StudioOperation) {
  const body = operation === "analyze" ? { documents: state.documents.filter(d => !d.excluded).map(({ id, name, text }) => ({ id, name, text })), instructions: state.instructions }
    : operation === "blueprint" ? { analysis: state.analysis, choiceId: state.choiceId, instructions: state.instructions }
    : { blueprint: state.blueprint };
  const requestId = crypto.randomUUID();
  const reserved = await changeWorkbench(projectId, state.revision, next => {
    if (next.job) throw new Error("当前已有任务在处理。");
    next.job = { jobId: requestId, operation, phase: "正在提交资料", sourceRevision: state.sourceRevision, blueprintRevision: state.blueprintRevision };
    next.error = null;
  });
  try {
    const job = studioJobViewSchema.parse(await localJson(`/api/studio/${operation}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Request-Id": requestId }, body: JSON.stringify(body) }));
    if (job.jobId !== requestId) throw new Error("任务编号不一致，请停止等待后重试。");
    return reserved;
  } catch (error) {
    // Keep the persisted request ID: status recovery never starts another paid call.
    throw error;
  }
}

export async function pollStudioJob(projectId: string, state: WorkbenchState) {
  if (!state.job) return state;
  const job = studioJobViewSchema.parse(await localJson(`/api/studio/status?jobId=${encodeURIComponent(state.job.jobId)}`));
  if (job.status === "running") return { ...state, job: { ...state.job, phase: job.phase } };
  return changeWorkbench(projectId, state.revision, next => {
    if (next.job?.jobId !== job.jobId) throw new Error("任务已变化，请重新读取。");
    if (next.sourceRevision !== next.job.sourceRevision || next.blueprintRevision !== next.job.blueprintRevision) { next.job = null; next.error = "材料或蓝图已变化，旧任务结果未应用。"; return; }
    const operation = next.job.operation; next.job = null;
    if (job.status === "failed") { next.error = job.error?.message || "处理失败，请重试。"; return; }
    const result = job.result;
    if (result?.kind === "analysis" && operation === "analyze") { next.analysis = result.analysis; next.analysisSourceRevision = next.sourceRevision; next.choiceId = null; }
    else if (result?.kind === "blueprint" && operation === "blueprint") {
      if (next.blueprint) { if (next.versions.length >= 20) { next.error = "蓝图历史已达20份，旧稿已保留。请先整理历史再生成。"; return; } next.versions.push({ revision: next.blueprintRevision, data: next.blueprint }); }
      next.blueprint = result.blueprint; next.blueprintRevision++; next.blueprintSourceRevision = next.sourceRevision; next.blueprintChoiceId = next.choiceId;
    } else if (result?.kind === "review" && operation === "review") { next.review = result; next.reviewBlueprintRevision = next.blueprintRevision; }
    else throw new Error("返回结果与当前任务不一致，原内容已保留。");
  });
}
