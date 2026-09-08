"use client";
import { developmentPercent, developmentPhases } from "@/domain/development-progress";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";

export function DevelopmentProgress() {
  const delivered = developmentPhases.filter((phase) => phase.delivered).length;
  const pending = developmentPhases.find((phase) => phase.status === "本轮待你测试");
  return <Dialog><DialogTrigger asChild><button className="development-progress-button" aria-label={`查看开发阶段与总体进度，${developmentPercent}%`}>原型开发 {developmentPercent}% · {pending?.id ?? ""}待测试</button></DialogTrigger><DialogContent className="sm:max-w-2xl"><DialogTitle>开发阶段与总体进度</DialogTitle><DialogDescription>已完成开发交付 {delivered} / {developmentPhases.length} 批，约 {developmentPercent}%。按A—E等权计算，只表示前端原型开发；不包含真实后端，不等于用户验收或真人试玩通过。</DialogDescription><progress max={100} value={developmentPercent} aria-label="原型总体开发进度" className="w-full" /><div className="record-list">{developmentPhases.map((phase) => <div key={phase.id} className="record-item"><strong>{phase.id}</strong><div><h3>{phase.name}</h3><p className="field-hint">{phase.scope}</p><span className={`tag ${phase.id === pending?.id ? "amber" : "neutral"}`}>{phase.status}</span></div></div>)}</div><p className="field-hint">下一步：请在“生成与检查”体验模拟生成、正文修改和意见处理。你的剧本Skill与已验收阶段无需重复验收。</p></DialogContent></Dialog>;
}
