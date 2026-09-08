import { pickedOutputDirectorySchema, type PickedOutputDirectory } from "@/domain/output-settings";
import { ServiceError, type OutputDirectoryPort } from "./contracts";

export const OUTPUT_DIRECTORY_DB = "juben-workbench:output-directories:v1";
const storeName = "directories";
type PickerWindow = Window & { showDirectoryPicker?: (options: { startIn: "desktop"; mode: "read" }) => Promise<FileSystemDirectoryHandle> };

function unavailable() { return new ServiceError("STORAGE_UNAVAILABLE", "无法保存或读取文件夹引用，原输出设置已保留。请重试选择，或手动填写完整路径。"); }

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(OUTPUT_DIRECTORY_DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(storeName, { keyPath: "id" }); };
    request.onsuccess = () => { if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
    request.onerror = request.onblocked = () => { settled = true; reject(unavailable()); };
  });
}

// Only a browser directory reference is stored. No entries are enumerated,
// no file contents are read and no write permission is requested.
export class BrowserOutputDirectories implements OutputDirectoryPort {
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
    if (typeof browser.showDirectoryPicker !== "function") throw new ServiceError("DIRECTORY_UNAVAILABLE", "当前浏览器不支持文件夹选择。请手动填写完整路径，或使用支持目录选择的浏览器。");
    let handle: FileSystemDirectoryHandle;
    try {
      // Keep this as the first awaited operation, directly under the user's click.
      handle = await browser.showDirectoryPicker({ startIn: "desktop", mode: "read" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      throw new ServiceError("DIRECTORY_UNAVAILABLE", "未能打开或访问所选文件夹，原设置已保留。请重试，或手动填写完整路径。");
    }
    const result = pickedOutputDirectorySchema.safeParse({ id: crypto.randomUUID(), name: handle.name });
    if (handle.kind !== "directory" || !result.success) throw new ServiceError("DIRECTORY_UNAVAILABLE", "无法读取所选文件夹名称，请重新选择；原设置已保留。");
    await this.transaction("readwrite", (store) => store.put({ id: result.data.id, handle }));
    return result.data;
  }

  async get(id: string): Promise<FileSystemDirectoryHandle | null> {
    const record = await this.transaction<{ id: string; handle: FileSystemDirectoryHandle } | undefined>("readonly", (store) => store.get(id));
    return record?.handle ?? null;
  }
}
