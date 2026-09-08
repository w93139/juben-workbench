import { afterEach, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/studio/[operation]/route";
const address = "http://127.0.0.1:3107";
const context = (operation: string) => ({ params: Promise.resolve({ operation }) });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("未配置模型接口返回503且零外呼，capability仅暴露布尔状态和安全提示", async () => {
  vi.stubEnv("STUDIO_API_KEY", ""); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  const status = await GET(new Request(`${address}/api/studio/capability`, { headers: { host: "127.0.0.1:3107" } }), context("capability"));
  expect(status.status).toBe(200); const body = await status.json(); expect(body.configured).toBe(false); expect(Object.keys(body).sort()).toEqual(["configured", "message"]);
  const response = await POST(new Request(`${address}/api/studio/analyze`, { method: "POST", headers: { host: "127.0.0.1:3107", origin: address, "content-type": "application/json" }, body: JSON.stringify({ documents: [{ id: "a", name: "剧本", text: "自有测试资料" }] }) }), context("analyze"));
  expect(response.status).toBe(503); expect((await response.json()).error.code).toBe("MODEL_NOT_CONFIGURED"); expect(fetchMock).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("拒绝跨站或无Origin的本机模型POST，任务轮询不接受不存在的令牌", async () => {
  for (const origin of [undefined, "https://other.invalid"]) {
    const response = await POST(new Request(`${address}/api/studio/review`, { method: "POST", headers: { host: "127.0.0.1:3107", ...(origin ? { origin } : {}) }, body: "{}" }), context("review")); expect(response.status).toBe(403);
  }
  const status = await GET(new Request(`${address}/api/studio/status?jobId=forged-passed`, { headers: { host: "127.0.0.1:3107" } }), context("status"));
  expect(status.status).toBe(404);
});
