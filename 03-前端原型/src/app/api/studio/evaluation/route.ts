import { z } from "zod";
import { assertLocalRequest, localErrorResponse, localJson, readLocalJson } from "@/server/local-security";
import { modelEvaluationEngine } from "@/server/model-evaluation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const actionSchema = z.object({ action: z.enum(["discover", "start", "resume", "cancel"]) }).strict();

export async function GET(request: Request) {
  try { assertLocalRequest(request); return localJson(modelEvaluationEngine.get()); }
  catch (error) { return localErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    assertLocalRequest(request, { mutation: true });
    const parsed = actionSchema.safeParse(await readLocalJson(request));
    if (!parsed.success) return localJson({ error: "测评操作无效。" }, 400);
    if (parsed.data.action === "discover") return localJson(await modelEvaluationEngine.discover());
    if (parsed.data.action === "start") return localJson(modelEvaluationEngine.start(), 202);
    if (parsed.data.action === "resume") return localJson(await modelEvaluationEngine.resume(), 202);
    return localJson(modelEvaluationEngine.cancel(), 202);
  } catch (error) { return localErrorResponse(error); }
}
