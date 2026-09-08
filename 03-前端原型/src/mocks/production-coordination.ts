import type { ReviewCoordination, ReviewFinding, ReviewRun } from "@/domain/production";

// Workflow modeled on historical independent-review / mutual-check / evidence adjudication.
// No historical finding, verdict or validation status is imported as a current result.
export function mockCoordination(run: ReviewRun): ReviewCoordination {
  return {
    summary: "主 Agent 已模拟整理两路独审和一次互审。以下核对只检查当前意见记录是否带有资料位置，并保留分歧；未运行真实 AI、原 Skill 或独立重算。两路一致也不能直接证明问题成立。",
    mutualChecks: run.findings.flatMap((finding) => run.models.map((model) => ({ modelId: model.id, findingId: finding.id,
      conclusion: finding.agreement === "disagreement" ? `模拟互审：已对照另一侧的建议。关于增加提示的时机保留不同意见，需作者结合试玩决定；不能据此认定节奏已验证。` : "模拟互审：另一侧也提出了发放检查建议；附带位置只是核对入口，尚不能证明当前资料存在语义问题。" }))),
    checks: run.findings.map((finding) => ({ findingId: finding.id, outcome: finding.agreement === "disagreement" ? "human-test" : "needs-evidence",
      rationale: finding.agreement === "disagreement" ? "两路建议不同，主 Agent 保留分歧。提示是否改善体验须真人试玩，当前不判定哪一侧正确。" : `本意见附有资料位置“${finding.evidence.location.slice(0, 400)}”，但意见为预设。主 Agent 建议回到该位置核对原文，不以两路一致替代证据。` })),
    messages: [], proposals: [],
  };
}
export function mockRevisionProposal(run: ReviewRun, finding: ReviewFinding, instruction: string) {
  return `修改目标：${finding.title.slice(0, 400)}\n核对位置：${finding.evidence.location.slice(0, 400)}\n作者要求：${instruction}\n\n建议步骤：\n1. ${finding.suggestion.slice(0, 1800)}\n2. ${run.target === "manuscript" ? "仅编辑对应正文的最新版本，保留该材料读者范围与发放轮次。" : "在故事设计中先核对相关条件和事件因果，避免为修补规则临时添加冲突事实。"}\n3. 保存新版后重新审查；涉及阅读量、参与度和节奏的效果记录为待真人试玩。\n\n这是根据所选问题和你的要求拼接的本地模拟方案，可编辑后选择；尚未自动改动剧本。`;
}
