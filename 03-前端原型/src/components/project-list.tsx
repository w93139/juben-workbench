"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, FolderOpen, FileText, Search } from "lucide-react";
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
    <div className="page-heading"><div><span className="eyebrow">{home ? "FROM STRUCTURE TO ORIGINAL STORIES" : "YOUR STORY ARCHIVE"}</span><h1 className="serif">{home ? "从完整剧本，走向新的故事。" : "我的项目"}</h1><p>{home ? "上传要改写的剧本文件夹，拆解架构，再选择原创大纲与写作方向。" : "点击项目继续创作；上传另一个剧本文件夹，会建立新的项目。"}</p></div><UploadProjectButton fallback /></div>
    {home && <section className="panel"><div className="record-grid"><div className="record-card"><strong>01 · 上传完整材料</strong><p className="story-premise mt-3">角色本、主持手册、线索和结局一起整理，保留原文件夹层级。</p></div><div className="record-card"><strong>02 · 拆解故事架构</strong><p className="story-premise mt-3">看清因果、关系、信息分配、证据链和每轮体验。</p></div><div className="record-card"><strong>03 · 选择新作方向</strong><p className="story-premise mt-3">比较原创大纲、玩家体验和风险，选择后再进入故事设计。</p></div></div></section>}
    <div className="section-heading"><h2>{home ? "最近项目" : "全部项目"}<span className="count">{mine.length}</span></h2>{home && <Link href="/projects" className="text-link">查看全部 <ArrowRight size={13} /></Link>}</div>
    {!home && <div className="search-tools"><div className="search-box"><Search size={15} /><Input aria-label="搜索项目名称" placeholder="搜索项目名称…" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div>}
    {projects.isPending ? <Loading /> : projects.error ? <LoadError error={projects.error} retry={() => void projects.refetch()} /> : shown.length ? <ProjectTable projects={shown} /> : <section className="panel empty-state"><FolderOpen size={26} className="mx-auto" /><h2>{search ? "没有找到匹配的项目" : "先上传你想改写的剧本"}</h2><p>{search ? "试试另一个项目名称。" : "点击上方“上传完整剧本文件夹”。选好后自动建立项目，不需要先填写新建表单。"}</p></section>}
    <div className="page-footnote"><span><span className="local-dot" />项目保存在此浏览器，清除网站数据后将丢失。</span><span>AI 审查不等同于真人试玩</span></div>
  </AppFrame>;
}
