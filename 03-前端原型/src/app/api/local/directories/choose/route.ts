import { assertLocalRequest, LocalApiError, localErrorResponse, localJson, readLocalJson } from "@/server/local-security";
import { chooseLocalDirectory } from "@/server/local-directories";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { assertLocalRequest(request, { mutation: true }); const body = await readLocalJson(request); if (Object.keys(body).length) throw new LocalApiError(400, "请选择系统窗口中的文件夹，不接受路径参数。"); const directory = await chooseLocalDirectory(request.signal); return localJson(directory ?? { cancelled: true }); }
  catch (error) { return localErrorResponse(error); }
}
