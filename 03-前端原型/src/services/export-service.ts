import { checkBlueprint } from "@/domain/blueprint";
import type { Project } from "@/domain/models";
import { isReviewStale } from "@/domain/production";
import { artifactExportPath, exportCharacterDirectories, exportArtifacts, exportLabel, safeExportName, type ExportBundle, type ExportFile, type ExportScope } from "@/domain/export";
import { ServiceError } from "./contracts";

export function prepareExport(project: Project, versionId: string, scope: ExportScope, now = new Date().toISOString()): ExportBundle {
  const version = project.blueprint?.versions.find((item) => item.id === versionId);
  if (!version) throw new ServiceError("INVALID_INPUT", "请先选择已经保存的蓝图版本。");
  const artifacts = exportArtifacts(project, versionId, scope);
  if (!artifacts.length) throw new ServiceError("INVALID_INPUT", "所选蓝图版本还没有这类正文，请先到“生成与检查”生成或编辑材料。");
  const issues = checkBlueprint(version.data);
  const review = project.production?.reviews.filter((item) => item.blueprintVersionId === versionId).at(-1);
  const reviewSummary = !review ? "尚无模拟审查记录" : isReviewStale(project, review) ? "已有模拟审查需要复查" : review.models.every((model) => model.status === "completed") ? "模拟双审已完成，意见仍需作者处理" : "模拟双审尚未完成";
  const directories = exportCharacterDirectories(project);
  const files: ExportFile[] = artifacts.map((artifact, index) => ({ path: artifactExportPath(artifact, index, directories), content: artifact.content }));
  const manifest = {
    formatVersion: 1, project: { id: project.id, title: project.title, revision: project.revision },
    blueprint: { id: version.id, label: version.label, createdAt: version.createdAt }, exportedAt: now, scope,
    limitations: { sourceAnalysis: "未接入真实OCR或AI；仅导出浏览器内已有正文", wordAndPDF: "本包仅含Markdown和JSON，未转换Word或PDF", destination: "浏览器下载位置；不表示写入项目设置的输出目录" },
    checks: {
      blueprintFields: { scope: "所选蓝图的字段与引用检查，不是完整开本包静态一致性检查", errors: issues.filter((issue) => issue.severity === "error").length, warnings: issues.filter((issue) => issue.severity === "warning").length },
      fullStaticConsistency: "本次未执行完整成品静态一致性检查脚本", realAIReview: "未接入真实AI审查", mockReview: { status: reviewSummary, id: review?.id ?? null },
      simulatedPlaytest: "无本次模拟试玩结论", humanPlaytest: "尚未真人试玩；未记录真人试玩结论",
    },
    materials: artifacts.map((artifact, index) => ({ path: files[index].path, id: artifact.id, module: artifact.module, audience: artifact.audience, characterId: artifact.characterId, blueprintVersionId: artifact.blueprintVersionId, version: artifact.version, origin: artifact.origin, createdAt: artifact.createdAt })),
  };
  files.unshift({ path: "00-使用说明.md", content: `# ${project.title} · ${exportLabel(scope)}\n\n这是创作中的材料包，尚未真人试玩。\n\n- 蓝图：${version.label}（${version.id}）。仅含此版本下各份正文的最新非空版本。\n- 本次共 ${artifacts.length} 份正文；缺少的类别不会自动补造，下载全部资源不代表开本包已齐全。\n- 玩家材料按角色分文件夹，分别发给对应玩家；不要将整个包直接发送给玩家。\n- “主持材料-含谜底”仅供主持人；总包、主持手册与终局材料含剧透。\n- 正文可能来自本地模拟模板或作者修改，请在开本前逐份校对。\n- ${reviewSummary}。未进行真实AI审查，本次未执行完整成品静态一致性检查脚本。\n- 蓝图字段与引用检查：${issues.filter((item) => item.severity === "error").length} 项错误、${issues.filter((item) => item.severity === "warning").length} 项提醒；不代表可玩性已验证。\n- ZIP 内含 Markdown 正文与 JSON 清单，没有 Word/PDF 转换。\n- 下载位置由浏览器设置决定，没有直接写入项目所选输出文件夹。\n` });
  files.push({ path: "01-导出清单.json", content: JSON.stringify(manifest, null, 2) });
  return { filename: `${safeExportName(project.title)}-${safeExportName(version.label)}-${exportLabel(scope)}.zip`, files, materialCount: artifacts.length };
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Standard ZIP (stored entries, UTF-8 names), with central directory and CRCs. */
export function createZip(files: ExportFile[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const entries = files.map((file) => ({ name: encoder.encode(file.path), body: encoder.encode(file.content) }));
  if (entries.length > 65535 || entries.some((entry) => entry.name.length > 65535)) throw new Error("导出文件过多或名称过长，请分资源类别下载。");
  const localSize = entries.reduce((size, item) => size + 30 + item.name.length + item.body.length, 0);
  const centralSize = entries.reduce((size, item) => size + 46 + item.name.length, 0);
  if (localSize + centralSize + 22 >= 0xffffffff) throw new Error("材料包过大，请分资源类别下载。");
  const bytes = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(bytes.buffer);
  let offset = 0, central = localSize;
  for (const item of entries) {
    const crc = crc32(item.body);
    view.setUint32(offset, 0x04034b50, true); view.setUint16(offset + 4, 20, true); view.setUint16(offset + 6, 0x0800, true);
    view.setUint16(offset + 12, 0x21, true); view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, item.body.length, true); view.setUint32(offset + 22, item.body.length, true); view.setUint16(offset + 26, item.name.length, true);
    bytes.set(item.name, offset + 30); bytes.set(item.body, offset + 30 + item.name.length);
    view.setUint32(central, 0x02014b50, true); view.setUint16(central + 4, 20, true); view.setUint16(central + 6, 20, true); view.setUint16(central + 8, 0x0800, true);
    view.setUint16(central + 14, 0x21, true); view.setUint32(central + 16, crc, true); view.setUint32(central + 20, item.body.length, true); view.setUint32(central + 24, item.body.length, true);
    view.setUint16(central + 28, item.name.length, true); view.setUint32(central + 42, offset, true); bytes.set(item.name, central + 46);
    offset += 30 + item.name.length + item.body.length; central += 46 + item.name.length;
  }
  view.setUint32(central, 0x06054b50, true); view.setUint16(central + 8, entries.length, true); view.setUint16(central + 10, entries.length, true); view.setUint32(central + 12, centralSize, true); view.setUint32(central + 16, localSize, true);
  return bytes;
}
export function downloadExport(bundle: ExportBundle): void {
  const blob = new Blob([createZip(bundle.files).buffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = bundle.filename; link.style.display = "none";
  document.body.append(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
