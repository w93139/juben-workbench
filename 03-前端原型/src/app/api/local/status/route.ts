import { assertLocalRequest, localErrorResponse, localJson } from "@/server/local-security";
import { hasNativeDirectoryPicker } from "@/server/local-directories";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { assertLocalRequest(request); return localJson({ directoryPicker: await hasNativeDirectoryPicker(), materialReader: true, platform: process.platform }); }
  catch (error) { return localErrorResponse(error); }
}
