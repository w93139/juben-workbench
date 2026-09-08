"use client";

import Link from "next/link";
import type { Project } from "@/domain/models";
import { defaultDirection, type MechanismChoice, type OriginalDirection, type ResearchCatalog } from "@/domain/research";
import { useService } from "../providers";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { AnalysisStage } from "./analysis";
import { useResearchAction, useResearchDraft } from "./common";

const experiences = [
  { name: "偏推理", deduction: 60, emotion: 25, mechanics: 15 },
  { name: "偏情感", deduction: 25, emotion: 60, mechanics: 15 },
  { name: "偏互动", deduction: 25, emotion: 15, mechanics: 60 },
  { name: "均衡", deduction: 34, emotion: 33, mechanics: 33 },
] as const;
type PlanDraft = { direction: OriginalDirection; choices: MechanismChoice[] };

export function CreativePlan({ project, catalog }: { project: Project; catalog: ResearchCatalog }) {
  const initial = { direction: project.research.direction ?? defaultDirection, choices: project.research.choices };
  const { draft, change, saved } = useResearchDraft<PlanDraft>(initial);
  const action = useResearchAction(project);
  const service = useService();
  const ready = project.research.auditRevision === project.research.materialRevision && project.research.analysisRevision === project.research.materialRevision && !project.research.issues.some((issue) => issue.status === "open");
  const busy = project.readOnly || action.isPending || project.research.job?.status === "running";
  const total = draft.direction.deduction + draft.direction.emotion + draft.direction.mechanics;
  const selected = draft.choices.filter((choice) => choice.choice !== "omit");
  const selectedPatterns = selected.flatMap((choice) => catalog.patterns.filter((pattern) => pattern.id === choice.id));
  const mainRisks = selectedPatterns.flatMap((pattern) => pattern.risks.length ? [{ id: pattern.id, name: pattern.name, text: pattern.risks[0] }] : []).slice(0, 2);
  const edited = JSON.stringify(draft) !== JSON.stringify(initial);
  const selectedPreset = experiences.find((preset) => preset.deduction === draft.direction.deduction && preset.emotion === draft.direction.emotion && preset.mechanics === draft.direction.mechanics);
  function update(next: PlanDraft) { action.touch(); change(next); }
  function setDirection<K extends keyof OriginalDirection>(key: K, value: OriginalDirection[K]) { update({ ...draft, direction: { ...draft.direction, [key]: value } }); }
  function setChoice(pattern: ResearchCatalog["patterns"][number], choice: MechanismChoice["choice"] | "") {
    const existing = draft.choices.find((item) => item.id === pattern.id);
    update({ ...draft, choices: [...draft.choices.filter((item) => item.id !== pattern.id), ...(choice ? [{ id: pattern.id, choice, reason: existing?.reason ?? pattern.suggestion }] : [])] });
  }
  function save(confirm: boolean) {
    if (!busy) action.mutate((revision) => service.saveCreativePlan(project.id, revision, { ...draft, confirm }), { onSuccess: saved });
  }
  return <>
    <section className="panel" id="creative-plan-form" aria-label="创作方案">
      <div className="panel-title"><h2>新作创作方案</h2><span>{project.research.directionConfirmed && !edited ? "已确认" : "暂定"}</span></div>
      <p className="story-premise">先确定想写的故事和玩法，再集中确认。以下数值与玩法建议来自练习预设，可以修改；人物、事件因果和线索都需要重新创作。</p>
      <form className="mt-5" onSubmit={(event) => { event.preventDefault(); save(true); }}>
        <fieldset disabled={busy}>
          <legend className="sr-only">创作方案设置</legend>
          <div className="research-form-grid"><label className="field-label">玩家人数<Input aria-label="目标玩家人数" type="number" min={2} max={12} value={draft.direction.players} onChange={(event) => setDirection("players", Number(event.target.value))} /></label><label className="field-label">计划时长（分钟）<Input aria-label="目标时长" type="number" min={60} max={600} value={draft.direction.minutes} onChange={(event) => setDirection("minutes", Number(event.target.value))} /></label></div>
          <label className="field-label mt-4" htmlFor="direction-genre">题材</label><Input id="direction-genre" value={draft.direction.genre} maxLength={60} onChange={(event) => setDirection("genre", event.target.value)} placeholder="例如：近未来悬疑" />
          <label className="field-label mt-4" htmlFor="direction-idea">补充创意</label><Textarea id="direction-idea" rows={3} value={draft.direction.idea} maxLength={2000} onChange={(event) => setDirection("idea", event.target.value)} placeholder="故事发生在哪里？玩家要面对什么矛盾？" />
          <p className="field-label mt-5">希望玩家获得什么体验</p>
          <div className="view-switcher" aria-label="体验预设">{experiences.map((preset) => <button type="button" key={preset.name} aria-pressed={selectedPreset?.name === preset.name} onClick={() => update({ ...draft, direction: { ...draft.direction, deduction: preset.deduction, emotion: preset.emotion, mechanics: preset.mechanics } })}>{preset.name}</button>)}</div>
          <details className="research-excerpt"><summary>精细设置体验比例与改编方式</summary>
            <div className="research-form-grid three">{([ ["deduction", "推理还原"], ["emotion", "情感关系"], ["mechanics", "机制互动"] ] as const).map(([key, label]) => <label className="field-label" key={key}>{label} %<Input aria-label={`${label}比例`} type="number" min={0} max={100} value={draft.direction[key]} onChange={(event) => setDirection(key, Number(event.target.value))} /></label>)}</div>
            <p className={`field-hint ${total !== 100 ? "text-destructive" : ""}`}>当前合计 {total}%，确认方案前需要等于 100%；草稿可以先保存。</p>
            <label className="field-label mt-4" htmlFor="direction-intensity">机制改编方式</label><select id="direction-intensity" className="plain-select" value={draft.direction.intensity} onChange={(event) => setDirection("intensity", event.target.value as OriginalDirection["intensity"])}><option value="mechanisms">借鉴抽象机制，重建故事与因果</option><option value="recombine">重新组合机制，重建人物与证据结构</option></select>
          </details>
          <label className="field-label mt-4" htmlFor="direction-forbidden">不希望出现的内容</label><Textarea id="direction-forbidden" rows={2} value={draft.direction.forbidden} maxLength={1200} onChange={(event) => setDirection("forbidden", event.target.value)} />
          <div className="panel-title mt-6"><h3>选择值得借鉴的玩法</h3><span>{project.research.directionConfirmed && !edited ? "已确认采用" : "暂定采用"} {selected.length} 项</span></div>
          <p className="field-hint">先选玩法，迁移建议会作为默认理由。未选择的玩法不会加入方案；下面的建议不是已验证的试玩效果。</p>
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => {
            const choices = [...draft.choices];
            for (const id of ["P02", "P03"] as const) {
              const pattern = catalog.patterns.find((item) => item.id === id);
              if (pattern && !choices.some((item) => item.id === id)) choices.push({ id, choice: "adapt", reason: pattern.suggestion });
            }
            update({ ...draft, choices });
          }}>采用练习推荐组合</Button>
          <p className="field-hint">练习组合：证据解锁与私人信息更新。仅加入当前草稿，不会覆盖已有取舍。</p>
          {selected.length > 0 && <p className="stage-callout mt-3">{project.research.directionConfirmed && !edited ? "已确认采用" : "暂定采用"}：{selected.map((choice) => catalog.patterns.find((pattern) => pattern.id === choice.id)?.name).join("、")}</p>}
          {mainRisks.length > 0 && <div className="stage-callout mt-3" aria-label="主要迁移风险"><strong>采用前需要留意 · 分析建议</strong>{mainRisks.map((risk) => <p key={risk.id}>{risk.name}：{risk.text}。</p>)}<p className="field-hint">这里摘出所选玩法的首要风险；全部风险和依据可在下方展开查看。</p></div>}
          {draft.direction.players !== defaultDirection.players && <p className="stage-callout mt-3">人数从练习预设的 {defaultDirection.players} 人改为 {draft.direction.players} 人，需要重新分配私人信息、谈判对象和每个角色的关键贡献。原有 5 人样例尚未随之改写。</p>}
          {draft.direction.minutes !== defaultDirection.minutes && <p className="stage-callout mt-3">目标 {draft.direction.minutes} 分钟不同于原样例计划 {defaultDirection.minutes} 分钟，需要重新分配阅读、讨论、行动和主持说明的时间，不能只缩短轮次标签。</p>}
          <details className="research-excerpt"><summary>查看全部 {catalog.patterns.length} 条玩法与取舍</summary>
          <div className="record-list mt-4">{catalog.patterns.map((pattern) => {
            const choice = draft.choices.find((item) => item.id === pattern.id);
            return <article className="record-card mb-3" key={pattern.id}>
              <div className="flex flex-wrap items-center justify-between gap-3"><h3>{pattern.name}</h3><span className="tag neutral">{choice ? project.research.directionConfirmed && !edited ? "已确认取舍" : "暂定取舍" : "待选择"}</span></div>
              <p className="field-hint">{pattern.behavior}</p>
              <label className="field-label mt-3" htmlFor={`choice-${pattern.id}`}>如何使用「{pattern.name}」</label><select id={`choice-${pattern.id}`} className="plain-select" value={choice?.choice ?? ""} onChange={(event) => setChoice(pattern, event.target.value as MechanismChoice["choice"] | "")}><option value="">暂不决定</option><option value="adapt">改造后迁移</option><option value="retain">保留抽象功能</option><option value="omit">不采用</option></select>
              <details className="research-excerpt"><summary>查看建议、来源与风险／修改理由</summary>
                <span className="tag neutral">原创建议 · 暂定</span><p>{pattern.suggestion}</p>
                <dl className="mechanism-fields"><dt>所需前提</dt><dd>{pattern.prerequisites.join("；")}</dd><dt>与故事的关系</dt><dd>{pattern.story}</dd><dt>可以迁移的部分</dt><dd>{pattern.transferable}</dd></dl>
                <span className="tag">参考记录明确事实</span><p>{pattern.explicit}</p><p className="source-path">{pattern.locator}</p>{pattern.sources.map((source) => <p className="source-path" key={source.id}>{source.id} · {source.location}</p>)}
                <span className="tag blue">分析推断 · 迁移风险</span>{pattern.risks.map((risk) => <p key={risk}>{risk}</p>)}{Object.entries(pattern.changes).map(([name, risk]) => <p key={name}>{name}改变：{risk}</p>)}
                {choice && <><label className="field-label mt-3" htmlFor={`reason-${pattern.id}`}>取舍理由（可修改）</label><Textarea id={`reason-${pattern.id}`} value={choice.reason} maxLength={600} onChange={(event) => update({ ...draft, choices: draft.choices.map((item) => item.id === pattern.id ? { ...item, reason: event.target.value } : item) })} /></>}
              </details>
            </article>;
          })}</div></details>
        </fieldset>
        <div className="stage-callout mt-5">
          {!ready ? <p>可以先保存创意草稿。确认方案前，请完成材料校对和本页下方的模拟拆解。<a className="inline-link" href="#reference-analysis">查看分析依据</a></p> : <p>已具备本轮机制研究依据。确认后可进入故事设计；缺失的完整真相、原案时间线和人物关系仍待补充。</p>}
          {total !== 100 && <p>体验比例合计 {total}%，请在精细设置中调整为 100% 后再确认。</p>}
          {!draft.direction.genre.trim() && <p>题材可以暂时留空；确认方案前需要填写。</p>}
          {selected.length === 0 && <p>确认前至少采用一项机制。</p>}
        </div>
        <div className="flex flex-wrap gap-3 mt-5"><Button type="button" variant="outline" disabled={busy} onClick={() => save(false)}>保存方案草稿</Button><Button disabled={busy || !ready || total !== 100 || selected.length === 0 || !draft.direction.genre.trim()}>确认创作方案</Button></div>
        {action.feedback}
        {project.research.directionConfirmed && !edited && <p className="success-message" role="status">创作方案已确认。<Link className="inline-link" href={`/projects/${project.id}/stages/blueprint`}>进入设计故事 →</Link></p>}
      </form>
    </section>
    <section id="reference-analysis" aria-label="分析依据">
      <details className="panel" open={!ready}><summary className="cursor-pointer font-medium">查看参考分析依据{ready ? "与材料缺口" : "／开始模拟拆解"}</summary><div className="mt-5"><AnalysisStage project={project} catalog={catalog} embedded /></div></details>
    </section>
  </>;
}
