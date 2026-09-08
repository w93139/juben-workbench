import { NextResponse } from "next/server";
import { assertLocalRequest, localErrorResponse } from "@/server/local-security";
import { StudioError, readStudioConfig, studioEngine } from "@/server/studio-models";
import type { StudioOperation } from "@/domain/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) { return error instanceof StudioError ? response({ error: { code: error.code, message: error.message } }, error.status) : localErrorResponse(error); }
export async function GET(request: Request, context: { params: Promise<{ operation: string }> }) {
  try {
    assertLocalRequest(request);
    const { operation } = await context.params;
    if (operation === "capability") {
      try { readStudioConfig(); return response({ configured: true, message: "模型连接已配置，实际可用性以请求结果为准。" }); } catch { return response({ configured: false, message: "模型尚未连接，请配置主模型与两路审查模型后使用。" }); }
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
    if (Number(request.headers.get("content-length") ?? 0) > 700000) throw new StudioError("CONTEXT_TOO_LARGE", "请求资料超过限制，未发起模型调用。", 413);
    const reader = request.body?.getReader(); if (!reader) throw new StudioError("INVALID_INPUT", "请求资料为空。", 400);
    const chunks: Uint8Array[] = []; let bytes = 0;
    try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 700000) throw new StudioError("CONTEXT_TOO_LARGE", "请求资料超过限制，未发起模型调用。", 413); chunks.push(next.value); } } finally { await reader.cancel().catch(() => {}); }
    let input: unknown; try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new StudioError("INVALID_INPUT", "请求资料不是有效JSON。", 400); }
    return response(await studioEngine.start(operation as StudioOperation, input, request.headers.get("x-studio-request-id") ?? undefined), 202);
  } catch (error) { return failure(error); }
}
