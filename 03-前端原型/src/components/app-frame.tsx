"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowUpRight, ChevronRight, FolderClosed, House, LayoutDashboard, Menu, Plus, PanelsTopLeft } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useWorkflow } from "./providers";

export function AppFrame({ children, title, projectId, workspace = false }: { children: React.ReactNode; title: string; projectId?: string; workspace?: boolean }) {
  const pathname = usePathname();
  const workflow = useWorkflow();
  const [open, setOpen] = useState(false);
  const base = `/projects/${projectId}`;
  function nav(href: string, label: string, icon: React.ReactNode) {
    return <Link href={href} className={`nav-item ${pathname === href ? "active" : ""}`} aria-current={pathname === href ? "page" : undefined} onClick={() => setOpen(false)} key={href}>{icon}{label}{pathname === href && <ChevronRight className="nav-arrow" size={13} />}</Link>;
  }
  const navigation = <>
    <Link href="/" className="brand" onClick={() => setOpen(false)} aria-label="本间工作台首页"><span className="brand-mark">本</span><span><strong>本间工作台</strong><small>SCRIPT ATELIER</small></span></Link>
    <nav aria-label="主导航">
      {projectId ? <>
        {nav("/projects", "全部项目", <ArrowLeft size={15} />)}
        <p className="nav-section-title">当前项目</p>
        {nav(base, "项目总览", <LayoutDashboard size={15} />)}
        <p className="nav-section-title">创作流程</p>
        {workflow.data?.map((stage, i) => nav(`${base}/stages/${stage.id}`, stage.name, <span className="step-no">{String(i + 1).padStart(2, "0")}</span>))}
      </> : <>
        <p className="nav-section-title">创作空间</p>
        {nav("/", "工作台首页", <House size={16} />)}
        {nav("/projects", "我的项目", <FolderClosed size={16} />)}
        {nav("/projects/new", "新建项目", <Plus size={16} />)}
        <p className="nav-section-title">从一个好故事开始</p>
        {nav("/projects/demo-names", "浏览原创样例", <PanelsTopLeft size={16} />)}
      </>}
    </nav>
    <div className="sidebar-footer"><span className="local-dot" />仅保存在此浏览器<br />阶段 B · 参考研究与方向设置</div>
  </>;
  return <div className={`app-frame${workspace ? " workspace-frame" : ""}`}>
    <a href="#main" className="skip-link">跳到主要内容</a>
    <aside className="sidebar desktop-sidebar">{navigation}</aside>
    <div className="app-body">
      <header className="topbar">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><button className="mobile-menu-button" aria-label="打开导航"><Menu size={19} /></button></DialogTrigger>
          <DialogContent className="mobile-navigation"><DialogTitle className="sr-only">工作台导航</DialogTitle><DialogDescription className="sr-only">选择项目或创作阶段</DialogDescription><div className="mobile-nav-body">{navigation}</div></DialogContent>
        </Dialog>
        <div className="topbar-path"><Link href="/">创作空间</Link><ChevronRight size={12} /><span>{title}</span></div>
        <div className="topbar-right"><span className="prototype-label">可交互原型 · 本地演示</span><span className="avatar" aria-label="作者工作空间">作</span></div>
      </header>
      <main id="main" className="page-content" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}

export function ProjectLink({ id = "demo-names", children = "打开演示项目" }: { id?: string; children?: React.ReactNode }) {
  return <Link href={`/projects/${id}`} className="button-link">{children}<ArrowUpRight size={14} /></Link>;
}
