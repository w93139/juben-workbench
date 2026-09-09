import { z } from "zod";
import { MODEL_EVALUATION_TASK_VERSION, type ModelScore } from "@/domain/model-evaluation";

export const EVALUATION_TASK_VERSION = MODEL_EVALUATION_TASK_VERSION;
type Grade = Pick<ModelScore, "structure" | "evidence" | "originality" | "format"> & { notes: string[] };
type EvaluationTask = { name: string; prompt: string; grade: (value: unknown, raw: string) => Grade };
const meaningful = (minimum: number, maximum = 500) => z.string().trim().min(minimum).max(maximum);
const unique = <T>(values: T[]) => new Set(values.map(value => JSON.stringify(value))).size === values.length;

// Unknown display-only fields are ignored; required fields and their contents remain validated.
const structureSchema = z.object({
  facts: z.array(z.object({ statement: meaningful(4), sourceQuote: meaningful(8), kind: z.literal("明确事实") })).length(3).refine(unique),
  inferences: z.array(z.object({ statement: meaningful(6), supportQuotes: z.array(meaningful(8)).min(2).max(3).refine(unique) })).min(1).max(3),
  causalChain: z.array(meaningful(4)).min(3).max(8).refine(unique),
  unknowns: z.array(meaningful(4)).min(1).max(5).refine(unique),
});
const directionSchema = z.object({
  title: meaningful(2, 30), premise: meaningful(25, 500),
  playerBehaviors: z.array(meaningful(6)).min(2).max(6).refine(unique),
  originalChanges: z.array(meaningful(6)).min(4).max(8).refine(unique),
  risks: z.array(meaningful(6)).min(2).max(6).refine(unique),
});
const auditSchema = z.object({
  findings: z.array(z.object({
    category: z.enum(["时间线矛盾", "线索缺口", "信息泄漏", "角色贡献"]),
    evidence: meaningful(8), proposal: meaningful(10),
  })).min(2).max(6).refine(items => unique(items.map(item => item.category))),
  verdict: z.enum(["阻断", "可继续"]),
});

export function safeParseEvaluationJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^\uFEFF/, "");
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  try { return JSON.parse(fenced ? fenced[1]! : trimmed); } catch { return null; }
}

const pathLabels: Record<string, string> = {
  facts: "明确事实", statement: "陈述", sourceQuote: "原句", kind: "信息类别",
  inferences: "分析推断", supportQuotes: "支持原句", causalChain: "因果链", unknowns: "待确认问题",
  title: "标题", premise: "故事前提", playerBehaviors: "玩家行为", originalChanges: "原创变化", risks: "风险",
  findings: "审查问题", category: "问题类别", evidence: "证据", proposal: "修改方案", verdict: "结论",
};
function invalidGrade(notes: string[]): Grade { return { structure: 0, evidence: 0, originality: 0, format: 0, notes }; }
function validate<T>(schema: z.ZodType<T>, raw: string): { data: T } | { grade: Grade } {
  const value = safeParseEvaluationJson(raw);
  if (value === null) return { grade: invalidGrade(["回答不是可读取的JSON对象，无法评分；这不代表模型能力为零。"]) };
  const parsed = schema.safeParse(value);
  if (parsed.success) return { data: parsed.data };
  const details = parsed.error.issues.slice(0, 8).map(issue => {
    // Provider text, unknown property names and Zod's raw error message never enter diagnostics.
    const path = issue.path.map(part => typeof part === "number" ? `第${part + 1}项` : pathLabels[String(part)] ?? "字段").join("／") || "回答";
    const reason = issue.code === "too_small" ? "条数或字数少于题目要求"
      : issue.code === "too_big" ? "条数或字数超过题目上限"
      : issue.code === "custom" ? "存在重复内容或重复问题类别"
      : issue.code === "invalid_type" ? "缺少必填内容或数据类型不符"
      : "取值不在题目规定范围";
    return `${path}：${reason}`;
  });
  return { grade: invalidGrade(["回答未满足已明示的格式要求，未完成有效评分；这不代表模型能力为零。", ...details]) };
}

const sourceQuotes = ["21:40，顾遥把钥匙交给林川", "22:10，监控记录林川仍在北厅", "22:05，北厅门锁已从内部反锁"];
// Accept the displayed label and terminal Chinese full stop, while preserving all factual text.
const normalizeQuote = (quote: string) => quote.trim().replace(/^[ABC][：:]\s*/, "").replace(/。$/, "");
function orderedEventCount(nodes: string[]): number {
  const events = [
    { time: "21:40", content: /交|钥匙/ },
    { time: "22:05", content: /反锁/ },
    { time: "22:10", content: /监控/ },
  ];
  const lengths = [0, 0, 0];
  for (const node of nodes) {
    // Read only the previous node's state: one node cannot supply multiple chronological steps.
    const previous = [...lengths];
    events.forEach((event, index) => {
      if (node.includes(event.time) && event.content.test(node)) {
        lengths[index] = Math.max(lengths[index]!, 1 + Math.max(0, ...previous.slice(0, index)));
      }
    });
  }
  return Math.max(...lengths);
}

export const evaluationTasks: EvaluationTask[] = [
  {
    name: "结构与证据拆解",
    prompt: `以下是测试片段，不是真实用户剧本：\nA：${sourceQuotes[0]}。\nB：${sourceQuotes[1]}。\nC：${sourceQuotes[2]}。\n请整理明确事实、由多个事实支持的分析推断、按时间排列的事件链和待确认问题。不要把时间先后直接当作已证明的因果。\n格式要求：facts恰好3条，每条statement为4—500字、sourceQuote为8—500字且为完整逐字原句、kind固定为“明确事实”；inferences为1—3条，每条statement为6—500字，supportQuotes为2—3条不同的完整原句，每条8—500字；causalChain为3—8条，每条4—500字，每个事件单独一项并保留原文时间；unknowns为1—5条，每条4—500字。所有数组不得有重复项。原句允许保留A/B/C标签和句末句号。\n只返回JSON对象，字段示意（数组内省略号不表示只需一项）：{"facts":[{"statement":"…","sourceQuote":"完整逐字原句","kind":"明确事实"}],"inferences":[{"statement":"…","supportQuotes":["完整逐字原句"]}],"causalChain":["…"],"unknowns":["…"]}`,
    grade: (_value, raw) => {
      const parsed = validate(structureSchema, raw); if ("grade" in parsed) return parsed.grade;
      const factQuotes = new Set(parsed.data.facts.map(item => normalizeQuote(item.sourceQuote)));
      const exactFacts = sourceQuotes.filter(source => factQuotes.has(source)).length;
      const supportedInference = parsed.data.inferences.some(item => new Set(item.supportQuotes.map(normalizeQuote).filter(quote => sourceQuotes.includes(quote))).size >= 2);
      const chainHits = orderedEventCount(parsed.data.causalChain);
      const notes = exactFacts === 3 && supportedInference ? ["三条事实逐字可回查，推断引用多个依据"] : ["事实引用或推断依据未达到评分要求"];
      if (chainHits < 3) notes.push("事件链未按21:40、22:05、22:10顺序分别列出对应事件");
      return { structure: Math.round(chainHits / 3 * 70) + (supportedInference ? 30 : 0), evidence: Math.round(exactFacts / 3 * 80) + (supportedInference ? 20 : 0), originality: 50, format: 100, notes };
    },
  },
  {
    name: "原创方向设计",
    prompt: `参考机制：玩家分别掌握同一事故的局部记录，公开顺序会改变彼此信任。请设计一个全新的中文剧本杀方向。不得沿用“林川”“顾遥”“北厅”“钥匙”这些具体元素或照搬原事件；必须重建人物、动机、因果与承载机制的情境。“事故”作为普通词语可以使用。请在原创变化中分别说明人物、动机、事件因果及信息线索如何重建。\n格式要求：title为2—30字；premise为25—500字；playerBehaviors为2—6条；originalChanges为4—8条；risks为2—6条。后三个数组每项6—500字，同一数组不得重复。\n只返回JSON对象，字段示意（数组内省略号不表示只需一项）：{"title":"…","premise":"…","playerBehaviors":["…"],"originalChanges":["…"],"risks":["…"]}`,
    grade: (_value, raw) => {
      const parsed = validate(directionSchema, raw); if ("grade" in parsed) return parsed.grade;
      const combined = JSON.stringify(parsed.data);
      const copied = ["林川", "顾遥", "北厅", "钥匙"].filter(word => combined.includes(word));
      const behavior = parsed.data.playerBehaviors.join("");
      const mechanismHits = Number(/公开|披露|展示/.test(behavior)) + Number(/顺序|先后|时机/.test(behavior)) + Number(/信任|关系|判断/.test(behavior));
      const changeText = parsed.data.originalChanges.join("");
      const changeHits = [/(人物|角色)/, /动机/, /(因果|事件)/, /(线索|信息)/].filter(pattern => pattern.test(changeText)).length;
      const original = Math.max(0, 100 - copied.length * 20 - (4 - changeHits) * 10);
      return { structure: Math.round(mechanismHits / 3 * 100), evidence: 60, originality: original, format: 100, notes: copied.length || mechanismHits < 3 || changeHits < 4 ? ["原创变化或机制承载未完整达到评分要求"] : ["具体元素重建且保留了抽象玩家行为"] };
    },
  },
  {
    name: "一致性审查",
    prompt: `审查这个测试蓝图：真相明确20:00起所有区域持续断电，走廊摄像头随之停止工作，没有备用电源，也没有其他录像设备；角色甲却在20:10借助该走廊摄像头确认乙离开。结论“乙进入密室”是终局必须推出的结论，但线索表没有任何门禁、目击或痕迹线索。请指出阻断问题并给可执行修改方案。\n格式要求：findings为2—6条，每种category只能出现一次，category只能为“时间线矛盾”“线索缺口”“信息泄漏”“角色贡献”中的一个，不要求每类都有问题；每条evidence为8—500字，proposal为10—500字；verdict只能为“阻断”或“可继续”。\n只返回JSON对象，字段示意（数组内省略号不表示只需一项）：{"findings":[{"category":"时间线矛盾","evidence":"…","proposal":"…"}],"verdict":"阻断"}`,
    grade: (_value, raw) => {
      const parsed = validate(auditSchema, raw); if ("grade" in parsed) return parsed.grade;
      const categories = new Set(parsed.data.findings.map(item => item.category));
      const falsePositives = [...categories].filter(category => !["时间线矛盾", "线索缺口"].includes(category)).length;
      const found = Number(categories.has("时间线矛盾")) + Number(categories.has("线索缺口"));
      const executable = parsed.data.findings.filter(item => /(补充|增加|改为|调整|删除|建立|改写)/.test(item.proposal)).length;
      return { structure: Math.max(0, 100 - falsePositives * 25), evidence: Math.max(0, found * 40 + (parsed.data.verdict === "阻断" ? 10 : 0) + Math.min(10, executable * 5) - falsePositives * 15), originality: 60, format: 100, notes: found === 2 && !falsePositives && executable >= 2 ? ["两处预设问题均有可执行修订方案"] : ["存在漏报、误报或修改方案不可执行"] };
    },
  },
];
