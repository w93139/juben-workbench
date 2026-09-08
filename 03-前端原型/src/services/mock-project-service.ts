import { z } from "zod";
import type { BlueprintData } from "@/domain/blueprint";
import * as blueprint from "./blueprint-operations";
import { inspectSourceImport, sourceImportPolicy } from "@/domain/source-import";
import { outputPath, outputSettingsInputSchema, type OutputSettingsInput } from "@/domain/output-settings";
import { checkImportCancelled, runMockSourceImport } from "./mock-source-import";
import { emptyResearch, type SourceFileInput, type IssueResolution, type MechanismChoice, type OriginalDirection, type CreativePlanInput } from "@/domain/research";
import * as research from "./research-operations";
import snapshot from "@/mocks/names-beyond.json";
import { workflow } from "@/mocks/workflow";
import { blankDecisions, createProjectSchema, decisionStatusSchema, demoContentSchema, envelopeSchema, legacyEnvelopeSchema, projectSchema, updateProjectSchema, type CreateProjectInput, type DecisionStatus, type Project, type ProjectEnvelope, type UpdateProjectInput } from "@/domain/models";
import { ServiceError, type ProjectService, type StoragePort, type SourceImportOptions, type OutputDirectoryPort } from "./contracts";

const demo = demoContentSchema.parse(snapshot);
const baseline: Project = projectSchema.parse({
  id: "demo-names", title: demo.title, note: "完整原创样例。先浏览设计结构，再创建副本记录自己的创作决定。",
  template: "names-beyond", readOnly: true, revision: 0, createdAt: null, updatedAt: null,
  decisions: demo.decisions, research: emptyResearch(),
});

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ServiceError("INVALID_INPUT", "请检查输入：项目名称需为1–40个字符，备注不超过1200个字符。");
  return result.data;
}

export class MockProjectService implements ProjectService {
  constructor(
    private storage: StoragePort,
    private now: () => string = () => new Date().toISOString(),
    private uuid: () => string = () => crypto.randomUUID(),
    private outputDirectories?: OutputDirectoryPort,
  ) {}

  private readEnvelope(): ProjectEnvelope {
    const raw = this.storage.read();
    if (raw === null) return { schemaVersion: 3, projects: [] };
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch {
      throw new ServiceError("STORAGE_CORRUPT", "本机项目数据无法读取，原数据已保留。你可以先下载备份，再恢复空白工作区。");
    }
    if (parsed && typeof parsed === "object" && "schemaVersion" in parsed && parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2 && parsed.schemaVersion !== 3) {
      throw new ServiceError("STORAGE_VERSION", "本机数据来自不同版本，尚不能自动迁移。原数据已保留，请先下载备份。");
    }
    if (parsed && typeof parsed === "object" && "schemaVersion" in parsed && parsed.schemaVersion === 1) {
      const legacy = legacyEnvelopeSchema.safeParse(parsed);
      if (!legacy.success) throw new ServiceError("STORAGE_CORRUPT", "旧版本项目结构不完整，原数据已保留。请先下载备份。");
      parsed = { schemaVersion: 3, projects: legacy.data.projects.map((p) => ({ ...p, research: emptyResearch() })) };
    }
    if (parsed && typeof parsed === "object" && "schemaVersion" in parsed && parsed.schemaVersion === 2) parsed = { ...parsed, schemaVersion: 3 };
    const result = envelopeSchema.safeParse(parsed);
    if (!result.success) throw new ServiceError("STORAGE_CORRUPT", "本机项目数据结构不完整，原数据已保留。请先下载备份，再恢复空白工作区。");
    return result.data;
  }

  private writeEnvelope(envelope: ProjectEnvelope) {
    this.storage.write(JSON.stringify(envelopeSchema.parse(envelope)));
  }

  async list() {
    const { projects } = this.readEnvelope();
    return structuredClone([...projects].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).concat(baseline));
  }

  async get(id: string) {
    if (id === baseline.id) return structuredClone(baseline);
    const project = this.readEnvelope().projects.find((item) => item.id === id);
    if (!project) throw new ServiceError("NOT_FOUND", "没有找到这个项目。它可能属于另一个浏览器，或本机数据已被清除。");
    return structuredClone(project);
  }

  async create(input: CreateProjectInput, initialOutput?: OutputSettingsInput) {
    const validated = parseInput(createProjectSchema, input);
    const output = initialOutput ? await this.validateOutputSettings(initialOutput) : null;
    return this.storage.exclusive(async () => {
      const envelope = this.readEnvelope();
      const time = this.now();
      const project = projectSchema.parse({
        ...validated, id: `project-${this.uuid()}`, revision: 0, readOnly: false,
        createdAt: time, updatedAt: time, research: emptyResearch(),
        decisions: structuredClone(validated.template === "names-beyond" ? demo.decisions : blankDecisions),
      });
      if (output) {
        project.outputSettings.rootPath = output.rootPath;
        project.outputSettings.directory = output.directory ?? null;
        project.outputSettings.folders[output.stage] = output.folder;
      }
      if (envelope.projects.some((item) => item.id === project.id)) throw new ServiceError("CONFLICT", "项目编号发生冲突，请重新创建。");
      envelope.projects.push(project);
      this.writeEnvelope(envelope);
      return structuredClone(project);
    });
  }

  private async mutate(id: string, expectedRevision: number, update: (project: Project) => void) {
    if (id === baseline.id) throw new ServiceError("READ_ONLY", "原始样例保持只读。请先创建演示副本。");
    return this.storage.exclusive(async () => {
      const envelope = this.readEnvelope();
      const project = envelope.projects.find((item) => item.id === id);
      if (!project) throw new ServiceError("NOT_FOUND", "项目已不存在，请返回项目列表。");
      if (project.revision !== expectedRevision) throw new ServiceError("CONFLICT", "项目已在其他页面更新。当前输入已保留，请重新载入后再修改。");
      update(project);
      project.revision += 1;
      project.updatedAt = this.now();
      this.writeEnvelope(envelope);
      return structuredClone(project);
    });
  }

  async update(id: string, expectedRevision: number, input: UpdateProjectInput) {
    const validated = parseInput(updateProjectSchema, input);
    return this.mutate(id, expectedRevision, (project) => Object.assign(project, validated));
  }

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
  private async validateOutputSettings(input: OutputSettingsInput) {
    const result = outputSettingsInputSchema.safeParse(input);
    if (!result.success) throw new ServiceError("INVALID_INPUT", result.error.issues[0]?.message ?? "请检查输出路径。");
    if (result.data.directory) {
      const directory = await this.outputDirectories?.get(result.data.directory.id);
      if (!directory || directory.kind !== "directory" || directory.name !== result.data.directory.name) throw new ServiceError("DIRECTORY_UNAVAILABLE", "无法找到已选择的文件夹引用，请重新选择文件夹或手动填写路径；原设置已保留。");
    }
    return result.data;
  }
  async saveOutputSettings(id: string, revision: number, input: OutputSettingsInput) {
    const output = await this.validateOutputSettings(input);
    return this.mutate(id, revision, (p) => {
      p.outputSettings.rootPath = output.rootPath;
      p.outputSettings.directory = output.directory ?? null;
      p.outputSettings.folders[output.stage] = output.folder;
    });
  }
  getOutputDirectoryCapability() { return this.outputDirectories?.capability?.() ?? (this.outputDirectories ? "available" : "unsupported"); }
  async pickOutputDirectory() {
    if (!this.outputDirectories) throw new ServiceError("DIRECTORY_UNAVAILABLE", "当前环境不能选择文件夹，请手动填写完整路径。");
    return this.outputDirectories.pick();
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

  async getWorkflow() { return structuredClone(workflow); }
  async getBackup() { return this.storage.read(); }

  async resetLocalProjects(expectedBackup: string) {
    return this.storage.exclusive(async () => {
      if (this.storage.read() !== expectedBackup) throw new ServiceError("CONFLICT", "本机数据刚刚发生变化。请重新获取备份后再恢复。");
      this.writeEnvelope({ schemaVersion: 3, projects: [] });
    });
  }
}
