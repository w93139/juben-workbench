import type { EvaluationView } from "@/domain/model-evaluation";
import { LocalApiError } from "./local-security";

const TASK_NAMES = ["结构与证据拆解", "原创方向设计", "一致性审查"];
const money = (fen: number) => `¥${(fen / 100).toFixed(2)}`;
const time = (value: number | null) => value == null ? "旧记录未保存" : new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
const cell = (value: unknown) => String(value ?? "—").replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
const displayName = (view: EvaluationView, id: string) => view.candidates.find(item => item.id === id)?.displayName ?? view.excludedModels.find(item => item.modelId === id)?.displayName ?? id;

function resultLabel(view: EvaluationView) {
  if (view.status === "completed" && view.allocation) return "测评完成，已分配三个模型";
  if (view.completedCalls >= view.maximumCalls && view.maximumCalls > 0) return "测评完成，但没有三个模型同时达到质量线";
  if (view.status === "cancelled") return "测评由用户停止，结果不完整";
  return "测评尚未完整结束";
}

export function buildEvaluationReport(view: EvaluationView, generatedAt = Date.now()) {
  const hasRunRecord = view.completedCalls > 0 || view.scores.length > 0 || view.taskResults.length > 0 || view.excludedModels.length > 0 || view.spentFen > 0 || view.reservedFen > 0 || view.uncertainFen > 0 || view.lastFailure != null || view.startedAt != null;
  if (!hasRunRecord) throw new LocalApiError(409, "尚未开始模型测评，没有可写入报告的运行记录。");
  const lines = [
    "# 剧本工作台模型测评报告",
    "",
    "> 本报告由本机保存的固定小样测评记录按确定性规则整理，生成报告不会调用模型或产生费用。",
    "",
    "## 本次结论",
    "",
    `- 结果：${resultLabel(view)}`,
    `- 进度：${view.completedCalls}/${view.maximumCalls} 道可评分题目`,
    `- 测评规则：${view.taskVersion ?? "旧记录未保存版本号"}`,
    `- 测评开始：${time(view.startedAt)}`,
    `- 记录更新：${time(view.updatedAt)}`,
    `- 报告生成：${time(generatedAt)}`,
    `- 记录版本：${view.viewRevision}`,
    "",
    "## 模型分配",
    "",
  ];
  if (view.allocation) lines.push(`- 主创作模型：${displayName(view, view.allocation.mainModel)}`, `- 审查模型 A：${displayName(view, view.allocation.reviewA)}`, `- 审查模型 B：${displayName(view, view.allocation.reviewB)}`);
  else lines.push("尚未形成三个模型的可靠分配。未完整测评或未达到质量线时，不给出“最佳模型”结论。");
  const legacyInterrupted = view.resumeCount > 0 && view.excludedModels.length === 0 && view.lastFailure == null && view.error === "模型服务返回的正文结构不完整，已停止后续付费调用。"
    ? view.candidates.find(candidate => !view.scores.some(score => score.modelId === candidate.id) && !view.taskResults.some(result => result.modelId === candidate.id))
    : undefined;
  if (legacyInterrupted) lines.push("", "## 中断诊断", "", `- 分析推断：按旧版固定候选顺序和已保存进度，中断发生在 ${displayName(view, legacyInterrupted.id)} 的第一道“结构与证据拆解”。`, "- 可确认范围：服务请求已返回，但旧版严格正文结构校验没有通过，因此停止后续调用。", "- 无法确认范围：旧版没有保存异常响应原文，不能事后判定是结束标志、正文为空、正文分片还是其他具体字段。");
  lines.push("", "## 模型比较", "", "| 模型 | 状态 | 总分 | 结构 | 证据 | 原创 | 格式 | 响应时间 | 结果费用 |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  const modelIds = [...new Set([...view.candidates.map(item => item.id), ...view.scores.map(item => item.modelId), ...view.taskResults.map(item => item.modelId), ...view.excludedModels.map(item => item.modelId)])];
  for (const modelId of modelIds) {
    const score = view.scores.find(item => item.modelId === modelId); const excluded = view.excludedModels.find(item => item.modelId === modelId);
    const partial = view.taskResults.filter(item => item.modelId === modelId).length;
    const state = score ? "3/3 完成" : excluded ? excluded.reason.includes("length") ? "输出被截断，本轮未采用" : "响应不兼容，本轮未采用" : partial ? `${partial}/3 部分完成` : "未完成";
    lines.push(`| ${cell(displayName(view, modelId))} | ${cell(state)} | ${score?.total ?? "—"} | ${score?.structure ?? "—"} | ${score?.evidence ?? "—"} | ${score?.originality ?? "—"} | ${score?.format ?? "—"} | ${score ? `${(score.latencyMs / 1000).toFixed(1)} 秒` : "—"} | ${score ? money(score.costFen) : excluded?.costFen != null ? money(excluded.costFen) : "—"} |`);
  }
  lines.push("", "## 各模型记录", "");
  const recordedIds = modelIds.filter(modelId => view.scores.some(item => item.modelId === modelId) || view.taskResults.some(item => item.modelId === modelId));
  if (!recordedIds.length) lines.push("尚未形成可评分题目；失败原因和费用记录见下文。", "");
  for (const modelId of recordedIds) {
    const score = view.scores.find(item => item.modelId === modelId);
    const details = view.taskResults.filter(item => item.modelId === modelId).sort((a, b) => a.taskIndex - b.taskIndex);
    lines.push(`### ${displayName(view, modelId)}`, "");
    if (score) lines.push(`- 汇总：${score.total} 分；结构 ${score.structure}、证据 ${score.evidence}、原创 ${score.originality}、格式 ${score.format}`, `- 用量：${score.promptTokens + score.completionTokens} Token${score.usageEstimated ? "（按安全上限估算）" : ""}`, `- 备注：${score.notes.join("；") || "无"}`);
    else lines.push(`- 状态：已完成 ${details.length}/3 道，仅保留逐题记录，不合成总分或参与排名。`);
    if (score && !details.length) lines.push("- 逐题明细：这是升级前保存的历史汇总成绩，逐题明细未保存，不能补造。");
    else for (const detail of details) lines.push(`- ${TASK_NAMES[detail.taskIndex]}：结构 ${detail.structure}、证据 ${detail.evidence}、原创 ${detail.originality}、格式 ${detail.format}；${detail.notes.join("；")}`);
    lines.push("");
  }
  if (view.excludedModels.length) {
    lines.push("## 已排除候选", "");
    for (const item of view.excludedModels) {
      const completed = view.taskResults.filter(result => result.modelId === item.modelId).length;
      lines.push(`- ${displayName(view, item.modelId)}：${item.reason}；${item.costFen == null ? "旧版未保存单项费用，相关金额已包含在总待核对费用中" : `本条记录费用 ${money(item.costFen)}${item.usageEstimated ? "（上限估算）" : ""}`}${completed ? `；此前已有 ${completed}/3 道逐题结果已保留，但不合成总分` : ""}`);
    }
    lines.push("");
  }
  lines.push("## 费用", "", `- 已核算：${money(view.spentFen)}`, `- 在途预留：${money(view.reservedFen)}`, `- 待平台核对：${money(view.uncertainFen)}`, `- 工作台估算硬上限：${money(view.budgetCapFen)}`, "- “待平台核对”不是确认扣款；最终金额以蚂蚁平台账单为准。完整费用以本节账本合计为准，可能包含未形成成绩的异常调用。", "");
  if (view.error) lines.push("## 当前未解决事项", "", `- ${view.error}`, ...(view.lastFailure ? [`- 最近一次定位：${displayName(view, view.lastFailure.modelId ?? "未知模型")}，${view.lastFailure.taskIndex == null ? "题目未知" : TASK_NAMES[view.lastFailure.taskIndex]}，类型 ${view.lastFailure.category}`] : legacyInterrupted ? ["- 中断候选可按执行顺序定位，但响应具体字段未保存，不能事后补造。"] : ["- 旧记录没有保存失败调用的模型归属和响应形态，不能事后补造。"]), "");
  lines.push("## 适用边界", "", "- 测评只使用三类固定合成小样，没有发送用户剧本。", "- 得分用于当前工作台的模型角色分配，不证明长篇创作、完整 Skill 执行或真人试玩效果。", "- 未完成模型不能与完整模型直接排名；没有三个模型达到质量线时不会自动分配。", "");
  const date = new Date(view.updatedAt); const dateStamp = Number.isNaN(date.getTime()) ? "未知日期" : date.toISOString().slice(0, 10);
  return { filename: `模型测评报告-${dateStamp}.md`, markdown: lines.join("\n"), viewRevision: view.viewRevision };
}
