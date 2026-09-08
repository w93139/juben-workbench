import { assertLocalRequest, localErrorResponse, localJson, readLocalJson } from "@/server/local-security";
import { studioSettingsStore } from "@/server/studio-settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { assertLocalRequest(request); return localJson(studioSettingsStore.safe()); }
  catch (error) { return localErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    assertLocalRequest(request, { mutation: true });
    return localJson(studioSettingsStore.save(await readLocalJson(request, 16384)));
  } catch (error) { return localErrorResponse(error); }
}
