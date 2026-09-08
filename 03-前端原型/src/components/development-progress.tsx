"use client";
import { developmentPercent, developmentPhases } from "@/domain/development-progress";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";

export function DevelopmentProgress() {
  return <Dialog><DialogTrigger asChild><button className="development-progress-button" aria-label={`查看开发阶段与总体进度，${developmentPercent}%`}>原型开发 {developmentPercent}% · C待测试</button></DialogTrigger><DialogContent className="sm:max-w-2xl"><DialogTitle>开发阶段与总体进度</DialogTitle><DialogDescription>已完成开发交付 3 / 5 批，约 {developmentPercent}%。按A—E等权计算，只表示前端原型开发；不包含真实后端，不等于用户验收或真人试玩通过。</DialogDescription><progress max={100} value={developmentPercent} aria-label="原型总体开发进度" className="w-full" /><div className="record-list">{developmentPhases.map((phase) => <div key={phase.id} className="record-item"><strong>{phase.id}</strong><div><h3>{phase.name}</h3><p className="field-hint">{phase.scope}</p><span className={`tag ${phase.id === "C" ? "amber" : "neutral"}`}>{phase.status}</span></div></div>)}</div><p className="field-hint">下一步：请在“设计故事”中体验编辑、保存和版本查看。你的剧本Skill与A阶段无需重复验收。</p></DialogContent></Dialog>;
}
