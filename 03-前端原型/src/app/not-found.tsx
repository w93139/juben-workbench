import Link from "next/link";
export default function NotFound() { return <main className="empty-state"><p className="eyebrow">404</p><h1>没有找到这个页面</h1><p>请返回项目列表，继续你的创作。</p><Link href="/projects" className="button-link">返回项目列表</Link></main>; }
