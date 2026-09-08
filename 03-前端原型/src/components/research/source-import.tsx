"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "@/domain/models";
import { sourceFileAccept, sourceImportPolicy, sourceKinds, sourcePath, sourceSizeLabel, type SourceFileInput } from "@/domain/source-import";
import { ServiceError, type SourceImportProgress } from "@/services/contracts";
import { useService } from "../providers";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ErrorMessage } from "../shared";

type ImportStatus = "idle" | "running" | "succeeded" | "failed" | "cancelled";
const phaseLabels = { checking: "正在整理文件信息", transferring: "正在模拟上传", saving: "正在保存材料清单", complete: "导入处理完成" };

export function SourceImport({ project, children }: { project: Project; children?: ReactNode }) {
  const service = useService();
  const client = useQueryClient();
  const filePicker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [batch, setBatch] = useState<SourceFileInput[] | null>(null);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [progress, setProgress] = useState<SourceImportProgress>({ phase: "checking", percent: 0 });
  const [failure, setFailure] = useState<unknown>(null);
  const [pickerError, setPickerError] = useState("");
  const [added, setAdded] = useState(0);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  const running = status === "running";
  const busy = project.readOnly || running || project.research.job?.status === "running";
  const rows = progress.preview?.rows ?? [];
  const visible = rows.filter((row) => (filter === "all" || (filter === "eligible" ? row.eligible : !row.eligible)) && sourcePath(row.file).toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(visible.length / sourceImportPolicy.pageSize));
  const currentPage = Math.min(page, pages - 1);

  async function start(files: SourceFileInput[], retry = false) {
    if (controller.current || project.readOnly) return;
    const current = new AbortController(); controller.current = current;
    setBatch(files); setFailure(null); setPickerError(""); setStatus("running"); setAdded(0);
    setProgress({ phase: "checking", percent: 0 }); setFilter("all"); setSearch(""); setPage(0);
    try {
      // Retrying an append rechecks the latest inventory; no existing fields are overwritten.
      const revision = retry ? (await service.get(project.id)).revision : project.revision;
      const result = await service.importSourceFiles(project.id, revision, files, {
        signal: current.signal,
        onProgress: (next) => { if (controller.current === current) setProgress(next); },
      });
      if (controller.current !== current) return;
      if (result.added > 0) client.setQueryData(["project", project.id], result.project);
      else void client.invalidateQueries({ queryKey: ["project", project.id] });
      void client.invalidateQueries({ queryKey: ["projects"] });
      setAdded(result.added); setStatus("succeeded");
    } catch (error) {
      if (controller.current !== current) return;
      if (error instanceof ServiceError && error.code === "CANCELLED") setStatus("cancelled");
      else { setFailure(error); setStatus("failed"); }
    } finally { if (controller.current === current) controller.current = null; }
  }
  function receive(files: FileList | null) {
    if (busy || controller.current) return;
    if (!files?.length) { setPickerError("没有可导入的文件。空文件夹不会产生材料记录。"); return; }
    if (files.length > sourceImportPolicy.batchFiles) { setPickerError(`这次选择了${files.length}份，超过单批${sourceImportPolicy.batchFiles}份。请分子文件夹选择，本次未开始导入。`); return; }
    void start(Array.from(files, (file) => ({ name: file.name, size: file.size, mime: file.type, relativePath: file.webkitRelativePath || undefined, lastModified: file.lastModified })));
  }
  return <>
    <div className="research-toolbar">
      <Button disabled={busy} onClick={() => {
        if (folderPicker.current && "webkitdirectory" in folderPicker.current) folderPicker.current.click();
        else setPickerError("这个浏览器没有文件夹选择能力，请用“选择本机文件”批量多选，或换用支持文件夹选择的浏览器。");
      }}>导入文件夹</Button>
      <Button variant="outline" disabled={busy} onClick={() => filePicker.current?.click()}>选择本机文件</Button>
      <input className="sr-only" ref={filePicker} type="file" multiple accept={sourceFileAccept} aria-label="选择参考文件" disabled={busy} onChange={(e) => { receive(e.target.files); e.target.value = ""; }} />
      <input className="sr-only" ref={(node) => { folderPicker.current = node; node?.setAttribute("webkitdirectory", ""); }} type="file" multiple aria-label="选择参考文件夹" disabled={busy} onChange={(e) => { receive(e.target.files); e.target.value = ""; }} />
    </div>
    <p className="field-hint">选择文件夹后自动导入，包含子文件夹。当前仅模拟登记，文件留在本机。</p>
    {children && <details className="research-excerpt"><summary>历史研究练习资料</summary>{children}</details>}
    {pickerError && <p role="alert" className="error-banner">{pickerError}</p>}
    {batch && <section className="source-import-preview" aria-label="本次导入进度" aria-busy={running}>
      <div className="panel-title"><h3>{running ? phaseLabels[progress.phase] : status === "succeeded" ? "导入完成" : status === "cancelled" ? "导入已取消" : "导入未完成"}</h3><span>本地模拟</span></div>
      <progress max={100} value={progress.percent} aria-label="模拟上传进度" className="import-progress" />
      <p role="status">{running ? `${phaseLabels[progress.phase]} · ${progress.percent}%` : status === "succeeded" ? `已自动保存${added}份材料，略过${progress.preview?.skippedCount ?? 0}份；无需确认。尚未进行识别。` : status === "cancelled" ? "本批未保存，已有材料保持不变。" : "本批未保存，文件清单已保留，可重试。"}</p>
      <p className="field-hint">演示进度不代表真实网络传输。已保存的材料可以在下方清单查看。</p>
      {running && <Button size="sm" variant="outline" disabled={progress.phase === "saving"} onClick={() => controller.current?.abort()}>取消导入</Button>}
      {failure != null && <ErrorMessage error={failure} />}
      {(status === "failed" || status === "cancelled") && <Button disabled={busy} onClick={() => void start(batch, true)}>重试导入</Button>}
      {progress.preview && <>
        <p className="field-hint">共{rows.length}份，有效{progress.preview.eligibleCount}份，略过{progress.preview.skippedCount}份；文件合计{sourceSizeLabel(progress.preview.totalBytes)}（仅登记信息）。</p>
        <details className="research-excerpt"><summary>查看本批文件与略过原因</summary>
          <div className="research-toolbar"><Input aria-label="搜索本批文件" placeholder="搜索名称或相对路径" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /><select className="plain-select" aria-label="筛选本批文件" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0); }}><option value="all">全部文件</option><option value="eligible">有效材料</option><option value="skipped">已略过</option></select></div>
          <div className="record-list">{visible.slice(currentPage * sourceImportPolicy.pageSize, (currentPage + 1) * sourceImportPolicy.pageSize).map((row) => <article className="source-preview-row" key={row.index}><div className="source-preview-file"><span><strong>{sourcePath(row.file)}</strong><small>{sourceKinds[row.kind].label} · {sourceSizeLabel(row.file.size)}</small></span></div><p className="field-hint">{row.eligible ? `${status === "succeeded" ? "已登记" : "待保存"} · ${sourceKinds[row.kind].plan}` : row.reason}</p>{row.warning && <p className="field-hint text-amber-800">{row.warning}</p>}</article>)}</div>
          {visible.length === 0 && <p className="field-hint">没有匹配的文件。</p>}
          <div className="source-pagination"><Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>清单上一页</Button><span>第{currentPage + 1}/{pages}页</span><Button variant="outline" size="sm" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>清单下一页</Button></div>
        </details>
      </>}
    </section>}
    <details className="research-excerpt"><summary>支持格式与导入说明</summary><p>仅保存名称、大小、类型和相对路径，不上传或读取内容。单批{sourceImportPolicy.batchFiles}份、每项目{sourceImportPolicy.projectFiles}份，不限制单文件大小。离开或刷新会中断尚未保存的导入。</p><div className="source-format-guide">{Object.entries(sourceKinds).filter(([key]) => key !== "unknown").map(([key, kind]) => <p key={key}><strong>{kind.label}</strong>：{kind.extensions.slice(0, 5).join(" / ")} 等 · {kind.plan}</p>)}</div><p>以上是后续处理计划；原型没有执行转写、解码、抽帧或解压。没有识别结果的文件不会进入参考拆解。</p><p>疑似重复只比较相对路径、大小和可用修改时间，没有比对内容；不同目录的同名文件分别保留。</p></details>
  </>;
}
