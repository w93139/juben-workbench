"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, ChevronRight, FolderClosed, Menu } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UploadProjectButton } from "./create-project";
import { useService } from "./providers";

export function AppFrame({ children, title, projectId, workspace = false }: { children: React.ReactNode; title: string; projectId?: string; workspace?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const service = useService();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => service.list() });
  function nav(href: string, label: string, icon: React.ReactNode, active = pathname === href) {
    return <Link href={href} className={`nav-item ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)} key={href}>{icon}{label}{active && <ChevronRight className="nav-arrow" size={13} />}</Link>;
  }
  const navigation = <>
    <Link href="/" className="brand" onClick={() => setOpen(false)} aria-label="本间工作台首页"><span className="brand-mark">本</span><span><strong>本间工作台</strong><small>SCRIPT ATELIER</small></span></Link>
    <div className="project-nav-heading"><Link href="/projects" onClick={() => setOpen(false)}>我的项目</Link><UploadProjectButton compact /></div>
    <nav aria-label="主导航">
      {projects.data?.filter((project) => !project.readOnly).map((project) => nav(`/projects/${project.id}`, project.title, <FolderClosed size={15} />, project.id === projectId))}
      {projects.isPending && <p className="field-hint px-3">正在读取项目…</p>}
      {projects.error && <button className="nav-item" onClick={() => void projects.refetch()}>项目读取失败，点击重试</button>}
    </nav>
    <div className="sidebar-footer"><span className="local-dot" />本机工作区<br />作者材料请勿直接展示给玩家</div>
  </>;
  return <div className={`app-frame${workspace ? " workspace-frame" : ""}`}>
    <a href="#main" className="skip-link">跳到主要内容</a>
    <aside className="sidebar desktop-sidebar">{navigation}</aside>
    <div className="app-body">
      <header className="topbar">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><button className="mobile-menu-button" aria-label="打开导航"><Menu size={19} /></button></DialogTrigger>
          <DialogContent className="mobile-navigation translate-x-0 translate-y-0"><DialogTitle className="sr-only">工作台导航</DialogTitle><DialogDescription className="sr-only">选择要打开的剧本项目</DialogDescription><div className="mobile-nav-body">{navigation}</div></DialogContent>
        </Dialog>
        <div className="topbar-path"><Link href="/">创作空间</Link><ChevronRight size={12} /><span>{title}</span></div>
        <div className="topbar-right"><span className="avatar" aria-label="作者工作空间">作</span></div>
      </header>
      <main id="main" className="page-content" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}

export function ProjectLink({ id = "demo-names", children = "打开演示项目" }: { id?: string; children?: React.ReactNode }) {
  return <Link href={`/projects/${id}`} className="button-link">{children}<ArrowUpRight size={14} /></Link>;
}
