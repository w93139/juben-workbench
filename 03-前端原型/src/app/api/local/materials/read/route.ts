import { assertLocalRequest, localErrorResponse, localJson } from "@/server/local-security";
import { readMaterialUpload } from "@/server/material-reader";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { assertLocalRequest(request, { mutation: true }); return localJson(await readMaterialUpload(request)); }
  catch (error) { return localErrorResponse(error); }
}
