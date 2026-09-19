"use client";
import { useState } from "react";
import type { SegmentedReview, StudioArtifact } from "@/domain/studio";
import { AuditContent, ContentDetails, reportLabels } from "./review-content";

const states = { pending: "尚未开始", running: "正在处理", saved: "已保存", interrupted: "未保存，需手动继续" };
export function SegmentedReviewContent({ segmented, artifacts }: { segmented: SegmentedReview; artifacts: StudioArtifact[] }) {
  const [page, setPage] = useState(0), pages = Math.max(1, Math.ceil(segmented.units.length / 30)), current = Math.min(page, pages - 1);
  const parts = new Map(segmented.plan.parts.map(part => [part.id, part]));
  const links = new Map(segmented.plan.links.map(link => [link.id, link]));
  const originals = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  return <section className="mt-6" aria-label="分段审查与覆盖"><h3>分段审查与覆盖</h3><p className="mt-3">正文 {segmented.plan.parts.length} 段 · 关联检查 {segmented.plan.links.length} 组 · 已保存 {segmented.units.filter(unit => unit.state === "saved").length}/{segmented.plan.callsMax} 份报告</p><p className="field-hint mt-2">每段和关联范围均需两路独审、互审及主模型复核。来源范围与摘录可核对；相邻关联检查不能证明全部非相邻正文语义一致，仍需人工核对及真人试玩。</p>
    {segmented.units.slice(current * 30, (current + 1) * 30).map(unit => {
      const link = links.get(unit.scopeId), ids = link?.parts ?? [unit.scopeId];
      const label = ids.map(id => { const part = parts.get(id); return part ? `${originals.get(part.artifactId)?.title ?? part.artifactId} [${part.start}–${part.end}]` : id; }).join(" ↔ ");
      return <ContentDetails key={unit.id} title={<>{reportLabels[unit.stage]} · {states[unit.state]} · {label}</>}><div className="p-4 space-y-3"><p className="field-hint">范围以原文UTF-16位置记录，结束位置不含在内。</p>{link && <p className="break-all">关联依据：{link.groups.join("、")}</p>}{ids.map(id => {
        const part = parts.get(id), original = part ? originals.get(part.artifactId) : undefined;
        return part && original ? <ContentDetails key={id} title={`查看指定原文：${original.title} [${part.start}–${part.end}]`}><pre className="text-preview p-4">{original.content.slice(part.start, part.end)}</pre><p className="field-hint p-4 break-all">SHA256：{part.hash}</p></ContentDetails> : <p key={id}>原文范围暂不可用</p>;
      })}{unit.issues.map((issue, index) => <p key={index}>{issue}</p>)}{unit.report ? <><h4>模型覆盖声明与原文摘录</h4>{unit.report.coverage.map(entry => <blockquote className="whitespace-pre-wrap break-all border-l-2 pl-3" key={entry.partId}>{entry.partId}<br />{entry.quote}</blockquote>)}<AuditContent report={unit.report} /></> : <p>此项尚无可查阅的报告。</p>}</div></ContentDetails>;
    })}
    {pages > 1 && <nav className="flex flex-wrap items-center gap-3 mt-3" aria-label="分段报告分页"><button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页报告</button><span>第 {current + 1}/{pages} 页</span><button type="button" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>下一页报告</button></nav>}
  </section>;
}
