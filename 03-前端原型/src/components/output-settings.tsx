"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import type { Project } from "@/domain/models";
import { outputPath, outputSettingsInputSchema, type OutputStage } from "@/domain/output-settings";
import { useResearchAction, useResearchDraft } from "./research/common";
import { useService } from "./providers";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ErrorMessage } from "./shared";

export function OutputLocation({ project, stage }: { project: Project; stage: OutputStage }) {
  return <OutputSettingsPanel project={project} stage={stage} />;
}

export function OutputSettingsPanel({ project, stage }: { project: Project; stage: OutputStage }) {
  const service = useService();
  const capability = useQuery({ queryKey: ["output-directory-capability"], queryFn: () => service.getOutputDirectoryCapability() });
  const action = useResearchAction(project);
  const { draft, change, saved } = useResearchDraft({ rootPath: project.outputSettings.rootPath, directory: project.outputSettings.directory ?? null, folder: project.outputSettings.folders[stage] });
  const mounted = useRef(true);
  const pickingRef = useRef(false);
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState<unknown>(null);
  const [pickerNote, setPickerNote] = useState("");
  const [pendingDirectory, setPendingDirectory] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const valid = outputSettingsInputSchema.safeParse({ ...draft, stage });
  const busy = project.readOnly || action.isPending || picking;
  const location = project.outputSettings.directory?.name || project.outputSettings.rootPath || "尚未选择";
  function complete() { saved(); setPendingDirectory(false); setPickerNote(""); }
  async function pickDirectory() {
    if (busy || pickingRef.current) return;
    const hadDraft = pendingDirectory || draft.rootPath !== project.outputSettings.rootPath || draft.directory?.id !== project.outputSettings.directory?.id;
    pickingRef.current = true; setPicking(true); setPickerError(null); setPickerNote("");
    // Capture the version before the native window opens, including cross-tab waits.
    action.touch();
    try {
      const directory = await service.pickOutputDirectory();
      if (!mounted.current) return;
      if (!directory) {
        setPickerNote("已取消，原设置保持不变。");
        if (!hadDraft) action.discardDraft();
        return;
      }
      const next = { ...draft, rootPath: "", directory };
      change(next); setPendingDirectory(true);
      action.mutate((revision) => service.saveOutputSettings(project.id, revision, { ...next, stage }), { onSuccess: complete });
    } catch (error) {
      if (mounted.current) { setPickerError(error); if (!hadDraft) action.discardDraft(); }
    } finally { pickingRef.current = false; if (mounted.current) setPicking(false); }
  }
  return <section className="output-location" aria-label="输出储存位置">
    <div className="folder-location-row"><div className="folder-location-copy"><FolderOpen size={18} /><div><strong>输出文件夹</strong><p data-testid="output-directory-name">{location}</p></div></div>
      {project.readOnly ? <Link className="button-link secondary" href="/projects/new?template=demo">选择输出文件夹</Link> : <Button variant="outline" disabled={busy} onClick={() => void pickDirectory()}>{picking ? "正在选择文件夹…" : action.isPending ? "正在保存…" : project.outputSettings.directory || project.outputSettings.rootPath ? "更换输出文件夹" : "选择输出文件夹"}</Button>}
    </div>
    <p className="field-hint">{project.readOnly ? "原始样例只读，点击后先创建副本。" : "选好后自动记住，所有步骤共用。"}当前仅记录位置，尚未写出文件。</p>
    {!project.readOnly && capability.data === "unsupported" && <p className="field-hint" role="status">此浏览器不支持输出文件夹选择。可用桌面 Chrome／Edge，或展开下方备用方式。</p>}
    {!project.readOnly && capability.data === "insecure" && <p className="field-hint" role="status">请用本机地址或 HTTPS 打开，再选择文件夹。</p>}
    {pickerError != null && <ErrorMessage error={pickerError} />}
    {pickerNote && <p role="status" className="field-hint">{pickerNote}</p>}
    {pendingDirectory && !action.isPending && <div className="folder-retry"><p className="field-hint">待保存：{draft.directory?.name}。原输出位置未改变。</p><Button variant="outline" size="sm" disabled={busy || !valid.success} onClick={() => { if (valid.success) action.mutate((revision) => service.saveOutputSettings(project.id, revision, valid.data), { onSuccess: complete }); }}>重试保存文件夹</Button></div>}
    {action.feedback}
    {!project.readOnly && <details className="folder-fallback" open={manualOpen} onToggle={(event) => setManualOpen(event.currentTarget.open)}><summary>无法选择？备用方式</summary>
      <p className="field-hint">浏览器无法选择目录时，可粘贴完整路径。Mac 访达选中文件夹后，按 Option + Command + C 复制。不同浏览器的项目不会自动共享。</p>
      <form onSubmit={(event) => { event.preventDefault(); if (!busy && valid.success) action.mutate((revision) => service.saveOutputSettings(project.id, revision, valid.data), { onSuccess: complete }); }}>
        <label className="field-label" htmlFor="output-root">项目总输出目录</label>
        <div className="manual-folder-row"><Input id="output-root" value={draft.rootPath} placeholder="粘贴完整文件夹路径" maxLength={512} disabled={busy} onChange={(event) => { action.touch(); setPendingDirectory(false); change({ ...draft, rootPath: event.target.value, directory: null }); }} /><Button variant="outline" disabled={busy || !valid.success || !!draft.directory}>保存路径</Button></div>
        {!valid.success && <p role="alert" className="field-hint">{valid.error.issues[0]?.message}</p>}
      </form>
      <p className="field-hint">已有阶段子目录会保留，无需逐项设置。</p><p className="output-path" data-testid="output-path-preview">{valid.success ? outputPath({ rootPath: valid.data.rootPath, directory: valid.data.directory, folders: { ...project.outputSettings.folders, [stage]: valid.data.folder } }, stage) ?? "未设置本机目录" : "请填写有效路径"}</p>
    </details>}
  </section>;
}
