import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ validated: vi.fn(), write: vi.fn() }));
vi.mock("../../src/server/studio-models", () => ({ getValidatedStudioReview: mocks.validated }));
vi.mock("../../src/server/local-directories", () => ({ writeSelectedZip: mocks.write }));
import { POST } from "../../src/app/api/local/directories/write/route";
function request(body: unknown) { return new Request("http://127.0.0.1:3107/api/local/directories/write", { method: "POST", headers: { host: "127.0.0.1:3107", origin: "http://127.0.0.1:3107", "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => { mocks.write.mockReset(); mocks.validated.mockReset(); });
test("无服务器通过记录及浏览器伪造正文不能写出", async () => {
  mocks.validated.mockImplementation(() => { throw new Error("not validated"); });
  expect((await POST(request({ directoryId: "directory", validationId: "unknown", title: "作品" }))).status).toBe(409);
  expect((await POST(request({ directoryId: "directory", validationId: "unknown", title: "作品", passed: true, artifacts: [{ content: "fake" }] }))).status).toBe(400);
  expect(mocks.write).not.toHaveBeenCalled();
});
test("仅从已通过服务器快照制作全包，包含蓝图、报告、正文和未试玩标记", async () => {
  mocks.validated.mockReturnValue({ passed: true, validationId: "valid-server", blueprintFingerprint: "fingerprint", blueprint: { premise: "服务器设计蓝图" }, artifacts: [{ id: "p", module: "character", audience: "player", characterId: "a/b", roundId: null, title: "角色正文", content: "服务器核验后的角色正文", sourceIds: ["s1"] }, { id: "h", module: "host", audience: "host", characterId: null, roundId: null, title: "主持手册", content: "服务器核验后的主持谜底", sourceIds: ["s1"] }], reports: [{ role: "reviewer", content: "真实核验报告" }], humanPlaytest: "not-run" });
  mocks.write.mockResolvedValue({ written: true, filename: "server.zip", name: "测试输出" });
  const response = await POST(request({ directoryId: "chosen-id", validationId: "valid-server", title: "原创作品" }));
  expect(response.status).toBe(200); expect(mocks.validated).toHaveBeenCalledWith("valid-server");
  expect(mocks.write).toHaveBeenCalledOnce();
  const [id, filename, bytes] = mocks.write.mock.calls[0];
  expect(id).toBe("chosen-id"); expect(filename).toMatch(/\.zip$/);
  const text = new TextDecoder().decode(bytes);
  expect(text).toContain("服务器设计蓝图"); expect(text).toContain("真实核验报告"); expect(text).toContain("服务器核验后的角色正文"); expect(text).toContain("服务器核验后的主持谜底"); expect(text).toContain("尚未真人试玩");
  expect(text).toContain("主持材料-含谜底/原创设计蓝图.json");
});
