"use client";

import { useState } from "react";
import Link from "next/link";
import type { DemoContent, Project } from "@/domain/models";
import { artifactExportPath, exportCharacterDirectories, exportArtifacts, exportLabel, exportScopes, type ExportScope } from "@/domain/export";
import { prepareExport, downloadExport } from "@/services/export-service";
import { Button } from "../ui/button";
import { ErrorMessage } from "../shared";

export function ExportWorkbench({ project, content }: { project: Project; content: DemoContent | null }) {
  const versions = project.blueprint?.versions ?? [];
  const [choice, setChoice] = useState("");
  const versionId = versions.some((version) => version.id === choice) ? choice : versions.at(-1)?.id ?? "";
  const [busy, setBusy] = useState<ExportScope | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState("");
  const artifacts = exportArtifacts(project, versionId, "all");
  const directories = exportCharacterDirectories(project);
  async function exportScope(scope: ExportScope) {
    if (busy) return;
    setBusy(scope); setError(null); setMessage("");
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const bundle = prepareExport(project, versionId, scope);
      downloadExport(bundle);
      setMessage(`已发起下载：${bundle.filename}，包含 ${bundle.materialCount} 份正文。下载完成情况请查看浏览器。`);
    } catch (failure) { setError(failure); }
    finally { setBusy(null); }
  }
  return <>
    <section className="panel" aria-label="分类与全部导出">
      <div className="panel-title"><h2>导出创作材料</h2><span>Markdown · ZIP 下载</span></div>
      <p className="story-premise">按资源类别下载，或下载所选蓝图版本的全部已有正文。只收录每份材料最新版本，缺少的材料不会自动补齐。</p>
      <label className="field-label mt-4" htmlFor="export-blueprint-version">导出哪个蓝图版本</label>
      <select id="export-blueprint-version" className="plain-select w-full" disabled={busy !== null || !versions.length} value={versionId} onChange={(event) => { setChoice(event.target.value); setMessage(""); setError(null); }}>
        {!versions.length && <option value="">还没有已保存的蓝图版本</option>}
        {versions.map((version) => <option key={version.id} value={version.id}>{version.label}</option>)}
      </select>
      <p className="field-hint mt-3">下载位置由浏览器设置决定。项目上方的输出文件夹仅记录计划位置，当前没有向该文件夹直接写入文件。</p>
      <p className="stage-callout mt-3"><strong>全部资源含剧透。</strong>玩家材料按角色分开，主持手册及终局材料放在“主持材料-含谜底”。请分别发放对应材料，不要把总包交给玩家。</p>
      <div className="record-grid mt-5">{exportScopes.map((scope) => {
        const count = exportArtifacts(project, versionId, scope).length;
        return <article className="record-card" key={scope}><div className="panel-title"><h3>{exportLabel(scope)}</h3><span>{count ? `${count} 份正文` : "尚无正文"}</span></div><p className="field-hint">{scope === "host" || scope === "ending" ? "主持专用 · 含谜底" : scope === "clues" ? "按受众分区，公开材料与主持材料分开" : "按角色分文件夹，请分别发放"}</p><Button className="mt-3" variant="outline" disabled={!count || busy !== null} onClick={() => void exportScope(scope)}>{busy === scope ? "正在打包…" : `下载${exportLabel(scope)}`}</Button></article>;
      })}</div>
      <Button className="mt-5" disabled={!artifacts.length || busy !== null} onClick={() => void exportScope("all")}>{busy === "all" ? "正在打包全部资源…" : "下载全部资源"}</Button>
      {!artifacts.length && <p className="field-hint mt-3">此蓝图版本还没有可下载的正文。<Link className="inline-link" href={`/projects/${project.id}/stages/generation`}>去生成与检查准备材料</Link>。{content && "原始样例说明与历史检查不会冒充本次正文。"}</p>}
      <p className="field-hint mt-3">ZIP 内含 Markdown 正文、使用说明和版本清单。Word、PDF 转换尚未接入。</p>
      {message && <p className="field-hint mt-3" role="status">{message}</p>}{error != null && <ErrorMessage error={error} />}
    </section>
    <section className="panel" aria-label="导出文件预览"><div className="panel-title"><h2>文件分区预览</h2><span>{artifacts.length} 份正文</span></div>
      {(["player", "host"] as const).map((audience) => <div key={audience} className="mt-4"><h3>{audience === "player" ? "玩家材料 · 按角色分别发放" : "主持材料 · 含谜底"}</h3><ul className="mt-2 space-y-2">{artifacts.map((artifact, index) => ({ artifact, path: artifactExportPath(artifact, index, directories) })).filter(({ path }) => path.startsWith(audience === "player" ? "玩家材料/" : "主持材料-含谜底/")).map(({ artifact, path }) => <li className="field-hint break-all" key={artifact.id}>{path}</li>)}</ul></div>)}
      {!artifacts.length && <p className="field-hint mt-3">没有正文时不生成空包，不显示导出成功。</p>}
    </section>
    <section className="panel" aria-label="审查与试玩状态"><div className="panel-title"><h2>开本前还要检查什么</h2><span className="tag amber">尚未真人试玩</span></div><p className="story-premise">下载仅表示整理出已有文本，不代表剧本完整或可玩性通过验证。</p><ul className="space-y-2 mt-3"><li>蓝图字段与引用检查会写入清单；完整成品静态一致性脚本本次未执行。</li><li>已有双审属于本地模拟，真实 AI 审查尚未接入。</li><li>没有本次模拟试玩结论，也没有真人试玩记录。</li></ul><p className="field-hint mt-4">真人试玩录入后续开放。请另行记录实际时长、玩家卡点、角色参与、主持问题与修改建议。</p></section>
  </>;
}
