import { z } from "zod";

// Prototype guardrails; real upload and processing budgets belong to the future service.
export const sourceImportPolicy = {
  batchFiles: 2000,
  projectFiles: 5000,
  pageSize: 30,
  largeDocumentBytes: 100 * 1024 * 1024,
  largeMediaBytes: 2 * 1024 * 1024 * 1024,
};

function relativePathValid(path: string) {
  return !/[\\\u0000-\u001f]/.test(path) && !path.startsWith("/") && !/^[a-z]:/i.test(path)
    && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export const sourceFileInputSchema = z.object({
  name: z.string().min(1).max(255).refine((name) => !/[\/\\\u0000-\u001f]/.test(name), "文件名不能包含路径或控制字符。"),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  mime: z.string().max(200),
  relativePath: z.string().min(1).max(1024).refine(relativePathValid, "仅支持所选目录内的相对路径。").optional(),
  lastModified: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
}).refine((file) => !file.relativePath || file.relativePath.split("/").at(-1) === file.name, "相对路径与文件名不一致。");
export type SourceFileInput = z.infer<typeof sourceFileInputSchema>;

export const sourceKinds = {
  image: { label: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "heic", "heif", "gif", "avif"], plan: "待文字识别（OCR）；图片需逐页校对" },
  pdf: { label: "PDF", extensions: ["pdf"], plan: "待提取文字；扫描页需文字识别（OCR）" },
  document: { label: "办公文档", extensions: ["doc", "docx", "rtf", "odt", "ppt", "pptx", "xls", "xlsx"], plan: "待提取正文、表格及内嵌图片" },
  text: { label: "文本", extensions: ["txt", "md", "markdown", "csv", "tsv", "json", "html", "htm"], plan: "待读取文字与编码检查" },
  audio: { label: "音频", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma"], plan: "待语音转写；需保留说话人和时间位置" },
  video: { label: "视频", extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v", "mpeg", "mpg", "ts"], plan: "待语音转写／画面文字识别；需保留时间位置" },
  subtitle: { label: "字幕", extensions: ["srt", "vtt", "ass", "ssa", "lrc"], plan: "待读取字幕并保留时间位置" },
  archive: { label: "压缩包", extensions: ["zip", "7z", "rar"], plan: "待解包；当前仅登记，请解压后选择文件夹" },
  unknown: { label: "不支持的格式", extensions: [], plan: "当前无法安排处理，请先转换格式" },
} satisfies Record<string, { label: string; extensions: string[]; plan: string }>;
export type SourceKind = keyof typeof sourceKinds;
export const sourceFileAccept = Object.values(sourceKinds).flatMap((kind) => kind.extensions.map((ext) => `.${ext}`)).join(",");

export function classifySource(name: string): SourceKind {
  const extension = name.split(".").at(-1)?.toLowerCase();
  return (Object.keys(sourceKinds) as SourceKind[]).find((key) => (sourceKinds[key].extensions as string[]).includes(extension ?? "")) ?? "unknown";
}
export function sourcePath(file: SourceFileInput) { return file.relativePath ?? file.name; }
export function sourceSizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1024, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${Number(value.toFixed(1))} ${units[index]}`;
}

export type SourceImportRow = { index: number; file: SourceFileInput; kind: SourceKind; eligible: boolean; reason: string; warning: string };
export type SourceImportPreview = { rows: SourceImportRow[]; eligibleCount: number; skippedCount: number; totalBytes: number; availableSlots: number };

// No bytes are read. The signature only detects likely duplicates, not identical content.
export function inspectSourceImport(files: SourceFileInput[], existing: SourceFileInput[]): SourceImportPreview {
  const seen = new Map<string, SourceFileInput[]>();
  function remember(file: SourceFileInput) {
    const key = JSON.stringify([sourcePath(file), file.size]);
    seen.set(key, [...(seen.get(key) ?? []), file]);
  }
  existing.forEach(remember);
  const rows = files.map((file, index): SourceImportRow => {
    const kind = classifySource(file.name);
    const parsed = sourceFileInputSchema.safeParse(file);
    const hidden = sourcePath(file).split("/").some((part) => part.startsWith(".") || part === "__MACOSX");
    const matches = seen.get(JSON.stringify([sourcePath(file), file.size])) ?? [];
    const duplicate = matches.some((other) => other.lastModified === undefined || file.lastModified === undefined || other.lastModified === file.lastModified);
    const reason = !parsed.success ? "文件信息或相对路径无效" : hidden ? "隐藏或系统文件，已略过" : file.size === 0 ? "空文件，已略过" : kind === "unknown" ? "不支持的格式，已略过" : duplicate ? "疑似重复：路径、大小及可用修改时间相同" : "可登记";
    const eligible = reason === "可登记";
    if (eligible) remember(file);
    const threshold = kind === "audio" || kind === "video" ? sourceImportPolicy.largeMediaBytes : sourceImportPolicy.largeDocumentBytes;
    const warning = eligible && file.size > threshold ? "大文件可登记；正式处理时需分段、分页或分片上传。" : "";
    return { index, file, kind, eligible, reason, warning };
  });
  const eligible = rows.filter((row) => row.eligible);
  return { rows, eligibleCount: eligible.length, skippedCount: rows.length - eligible.length, totalBytes: eligible.reduce((sum, row) => sum + row.file.size, 0), availableSlots: Math.max(0, sourceImportPolicy.projectFiles - existing.length) };
}
