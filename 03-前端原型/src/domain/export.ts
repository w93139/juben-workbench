import type { Project } from "./models";
import { moduleIds, moduleLabels, type Artifact, type ProductionModule } from "./production";

export type ExportScope = ProductionModule | "all";
export interface ExportFile { path: string; content: string }
export interface ExportBundle { filename: string; files: ExportFile[]; materialCount: number }
export const exportScopes = moduleIds;
export function exportLabel(scope: ExportScope) { return scope === "all" ? "全部资源" : moduleLabels[scope]; }
export function safeExportName(value: string): string {
  const name = value.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_").replace(/^\.+|[. ]+$/g, "").trim().slice(0, 70);
  return name || "未命名材料";
}
/** Select latest content independently within the explicitly chosen blueprint. */
export function exportArtifacts(project: Project, versionId: string, scope: ExportScope): Artifact[] {
  if (!project.blueprint?.versions.some((version) => version.id === versionId)) return [];
  const selected = new Map<string, Artifact>();
  for (const artifact of project.production?.artifacts ?? []) {
    if (artifact.blueprintVersionId !== versionId || (scope !== "all" && artifact.module !== scope)) continue;
    const previous = selected.get(artifact.logicalKey);
    if (!previous || artifact.version >= previous.version) selected.set(artifact.logicalKey, artifact);
  }
  return [...selected.values()].filter((artifact) => artifact.content.trim().length > 0);
}
/**
 * Assign unique short directory prefixes from the entire project's raw IDs, not
 * the selected export category. Prefixes remain identical across categories and
 * blueprint selections in the same project snapshot, even on case-insensitive
 * filesystems or when normalized/truncated display names collide.
 */
export function exportCharacterDirectories(project: Project): ReadonlyMap<string, string> {
  const ids = new Set<string>();
  for (const character of project.blueprint?.draft.characters ?? []) ids.add(character.id);
  for (const version of project.blueprint?.versions ?? []) for (const character of version.data.characters) ids.add(character.id);
  for (const artifact of project.production?.artifacts ?? []) if (artifact.characterId) ids.add(artifact.characterId);
  return new Map([...ids].sort().map((id, index) => [id, `角色-${String(index + 1).padStart(4, "0")}-${safeExportName(id).slice(0, 35)}`]));
}
export function artifactExportPath(artifact: Artifact, index: number, directories: ReadonlyMap<string, string>): string {
  const audience = artifact.audience === "host" || artifact.module === "host" || artifact.module === "ending" ? "主持材料-含谜底" : "玩家材料";
  const recipient = audience === "玩家材料" ? artifact.characterId ? directories.get(artifact.characterId) : "公共材料" : "主持专用";
  if (!recipient) throw new Error("缺少角色导出目录映射，未生成材料包。");
  return `${audience}/${recipient}/${moduleLabels[artifact.module]}/${String(index + 1).padStart(3, "0")}-${safeExportName(artifact.title)}-v${artifact.version}.md`;
}
