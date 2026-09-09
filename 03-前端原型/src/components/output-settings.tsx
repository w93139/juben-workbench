"use client";
import { useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import type { Project } from "@/domain/models";
import type { OutputStage, PickedOutputDirectory } from "@/domain/output-settings";
import { useResearchAction } from "./research/common";
import { useService } from "./providers";
import { Button } from "./ui/button";
import { ErrorMessage } from "./shared";

export function OutputLocation({ project, stage }: { project: Project; stage: OutputStage }) {
  const mounted = useRef(true); useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const service = useService(); const action = useResearchAction(project);
  const [pending, setPending] = useState<PickedOutputDirectory | null>(null);
  const [picking, setPicking] = useState(false); const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState(""); const lock = useRef(false);
  const name = pending?.name || project.outputSettings.directory?.name || project.outputSettings.rootPath || "尚未选择";
  const busy = picking || action.isPending;
  function save(directory: PickedOutputDirectory) {
    action.mutate(revision => service.saveOutputSettings(project.id, revision, { directory, rootPath: "", stage, folder: project.outputSettings.folders[stage] }), { onSuccess: () => { setPending(null); setNote("已保存"); } });
  }
  async function choose() {
    if (busy || lock.current) return; lock.current = true; setPicking(true); setError(null); setNote(""); action.touch();
    try { const directory = await service.pickOutputDirectory();
      if (!mounted.current) return;
      if (!directory) { setNote("已取消选择"); action.discardDraft(); return; }
      setPending(directory); save(directory);
    } catch (failure) { setError(failure); action.discardDraft(); }
    finally { lock.current = false; setPicking(false); }
  }
  return <div className="output-compact" aria-label="输出储存位置">
    <div className="output-compact-row"><FolderOpen size={15} /><span>输出：</span><strong data-testid="output-directory-name" title={name}>{name}</strong>{pending && <small>待保存</small>}<Button size="sm" variant="ghost" title="直接使用所选文件夹保存成果" disabled={busy || project.readOnly} onClick={() => void choose()}>{picking ? "正在选择…" : action.isPending ? "正在保存…" : project.outputSettings.directory || project.outputSettings.rootPath ? "更换" : "选择文件夹"}</Button>{note && <small role="status">{note}</small>}{pending && !busy && <Button size="sm" variant="outline" onClick={() => save(pending)}>重试保存</Button>}</div>
    {error != null && <ErrorMessage error={error} />}{action.error && action.feedback}
  </div>;
}
export const OutputSettingsPanel = OutputLocation;
