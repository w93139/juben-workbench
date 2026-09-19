import { safeExportName } from "@/domain/export";
import { moduleLabels } from "@/domain/production";
import type { StudioReviewResult } from "@/domain/studio";

export const STUDIO_ZIP_BYTES = 64 * 1024 * 1024;
type ExportReview = Pick<StudioReviewResult, "blueprint" | "blueprintFingerprint" | "artifacts" | "reports" | "segmented" | "humanPlaytest">;
export function studioExportFiles(result: ExportReview, title: string, validationId: string, exportedAt = new Date().toISOString()) {
  const characterIds = [...new Set(result.artifacts.flatMap(artifact => artifact.characterId ? [artifact.characterId] : []))].sort();
  const directories = new Map(characterIds.map((id, index) => [id, `角色-${String(index + 1).padStart(4, "0")}-${safeExportName(id).slice(0, 35)}`]));
  const files = result.artifacts.map((artifact, index) => {
    const host = artifact.audience === "host" || artifact.module === "host" || artifact.module === "ending";
    const folder = host ? "主持材料-含谜底" : `玩家材料/${artifact.characterId ? directories.get(artifact.characterId) : "公共材料"}`;
    return { path: `${folder}/${moduleLabels[artifact.module]}/${String(index + 1).padStart(3, "0")}-${safeExportName(artifact.title)}.md`, content: artifact.content };
  });
  files.push({ path: "主持材料-含谜底/原创设计蓝图.json", content: JSON.stringify(result.blueprint, null, 2) });
  if (result.segmented) files.push({ path: SEGMENTED_REPORT_PATH, content: JSON.stringify(result.segmented) });
  files.unshift({ path: "00-使用说明.md", content: `# ${title}\n\n本包使用本机服务器保存的已通过交叉审查快照，浏览器不能替换其中的正文。\n\n主持材料和审查报告含谜底，请勿把整个包交给玩家；玩家材料按角色分别发放。\n\nAI审查通过不等于经过真人试玩。本项目尚未真人试玩。所有实际时长、玩家体验和可玩性均待真人测试。\n\n正文格式为Markdown，未转换Word或PDF。\n` });
  files.push({ path: "主持材料-含谜底/审查与版本清单.json", content: JSON.stringify({ validationId, blueprintFingerprint: result.blueprintFingerprint, reports: result.reports, humanPlaytest: result.humanPlaytest, exportedAt, materials: result.artifacts.map(artifact => ({ id: artifact.id, module: artifact.module, audience: artifact.audience, characterId: artifact.characterId, roundId: artifact.roundId, title: artifact.title, sourceIds: artifact.sourceIds })) }, null, 2) });
  return files;
}
export const SEGMENTED_REPORT_PATH = "主持材料-含谜底/分段审查原始报告与覆盖.json";
/** The application's ZIP uses stored entries, so this matches createZip without allocating it. */
export function studioZipBytes(files: { path: string; content: string }[]) {
  return 22 + files.reduce((total, file) => total + 76 + 2 * Buffer.byteLength(file.path) + Buffer.byteLength(file.content), 0);
}
