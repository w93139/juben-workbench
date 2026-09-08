import { isIP } from "node:net";

export class LocalApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "LocalApiError"; }
}
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || (isIP(host) === 4 && host === "127.0.0.1");
}
/** Local APIs are available only to this exact loopback origin, including port. */
export function assertLocalRequest(request: Request, options: { mutation?: boolean } = {}): void {
  const url = new URL(request.url);
  if (!["http:", "https:"].includes(url.protocol) || !isLoopbackHostname(url.hostname)) throw new LocalApiError(403, "本机接口仅允许在回环地址访问。");
  const host = request.headers.get("host");
  // Next's production Request.url uses its configured hostname (localhost),
  // while a browser may connect to 127.0.0.1. Keep the listening URL's port,
  // require BOTH hostnames to be loopback, and bind Origin to the actual Host
  // header. Forwarded headers are never used as an authority or allowed origin.
  let browserUrl: URL;
  try {
    if (!host) throw new Error();
    browserUrl = new URL(`${url.protocol}//${host}/`);
    if (browserUrl.host.toLowerCase() !== host.toLowerCase() || !isLoopbackHostname(browserUrl.hostname) || browserUrl.port !== url.port) throw new Error();
  } catch { throw new LocalApiError(403, "请求主机或端口与本机服务不一致。"); }
  const origin = request.headers.get("origin");
  if ((options.mutation && !origin) || (origin && origin !== browserUrl.origin)) throw new LocalApiError(403, "只接受当前本机页面发起的同源请求。");
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) throw new LocalApiError(403, "拒绝跨站调用本机接口。");
}
export function localJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export function localErrorResponse(error: unknown): Response {
  if (error instanceof LocalApiError) return localJson({ error: error.message }, error.status);
  if (error instanceof Error && error.name === "AbortError") return localJson({ error: "操作已取消。" }, 499);
  // OS errors may contain personal paths, subprocess arguments or secrets.
  return localJson({ error: "本机操作未完成，请检查权限或稍后重试。" }, 500);
}
export async function readLocalJson(request: Request, maximum = 16384): Promise<Record<string, unknown>> {
  const size = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(size) || size > maximum) throw new LocalApiError(413, "请求过大。");
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    total += value.length;
    if (total > maximum) { await reader.cancel(); throw new LocalApiError(413, "请求过大。"); }
    chunks.push(value);
  }
  try {
    const raw = Buffer.concat(chunks).toString("utf8");
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new LocalApiError(400, "请求格式无效。"); }
}
