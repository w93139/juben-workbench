"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, BookOpen, FileText, Plus, Search } from "lucide-react";
import { AppFrame, ProjectLink } from "./app-frame";
import { Input } from "./ui/input";
import { useContent, useService } from "./providers";
import { LoadError, Loading } from "./shared";
import { workflowStep } from "@/domain/workflow-view";
import { currentStage, formatDate } from "@/domain/presentation";
import type { DemoContent, Project } from "@/domain/models";

function ProjectTable({ projects, demo }: { projects: Project[]; demo: DemoContent | null }) {
  return <div className="table-wrap"><table className="project-table"><thead><tr><th>项目名称</th><th>当前阶段</th><th className="table-secondary">材料准备</th><th className="table-secondary">检查记录</th><th className="table-secondary">最近修改</th><th><span className="sr-only">打开</span></th></tr></thead><tbody>
    {projects.map((project) => <tr key={project.id}><td><Link href={`/projects/${project.id}`} className="project-name"><span className="project-icon"><FileText size={17} /></span><span><strong>{project.title}</strong><small>{project.readOnly ? "原创演示 · 只读" : project.template === "names-beyond" ? "演示副本 · 本机保存" : "原创项目 · 本机保存"}</small></span></Link></td>
      <td><span className={`tag ${project.template === "blank" ? "neutral" : "amber"}`}>{workflowStep(currentStage(project)).name}</span></td>
      <td className="table-secondary">{project.template === "blank" ? "尚未准备" : demo ? `${demo.deliverables.filter((d) => d.complete).length} / ${demo.deliverables.length} 类齐备` : "读取中"}</td>
      <td className="table-secondary"><span className="table-status">{project.production?.reviews.length ? "有模拟检查记录" : project.template === "blank" ? "尚未检查" : "有历史检查记录"}</span></td>
      <td className="table-secondary"><span className="table-date">{formatDate(project.updatedAt)}</span></td>
      <td><Link href={`/projects/${project.id}`} aria-label={`打开${project.title}`} className="text-link"><ArrowUpRight size={15} /></Link></td>
    </tr>)}
  </tbody></table></div>;
}

export function ProjectListPage({ home = false }: { home?: boolean }) {
  const service = useService();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => service.list() });
  const content = useContent("demo-names");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const filtered = projects.data?.filter((p) => p.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (filter === "all" || (filter === "mine" ? !p.readOnly : p.readOnly))) ?? [];
  const shown = home ? filtered.slice(0, 4) : filtered;
  return <AppFrame title={home ? "工作台首页" : "我的项目"}>
    <div className="page-heading"><div><span className="eyebrow">{home ? "A SPACE FOR ORIGINAL STORIES" : "YOUR STORY ARCHIVE"}</span><h1 className="serif">{home ? "让好故事，经得起推敲。" : "我的项目"}</h1><p>{home ? "从参考机制到原创剧本，把灵感、人物与每一条线索放在一起。" : "整理创作进度，继续上一次的决定。"}</p></div><Link href="/projects/new" className="button-link"><Plus size={15} />新建剧本项目</Link></div>
    {home && <div className="home-lead"><section className="feature-project"><div className="feature-meta"><span>原创样例 / 001</span><span className="tag">完整开本材料</span></div><h2 className="serif">{content.data?.title ?? "原创演示项目"}</h2><p>先翻开一份完整的原创档案，看看人物的秘密、彼此的关系与玩家的选择，如何共同推动一个故事。</p><div className="feature-bottom"><div className="feature-facts"><span>{content.data?.players ?? "—"} 人剧本</span><span>计划 {content.data?.plannedMinutes ?? "—"} 分钟</span><span>尚未真人试玩</span></div><ProjectLink /></div></section>
      <section className="field-note home-notes"><span className="eyebrow">EDITOR’S NOTE / 创作手记</span><h2 className="serif">借鉴机制，让故事重新生长。</h2><div className="mini-step"><span className="number">01</span><div><strong>理解参考材料</strong><p>先看清信息如何分配，玩家为何行动。</p></div></div><div className="mini-step"><span className="number">02</span><div><strong>建立原创因果</strong><p>重新设计人物、事件与线索的关联。</p></div></div><div className="mini-step"><span className="number">03</span><div><strong>逐项检查，留待试玩</strong><p>纸面成立之后，还要交给真实的玩家。</p></div></div></section></div>}
    <div className="section-heading"><h2>{home ? "项目档案" : "全部项目"}<span className="count">{projects.data?.length ?? "—"}</span></h2>{home && <Link href="/projects" className="text-link">查看全部 <ArrowRight size={13} /></Link>}</div>
    {!home && <div className="search-tools"><div className="search-box"><Search size={15} /><Input aria-label="搜索项目名称" placeholder="搜索项目名称…" value={search} onChange={(e) => setSearch(e.target.value)} /></div><select className="plain-select" aria-label="筛选项目" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部项目</option><option value="mine">我的本机项目</option><option value="demo">原始样例</option></select></div>}
    {projects.isPending ? <Loading /> : projects.error ? <LoadError error={projects.error} retry={() => void projects.refetch()} /> : shown.length ? <ProjectTable projects={shown} demo={content.data ?? null} /> : <section className="panel empty-state"><BookOpen size={26} className="mx-auto" /><h2>{search ? "没有找到匹配的项目" : "这里等待你的第一个故事"}</h2><p>{search ? "试试另一个项目名称，或调整筛选条件。" : "从空白项目开始，或带着完整样例建立一份副本。"}</p><Link href="/projects/new" className="button-link">新建项目</Link></section>}
    <div className="page-footnote"><span><span className="local-dot" />本机项目保存于此浏览器，清除网站数据后将丢失。</span><span>材料齐备 ≠ 体验经过真人验证</span></div>
  </AppFrame>;
}
