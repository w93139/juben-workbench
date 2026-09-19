import { assertLocalRequest, LocalApiError, localErrorResponse, localJson, readLocalJson } from "@/server/local-security";
import { writeSelectedZip } from "@/server/local-directories";
import { getValidatedStudioReview } from "@/server/studio-models";
import { createZip } from "@/services/zip";
import { safeExportName } from "@/domain/export";
import { studioExportFiles } from "@/server/studio-export-files";
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
    const files = studioExportFiles(result, body.title, body.validationId);
    const filename = `${safeExportName(body.title)}-开本包-${body.validationId.slice(0, 8)}.zip`;
    return localJson(await writeSelectedZip(body.directoryId, filename, createZip(files)));
  } catch (error) { return localErrorResponse(error); }
}
