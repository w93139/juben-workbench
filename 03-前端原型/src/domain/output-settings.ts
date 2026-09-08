import { z } from "zod";

export const outputStages = {
  analysis: { label: "参考本拆解", folder: "01-参考本拆解" },
  mechanisms: { label: "机制提炼", folder: "02-机制提炼" },
  direction: { label: "原创方向", folder: "03-原创方向" },
  blueprint: { label: "原创蓝图", folder: "04-原创蓝图" },
  generation: { label: "正文生成", folder: "05-正文生成" },
  review: { label: "审查记录", folder: "06-审查记录" },
  playtest: { label: "真人试玩", folder: "07-真人试玩" },
  export: { label: "成品导出", folder: "08-成品导出" },
} as const;
export const outputStageSchema = z.enum(["analysis", "mechanisms", "direction", "blueprint", "generation", "review", "playtest", "export"]);
export type OutputStage = z.infer<typeof outputStageSchema>;
const forbidden = /[\x00-\x1f\x7f*?"<>|]/;
function segmentsValid(path: string) { return path.split(/[\\/]/).every((part) => part !== "." && part !== ".."); }
export const outputRootSchema = z.string().trim().max(512, "总目录请控制在512个字符以内。").refine((path) => {
  if (!path) return true;
  const absolute = path.startsWith("/") || /^[a-z]:[\\/]/i.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path);
  return absolute && !forbidden.test(path) && segmentsValid(path) && !path.replace(/^[a-z]:/i, "").includes(":");
}, "请填写完整目录，例如 /Users/你的用户名/Desktop/剧本输出 或 D:\\剧本输出；不要使用 .. 或特殊控制字符。");
export const outputFolderSchema = z.string().trim().min(1, "请填写阶段子目录。").max(120).refine((path) => !forbidden.test(path) && !path.includes(":") && path.split(/[\\/]/).every((part) => part.trim() !== "" && part !== "." && part !== ".."), "请填写总目录下的子目录，可用 / 分层，不要使用绝对路径或 ..。");
export const pickedOutputDirectorySchema = z.object({ id: z.string().uuid(), name: z.string().min(1).max(255).refine((name) => !/[\/\x00-\x1f\x7f]/.test(name), "文件夹名称无效。") });
export type PickedOutputDirectory = z.infer<typeof pickedOutputDirectorySchema>;
const directorySchema = pickedOutputDirectorySchema.nullable().optional();
export const outputSettingsSchema = z.object({ rootPath: outputRootSchema, directory: directorySchema, folders: z.record(outputStageSchema, outputFolderSchema) }).refine((value) => !value.directory || !value.rootPath, "已选择文件夹时不能同时设置手动绝对路径。");
export type OutputSettings = z.infer<typeof outputSettingsSchema>;
export const outputSettingsInputSchema = z.object({ rootPath: outputRootSchema, directory: directorySchema, stage: outputStageSchema, folder: outputFolderSchema }).refine((value) => !value.directory || !value.rootPath, "请选择文件夹或手动路径中的一种方式。");
export type OutputSettingsInput = z.infer<typeof outputSettingsInputSchema>;
export function defaultOutputSettings(): OutputSettings {
  return { rootPath: "", folders: Object.fromEntries(Object.entries(outputStages).map(([id, value]) => [id, value.folder])) as OutputSettings["folders"] };
}
export function outputPath(settings: OutputSettings, stage: OutputStage): string | null {
  if (settings.directory) return `所选文件夹「${settings.directory.name}」/${settings.folders[stage].replace(/[\\/]/g, "/")}`;
  if (!settings.rootPath) return null;
  const windows = /^[a-z]:[\\/]/i.test(settings.rootPath) || settings.rootPath.startsWith("\\\\");
  const separator = windows ? "\\" : "/";
  const root = windows ? settings.rootPath.replace(/[\\/]/g, separator).replace(/\\+$/, "") : settings.rootPath.replace(/\/+$/, "");
  return root + separator + settings.folders[stage].replace(/[\\/]/g, separator);
}
