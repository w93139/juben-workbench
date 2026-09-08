"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { CreateProjectInput } from "@/domain/models";
import { AppFrame } from "./app-frame";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { ErrorMessage } from "./shared";
import { useContent, useService } from "./providers";

export function CreateProjectPage({ fromDemo = false, startResearch = false }: { fromDemo?: boolean; startResearch?: boolean }) {
  const service = useService();
  const router = useRouter();
  const client = useQueryClient();
  const content = useContent("demo-names");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [template, setTemplate] = useState<CreateProjectInput["template"]>(fromDemo ? "names-beyond" : "blank");
  const create = useMutation({ mutationFn: (input: CreateProjectInput) => service.create(input), onSuccess: async (project) => { client.setQueryData(["project", project.id], project); await client.invalidateQueries({ queryKey: ["projects"] }); router.push(`/projects/${project.id}${startResearch ? "/stages/materials" : ""}`); } });
  return <AppFrame title="新建项目"><div className="page-heading"><div><span className="eyebrow">START A NEW CHAPTER</span><h1 className="serif">为一个新故事，建立档案。</h1><p>{startResearch ? "创建后会直接进入材料中心，再点击“载入研究练习包”开始。" : "先给项目一个名字。其他创作决定，可以在工作台里慢慢确定。"}</p></div></div>
    <div className="form-layout"><form className="form-panel" onSubmit={(e) => { e.preventDefault(); if (!create.isPending) create.mutate({ title, note, template }); }}>
      <fieldset disabled={create.isPending}><legend className="sr-only">项目基本信息</legend><div className="form-field"><label className="field-label" htmlFor="project-title">项目名称 <span className="font-normal text-muted-foreground">/ 必填</span></label><Input id="project-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} required placeholder="例如：一封没有收件人的信" autoComplete="off" /><p className="field-hint">不超过 40 个字符，之后可以修改。</p></div>
      <fieldset className="form-field"><legend className="field-label">从哪里开始</legend><div className="template-options"><label className="template-option"><input type="radio" name="template" checked={template === "blank"} onChange={() => setTemplate("blank")} /><strong>空白原创项目</strong><p>从创作意图与待确定事项开始，建立自己的故事。</p></label><label className="template-option"><input type="radio" name="template" checked={template === "names-beyond"} onChange={() => setTemplate("names-beyond")} /><strong>使用演示副本</strong><p>带入《{content.data?.title ?? "原创样例"}》结构底稿，独立记录创作决定。</p></label></div></fieldset>
      <div className="form-field"><label className="field-label" htmlFor="project-note">创作备注 <span className="font-normal text-muted-foreground">/ 选填</span></label><Textarea id="project-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1200} rows={5} placeholder="写下一个画面、一段人物关系，或你希望玩家获得的体验…" /><p className="field-hint">{note.length} / 1200 字</p></div></fieldset>
      {create.error && <ErrorMessage error={create.error} />}<div className="form-actions"><Link href="/projects" className="text-link">返回项目</Link><Button type="submit" disabled={create.isPending || !title.trim()}>{create.isPending ? "正在创建…" : startResearch ? "创建并进入材料中心" : "创建并进入工作台"}<ArrowRight size={14} /></Button></div>
    </form><aside className="field-note"><span className="eyebrow">BEFORE YOU BEGIN</span><h2 className="serif">把灵感留住，把决定记清。</h2><div className="note-list"><div><strong>当前可做什么</strong>创建项目、浏览样例，体验模拟OCR、材料校对、参考拆解、机制取舍和原创方向设置。</div><div><strong>演示副本独立保存</strong>你的备注和决定不会改动原始样例。第一阶段的剧本底稿仍为只读。</div><div><strong>检查与试玩分开看</strong>副本附带原样例的历史记录，不代表新项目经过检查或真人试玩。</div></div></aside></div>
  </AppFrame>;
}
