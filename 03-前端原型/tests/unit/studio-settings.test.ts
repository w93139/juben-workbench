import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioSettingsStore } from "@/server/studio-settings";
import { GET, POST } from "@/app/api/studio/settings/route";
const temporary: string[] = [];
function setup() { const root = mkdtempSync(join(tmpdir(), "studio-settings-test-")); temporary.push(root); return { root, store: new StudioSettingsStore(root) }; }
const input = { revision: 0, baseUrl: "https://model.invalid/v1/", apiKey: "test-only-placeholder", mainModel: "main", reviewA: "review-a", reviewB: "review-b" };
afterEach(() => { temporary.forEach(root => rmSync(root, { recursive: true, force: true })); temporary.length = 0; vi.unstubAllGlobals(); });
describe("本机模型配置安全保存", () => {
  it("原子写受限文件，安全读取无密钥，保存配置不调用网络", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); const { store, root } = setup();
    expect(store.safe({}).configured).toBe(false);
    const saved = store.save(input, {}); expect(saved).toMatchObject({ configured: true, hasApiKey: true, source: "local", baseUrl: "https://model.invalid/v1", revision: 1 });
    expect(JSON.stringify(saved)).not.toContain(input.apiKey); expect(Object.keys(saved)).not.toContain("apiKey");
    expect(store.config({})?.apiKey).toBe(input.apiKey);
    expect(statSync(root).mode & 0o777).toBe(0o700); expect(statSync(join(root, "studio-settings.json")).mode & 0o777).toBe(0o600);
    expect(readdirSync(root)).toEqual(["studio-settings.json"]); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("留空保留同地址密钥，换服务强制新密钥；过期revision不覆盖", () => {
    const { store, root } = setup(); store.save(input, {});
    const next = store.save({ ...input, revision: 1, apiKey: "", mainModel: "main-v2" }, {}); expect(next.revision).toBe(2); expect(store.config({})?.apiKey).toBe(input.apiKey);
    const before = readFileSync(join(root, "studio-settings.json"), "utf8");
    expect(() => store.save({ ...input, revision: 2, baseUrl: "https://different.invalid/v1", apiKey: "" }, {})).toThrow("新服务地址需要重新填写密钥");
    expect(() => store.save({ ...input, revision: 1 }, {})).toThrow("其他页面更新"); expect(readFileSync(join(root, "studio-settings.json"), "utf8")).toBe(before);
  });
  it("三模型需不同，地址不能带凭证或非回环明文HTTP，失败不新建文件", () => {
    const { store, root } = setup();
    const embedded = new URL("https://service.invalid/v1"); embedded.username = "test-user"; embedded.password = "test-only-placeholder";
    for (const value of [ { ...input, reviewB: "main" }, { ...input, baseUrl: "http://external.invalid/v1" }, { ...input, baseUrl: embedded.toString() }, { ...input, baseUrl: "https://service.invalid/v1?key=placeholder" } ]) expect(() => store.save(value, {})).toThrow();
    expect(existsSync(join(root, "studio-settings.json"))).toBe(false);
  });
  it("环境变量整组优先，不混合本机密钥且阻止页面覆盖", () => {
    const { store } = setup(); store.save(input, {});
    const partial = { STUDIO_API_BASE_URL: "https://environment.invalid/v1" };
    expect(() => store.config(partial)).toThrow("环境变量"); expect(store.safe(partial)).toMatchObject({ configured: false, environmentLocked: true });
    expect(() => store.save({ ...input, revision: 1 }, partial)).toThrow("环境变量管理");
    const env = { ...partial, STUDIO_API_KEY: "env-unit-placeholder", STUDIO_MAIN_MODEL: "env-main", STUDIO_REVIEW_A_MODEL: "env-a", STUDIO_REVIEW_B_MODEL: "env-b" };
    expect(store.config(env)?.apiKey).toBe("env-unit-placeholder"); expect(store.safe(env).source).toBe("environment"); expect(JSON.stringify(store.safe(env))).not.toContain("env-unit-placeholder");
  });
  it("拒绝符号链接与宽松文件权限，损坏文件不被静默覆盖", () => {
    const { store, root } = setup(); store.save(input, {}); const file = join(root, "studio-settings.json");
    chmodSync(file, 0o644); expect(() => store.config({})).toThrow("无法安全读取或保存"); chmodSync(file, 0o600);
    writeFileSync(file, "broken", { mode: 0o600 }); expect(() => store.save({ ...input, revision: 1 }, {})).toThrow("无法安全读取或保存"); expect(readFileSync(file, "utf8")).toBe("broken");
    rmSync(file); const other = join(root, "another-file"); writeFileSync(other, "unchanged", { mode: 0o600 }); symlinkSync(other, file);
    expect(() => store.config({})).toThrow("无法安全读取或保存"); expect(readFileSync(other, "utf8")).toBe("unchanged");
  });
  it("设置API拒绝跨站与缺Origin的写入，不暴露内部信息", async () => {
    for (const origin of [undefined, "https://external.invalid"]) {
      const response = await POST(new Request("http://127.0.0.1:3107/api/studio/settings", { method: "POST", headers: { host: "127.0.0.1:3107", ...(origin ? { origin } : {}) }, body: JSON.stringify(input) })); expect(response.status).toBe(403); expect(JSON.stringify(await response.json())).not.toContain(input.apiKey);
    }
    const response = await GET(new Request("https://external.invalid/api/studio/settings", { headers: { host: "external.invalid" } })); expect(response.status).toBe(403);
  });
});
