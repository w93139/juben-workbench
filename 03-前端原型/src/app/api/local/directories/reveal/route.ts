import { assertLocalRequest, LocalApiError, localErrorResponse, localJson, readLocalJson } from "@/server/local-security";
import { revealLocalDirectory } from "@/server/local-directories";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { assertLocalRequest(request, { mutation: true }); const body = await readLocalJson(request); if (Object.keys(body).some((key) => key !== "directoryId")) throw new LocalApiError(400, "仅接受已选文件夹编号。"); return localJson(await revealLocalDirectory(body.directoryId)); }
  catch (error) { return localErrorResponse(error); }
}
