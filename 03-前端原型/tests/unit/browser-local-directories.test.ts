import { afterEach, expect, test, vi } from "vitest";
import { BrowserOutputDirectories } from "../../src/services/browser-output-directories";
afterEach(() => { vi.unstubAllGlobals(); });
function page(hostname: string, picker = vi.fn(() => Promise.reject(new DOMException("cancel", "AbortError")))) {
  vi.stubGlobal("window", { location: { hostname }, isSecureContext: true, showDirectoryPicker: picker });
  return picker;
}
test("非本机浏览器fallback在第一次await之前打开picker，保留点击激活", async () => {
  const picker = page("example.com");
  const directory = new BrowserOutputDirectories();
  const result = directory.pick();
  expect(picker).toHaveBeenCalledOnce();
  expect(picker).toHaveBeenCalledWith({ startIn: "desktop", mode: "read" });
  expect(await result).toBeNull();
});
test("本机预先探测不支持原生后，浏览器fallback仍同步触发", async () => {
  const picker = page("127.0.0.1");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ directoryPicker: false })));
  const directory = new BrowserOutputDirectories();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const result = directory.pick();
  expect(picker).toHaveBeenCalledOnce();
  expect(await result).toBeNull();
});
test("本机服务优先且取消不触发第二个窗口，服务失联要求重启不伪造成功", async () => {
  const picker = page("127.0.0.1");
  const fetch = vi.fn(async (url: string) => url.endsWith("status") ? Response.json({ directoryPicker: true }) : Response.json({ cancelled: true }));
  vi.stubGlobal("fetch", fetch);
  const directory = new BrowserOutputDirectories();
  expect(await directory.pick()).toBeNull();
  expect(fetch).toHaveBeenCalledWith("/api/local/directories/choose", expect.objectContaining({ method: "POST" }));
  expect(picker).not.toHaveBeenCalled();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  await expect(new BrowserOutputDirectories().pick()).rejects.toThrow("重新启动本机工作台");
  expect(picker).not.toHaveBeenCalled();
});
