import { expect, test } from "vitest";
import { assertLocalRequest, localErrorResponse, readLocalJson } from "../../src/server/local-security";
function request(url: string, headers: Record<string, string> = {}, method = "POST") { return new Request(url, { method, headers: { host: new URL(url).host, ...headers } }); }
test("本机API严格绑定回环host、页面origin和端口，拒绝跨站和缺失origin变更", () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) expect(() => assertLocalRequest(request(`http://${host}:3107/api/local/x`, { origin: `http://${host}:3107`, "sec-fetch-site": "same-origin" }), { mutation: true })).not.toThrow();
  for (const value of [
    request("http://127.0.0.1:3107/x"),
    request("http://127.0.0.1:3107/x", { origin: "http://localhost:3107" }),
    request("http://127.0.0.1:3107/x", { origin: "http://127.0.0.1:3108" }),
    request("http://127.0.0.1:3107/x", { origin: "https://attacker.example" }),
    request("http://127.0.0.1:3107/x", { origin: "http://127.0.0.1:3107", host: "attacker.example" }),
    request("http://127.0.0.1:3107/x", { origin: "http://127.0.0.1:3107", "sec-fetch-site": "cross-site" }),
    request("http://127.0.0.1.attacker.example:3107/x", { origin: "http://127.0.0.1.attacker.example:3107" }),
    request("http://192.168.1.2:3107/x", { origin: "http://192.168.1.2:3107" }),
  ]) expect(() => assertLocalRequest(value, { mutation: true })).toThrow();
  expect(() => assertLocalRequest(request("http://127.0.0.1:3107/x", {}, "GET"))).not.toThrow();
});
test("本机JSON读取有流大小上限，错误不泄漏文件路径或子进程参数且无CORS", async () => {
  const value = await readLocalJson(new Request("http://localhost/x", { method: "POST", body: '{"title":"新作品"}' }));
  expect(value.title).toBe("新作品");
  await expect(readLocalJson(new Request("http://localhost/x", { method: "POST", body: "a".repeat(200) }), 100)).rejects.toThrow("请求过大");
  await expect(readLocalJson(new Request("http://localhost/x", { method: "POST", body: "[]" }))).rejects.toThrow("请求格式无效");
  const response = localErrorResponse(new Error("/private/author/secret-path: command token"));
  expect(await response.text()).not.toMatch(/private|secret|token/);
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
});
test("兼容Next内部localhost URL，仍将Origin绑定实际回环Host及服务端口，不信转发头", () => {
  const internal = "http://localhost:3109/api/local/materials/read";
  const valid = { host: "127.0.0.1:3109", origin: "http://127.0.0.1:3109", "sec-fetch-site": "same-origin" };
  expect(() => assertLocalRequest(request(internal, valid), { mutation: true })).not.toThrow();
  expect(() => assertLocalRequest(request(internal, { ...valid, "x-forwarded-host": "attacker.example", "x-forwarded-port": "9999" }), { mutation: true })).not.toThrow();
  for (const headers of [
    { ...valid, origin: "http://localhost:3109" },
    { ...valid, host: "127.0.0.1:3110", origin: "http://127.0.0.1:3110" },
    { ...valid, host: "attacker.example:3109", "x-forwarded-host": "127.0.0.1:3109" },
    { ...valid, origin: "https://attacker.example", "x-forwarded-host": "attacker.example" },
    { ...valid, host: "127.0.0.1:3109@attacker.example:3109" },
  ]) expect(() => assertLocalRequest(request(internal, headers), { mutation: true })).toThrow();
});
