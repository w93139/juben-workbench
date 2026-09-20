import { NextResponse } from "next/server";
import { assertLocalRequest, localErrorResponse } from "@/server/local-security";
import { StudioError, readStudioConfig, studioEngine } from "@/server/studio-models";
import { studioSettingsStore } from "@/server/studio-settings";
import type { StudioOperation } from "@/domain/studio";
import { ANALYSIS_INPUT_BYTES } from "@/domain/analysis-limits";
import { studioBudgetClaimSchema } from "@/domain/studio-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) { return error instanceof StudioError ? response({ error: { code: error.code, message: error.message } }, error.status) : localErrorResponse(error); }
export async function GET(request: Request, context: { params: Promise<{ operation: string }> }) {
  try {
    assertLocalRequest(request);
    const { operation } = await context.params;
    if (operation === "capability") {
      try {
        const settings = studioSettingsStore.safe();
        const message = !settings.providerConfigured ? "模型尚未连接，请先保存平台地址与密钥。"
          : !settings.analyzeReady ? "尚未分配拆解模型或主模型，拆解暂不可用。请在模型配置中填写拆解模型（或主模型）。"
          : !settings.blueprintReady ? "拆解可用；生成蓝图与正文还需要设置主模型。"
          : !settings.reviewReady ? "拆解与蓝图可用；正文生成和交叉验证还需要补齐三个不同模型。"
          : "模型连接已配置，实际可用性以请求结果为准。";
        return response({ configured: settings.reviewReady, providerConfigured: settings.providerConfigured, analyzeReady: settings.analyzeReady, blueprintReady: settings.blueprintReady, reviewReady: settings.reviewReady, message });
      } catch { return response({ configured: false, providerConfigured: false, analyzeReady: false, blueprintReady: false, reviewReady: false, message: "模型连接状态读取失败，请检查本机配置。" }); }
    }
    if (operation !== "status") return response({ error: { code: "NOT_FOUND", message: "没有这个操作。" } }, 404);
    return response(studioEngine.get(new URL(request.url).searchParams.get("jobId") ?? ""));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  try {
    assertLocalRequest(request, { mutation: true });
    const { operation } = await context.params;
    if (!["analyze", "blueprint", "review"].includes(operation)) return response({ error: { code: "NOT_FOUND", message: "没有这个操作。" } }, 404);
    readStudioConfig();
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new StudioError("INVALID_INPUT", "请发送JSON资料。", 415);
    const requestLimit = operation === "analyze" ? ANALYSIS_INPUT_BYTES + 65536 : 700000;
    if (Number(request.headers.get("content-length") ?? 0) > requestLimit) throw new StudioError("CONTEXT_TOO_LARGE", "请求资料超过限制，未发起模型调用。", 413);
    const reader = request.body?.getReader(); if (!reader) throw new StudioError("INVALID_INPUT", "请求资料为空。", 400);
    const chunks: Uint8Array[] = []; let bytes = 0;
    try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > requestLimit) throw new StudioError("CONTEXT_TOO_LARGE", "请求资料超过限制，未发起模型调用。", 413); chunks.push(next.value); } } finally { await reader.cancel().catch(() => {}); }
    let input: unknown; try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new StudioError("INVALID_INPUT", "请求资料不是有效JSON。", 400); }
    const previewId = request.headers.get("x-studio-budget-preview");
    const budget = studioBudgetClaimSchema.safeParse({ projectId: request.headers.get("x-studio-project-id"), revision: Number(request.headers.get("x-studio-budget-revision")), ...(previewId ? { previewId } : {}) });
    return response(await studioEngine.start(operation as StudioOperation, input, request.headers.get("x-studio-request-id") ?? undefined, budget.success ? budget.data : undefined), 202);
  } catch (error) { return failure(error); }
}
