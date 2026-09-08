import { assertLocalRequest, LocalApiError, localErrorResponse, localJson, readLocalJson } from "@/server/local-security";
import { writeSelectedZip } from "@/server/local-directories";
import { getValidatedStudioReview } from "@/server/studio-models";
import { createZip } from "@/services/export-service";
import { safeExportName } from "@/domain/export";
import { moduleLabels } from "@/domain/production";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertLocalRequest(request, { mutation: true });
    const body = await readLocalJson(request);
    if (typeof body.validationId !== "string" || typeof body.title !== "string" || !body.title.trim() || body.title.length > 80 || Object.keys(body).some((key) => !["directoryId", "validationId", "title"].includes(key))) throw new LocalApiError(400, "请提供通过审查的版本编号和导出名称，不接受浏览器提交的正文。");
    let result: ReturnType<typeof getValidatedStudioReview>;
    try { result = getValidatedStudioReview(body.validationId); }
    catch { throw new LocalApiError(409, "通过审查的本机记录已失效或不存在，请重新运行审查后导出。"); }
    if (!result.blueprint) throw new LocalApiError(409, "通过记录缺少原创蓝图，请重新运行完整审查后导出。");
    const characterIds = [...new Set(result.artifacts.flatMap((artifact) => artifact.characterId ? [artifact.characterId] : []))].sort();
    const directories = new Map(characterIds.map((id, index) => [id, `角色-${String(index + 1).padStart(4, "0")}-${safeExportName(id).slice(0, 35)}`]));
    const files = result.artifacts.map((artifact, index) => {
      const host = artifact.audience === "host" || artifact.module === "host" || artifact.module === "ending";
      const folder = host ? "主持材料-含谜底" : `玩家材料/${artifact.characterId ? directories.get(artifact.characterId) : "公共材料"}`;
      return { path: `${folder}/${moduleLabels[artifact.module]}/${String(index + 1).padStart(3, "0")}-${safeExportName(artifact.title)}.md`, content: artifact.content };
    });
    files.push({ path: "主持材料-含谜底/原创设计蓝图.json", content: JSON.stringify(result.blueprint, null, 2) });
    files.unshift({ path: "00-使用说明.md", content: `# ${body.title}\n\n本包使用本机服务器保存的已通过交叉审查快照，浏览器不能替换其中的正文。\n\n主持材料和审查报告含谜底，请勿把整个包交给玩家；玩家材料按角色分别发放。\n\nAI审查通过不等于经过真人试玩。本项目尚未真人试玩。所有实际时长、玩家体验和可玩性均待真人测试。\n\n正文格式为Markdown，未转换Word或PDF。\n` });
    files.push({ path: "主持材料-含谜底/审查与版本清单.json", content: JSON.stringify({ validationId: body.validationId, blueprintFingerprint: result.blueprintFingerprint, reports: result.reports, humanPlaytest: result.humanPlaytest, exportedAt: new Date().toISOString(), materials: result.artifacts.map((artifact) => ({ id: artifact.id, module: artifact.module, audience: artifact.audience, characterId: artifact.characterId, roundId: artifact.roundId, title: artifact.title, sourceIds: artifact.sourceIds })) }, null, 2) });
    const filename = `${safeExportName(body.title)}-开本包-${body.validationId.slice(0, 8)}.zip`;
    return localJson(await writeSelectedZip(body.directoryId, filename, createZip(files)));
  } catch (error) { return localErrorResponse(error); }
}
