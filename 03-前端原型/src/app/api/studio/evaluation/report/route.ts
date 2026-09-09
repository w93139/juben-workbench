import { assertLocalRequest, localErrorResponse, localJson } from "@/server/local-security";
import { buildEvaluationReport } from "@/server/evaluation-report";
import { modelEvaluationEngine } from "@/server/model-evaluation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { assertLocalRequest(request); return localJson(buildEvaluationReport(modelEvaluationEngine.get())); }
  catch (error) { return localErrorResponse(error); }
}
