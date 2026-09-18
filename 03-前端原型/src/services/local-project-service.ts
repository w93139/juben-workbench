import { z } from "zod";
import { emptyResearch } from "@/domain/research";
import { outputSettingsInputSchema, type OutputSettingsInput } from "@/domain/output-settings";
import { blankDecisions, createProjectSchema, envelopeSchema, legacyEnvelopeSchema, projectSchema, updateProjectSchema, type CreateProjectInput, type Project, type ProjectEnvelope, type UpdateProjectInput } from "@/domain/models";
import { ServiceError, type LocalProjectPort, type ProjectDeletionPort, type StoragePort, type OutputDirectoryPort } from "./contracts";
import { baseline } from "./project-sample";

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ServiceError("INVALID_INPUT", "请检查输入：项目名称需为1–40个字符，备注不超过1200个字符。");
  return result.data;
}

export class LocalProjectService implements LocalProjectPort {
  constructor(
    protected storage: StoragePort,
    protected now: () => string = () => new Date().toISOString(),
    protected uuid: () => string = () => crypto.randomUUID(),
    private outputDirectories?: OutputDirectoryPort,
    private deletion?: ProjectDeletionPort,
  ) {}

  protected readEnvelope(): ProjectEnvelope {
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

  protected writeEnvelope(envelope: ProjectEnvelope) {
    this.storage.write(JSON.stringify(envelopeSchema.parse(envelope)));
  }

  async list() {
    const { projects } = this.readEnvelope();
    return structuredClone([...projects].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).concat(baseline));
  }

  async remove(id: string, revision: number) {
    if (id === baseline.id) throw new ServiceError("READ_ONLY", "原始样例不能删除。");
    if (!this.deletion) throw new ServiceError("STORAGE_UNAVAILABLE", "当前环境不支持安全删除项目。");
    const deletion = this.deletion;
    return this.storage.exclusive(async () => {
      const envelope = this.readEnvelope();
      const project = envelope.projects.find(item => item.id === id);
      if (!project) throw new ServiceError("NOT_FOUND", "项目已不存在，请刷新列表。");
      if (project.readOnly) throw new ServiceError("READ_ONLY", "只读项目不能删除。");
      if (project.revision !== revision) throw new ServiceError("CONFLICT", "项目已在其他页面更新，请关闭对话框并刷新后再删除。");
      await deletion.prepare(id);
      try { this.writeEnvelope({ ...envelope, projects: envelope.projects.filter(item => item.id !== id) }); }
      catch (failure) {
        try { await deletion.restore(id); }
        catch { throw new ServiceError("STORAGE_UNAVAILABLE", "删除未完成，项目与正文备份仍保留；请重试删除或检查浏览器存储。"); }
        throw failure;
      }
      try { await deletion.finish(id); return { cleanupPending: false }; }
      catch { return { cleanupPending: true }; }
    });
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
        decisions: structuredClone(validated.template === "names-beyond" ? baseline.decisions : blankDecisions),
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

  protected async mutate(id: string, expectedRevision: number, update: (project: Project) => void) {
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
  async getBackup() { return this.storage.read(); }

  async resetLocalProjects(expectedBackup: string) {
    return this.storage.exclusive(async () => {
      if (this.storage.read() !== expectedBackup) throw new ServiceError("CONFLICT", "本机数据刚刚发生变化。请重新获取备份后再恢复。");
      this.writeEnvelope({ schemaVersion: 3, projects: [] });
    });
  }
}
