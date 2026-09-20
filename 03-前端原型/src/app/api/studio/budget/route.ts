import { z } from "zod";
import { moneyFenSchema, projectBudgetIdSchema } from "@/domain/studio-budget";
import { ANALYSIS_INPUT_BYTES } from "@/domain/analysis-limits";
import { assertLocalRequest, LocalApiError, localErrorResponse, localJson, readLocalJson } from "@/server/local-security";
import { getStudioEngine, readStudioConfig, StudioError } from "@/server/studio-models";
import { previewStudioCost } from "@/server/studio-cost-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const number = z.number().int().nonnegative().safe();
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configure"), projectId: projectBudgetIdSchema, capFen: moneyFenSchema, revision: number }).strict(),
  z.object({ action: z.literal("reconcile"), projectId: projectBudgetIdSchema, callId: z.string().uuid(), version: number, actualFen: number, note: z.string().trim().min(1).max(500) }).strict(),
  z.object({ action: z.literal("prices") }).strict(),
  z.object({ action: z.literal("preview"), projectId: projectBudgetIdSchema, operation: z.enum(["analyze", "blueprint", "review"]), input: z.unknown() }).strict(),
]);
function failure(error: unknown) {
  if (error instanceof StudioError) return localJson({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return localJson({ error: "预算请求格式无效，原记录未修改。" }, 400);
  return localErrorResponse(error);
}
export async function GET(request: Request) {
  try {
    assertLocalRequest(request); const url = new URL(request.url);
    const projectId = projectBudgetIdSchema.parse(url.searchParams.get("projectId"));
    const offset = number.parse(Number(url.searchParams.get("offset") ?? 0));
    return localJson({ budget: getStudioEngine().billing!.ledger.snapshot(projectId, offset) });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    assertLocalRequest(request, { mutation: true });
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new LocalApiError(415, "预算接口仅接受JSON请求。");
    const body = bodySchema.parse(await readLocalJson(request, ANALYSIS_INPUT_BYTES + 65536));
    const billing = getStudioEngine().billing!;
    if (body.action === "configure") return localJson({ budget: billing.ledger.configure(body.projectId, body.capFen, body.revision) });
    if (body.action === "reconcile") return localJson({ budget: billing.ledger.reconcile(body.projectId, body.callId, body.version, body.actualFen, body.note) });
    const config = readStudioConfig();
    if (body.action === "prices") return localJson({ quotes: await billing.prices.get(config.baseUrl, [config.mainModel, config.reviewA, config.reviewB].filter(Boolean), undefined, true) });
    return localJson(await previewStudioCost(billing, config, body.projectId, body.operation, body.input, getStudioEngine().production));
  } catch (error) { return failure(error); }
}
