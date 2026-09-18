import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StudioJobStore } from "@/server/studio-job-store";
import { StudioBilling } from "@/server/studio-billing";
import { GET, POST } from "@/app/api/studio/budget/route";

const holder = vi.hoisted(() => ({ billing: undefined as StudioBilling | undefined }));
vi.mock("@/server/studio-models", async original => ({ ...await original<typeof import("@/server/studio-models")>(),
  getStudioEngine: () => ({ billing: holder.billing }), readStudioConfig: () => { throw new Error("No test model configuration"); },
}));
let store: StudioJobStore;
beforeEach(() => { store = new StudioJobStore(":memory:"); holder.billing = new StudioBilling(store.budget); });
afterEach(() => { store.close(); vi.unstubAllGlobals(); });
const address = "http://127.0.0.1:3107/api/studio/budget";
const headers = { host: "127.0.0.1:3107", origin: "http://127.0.0.1:3107", "content-type": "application/json" };
const request = (body: unknown) => new Request(address, { method: "POST", headers, body: JSON.stringify(body) });
it("无模型配置也能读写预算，读账本和CAS失败均不外呼", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const empty = await GET(new Request(address + "?projectId=project-a", { headers }));
  expect(await empty.json()).toEqual({ budget: null }); expect(empty.headers.get("cache-control")).toBe("no-store");
  const saved = await POST(request({ action: "configure", projectId: "project-a", capFen: 1000, revision: 0 })); expect(saved.status).toBe(200);
  expect((await saved.json()).budget).toMatchObject({ revision: 1, capFen: 1000, totalCalls: 0 });
  const stale = await POST(request({ action: "configure", projectId: "project-a", capFen: 2000, revision: 0 })); expect(stale.status).toBe(409);
  expect(store.budget.snapshot("project-a")!.capFen).toBe(1000); expect(fetcher).not.toHaveBeenCalled();
});
it("拒绝跨站、非法金额和客户端伪造账单字段，原账本不变", async () => {
  const cross = await POST(new Request(address, { method: "POST", headers: { ...headers, origin: "https://other.invalid" }, body: "{}" })); expect(cross.status).toBe(403);
  for (const capFen of [-1, 0.5, "100"])
    expect((await POST(request({ action: "configure", projectId: "project-a", capFen, revision: 0 }))).status).toBe(400);
  expect((await POST(request({ action: "configure", projectId: "project-a", capFen: 1000, revision: 0, spentFen: 0 }))).status).toBe(400);
  expect(store.budget.snapshot("project-a")).toBeNull();
});
it("核对须有明确记录版本和依据，不能用无记录或空白清除费用", async () => {
  store.budget.configure("project-a", 1000, 0);
  expect((await POST(request({ action: "reconcile", projectId: "project-a", callId: "11111111-1111-4111-8111-111111111111", version: 1, actualFen: 0, note: "" }))).status).toBe(400);
  expect((await POST(request({ action: "reconcile", projectId: "project-a", callId: "11111111-1111-4111-8111-111111111111", version: 1, actualFen: 0, note: "自造账单核对" }))).status).toBe(409);
});
