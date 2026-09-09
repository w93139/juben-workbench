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
  expect(picker).toHaveBeenCalledWith({ startIn: "desktop", mode: "readwrite" });
  expect(await result).toBeNull();
});
test("浏览器新建成果子目录并保存子目录引用，权限失败不会登记成功", async () => {
  const child = { name: "", kind: "directory" };
  const createChild = vi.fn(async (name: string) => { child.name = name; return child; });
  const picker = vi.fn(async () => ({ name: "父目录", kind: "directory", getDirectoryHandle: createChild }));
  vi.stubGlobal("window", { location: { hostname: "example.com" }, isSecureContext: true, showDirectoryPicker: picker });
  const directory = new BrowserOutputDirectories();
  const transaction = vi.spyOn(directory as unknown as { transaction: () => Promise<unknown> }, "transaction").mockResolvedValue(undefined);
  const result = await directory.pick();
  expect(picker).toHaveBeenCalledWith({ startIn: "desktop", mode: "readwrite" });
  expect(result?.name).toMatch(/^剧本工作台成果-[0-9a-f-]{36}$/);
  expect(createChild).toHaveBeenCalledWith(result?.name, { create: true });
  expect(transaction).toHaveBeenCalledOnce();
  createChild.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
  await expect(directory.pick()).rejects.toThrow("新建成果文件夹");
  expect(transaction).toHaveBeenCalledOnce();
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
