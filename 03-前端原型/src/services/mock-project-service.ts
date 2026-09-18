import type { ProductionModule, ReviewModelId, ReviewDecision } from "@/domain/production";
import * as production from "./production-operations";
import * as folderPlan from "./folder-plan-operations";
import { z } from "zod";
import type { BlueprintData } from "@/domain/blueprint";
import * as blueprint from "./blueprint-operations";
import { inspectSourceImport, sourceImportPolicy } from "@/domain/source-import";
import { outputPath } from "@/domain/output-settings";
import { checkImportCancelled, runMockSourceImport } from "./mock-source-import";
import { emptyResearch, type SourceFileInput, type IssueResolution, type MechanismChoice, type OriginalDirection, type CreativePlanInput } from "@/domain/research";
import * as research from "./research-operations";
import snapshot from "@/mocks/names-beyond.json";
import { workflow } from "@/mocks/workflow";
import { blankDecisions, decisionStatusSchema, demoContentSchema, projectSchema, type DecisionStatus } from "@/domain/models";
import { ServiceError, type ProjectService, type SourceImportOptions } from "./contracts";

import { LocalProjectService } from "./local-project-service";

const demo = demoContentSchema.parse(snapshot);

/** Historical simulated workflow, retained only for regression tests. */
export class MockProjectService extends LocalProjectService implements ProjectService {

  async createFromSources(files: SourceFileInput[], options: SourceImportOptions = {}) {
    if (!Array.isArray(files) || files.length === 0 || files.length > sourceImportPolicy.batchFiles) throw new ServiceError("INVALID_INPUT", `请选择1至${sourceImportPolicy.batchFiles}份文件。`);
    const metadata = z.array(z.object({ name: z.string(), size: z.number(), mime: z.string(), relativePath: z.string().optional(), lastModified: z.number().optional() })).safeParse(files);
    if (!metadata.success) throw new ServiceError("INVALID_INPUT", "无法读取文件信息，请重新选择剧本文件夹。");
    const time = this.now();
    const temporary = projectSchema.parse({ id: `project-${this.uuid()}`, title: "待导入剧本", note: "", template: "blank", readOnly: false, revision: 0, createdAt: time, updatedAt: time, research: emptyResearch(), decisions: structuredClone(blankDecisions) });
    return runMockSourceImport(temporary, async () => {
      const preview = inspectSourceImport(metadata.data, []);
      if (!preview.eligibleCount) throw new ServiceError("INVALID_INPUT", "这个文件夹中没有可登记的材料，请选择包含剧本文件的文件夹。");
      return preview;
    }, (selected) => this.storage.exclusive(async () => {
      checkImportCancelled(options.signal);
      const envelope = this.readEnvelope();
      if (envelope.projects.some((project) => project.id === temporary.id)) throw new ServiceError("CONFLICT", "项目编号冲突，请重新导入。");
      const project = structuredClone(temporary);
      const first = selected[0];
      const folderName = first.relativePath?.includes("/") ? first.relativePath.split("/")[0] : first.name.replace(/\.[^.]+$/, "");
      project.title = folderName.trim().slice(0, 40) || "我的剧本";
      research.registerFiles(project.research, selected, this.uuid);
      project.updatedAt = this.now();
      envelope.projects.push(project);
      this.writeEnvelope(envelope);
      return structuredClone(project);
    }), options);
  }

  async startFolderPlan(id: string, revision: number) { return this.mutate(id, revision, (project) => folderPlan.start(project, this.now())); }
  async advanceFolderPlan(id: string, revision: number) { return this.mutate(id, revision, (project) => folderPlan.advance(project, this.now())); }
  async cancelFolderPlan(id: string, revision: number) { return this.mutate(id, revision, (project) => folderPlan.cancel(project, this.now())); }
  async saveFolderDirection(id: string, revision: number, choiceId: string) { return this.mutate(id, revision, (project) => folderPlan.choose(project, choiceId, this.now())); }
  async sendFolderMessage(id: string, revision: number, message: string) { return this.mutate(id, revision, (p) => folderPlan.sendMessage(p, message, this.now(), this.uuid)); }
  async saveFolderProposal(id: string, revision: number, input: BlueprintData) { return this.mutate(id, revision, (p) => folderPlan.saveProposal(p, input, this.now())); }
  async initializeFolderBlueprint(id: string, revision: number) { return this.mutate(id, revision, (project) => folderPlan.initializeBlueprint(project, this.now())); }

  async setDecision(id: string, expectedRevision: number, decisionId: string, status: DecisionStatus) {
    const validated = decisionStatusSchema.safeParse(status);
    if (!validated.success) throw new ServiceError("INVALID_INPUT", "请选择有效的决定状态。");
    return this.mutate(id, expectedRevision, (project) => {
      const decision = project.decisions.find((item) => item.id === decisionId);
      if (!decision) throw new ServiceError("NOT_FOUND", "没有找到这条决定。");
      decision.status = validated.data;
    });
  }

  async getContent(id: string) {
    const project = await this.get(id);
    return project.template === "names-beyond" ? structuredClone(demo) : null;
  }

  async getBlueprint(id: string) {
    const project = await this.get(id);
    return structuredClone(project.readOnly ? blueprint.demoBlueprint(demo) : project.blueprint);
  }
  async initializeBlueprint(id: string, revision: number, mode: "blank" | "demo") { return this.mutate(id, revision, (p) => blueprint.initialize(p, mode, demo, this.now())); }
  async saveBlueprint(id: string, revision: number, input: BlueprintData) { return this.mutate(id, revision, (p) => blueprint.save(p, input, this.now())); }
  async publishBlueprintVersion(id: string, revision: number, label: string) { return this.mutate(id, revision, (p) => blueprint.publish(p, label, this.now(), this.uuid)); }

  async startGeneration(id: string, revision: number, module: ProductionModule, versionId: string, fail = false) { return this.mutate(id, revision, (p) => production.startGeneration(p, module, versionId, fail, this.now(), this.uuid)); }
  async advanceGeneration(id: string, revision: number, jobId: string) { return this.mutate(id, revision, (p) => production.advanceGeneration(p, jobId, this.now(), this.uuid)); }
  async cancelGeneration(id: string, revision: number, jobId: string) { return this.mutate(id, revision, (p) => production.cancelGeneration(p, jobId)); }
  async retryGeneration(id: string, revision: number, jobId: string) { return this.mutate(id, revision, (p) => production.retryGeneration(p, jobId)); }
  async saveArtifact(id: string, revision: number, artifactId: string, content: string) { return this.mutate(id, revision, (p) => production.saveArtifact(p, artifactId, content, this.now(), this.uuid)); }
  async startReview(id: string, revision: number, target: "blueprint" | "manuscript", versionId: string, failModel?: ReviewModelId) { return this.mutate(id, revision, (p) => production.startReview(p, target, versionId, failModel, this.now(), this.uuid)); }
  async advanceReviewModel(id: string, revision: number, reviewId: string, modelId: ReviewModelId) { return this.mutate(id, revision, (p) => production.advanceReviewModel(p, reviewId, modelId, this.uuid)); }
  async cancelReviewModel(id: string, revision: number, reviewId: string, modelId: ReviewModelId) { return this.mutate(id, revision, (p) => production.cancelReviewModel(p, reviewId, modelId)); }
  async retryReviewModel(id: string, revision: number, reviewId: string, modelId: ReviewModelId) { return this.mutate(id, revision, (p) => production.retryReviewModel(p, reviewId, modelId)); }
  async crossReview(id: string, revision: number, reviewId: string) { return this.mutate(id, revision, (p) => production.crossReview(p, reviewId)); }
  async decideReviewFinding(id: string, revision: number, reviewId: string, findingId: string, decision: ReviewDecision, reason: string) { return this.mutate(id, revision, (p) => production.decideReviewFinding(p, reviewId, findingId, decision, reason)); }

  async getResearchCatalog() { return structuredClone(research.researchCatalog); }
  async addResearchDemo(id: string, revision: number) { return this.mutate(id, revision, (p) => research.addDemo(p.research)); }
  async previewSourceFiles(id: string, files: SourceFileInput[]) {
    if (!Array.isArray(files) || files.length > sourceImportPolicy.batchFiles) throw new ServiceError("INVALID_INPUT", `每次最多选择${sourceImportPolicy.batchFiles}份材料，请分文件夹登记。`);
    const metadata = z.array(z.object({ name: z.string(), size: z.number(), mime: z.string(), relativePath: z.string().optional(), lastModified: z.number().optional() })).safeParse(files);
    if (!metadata.success) throw new ServiceError("INVALID_INPUT", "无法读取这批文件信息，请重新选择文件或文件夹。");
    const project = await this.get(id);
    return inspectSourceImport(metadata.data, project.research.documents);
  }
  async registerSourceFiles(id: string, revision: number, files: SourceFileInput[]) { return this.mutate(id, revision, (p) => research.registerFiles(p.research, files, this.uuid)); }
  async importSourceFiles(id: string, revision: number, files: SourceFileInput[], options: SourceImportOptions = {}) {
    const project = await this.get(id);
    if (project.revision !== revision) throw new ServiceError("CONFLICT", "项目已更新，本批未保存。重试导入会读取最新清单并重新检查重复项。");
    return runMockSourceImport(project, () => this.previewSourceFiles(id, files), (selected) => this.mutate(id, revision, (p) => {
      checkImportCancelled(options.signal);
      research.registerFiles(p.research, selected, this.uuid);
    }), options);
  }
  async startResearchJob(id: string, revision: number, kind: "ocr" | "analysis", fail = false) {
    if (!["ocr", "analysis"].includes(kind)) throw new ServiceError("INVALID_INPUT", "未知任务类型。");
    return this.mutate(id, revision, (p) => {
      research.startJob(p.research, kind, fail, this.uuid);
      if (p.research.job && kind === "analysis") p.research.job.outputLocation = outputPath(p.outputSettings, "analysis");
    });
  }
  async advanceResearchJob(id: string, jobId: string) {
    const project = await this.get(id);
    if (project.research.job?.id !== jobId || project.research.job.status !== "running") return project;
    return this.mutate(id, project.revision, (p) => research.advanceJob(p.research, jobId));
  }
  async cancelResearchJob(id: string, revision: number) { return this.mutate(id, revision, (p) => research.cancelJob(p.research)); }
  async resolveOCRIssue(id: string, revision: number, input: IssueResolution) { return this.mutate(id, revision, (p) => research.resolveIssue(p.research, input)); }
  async confirmMaterialAudit(id: string, revision: number, note: string) { return this.mutate(id, revision, (p) => research.confirmAudit(p.research, note)); }
  async chooseMechanism(id: string, revision: number, input: MechanismChoice) { return this.mutate(id, revision, (p) => research.chooseMechanism(p.research, input)); }
  async saveDirection(id: string, revision: number, input: OriginalDirection) { return this.mutate(id, revision, (p) => research.saveDirection(p.research, input)); }
  async saveCreativePlan(id: string, revision: number, input: CreativePlanInput) { return this.mutate(id, revision, (p) => research.saveCreativePlan(p.research, input)); }

  async sendReviewMessage(id: string, revision: number, reviewId: string, findingId: string, message: string) { return this.mutate(id, revision, (p) => production.sendReviewMessage(p, reviewId, findingId, message, this.now(), this.uuid)); }
  async saveReviewProposal(id: string, revision: number, reviewId: string, proposalId: string, content: string) { return this.mutate(id, revision, (p) => production.saveReviewProposal(p, reviewId, proposalId, content, this.now())); }
  async decideReviewProposal(id: string, revision: number, reviewId: string, proposalId: string, decision: ReviewDecision, reason: string) { return this.mutate(id, revision, (p) => production.decideReviewProposal(p, reviewId, proposalId, decision, reason, this.now())); }
  async getWorkflow() { return structuredClone(workflow); }
}
