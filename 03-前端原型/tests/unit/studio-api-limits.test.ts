import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/studio/[operation]/route";
import { ANALYSIS_INPUT_BYTES } from "@/domain/analysis-limits";

const { start } = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("@/server/studio-models", () => ({
  StudioError: class extends Error { constructor(public code: string, message: string, public status: number) { super(message); } },
  readStudioConfig: () => ({}),
  studioEngine: { start },
}));
const address = "http://127.0.0.1:3107";
const context = (operation: string) => ({ params: Promise.resolve({ operation }) });
const request = (operation: string, body: string, headers: Record<string, string> = {}) => new Request(`${address}/api/studio/${operation}`, {
  method: "POST", headers: { host: "127.0.0.1:3107", origin: address, "content-type": "application/json", ...headers }, body,
});
beforeEach(() => { start.mockReset(); start.mockResolvedValue({ jobId: "test", status: "running", phase: "正在分段读取" }); });
afterEach(() => vi.unstubAllGlobals());

it("拆解入口接收超过旧700KB请求上限的完整正文", async () => {
  const body = { documents: [{ id: "d", name: "原本.txt", text: "文".repeat(250000) }] };
  const response = await POST(request("analyze", JSON.stringify(body)), context("analyze"));
  expect(response.status).toBe(202); expect(start).toHaveBeenCalledWith("analyze", body, undefined);
});
it("长剧本入口分别按Content-Length与实际字节拒绝过量请求，不发起任务或外呼", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const limit = ANALYSIS_INPUT_BYTES + 65536;
  for (const req of [request("analyze", "{}", { "content-length": String(limit + 1) }), request("analyze", "x".repeat(limit + 1))]) {
    const response = await POST(req, context("analyze"));
    expect(response.status).toBe(413); expect((await response.json()).error.code).toBe("CONTEXT_TOO_LARGE");
  }
  expect(start).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
it("其他步骤仍保持原请求容量限制", async () => {
  for (const operation of ["blueprint", "review"]) {
    const response = await POST(request(operation, "x".repeat(700001)), context(operation));
    expect(response.status).toBe(413);
  }
  expect(start).not.toHaveBeenCalled();
});
