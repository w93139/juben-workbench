/** Browser directory enumeration; every readEntries batch must be consumed. */
export interface DropEntry {
  name: string; isFile: boolean; isDirectory: boolean;
  file?: (success: (file: File) => void, failure: (error: DOMException) => void) => void;
  createReader?: () => { readEntries: (success: (entries: DropEntry[]) => void, failure: (error: DOMException) => void) => void };
}
export function visibleFiles(files: File[]) { return files.filter(file => !(file.webkitRelativePath || file.name).split("/").some(part => part.startsWith(".") || part === "__MACOSX")); }
export async function walkDroppedEntries(entries: DropEntry[], maximum = 2000): Promise<File[]> {
  const files: File[] = []; let visited = 0;
  async function walk(entry: DropEntry, prefix: string, depth: number) {
    if (++visited > 10000 || depth > 40) throw new Error("文件夹层级或项目过多，请选择更具体的剧本文件夹。");
    if (entry.name.startsWith(".") || entry.name === "__MACOSX") return;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile && entry.file) {
      const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
      const copy = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
      Object.defineProperty(copy, "webkitRelativePath", { value: path }); files.push(copy);
      if (files.length > maximum) throw new Error(`一次最多读取${maximum}份文件，请分批选择；原材料未改变。`);
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      for (;;) { const batch = await new Promise<DropEntry[]>((resolve, reject) => reader.readEntries(resolve, reject)); if (!batch.length) break; for (const child of batch) await walk(child, path, depth + 1); }
    } else throw new Error("浏览器无法读取这个拖入项，请点击上传文件夹重新选择。");
  }
  for (const entry of entries) await walk(entry, "", 0);
  if (!files.length) throw new Error("文件夹中没有可读取的文件，原材料未改变。");
  return files;
}
export function droppedFiles(data: DataTransfer): Promise<File[]> {
  // Capture handles synchronously while the drop event can still read them.
  const items = Array.from(data.items).filter(item => item.kind === "file");
  const entries = items.map(item => item.webkitGetAsEntry?.() as DropEntry | null);
  if (entries.length && entries.every(entry => entry !== null && entry !== undefined)) return walkDroppedEntries(entries as DropEntry[]);
  if (entries.some(Boolean)) return Promise.reject(new Error("部分拖入项无法读取，请点击上传文件夹，避免漏掉材料。"));
  const files = visibleFiles(Array.from(data.files));
  if (!files.length || files.some(file => !file.size && !file.type)) return Promise.reject(new Error("当前浏览器无法拖入该文件夹，请点击上传文件夹选择。"));
  return Promise.resolve(files);
}
