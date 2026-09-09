// Human-reviewed public evidence, not a live leaderboard or a quality guarantee.
export const MODEL_SHORTLIST_VERSION = "script-research/2026-09-09";
export const MODEL_SHORTLIST = [
  { id: "qwen3.8-max", name: "Qwen3.8-Max", focus: "拆解与原创方向", omitTemperature: true, reason: "官方支持长文档和结构化输出，公开创意写作评测可作入围参考；平台别名与评测快照未必相同。", url: "https://help.aliyun.com/en/model-studio/qwen3-8-max" },
  { id: "deepseek-v4-pro-0813", name: "DeepSeek-V4-Pro-0813", focus: "因果与证据审查", omitTemperature: true, reason: "官方明确0813版本、长上下文与JSON能力；是否能准确核对剧本因果仍需本地小样验证。", url: "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-0813" },
  { id: "kimi-k3", name: "Kimi K3", focus: "跨角色信息与独立复核", omitTemperature: true, reason: "官方定位长程知识工作，补充另一家模型的审查视角；平台费用较高，只做针对性小样。", url: "https://huggingface.co/moonshotai/Kimi-K3" },
  { id: "deepseek-v4-flash-0731", name: "DeepSeek-V4-Flash-0731", focus: "唯一低成本替补", omitTemperature: false, reason: "官方明确0731版本与长上下文能力；与Pro同属一个模型家族，替补后审查视角可能更接近。", url: "https://api-docs.deepseek.com/quick_start/pricing/" },
] as const;
export type CandidateSelectionPolicy = { ids: readonly string[]; initialCount: 3 | 4 };
export const RESEARCH_SELECTION_POLICY: CandidateSelectionPolicy = { ids: MODEL_SHORTLIST.map(item => item.id), initialCount: 3 };
