import { createHash } from "node:crypto";
import { access, chmod, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { ensureRuntimeRoot, runLocalTool, runtimeRoot } from "./local-directories";
import { LocalApiError } from "./local-security";

export const materialLimits = { fileBytes: 25 * 1024 * 1024, requestBytes: 26 * 1024 * 1024, textCharacters: 300_000, pdfPages: 60, imagePixels: 40_000_000, processingMs: 120000 };
export interface MaterialReadResult { status: "read" | "unsupported" | "error"; text: string; method: string; warnings: string[]; pages?: number }
let compiling: Promise<string> | undefined;
let active = 0;
let uploads = 0;
async function compiledOCR(): Promise<string> {
  if (compiling) return compiling;
  compiling = (async () => {
    if (process.platform !== "darwin") throw new LocalApiError(501, "当前系统没有本机Vision OCR能力。");
    await ensureRuntimeRoot();
    const source = join(process.cwd(), "scripts", "ocr.swift");
    const hash = createHash("sha256").update(await readFile(source)).digest("hex").slice(0, 16);
    const output = join(runtimeRoot, `ocr-${hash}`);
    try { await access(output); return output; } catch { /* Compile only application-owned source. */ }
    const temp = `${output}.tmp`;
    try {
      await runLocalTool("/usr/bin/swiftc", ["-O", "-module-cache-path", join(runtimeRoot, "swift-cache"), source, "-o", temp], { timeout: 120000, maxBuffer: 1024 * 1024 });
      await chmod(temp, 0o700); await rename(temp, output); return output;
    } catch { await rm(temp, { force: true }); throw new LocalApiError(503, "本机OCR组件暂时无法准备，请检查系统开发工具是否可用。"); }
  })();
  try { return await compiling; } catch (error) { compiling = undefined; throw error; }
}
function textResult(text: string, method: string, warnings: string[] = []): MaterialReadResult {
  const cleaned = text.replace(/^\ufeff/, "");
  if (cleaned.includes("\u0000")) return { status: "error", text: "", method, warnings: ["文件包含无法作为正文使用的二进制字符，请检查格式。"] };
  if (cleaned.length > materialLimits.textCharacters) throw new LocalApiError(413, "识别文字超过300000字符上限，本次未截断或保存正文，请拆分材料后重试。");
  if (!cleaned.trim()) return { status: "error", text: "", method, warnings: [...warnings, "没有识别到可用正文，请核对材料质量或格式。"] };
  return { status: "read", text: cleaned, method, warnings };
}
function decodeText(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
/** Reads only supplied upload bytes. It never interprets the name as a path. */
export async function readMaterialBytes(name: string, bytes: Uint8Array, signal?: AbortSignal): Promise<MaterialReadResult> {
  if (!bytes.length) throw new LocalApiError(400, "文件为空，未读取正文。");
  if (bytes.length > materialLimits.fileBytes) throw new LocalApiError(413, "单个识别文件最多25MB，请拆分后上传。大文件清单登记不代表可直接识别。");
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const extension = extname(basename(name)).toLowerCase();
  if (![".txt", ".md", ".markdown", ".csv", ".json", ".srt", ".vtt", ".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx", ".rtf"].includes(extension)) return { status: "unsupported", text: "", method: "none", warnings: ["该格式尚无正文读取或音视频转写服务。已登记文件不等于已识别，不能参与正文分析。"] };
  if (active >= 2) throw new LocalApiError(429, "本机正在处理其他材料，请稍后重试。");
  active++;
  let temp: string | undefined;
  try {
    if ([".txt", ".md", ".markdown", ".csv", ".json", ".srt", ".vtt"].includes(extension)) {
      try { return textResult(decodeText(bytes), "text-decode"); }
      catch (error) { if (error instanceof LocalApiError) throw error; return { status: "error", text: "", method: "text-decode", warnings: ["文字编码无法识别，请转换为UTF-8或带BOM的UTF-16后重试。"] }; }
    }
    await ensureRuntimeRoot();
    temp = await mkdtemp(join(runtimeRoot, "material-")); await chmod(temp, 0o700);
    const input = join(temp, `upload${extension}`); await writeFile(input, bytes, { mode: 0o600, flag: "wx" });
    if ([".doc", ".docx", ".rtf"].includes(extension)) {
      if (process.platform !== "darwin") return { status: "unsupported", text: "", method: "none", warnings: ["当前系统没有文档文字转换工具，请先另存为TXT或PDF。"] };
      try { await access("/usr/bin/textutil"); } catch { return { status: "unsupported", text: "", method: "none", warnings: ["本机未安装文档文字转换工具。"] }; }
      const text = await runLocalTool("/usr/bin/textutil", ["-convert", "txt", "-encoding", "UTF-8", "-stdout", "-noload", "-nostore", "-strip", "--", input], { timeout: 60000, maxBuffer: 8 * 1024 * 1024, signal });
      return textResult(text, "textutil");
    }
    const tool = await compiledOCR();
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const raw = await runLocalTool(tool, [extension === ".pdf" ? "pdf" : "image", input], { timeout: materialLimits.processingMs, maxBuffer: 8 * 1024 * 1024, signal });
    const result = JSON.parse(raw) as { text: string; method: string; pages: number; warnings: string[] };
    return { ...textResult(result.text, result.method, result.warnings), pages: result.pages };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw new DOMException("Aborted", "AbortError");
    if (error instanceof LocalApiError) throw error;
    const code = String((error as { toolStderr?: string }).toolStderr ?? "");
    const warning = code.includes("RESOURCE_LIMIT") ? "文件超过60页、图片超过4000万像素或正文过长，请拆分材料。" : code.includes("ENCRYPTED_PDF") ? "PDF受密码保护，请先提供可读取的副本。" : "正文读取失败或处理超时，请检查文件格式、质量并分批重试。";
    return { status: "error", text: "", method: "none", warnings: [warning] };
  } finally { active--; if (temp) await rm(temp, { recursive: true, force: true }); }
}
/** Bound multipart bodies before parsing to avoid unbounded formData buffering. */
export async function readMaterialUpload(request: Request): Promise<MaterialReadResult> {
  if (uploads >= 2) throw new LocalApiError(429, "本机正在接收其他材料，请稍后重试。");
  uploads++;
  try { return await parseMaterialUpload(request); } finally { uploads--; }
}
async function parseMaterialUpload(request: Request): Promise<MaterialReadResult> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > materialLimits.requestBytes) throw new LocalApiError(413, "单次识别请求过大，请拆分文件。");
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new LocalApiError(400, "请通过文件上传提交待识别正文。");
  const reader = request.body?.getReader(); if (!reader) throw new LocalApiError(400, "没有收到文件。");
  let total = 0; const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.length; if (total > materialLimits.requestBytes) { await reader.cancel(); throw new LocalApiError(413, "单次识别请求过大。"); }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks);
  const form = await new Response(body, { headers: { "content-type": request.headers.get("content-type")! } }).formData();
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File) || [...form.keys()].some((key) => key !== "file")) throw new LocalApiError(400, "每次只能上传一个文件，不接受本机路径或网址。");
  return readMaterialBytes(files[0].name, new Uint8Array(await files[0].arrayBuffer()), request.signal);
}
