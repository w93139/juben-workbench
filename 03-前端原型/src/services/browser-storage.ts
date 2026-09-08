import { ServiceError, type StoragePort } from "./contracts";

export const STORAGE_KEY = "juben-workbench:projects:v1";

export class BrowserStorage implements StoragePort {
  private queue: Promise<unknown> = Promise.resolve();

  read() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      throw new ServiceError("STORAGE_UNAVAILABLE", "无法读取本机保存的数据。请检查浏览器存储设置后重试。");
    }
  }

  write(value: string) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      throw new ServiceError("STORAGE_UNAVAILABLE", "保存失败，当前输入仍保留。浏览器存储可能已满或被禁用。");
    }
  }

  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return navigator.locks.request(STORAGE_KEY, operation);
    }
    const pending = this.queue.then(operation, operation);
    this.queue = pending.catch(() => undefined);
    return pending;
  }
}
