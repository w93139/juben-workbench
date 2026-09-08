"use client";

import { useState } from "react";
import type { ResearchDocument } from "@/domain/research";
import { classifySource, sourceImportPolicy, sourceKinds, sourcePath, sourceSizeLabel } from "@/domain/source-import";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function SourceList({ documents }: { documents: ResearchDocument[] }) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(0);
  const filtered = documents.filter((doc) => sourcePath(doc).toLowerCase().includes(search.trim().toLowerCase()) && (kind === "all" || (doc.origin === "demo" ? "demo" : classifySource(doc.name)) === kind));
  const pages = Math.max(1, Math.ceil(filtered.length / sourceImportPolicy.pageSize));
  const currentPage = Math.min(page, pages - 1);
  if (!documents.length) return null;
  return <section className="mt-6" aria-label="已登记材料"><div className="panel-title"><h3>材料清单</h3><span>{documents.length}份已登记</span></div>
    <div className="research-toolbar"><Input aria-label="搜索已登记材料" value={search} placeholder="搜索名称或相对路径" onChange={(e) => { setSearch(e.target.value); setPage(0); }} /><select className="plain-select" aria-label="筛选材料类型" value={kind} onChange={(e) => { setKind(e.target.value); setPage(0); }}><option value="all">全部类型</option><option value="demo">练习包</option>{Object.entries(sourceKinds).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></div>
    <div className="record-list">{filtered.slice(currentPage * sourceImportPolicy.pageSize, (currentPage + 1) * sourceImportPolicy.pageSize).map((doc) => <article className="research-document" key={doc.id}><div><strong>{doc.name}</strong>{doc.relativePath && <p className="source-path">{doc.relativePath}</p>}<p>{doc.origin === "demo" ? doc.kind : sourceKinds[classifySource(doc.name)].label} · {doc.audience} · {doc.origin === "demo" ? "人工练习数据" : `${sourceSizeLabel(doc.size)} / 仅登记，未识别`}</p>{doc.origin !== "demo" && <p className="field-hint">处理计划：{sourceKinds[classifySource(doc.name)].plan}</p>}<p className="field-hint">版本：{doc.edition}</p></div><span className="tag">{doc.status === "processed" ? "模拟识别完成" : "已登记"}</span></article>)}</div>
    {filtered.length === 0 && <p className="field-hint">没有匹配的材料。</p>}
    <div className="source-pagination"><Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>材料上一页</Button><span>共{filtered.length}份，第{currentPage + 1}/{pages}页</span><Button size="sm" variant="outline" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>材料下一页</Button></div>
  </section>;
}
