import { emptyBlueprintData, type BlueprintData } from "@/domain/blueprint";
import type { FolderPlanChoice } from "@/domain/folder-plan";

// Generic, internally linked planning scaffold. Never derived from source file names or bodies.
export function createFolderBlueprint(choice: FolderPlanChoice): BlueprintData {
  const data = emptyBlueprintData();
  const subject = choice.id === "deduction" ? "导航异常与撤离" : choice.id === "emotion" ? "夜校停课与匿名资助" : "闸门故障与修复次序";
  const identities = ["记录保管者", "当时的执行者", "受影响的见证者", "资源协调者", "被误解的知情者", "后来加入的调查者"];
  data.premise = `${choice.premise}\n\n体验：${choice.experience}\n\n${choice.outline.map((text, i) => `第${i + 1}幕：${text}`).join("\n")}\n\n抽象玩法：${choice.mechanism}\n风险：${choice.risk}\n\n通用模拟方案，未分析上传正文；人物姓名、具体年代和事件细节待共同创作。`;
  data.truth = `围绕“${subject}”，一次隐瞒、一次误判和一次资源选择共同造成现在的困境。保管者留存了部分记录，执行者知道采取行动的理由，见证者掌握后果，协调者了解当时约束。没有任何单一口供足以解释全貌。最终必须先核对记录与结果，再决定如何承担代价。此为通用结构草稿，具体动机与事实待作者补充。`;
  data.characters = identities.slice(0, choice.players).map((identity, i) => ({ id: `plan-character-${i + 1}`, name: `角色${i + 1}`, publicIdentity: identity, goal: `从${identity}的立场推动对${subject}的处理，并保护自己承担的责任。`, privateInformation: `掌握事件第${i % 3 + 1}环的一段经历；需要与他人的记录核对，不能独自确定全部真相。`, choice: "公开自己保留的经历，或承担暂不公开对他人的后果。", contribution: `提供第${i % 3 + 1}环核验所需的独立视角，并参与终局资源与责任分配。` }));
  data.relationships = data.characters.map((character, i) => ({ id: `plan-relation-${i + 1}`, fromId: character.id, toId: data.characters[(i + 1) % data.characters.length].id, publicVersion: "曾共同处理过一项任务。", truth: "一方只看到了行动结果，另一方知道行动时的约束。", consequence: "交换经历可以修正归责；隐瞒会改变最终的信任与分配。" }));
  data.events = choice.outline.map((act, i) => ({ id: `plan-event-${i + 1}`, time: ["事发前", "事发时", "事发后"][i], location: "核心事件现场（待命名）", action: ["一份关键信息未能及时公开，后续参与者据此作出错误判断。", "在错误判断和有限资源下执行行动，造成他人未预料的影响。", "记录与后果产生冲突，各方需要交叉核验并决定如何补救。"][i], causes: i ? [`plan-event-${i}`] : [] }));
  const duration = Math.floor(choice.minutes / 3);
  data.rounds = choice.outline.map((act, i) => ({ id: `plan-round-${i + 1}`, name: ["建立视角", "交叉核验", "共同抉择"][i], minutes: i === 2 ? choice.minutes - duration * 2 : duration, activity: act, reveal: `公开事件第${i + 1}环的可核验记录；核验后才开放下一层解释。` }));
  data.claims = data.events.map((event, i) => ({ id: `plan-claim-${i + 1}`, statement: event.action, required: true }));
  data.clues = data.claims.map((claim, i) => ({ id: `plan-clue-${i + 1}`, name: ["信息传递记录", "执行与资源记录", "结果核对清单"][i], content: `待写正文：用可核对的时间、行动和结果支持“${claim.statement}”，不得仅写直接公布谜底的结论。`, supports: [claim.id], roundId: data.rounds[i].id, characterIds: [], cost: 0, access: "本轮主持公开发放，所有玩家均可获得，不需购买。" }));
  data.knowledge = data.characters.flatMap((character, index) => data.events.map((event, i) => ({ id: `plan-knowledge-${index + 1}-${i + 1}`, characterId: character.id, factId: event.id, roundId: data.rounds[i].id, state: "partial" as const, detail: `${character.publicIdentity}知道与自己行动有关的片段；通过本轮公共记录和其他角色信息补足。具体私人片段待补充。` })));
  data.triggers = data.rounds.map((round, i) => ({ id: `plan-trigger-${i + 1}`, roundId: round.id, condition: "每名角色至少分享一项可核验信息，或到达本轮计划时间。", action: `发放${data.clues[i].name}，请玩家指出仍未解释的因果。`, fallback: "无人主动分享时给出信息交换提示，并直接开放必要的公共记录，不锁死推理。" }));
  data.endings = [{ id: "plan-ending-open", name: "公开并共同承担", condition: "关键记录已核对，玩家选择公开。", choice: "决定公开范围与补救资源分配。", consequence: "保留可追溯记录，承担公开造成的关系与资源代价。" }, { id: "plan-ending-limited", name: "有限公开并承担责任", condition: "关键记录已核对，玩家选择保留部分私人经历。", choice: "指定承担责任与补救行动的人，并说明保留信息的理由。", consequence: "私人关系暂时保留，但责任归属和后续信任留下持续影响。" }];
  return data;
}
