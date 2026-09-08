import type { SourceImportPreview } from "@/domain/source-import";
import type { BlueprintData, BlueprintWorkspace } from "@/domain/blueprint";
import type { OutputSettingsInput, PickedOutputDirectory } from "@/domain/output-settings";
import type { CreateProjectInput, DecisionStatus, DemoContent, Project, UpdateProjectInput, WorkflowStage } from "@/domain/models";
import type { SourceFileInput, IssueResolution, MechanismChoice, OriginalDirection, ResearchCatalog, CreativePlanInput } from "@/domain/research";

export type ServiceErrorCode = "NOT_FOUND" | "READ_ONLY" | "CONFLICT" | "INVALID_INPUT" | "STORAGE_UNAVAILABLE" | "STORAGE_CORRUPT" | "STORAGE_VERSION" | "CANCELLED" | "DIRECTORY_UNAVAILABLE";

export type OutputDirectoryCapability = "available" | "unsupported" | "insecure";

export interface OutputDirectoryPort {
  capability?(): OutputDirectoryCapability;
  pick(): Promise<PickedOutputDirectory | null>;
  get(id: string): Promise<{ name: string; kind: "directory" } | null>;
}

export interface SourceImportProgress {
  phase: "checking" | "transferring" | "saving" | "complete";
  percent: number;
  preview?: SourceImportPreview;
}
export interface SourceImportOptions { signal?: AbortSignal; onProgress?: (progress: SourceImportProgress) => void }
export interface SourceImportResult { project: Project; preview: SourceImportPreview; added: number }

export class ServiceError extends Error {
  constructor(public readonly code: ServiceErrorCode, message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

export interface ProjectService {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project>;
  create(input: CreateProjectInput): Promise<Project>;
  update(id: string, expectedRevision: number, input: UpdateProjectInput): Promise<Project>;
  setDecision(id: string, expectedRevision: number, decisionId: string, status: DecisionStatus): Promise<Project>;
  getContent(id: string): Promise<DemoContent | null>;
  getBlueprint(id: string): Promise<BlueprintWorkspace | null>;
  initializeBlueprint(id: string, revision: number, mode: "blank" | "demo"): Promise<Project>;
  saveBlueprint(id: string, revision: number, input: BlueprintData): Promise<Project>;
  publishBlueprintVersion(id: string, revision: number, label: string): Promise<Project>;
  getWorkflow(): Promise<WorkflowStage[]>;
  getResearchCatalog(): Promise<ResearchCatalog>;
  addResearchDemo(id: string, revision: number): Promise<Project>;
  previewSourceFiles(id: string, files: SourceFileInput[]): Promise<SourceImportPreview>;
  registerSourceFiles(id: string, revision: number, files: SourceFileInput[]): Promise<Project>;
  importSourceFiles(id: string, revision: number, files: SourceFileInput[], options?: SourceImportOptions): Promise<SourceImportResult>;
  saveOutputSettings(id: string, revision: number, input: OutputSettingsInput): Promise<Project>;
  pickOutputDirectory(): Promise<PickedOutputDirectory | null>;
  getOutputDirectoryCapability(): OutputDirectoryCapability;
  startResearchJob(id: string, revision: number, kind: "ocr" | "analysis", fail?: boolean): Promise<Project>;
  advanceResearchJob(id: string, jobId: string): Promise<Project>;
  cancelResearchJob(id: string, revision: number): Promise<Project>;
  resolveOCRIssue(id: string, revision: number, input: IssueResolution): Promise<Project>;
  confirmMaterialAudit(id: string, revision: number, note: string): Promise<Project>;
  chooseMechanism(id: string, revision: number, input: MechanismChoice): Promise<Project>;
  saveDirection(id: string, revision: number, input: OriginalDirection): Promise<Project>;
  saveCreativePlan(id: string, revision: number, input: CreativePlanInput): Promise<Project>;
  getBackup(): Promise<string | null>;
  resetLocalProjects(expectedBackup: string): Promise<void>;
}

export interface StoragePort {
  read(): string | null;
  write(value: string): void;
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
}
