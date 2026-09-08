import type { BlueprintData } from "@/domain/blueprint";
import type { Artifact, ProductionModule, ReviewFinding, ReviewModelId } from "@/domain/production";

const notice = "> 模板模拟 / 待补充：按蓝图字段组装，尚未经过真实AI生成或真人试玩。\n\n";
type DraftArtifact = Pick<Artifact, "logicalKey" | "module" | "title" | "audience" | "characterId" | "roundId" | "content">;
/** Explicit projection: player drafts never inherit truth/event/relationship/host fields. */
export function mockArtifacts(data: BlueprintData, module: ProductionModule): DraftArtifact[] {
  const result: DraftArtifact[] = [];
  const add = (key: string, title: string, body: string, characterId: string | null = null, roundId: string | null = null, audience: "player" | "host" = "player") => result.push({ logicalKey: `${module}:${key}`, module, title, audience, characterId, roundId, content: notice + `# ${title}\n\n` + body });
  if (module === "character") data.characters.forEach((c) => add(c.id, `${c.name} · 角色本`, `身份：${c.publicIdentity}\n\n个人目标：${c.goal}\n\n你的选择：${c.choice}\n\n你能推动的事情：${c.contribution}\n\n[待补充：角色叙事正文]`, c.id));
  if (module === "private") data.characters.forEach((c) => add(c.id, `${c.name} · 私人信息`, `仅交给本角色阅读。\n\n${c.privateInformation}\n\n[待补充：个人行动提示]`, c.id));
  if (module === "updates") data.characters.forEach((c) => data.rounds.forEach((r) => {
    const visible = data.knowledge.filter((k) => k.characterId === c.id && k.roundId === r.id && ["known", "partial", "false", "hidden"].includes(k.state));
    if (visible.length) add(`${c.id}:${r.id}`, `${c.name} · ${r.name}`, `仅在本轮交给本角色。\n\n${visible.map((k) => k.detail).join("\n\n")}\n\n[待补充：本轮行动]`, c.id, r.id);
  }));
  if (module === "clues") data.clues.filter((c) => c.characterIds.length === 0 && c.access.trim() && data.rounds.some((r) => r.id === c.roundId)).forEach((c) => add(c.id, c.name, `${c.content}\n\n[待补充：排版与发放复核]`, null, c.roundId || null));
  if (module === "host") add("manual", "主持人手册", `仅主持人可读，含谜底。\n\n客观真相：${data.truth}\n\n事件与触发：\n${[
      "## 客观时间线", ...data.events.map((e) => `${e.time} · ${e.location}：${e.action}\n前因编号：${e.causes.join("、") || "无"}`),
      "## 轮次安排", ...data.rounds.map((r) => `${r.name}（${r.minutes}分钟）\n玩家行动：${r.activity}\n本轮揭示：${r.reveal}`),
      "## 主持触发", ...data.triggers.map((t) => `所属轮次：${data.rounds.find((r) => r.id === t.roundId)?.name || "待关联"}\n何时触发：${t.condition}\n主持操作：${t.action}\n未触发时：${t.fallback}`),
      "## 限定读者线索", ...data.clues.filter((c) => c.characterIds.length > 0).map((c) => `${c.name}\n交给：${c.characterIds.map((id) => data.characters.find((character) => character.id === id)?.name || "待关联角色").join("、")}\n所属轮次：${data.rounds.find((r) => r.id === c.roundId)?.name || "待关联"}\n获取方式：${c.access || "待补充"}\n内容：${c.content}`),
    ].join("\n\n")}`, null, null, "host");
  if (module === "ending") add("endings", "终局主持材料", `仅主持人可读；玩家版须另行审定。\n\n${data.endings.map((e) => `${e.name}\n触发：${e.condition}\n选择：${e.choice}\n后果：${e.consequence}`).join("\n\n")}\n\n[待补充：玩家终局宣读稿]`, null, null, "host");
  return result;
}

/** Preset demonstrations, not semantic judgments or real model results. */
export function mockReviewOpinions(target: "blueprint" | "manuscript", source: { location: string; excerpt: string; artifactId: string | null }, modelId: ReviewModelId): Omit<ReviewFinding, "id">[] {
  return [{
    title: "模拟意见：核对玩家理解与主持发放", severity: "warning", category: "主持执行歧义", agreement: "consensus", evidence: source,
    suggestion: target === "blueprint" ? "请作者逐轮核对触发条件、玩家可获得信息及未触发时的处理，再保存新的蓝图版本。" : "请作者在正文编辑框中补充发放时机，并保留原有读者范围；保存新版本后重新审查。",
    modelOpinions: [{ modelId, opinion: "预设模拟意见：建议作者核对发放对象和时机；尚未进行语义判断。" }], decision: "unhandled", reason: "",
  }, {
    title: "模拟分歧：是否现在增加提示", severity: "info", category: "节奏风险", agreement: "disagreement", evidence: source,
    suggestion: "这是用于练习取舍的预设分歧。请作者记录决定及理由，实际效果留待真人试玩。",
    modelOpinions: [{ modelId, opinion: modelId === "model-a" ? "预设模拟立场A：可先补充提示，方便主持执行。" : "预设模拟立场B：可暂缓增加提示，试玩后根据卡点决定。" }], decision: "unhandled", reason: "",
  }];
}
