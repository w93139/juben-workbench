import { pickedOutputDirectorySchema, type PickedOutputDirectory } from "@/domain/output-settings";
import { ServiceError, type OutputDirectoryPort, type OutputDirectoryCapability } from "./contracts";

export const OUTPUT_DIRECTORY_DB = "juben-workbench:output-directories:v1";
const storeName = "directories";
function loopbackPage() { return typeof window !== "undefined" && ["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname); }

type BridgeState = "available" | "unsupported" | "unavailable";
async function nativeBridgeState(): Promise<BridgeState> {
  if (!loopbackPage()) return "unsupported";
  try {
    const result = await fetch("/api/local/status", { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!result.ok) return "unavailable";
    return (await result.json()).directoryPicker === true ? "available" : "unsupported";
  } catch { return "unavailable"; }
}

type PickerWindow = Window & { showDirectoryPicker?: (options: { startIn: "desktop"; mode: "readwrite" }) => Promise<FileSystemDirectoryHandle> };

function unavailable() { return new ServiceError("STORAGE_UNAVAILABLE", "无法保存或读取文件夹引用，原输出设置已保留。请重新选择文件夹。"); }

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(OUTPUT_DIRECTORY_DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(storeName, { keyPath: "id" }); };
    request.onsuccess = () => { if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
    request.onerror = request.onblocked = () => { settled = true; reject(unavailable()); };
  });
}

// Store the newly created output child, never the source/parent directory.
export class BrowserOutputDirectories implements OutputDirectoryPort {
  private bridge: BridgeState | null = loopbackPage() ? null : "unsupported";
  private probe: Promise<BridgeState>;
  constructor() {
    // Read-only capability discovery happens before the user's click. Browser
    // fallback must invoke its picker without an earlier await in that click.
    this.probe = nativeBridgeState().then((state) => { this.bridge = state; return state; });
  }
  capability(): OutputDirectoryCapability {
    if (typeof window === "undefined" || !window.isSecureContext) return "insecure";
    return (loopbackPage() && this.bridge !== "unsupported") || typeof (window as PickerWindow).showDirectoryPicker === "function" ? "available" : "unsupported";
  }
  private async transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    let db: IDBDatabase | undefined;
    try {
      db = await openDatabase();
      return await new Promise<T>((resolve, reject) => {
        const transaction = db!.transaction(storeName, mode);
        const request = operation(transaction.objectStore(storeName));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = transaction.onerror = () => reject(unavailable());
      });
    } catch { throw unavailable(); }
    finally { db?.close(); }
  }

  async pick(): Promise<PickedOutputDirectory | null> {
    const browser = window as PickerWindow;
    let state = this.bridge;
    if (state === null || state === "unavailable") {
      const pending = state === null ? this.probe : nativeBridgeState().then((value) => { this.bridge = value; return value; });
      state = await pending;
      if (state === "unsupported") throw new ServiceError("DIRECTORY_UNAVAILABLE", "本机系统不支持原生目录窗口。请再点击一次，通过浏览器选择文件夹。");
    }
    if (state === "unavailable") throw new ServiceError("DIRECTORY_UNAVAILABLE", "本机文件夹服务不可用，请重新启动本机工作台后再选择。原设置已保留。");
    if (state === "available") {
      const response = await fetch("/api/local/directories/choose", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await response.json();
      if (!response.ok) throw new ServiceError("DIRECTORY_UNAVAILABLE", body.error || "本机文件夹选择未完成。");
      if (body.cancelled === true) return null;
      const selected = pickedOutputDirectorySchema.safeParse(body);
      if (!selected.success) throw new ServiceError("DIRECTORY_UNAVAILABLE", "未收到有效的本机文件夹记录。");
      return selected.data;
    }
    if (this.capability() === "insecure") throw new ServiceError("DIRECTORY_UNAVAILABLE", "当前页面不是安全环境。请重新打开本机工作台；线上页面需要HTTPS。");
    if (typeof browser.showDirectoryPicker !== "function") throw new ServiceError("DIRECTORY_UNAVAILABLE", "当前浏览器不支持文件夹选择。请使用本机工作台，或用桌面Chrome／Edge打开；不同浏览器的项目不会自动共享。");
    let handle: FileSystemDirectoryHandle;
    try {
      // Keep this as the first awaited operation, directly under the user's click.
      const parent = await browser.showDirectoryPicker({ startIn: "desktop", mode: "readwrite" });
      // A UUID avoids reusing an existing folder on browsers without exclusive mkdir.
      const childName = `剧本工作台成果-${crypto.randomUUID()}`;
      handle = await parent.getDirectoryHandle(childName, { create: true });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      throw new ServiceError("DIRECTORY_UNAVAILABLE", "未能在所选位置新建成果文件夹，原设置已保留。请允许访问和写入文件夹后重试。");
    }
    const result = pickedOutputDirectorySchema.safeParse({ id: crypto.randomUUID(), name: handle.name });
    if (handle.kind !== "directory" || !result.success) throw new ServiceError("DIRECTORY_UNAVAILABLE", "无法读取所选文件夹名称，请重新选择；原设置已保留。");
    await this.transaction("readwrite", (store) => store.put({ id: result.data.id, handle }));
    return result.data;
  }

  async get(id: string): Promise<{ name: string; kind: "directory" } | null> {
    if (loopbackPage()) {
      try {
        const response = await fetch(`/api/local/directories/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (response.ok) {
          const selected = await response.json();
          if (selected.kind === "directory" && typeof selected.name === "string") return { kind: "directory", name: selected.name };
        } else if (response.status !== 404 && response.status !== 501) throw new ServiceError("DIRECTORY_UNAVAILABLE", "本机文件夹记录读取失败，请重新选择。");
      } catch (error) { if (error instanceof ServiceError) throw error; }
    }
    const record = await this.transaction<{ id: string; handle: FileSystemDirectoryHandle } | undefined>("readonly", (store) => store.get(id));
    return record?.handle ?? null;
  }
}
