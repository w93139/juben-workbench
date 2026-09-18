export interface ZipFile { path: string; content: string }

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Standard ZIP (stored entries, UTF-8 names), with central directory and CRCs. */
export function createZip(files: ZipFile[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const entries = files.map((file) => ({ name: encoder.encode(file.path), body: encoder.encode(file.content) }));
  if (entries.length > 65535 || entries.some((entry) => entry.name.length > 65535)) throw new Error("导出文件过多或名称过长，请分资源类别下载。");
  const localSize = entries.reduce((size, item) => size + 30 + item.name.length + item.body.length, 0);
  const centralSize = entries.reduce((size, item) => size + 46 + item.name.length, 0);
  if (localSize + centralSize + 22 >= 0xffffffff) throw new Error("材料包过大，请分资源类别下载。");
  const bytes = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(bytes.buffer);
  let offset = 0, central = localSize;
  for (const item of entries) {
    const crc = crc32(item.body);
    view.setUint32(offset, 0x04034b50, true); view.setUint16(offset + 4, 20, true); view.setUint16(offset + 6, 0x0800, true);
    view.setUint16(offset + 12, 0x21, true); view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, item.body.length, true); view.setUint32(offset + 22, item.body.length, true); view.setUint16(offset + 26, item.name.length, true);
    bytes.set(item.name, offset + 30); bytes.set(item.body, offset + 30 + item.name.length);
    view.setUint32(central, 0x02014b50, true); view.setUint16(central + 4, 20, true); view.setUint16(central + 6, 20, true); view.setUint16(central + 8, 0x0800, true);
    view.setUint16(central + 14, 0x21, true); view.setUint32(central + 16, crc, true); view.setUint32(central + 20, item.body.length, true); view.setUint32(central + 24, item.body.length, true);
    view.setUint16(central + 28, item.name.length, true); view.setUint32(central + 42, offset, true); bytes.set(item.name, central + 46);
    offset += 30 + item.name.length + item.body.length; central += 46 + item.name.length;
  }
  view.setUint32(central, 0x06054b50, true); view.setUint16(central + 8, entries.length, true); view.setUint16(central + 10, entries.length, true); view.setUint32(central + 12, centralSize, true); view.setUint32(central + 16, localSize, true);
  return bytes;
}
