import { assertLocalRequest, localErrorResponse, localJson } from "@/server/local-security";
import { buildEvaluationReport } from "@/server/evaluation-report";
import { modelEvaluationEngine } from "@/server/model-evaluation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const archive = new URL(request.url).searchParams.get("archive");
    if (archive != null && !/^\d{1,9}$/.test(archive)) return localJson({ error: "历史报告编号无效。" }, 400);
    return localJson(buildEvaluationReport(archive == null ? modelEvaluationEngine.get() : modelEvaluationEngine.archived(Number(archive))));
  }
  catch (error) { return localErrorResponse(error); }
}
