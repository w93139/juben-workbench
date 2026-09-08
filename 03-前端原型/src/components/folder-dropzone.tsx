"use client";
import { useEffect, useRef, useState } from "react";
import { FolderUp } from "lucide-react";
import { droppedFiles } from "@/services/folder-drop";
import { Button } from "./ui/button";
import { ErrorMessage } from "./shared";

export function FolderDropzone({ selectedName, disabled = false, onPick, onFiles, large = false }: { selectedName?: string; disabled?: boolean; onPick: () => void; onFiles: (files: File[]) => Promise<void>; large?: boolean }) {
  const [dragging, setDragging] = useState(false); const [collecting, setCollecting] = useState(false); const [error, setError] = useState<unknown>(null);
  const depth = useRef(0); const lock = useRef(false); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = disabled || collecting;
  return <section className={`folder-dropzone ${large ? "large" : ""} ${dragging ? "dragging" : ""}`} aria-label="剧本文件夹拖拽区" aria-busy={busy}
    onDragEnter={event => { event.preventDefault(); if (!busy) { depth.current++; setDragging(true); } }}
    onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; }}
    onDragLeave={event => { event.preventDefault(); if (--depth.current <= 0) { depth.current = 0; setDragging(false); } }}
    onDrop={event => {
      event.preventDefault(); depth.current = 0; setDragging(false); if (busy || lock.current) return;
      lock.current = true; setCollecting(true); setError(null);
      void droppedFiles(event.dataTransfer).then(files => { if (mounted.current) return onFiles(files); }).catch(failure => { if (mounted.current) setError(failure); }).finally(() => { lock.current = false; if (mounted.current) setCollecting(false); });
    }}>
    <FolderUp size={40} /><h2>{dragging ? "松开，读取这个文件夹" : selectedName ? selectedName : "把完整剧本文件夹拖到这里"}</h2>
    <p>{selectedName ? "更换后使用新文件夹，原文件不会改动。" : "包含角色本、主持手册、线索及其他资料"}</p>
    <Button disabled={busy} onClick={onPick}>{collecting ? "正在整理…" : selectedName ? "更改文件夹" : "上传文件夹"}</Button>
    {error != null && <ErrorMessage error={error} />}
  </section>;
}
