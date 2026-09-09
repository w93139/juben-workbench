import { describe, expect, it } from "vitest";
import { evaluationViewSchema } from "@/domain/model-evaluation";
import { buildEvaluationReport } from "@/server/evaluation-report";

const base = evaluationViewSchema.parse({
  status: "blocked", phase: "测评因费用或服务状态停止", connectionRevision: 1, priceCheckedAt: 1_800_000_000_000, updatedAt: 1_800_000_001_000,
  budgetCapFen: 1000, spentFen: 20, reservedFen: 0, uncertainFen: 4,
  candidates: [{ id: "qwen", displayName: "Qwen | Max", provider: "Qwen", contextLength: 128000, inputPriceMicroCnyPerMillion: 1, outputPriceMicroCnyPerMillion: 2 }, { id: "lingdt", displayName: "LingDT Flash", provider: "AntDigital", contextLength: 128000, inputPriceMicroCnyPerMillion: 1, outputPriceMicroCnyPerMillion: 2 }],
  scores: [{ modelId: "qwen", total: 64, structure: 71, evidence: 48, originality: 53, format: 100, latencyMs: 1000, promptTokens: 600, completionTokens: 5000, costFen: 20, usageEstimated: false, notes: ["未达到质量线"] }],
  taskResults: [], allocation: null, completedCalls: 3, maximumCalls: 12, plannedMaximumFen: 39, resumeCount: 1, resumeAllowed: true, viewRevision: 2,
  error: "模型服务返回的正文结构不完整，已停止后续付费调用。",
});

describe("模型测评报告", () => {
  it("旧版部分结果明确缺失逐题明细、待核对费用和结论边界", () => {
    const report = buildEvaluationReport(base, 1_800_000_002_000);
    expect(report.markdown).toContain("测评尚未完整结束"); expect(report.markdown).toContain("逐题明细未保存，不能补造"); expect(report.markdown).toContain("待平台核对：¥0.04");
    expect(report.markdown).toContain("没有发送用户剧本"); expect(report.markdown).not.toContain("最佳模型：Qwen"); expect(report.markdown).toContain("Qwen \\| Max");
    expect(report.markdown).toContain("分析推断：按旧版固定候选顺序"); expect(report.markdown).toContain("响应具体字段未保存");
  });
  it("完成状态只展示数据库已有的三个角色分配", () => {
    const candidates = ["a", "b", "c"].map(id => ({ id, displayName: id.toUpperCase(), provider: id, contextLength: 128000, inputPriceMicroCnyPerMillion: 1, outputPriceMicroCnyPerMillion: 2 }));
    const scores = candidates.map((item, index) => ({ modelId: item.id, total: 80 + index, structure: 80, evidence: 80, originality: 80, format: 100, latencyMs: 1000, promptTokens: 10, completionTokens: 20, costFen: 1, usageEstimated: false, notes: ["完成"] }));
    const view = evaluationViewSchema.parse({ ...base, status: "completed", candidates, scores, allocation: { mainModel: "a", reviewA: "b", reviewB: "c" }, completedCalls: 9, maximumCalls: 9, uncertainFen: 0, error: null });
    const report = buildEvaluationReport(view); expect(report.markdown).toContain("主创作模型：A"); expect(report.markdown).toContain("审查模型 A：B"); expect(report.markdown).toContain("审查模型 B：C");
  });
  it("尚未开始付费测评时不生成虚假质量报告", () => {
    const empty = evaluationViewSchema.parse({ ...base, status: "discovered", scores: [], completedCalls: 0, spentFen: 0, uncertainFen: 0, startedAt: null, lastFailure: null, error: null });
    expect(() => buildEvaluationReport(empty)).toThrow("尚未开始模型测评");
  });
  it("首题失败且没有成绩时仍输出失败原因和待核对费用", () => {
    const failed = evaluationViewSchema.parse({ ...base, scores: [], completedCalls: 0, spentFen: 0, uncertainFen: 2, startedAt: 1_800_000_000_000, lastFailure: { modelId: "qwen", taskIndex: 0, category: "service", occurredAt: 1_800_000_000_100 }, error: "模型服务没有完成响应" });
    const report = buildEvaluationReport(failed); expect(report.markdown).toContain("尚未形成可评分题目"); expect(report.markdown).toContain("待平台核对：¥0.02"); expect(report.markdown).toContain("模型服务没有完成响应");
  });
  it("部分完成模型展示逐题结果但不合成总分", () => {
    const partial = evaluationViewSchema.parse({ ...base, scores: [], completedCalls: 1, spentFen: 1, uncertainFen: 0, taskResults: [{ modelId: "qwen", taskIndex: 0, structure: 70, evidence: 80, originality: 50, format: 100, latencyMs: 100, promptTokens: 10, completionTokens: 20, costFen: 1, usageEstimated: false, notes: ["部分结果"] }] });
    const report = buildEvaluationReport(partial); expect(report.markdown).toContain("已完成 1/3 道，仅保留逐题记录，不合成总分"); expect(report.markdown).toContain("结构与证据拆解：结构 70");
  });
});
