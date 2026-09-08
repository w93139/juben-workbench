import { assertLocalRequest, localErrorResponse, localJson } from "@/server/local-security";
import { getLocalDirectory } from "@/server/local-directories";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertLocalRequest(request); return localJson(await getLocalDirectory((await context.params).id)); }
  catch (error) { return localErrorResponse(error); }
}
