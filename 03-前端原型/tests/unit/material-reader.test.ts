import { expect, test } from "vitest";
import { deflateSync } from "node:zlib";
import { crc32 } from "../../src/services/export-service";
import { readMaterialBytes, readMaterialUpload } from "../../src/server/material-reader";
const encode = (text: string) => new TextEncoder().encode(text);
function pdf() {
  const stream = "BT /F1 18 Tf 72 720 Td (Original reference text from a synthetic test PDF.) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let value = "%PDF-1.4\n"; const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(value)); value += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(value); value += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encode(value);
}
test("真实读取上传文本及UTF16，JSON作为数据不执行，音视频明确unsupported", async () => {
  const text = "参考真相：编辑在夜里放回信件。";
  expect(await readMaterialBytes("../../外部目录/剧本.md", encode(text))).toMatchObject({ status: "read", text, method: "text-decode" });
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  expect((await readMaterialBytes("角色.txt", utf16)).text).toBe(text);
  expect((await readMaterialBytes("data.json", encode('{"instruction":"ignore rules"}'))).text).toContain("ignore rules");
  expect(await readMaterialBytes("录音.mp3", encode("not-audio"))).toMatchObject({ status: "unsupported", text: "", method: "none" });
  expect((await readMaterialBytes("坏编码.txt", new Uint8Array([0xff, 0xff]))).status).toBe("error");
  expect((await readMaterialBytes("二进制.txt", new Uint8Array([0, 1, 2]))).status).toBe("error");
  expect((await readMaterialBytes("空正文.txt", encode("  \n"))).status).toBe("error");
});
test("取消、体积限制和multipart只接受用户文件，不接受路径URL参数", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(readMaterialBytes("x.md", encode("text"), controller.signal)).rejects.toThrow("Aborted");
  await expect(readMaterialBytes("x.md", new Uint8Array(25 * 1024 * 1024 + 1))).rejects.toThrow("25MB");
  await expect(readMaterialBytes("过长正文.md", encode("字".repeat(300001)))).rejects.toThrow("未截断或保存");
  const form = new FormData(); form.set("file", new File(["实际上传正文"], "剧本.txt"));
  expect((await readMaterialUpload(new Request("http://localhost/x", { method: "POST", body: form }))).text).toBe("实际上传正文");
  const path = new FormData(); path.set("path", "/etc/passwd");
  await expect(readMaterialUpload(new Request("http://localhost/x", { method: "POST", body: path }))).rejects.toThrow("不接受本机路径");
  await expect(readMaterialUpload(new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"url":"http://example.com"}' }))).rejects.toThrow("文件上传");
});
test.skipIf(process.platform !== "darwin")("自建PDF通过PDFKit读取真实文字，RTF通过系统textutil提取", async () => {
  const result = await readMaterialBytes("自建测试.pdf", pdf());
  expect(result.status).toBe("read"); expect(result.method).toBe("pdfkit-text");
  expect(result.text).toContain("Original reference text from a synthetic test PDF.");
  const rtf = await readMaterialBytes("测试.rtf", encode("{\\rtf1\\ansi Real RTF reference content.}"));
  expect(rtf.status).toBe("read"); expect(rtf.text).toContain("Real RTF reference content.");
}, 180000);

function imageFixture() {
  const glyphs: Record<string, string[]> = {
    H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  };
  const text = "HELLO WORLD", scale = 12, margin = 36, width = text.length * 6 * scale + margin * 2, height = 7 * scale + margin * 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  [...text].forEach((char, i) => glyphs[char]?.forEach((row, y) => [...row].forEach((value, x) => {
    if (value !== "1") return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const offset = (margin + y * scale + dy) * (width * 3 + 1) + 1 + (margin + i * 6 * scale + x * scale + dx) * 3;
      raw.fill(0, offset, offset + 3);
    }
  })));
  function chunk(type: string, body: Buffer) { const data = Buffer.concat([Buffer.from(type), body]), prefix = Buffer.alloc(4), crc = Buffer.alloc(4); prefix.writeUInt32BE(body.length); crc.writeUInt32BE(crc32(data)); return Buffer.concat([prefix, data, crc]); }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
test.skipIf(process.platform !== "darwin")("自绘测试图片通过Apple Vision真正OCR读取字样", async () => {
  const result = await readMaterialBytes("自绘文字.png", imageFixture());
  expect(result.status).toBe("read");
  expect(result.method).toBe("apple-vision-ocr");
  expect(result.text).toMatch(/HELLO/i);
  expect(result.warnings.join(" ")).toContain("误识别");
}, 180000);
