import { z } from "zod";
import { inspectSourceImport, sourceImportPolicy, sourceKinds } from "@/domain/source-import";
import rawCatalog from "@/mocks/research.json";
import { directionSchema, issueResolutionSchema, mechanismChoiceSchema, researchCatalogSchema, sourceFileInputSchema, type IssueResolution, type MechanismChoice, type OriginalDirection, type ResearchState, type SourceFileInput } from "@/domain/research";
import { ServiceError } from "./contracts";

export const researchCatalog = researchCatalogSchema.parse(rawCatalog);
function invalid(message: string): never { throw new ServiceError("INVALID_INPUT", message); }
function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? "输入无效，请检查。");
  return parsed.data;
}
function idle(state: ResearchState) { if (state.job?.status === "running") invalid("请先等待任务完成，或取消当前模拟任务。"); }
function changed(state: ResearchState) { state.materialRevision += 1; state.auditRevision = null; state.analysisRevision = null; state.directionConfirmed = false; }
function analysisReady(state: ResearchState) {
  idle(state);
  if (state.analysisRevision === null || state.analysisRevision !== state.materialRevision) invalid("请先完成当前材料版本的审计与模拟拆解。");
}

export function addDemo(state: ResearchState) {
  idle(state);
  if (state.documents.some((d) => d.origin === "demo")) invalid("研究练习包已经载入，无需重复添加。");
  if (state.documents.length >= sourceImportPolicy.projectFiles) invalid(`每个项目最多登记${sourceImportPolicy.projectFiles}份材料，请另建项目分组整理。`);
  state.documents.push({ id: "research-excerpts", name: "参考机制摘录·OCR练习包", size: 4096, mime: "text/plain", origin: "demo", kind: "机制研究摘录", audience: "作者／主持", edition: researchCatalog.edition, status: "registered", fixtureId: "research-excerpts" });
  changed(state);
}

export function registerFiles(state: ResearchState, files: SourceFileInput[], uuid: () => string) {
  idle(state);
  if (!Array.isArray(files) || files.length === 0 || files.length > sourceImportPolicy.batchFiles) invalid(`每次请选择1至${sourceImportPolicy.batchFiles}份材料，超出时请分文件夹登记。`);
  const inputs = validate(z.array(sourceFileInputSchema), files);
  const preview = inspectSourceImport(inputs, state.documents);
  const rejected = preview.rows.find((row) => !row.eligible);
  if (rejected) invalid(`“${rejected.file.name}”：${rejected.reason}。请重新查看登记清单。`);
  if (inputs.length > preview.availableSlots) invalid(`每个项目最多登记${sourceImportPolicy.projectFiles}份材料，当前还可登记${preview.availableSlots}份。`);
  preview.rows.forEach(({ file, kind }) => {
    state.documents.push({ ...file, id: `source-${uuid()}`, origin: "local-metadata", kind: sourceKinds[kind].label, audience: "待确认", edition: "待确认", status: "registered", fixtureId: null });
  });
  changed(state);
}

export function startJob(state: ResearchState, kind: "ocr" | "analysis", fail: boolean, uuid: () => string) {
  idle(state);
  if (kind === "ocr") {
    if (!state.documents.some((d) => d.origin === "demo" && d.status === "registered")) invalid("请先载入尚未识别的内置研究练习包。真实文件目前仅登记元信息。");
  } else if (state.auditRevision === null || state.auditRevision !== state.materialRevision) invalid("请先处理练习问题，并确认当前材料的阅读范围。");
  state.job = { id: `job-${uuid()}`, kind, status: "running", progress: 0, fail, message: kind === "ocr" ? "准备模拟文字识别" : "准备模拟参考拆解", sourceRevision: state.materialRevision };
}

export function advanceJob(state: ResearchState, jobId: string) {
  const job = state.job;
  if (!job || job.id !== jobId || job.status !== "running") return;
  if (job.sourceRevision !== state.materialRevision) { job.status = "cancelled"; job.message = "材料版本已变化，请重新开始。"; return; }
  job.progress = Math.min(100, job.progress + 25);
  job.message = job.kind === "ocr" ? `模拟识别中 ${job.progress}%` : `模拟整理拆解记录 ${job.progress}%`;
  if (job.progress < 100) return;
  if (job.fail) { job.status = "failed"; job.message = "模拟处理失败，材料已保留，可以重试。"; return; }
  job.status = "succeeded";
  if (job.kind === "ocr") {
    state.documents.filter((d) => d.origin === "demo").forEach((d) => { d.status = "processed"; });
    state.issues = structuredClone(researchCatalog.issues);
    changed(state);
    job.message = "模拟识别完成：3份有效摘录，4项练习问题。原始扫描页未识别。";
  } else {
    state.analysisRevision = state.materialRevision;
    job.message = "模拟拆解完成；结果限于已有机制摘录，完整真相仍待材料。";
  }
}

export function cancelJob(state: ResearchState) {
  if (state.job?.status !== "running") invalid("当前没有运行中的模拟任务。");
  state.job.status = "cancelled"; state.job.message = "任务已取消，已登记材料保留，可重新开始。";
}

export function resolveIssue(state: ResearchState, input: IssueResolution) {
  idle(state);
  const value = validate(issueResolutionSchema, input);
  const issue = state.issues.find((i) => i.id === value.id);
  if (!issue) invalid("没有找到这项识别问题。");
  if (issue.kind === "missing" && value.status !== "retained") invalid("缺失的原始材料不能用点击确认补齐，请保留缺口并说明影响。");
  if (value.status === "excluded" && issue.kind !== "duplicate") invalid("仅重复页可以标为排除。");
  if (value.status === "corrected" && !["text", "blur"].includes(issue.kind)) invalid("只有文字问题可以填写校对结果。");
  issue.status = value.status; issue.resolution = value.resolution;
  changed(state);
}

export function confirmAudit(state: ResearchState, note: string) {
  idle(state);
  const value = validate(z.string().trim().min(1, "请说明本轮阅读范围及未提供的材料。").max(1000), note);
  if (!state.documents.some((d) => d.origin === "demo" && d.status === "processed")) invalid("请先完成内置练习包的模拟识别。");
  if (state.issues.some((i) => i.status === "open")) invalid("请先逐项校对或明确保留问题，不能把未处理问题当作已通过。");
  if (state.auditNote !== value) { state.analysisRevision = null; state.directionConfirmed = false; }
  state.auditRevision = state.materialRevision; state.auditNote = value;
}

export function chooseMechanism(state: ResearchState, input: MechanismChoice) {
  analysisReady(state);
  const value = validate(mechanismChoiceSchema, input);
  if (!researchCatalog.patterns.some((p) => p.id === value.id)) invalid("该机制不在当前研究记录中。");
  const existing = state.choices.findIndex((c) => c.id === value.id);
  if (existing < 0) state.choices.push(value); else state.choices[existing] = value;
  state.directionConfirmed = false;
}

export function saveDirection(state: ResearchState, input: OriginalDirection) {
  analysisReady(state);
  if (!state.choices.some((c) => c.choice !== "omit")) invalid("请至少保留或改造一个有依据的机制，再确定原创方向。");
  state.direction = validate(directionSchema, input); state.directionConfirmed = true;
}
