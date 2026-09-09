"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, FolderOpen, FileText, Search } from "lucide-react";
import { AppFrame } from "./app-frame";
import { UploadProjectButton } from "./create-project";
import { Input } from "./ui/input";
import { useService } from "./providers";
import { LoadError, Loading } from "./shared";

import { formatDate } from "@/domain/presentation";
import type { Project } from "@/domain/models";

function downloadHistory(project: Project) {
  const blob = new Blob([JSON.stringify(project, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "旧版项目记录.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ProjectTable({ projects }: { projects: Project[] }) {
  return <div className="table-wrap"><table className="project-table"><thead><tr><th>项目名称</th><th>最近修改</th><th>打开</th></tr></thead><tbody>{projects.map(project => <tr key={project.id}><td><Link href={`/projects/${project.id}`} className="project-name"><FileText size={17} /><strong>{project.title}</strong></Link></td><td>{formatDate(project.updatedAt)}{(project.blueprint || project.production || project.research.documents.length > 0) && <button className="text-link block mt-2" onClick={() => downloadHistory(project)}>下载旧版记录</button>}</td><td><Link href={`/projects/${project.id}`} aria-label={`打开${project.title}`}><ArrowUpRight size={15} /></Link></td></tr>)}</tbody></table></div>;
}

export function ProjectListPage({ home = false }: { home?: boolean }) {
  const service = useService();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => service.list() });
  const [search, setSearch] = useState("");
  const mine = projects.data?.filter((project) => !project.readOnly) ?? [];
  const filtered = mine.filter((project) => project.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const shown = home ? filtered.slice(0, 4) : filtered;
  return <AppFrame title={home ? "工作台首页" : "我的项目"}>
    <div className="page-heading"><div><span className="eyebrow">{home ? "FROM STRUCTURE TO ORIGINAL STORIES" : "YOUR STORY ARCHIVE"}</span><h1 className="serif">{home ? "从完整剧本，走向新的故事。" : "我的项目"}</h1></div></div>
    {home ? <UploadProjectButton /> : <>
      <div className="section-heading"><h2>全部项目<span className="count">{mine.length}</span></h2></div>
      <div className="search-tools"><div className="search-box"><Search size={15} /><Input aria-label="搜索项目名称" placeholder="搜索项目名称…" value={search} onChange={event => setSearch(event.target.value)} /></div></div>
      {projects.isPending ? <Loading /> : projects.error ? <LoadError error={projects.error} retry={() => void projects.refetch()} /> : shown.length ? <ProjectTable projects={shown} /> : <section className="panel empty-state"><FolderOpen size={26} className="mx-auto" /><h2>{search ? "没有找到匹配的项目" : "当前浏览器和地址下暂无项目"}</h2>{!search && <p className="field-hint">之前上传过？请先用原浏览器和相同网址打开，再检查项目记录。</p>}<Link className="text-link" href="/">上传文件夹</Link></section>}
    </>}
    <div className="page-footnote"><span><span className="local-dot" />项目保存在此浏览器，清除网站数据后将丢失。</span><span>AI 审查不等同于真人试玩</span></div>
  </AppFrame>;
}
