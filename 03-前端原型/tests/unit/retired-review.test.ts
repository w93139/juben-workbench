import { expect, it, vi } from "vitest";
import { POST as operationsPOST } from "@/app/api/studio/[operation]/route";
import { POST as budgetPOST } from "@/app/api/studio/budget/route";

const address = "http://127.0.0.1:3107";
const projectId = "retired-review-project";
function request(path: string, body: unknown) {
  return new Request(address + path, { method: "POST", headers: { host: "127.0.0.1:3107", origin: address, "content-type": "application/json" }, body: JSON.stringify(body) });
}
const context = (operation: string) => ({ params: Promise.resolve({ operation }) });

it("服务端拒绝所有新的 review 启动请求，防止绕过页面直接付费", async () => {
  const start = vi.fn(); vi.stubGlobal("__studioEngine", { start });
  const response = await operationsPOST(request("/api/studio/review", { blueprint: {} }), context("review"));
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("OPERATION_RETIRED");
  expect(start).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("服务端拒绝所有新的 review 费用预览，不读取账本也不发起报价", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  const response = await budgetPOST(request("/api/studio/budget", { action: "preview", projectId, operation: "review", input: { blueprint: {} } }));
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("不再提供 review 费用预览");
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
