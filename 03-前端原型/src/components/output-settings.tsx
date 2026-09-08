"use client";

import { useEffect, useRef, useState } from "react";
import type { Project } from "@/domain/models";
import { outputPath, outputSettingsInputSchema, outputStages, type OutputStage } from "@/domain/output-settings";
import { useResearchAction, useResearchDraft } from "./research/common";
import { useService } from "./providers";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ErrorMessage } from "./shared";

export function OutputSettingsPanel({ project, stage }: { project: Project; stage: OutputStage }) {
  const service = useService();
  const action = useResearchAction(project);
  const { draft, change, saved } = useResearchDraft({ rootPath: project.outputSettings.rootPath, directory: project.outputSettings.directory ?? null, folder: project.outputSettings.folders[stage] });
  const mounted = useRef(true);
  const pickingRef = useRef(false);
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState<unknown>(null);
  const [pickerNote, setPickerNote] = useState("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const valid = outputSettingsInputSchema.safeParse({ ...draft, stage });
  const planned = valid.success ? outputPath({ rootPath: valid.data.rootPath, directory: valid.data.directory, folders: { ...project.outputSettings.folders, [stage]: valid.data.folder } }, stage) : null;
  const busy = project.readOnly || action.isPending || picking;
  async function pickDirectory() {
    if (busy || pickingRef.current) return;
    pickingRef.current = true; setPicking(true); setPickerError(null); setPickerNote("");
    try {
      const directory = await service.pickOutputDirectory();
      if (!mounted.current) return;
      if (directory) { action.touch(); change({ ...draft, rootPath: "", directory }); setPickerNote("文件夹已选择，点击保存输出路径后应用到项目。"); }
      else setPickerNote("未更改文件夹，原设置和输入已保留。");
    } catch (error) { if (mounted.current) setPickerError(error); }
    finally { pickingRef.current = false; if (mounted.current) setPicking(false); }
  }
  return <section className="panel" aria-label="输出储存位置">
    <div className="panel-title"><h2>输出储存位置</h2><span>{outputStages[stage].label}</span></div>
    <p className="field-hint">设置项目总目录和本阶段子目录。总目录供所有阶段共用；修改只影响后续任务，不移动已有结果。</p>
    <form onSubmit={(event) => { event.preventDefault(); if (!busy && valid.success) action.mutate((revision) => service.saveOutputSettings(project.id, revision, valid.data), { onSuccess: saved }); }}>
      <div className="research-toolbar"><Button type="button" variant="outline" disabled={busy} onClick={() => void pickDirectory()}>{picking ? "正在选择文件夹…" : draft.directory ? "重新选择文件夹" : "选择文件夹"}</Button>{draft.directory && <Button type="button" variant="outline" disabled={busy} onClick={() => { action.touch(); change({ ...draft, directory: null }); setPickerError(null); setPickerNote(""); }}>改为手动填写路径</Button>}</div>
      <p className="field-hint">选择窗口会请求从桌面打开，也可在窗口中前往其他位置。取消选择不会改变当前设置。</p>
      {pickerError != null && <ErrorMessage error={pickerError} />}
      {pickerNote && <p role="status" className="field-hint">{pickerNote}</p>}
      <label className="field-label" htmlFor="output-root">项目总输出目录</label>
      {draft.directory ? <><Input id="output-root" value={`所选文件夹：${draft.directory.name}`} readOnly disabled={busy} /><p className="field-hint">已记住所选文件夹。浏览器未提供完整本机路径；真正导出时会再检查是否允许保存。</p></> : <Input id="output-root" value={draft.rootPath} placeholder="也可手动填写，例如 /Users/你的用户名/Desktop/剧本输出" maxLength={512} disabled={busy} onChange={(event) => { action.touch(); change({ ...draft, rootPath: event.target.value }); }} />}
      <label className="field-label mt-4" htmlFor="output-folder">本阶段子目录</label>
      <Input id="output-folder" value={draft.folder} maxLength={120} disabled={busy} onChange={(event) => { action.touch(); change({ ...draft, folder: event.target.value }); }} />
      {!valid.success && <p role="alert" className="field-hint">{valid.error.issues[0]?.message}</p>}
      <p className="field-hint mt-4">计划输出位置（输入预览）：</p><p className="output-path" data-testid="output-path-preview">{valid.success ? planned ?? "未设置本机目录，当前内容保存在此浏览器的项目中。" : "请先修正上面的路径。"}</p>
      <Button className="mt-4" disabled={busy || !valid.success}>{action.isPending ? "正在保存路径…" : "保存输出路径"}</Button>
      {action.isSuccess && <p role="status" className="success-message">输出路径已保存；尚未向该目录写入文件。</p>}
      {action.feedback}
    </form>
    <p className="field-hint mt-4">当前只保存路径设置，不会创建目录或写出文件；真实输出将在后续接入。{project.readOnly && "原始样例只读，请先创建副本再设置。"}</p>
    {stage === "analysis" && project.research.job?.kind === "analysis" && <p className="field-hint">本次拆解使用启动时保存的路径；先保存路径，再开始下一次拆解。</p>}
  </section>;
}
