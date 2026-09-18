import { checkBlueprint } from "@/domain/blueprint";
import type { Project } from "@/domain/models";
import { isReviewStale } from "@/domain/production";
import { artifactExportPath, exportCharacterDirectories, exportArtifacts, exportLabel, safeExportName, type ExportBundle, type ExportFile, type ExportScope } from "@/domain/export";
import { ServiceError } from "./contracts";

/** Historical simulated export format, retained for regression tests. */
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
