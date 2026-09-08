import type { FolderPlanChoice } from "@/domain/folder-plan";

// Independent generic presets. These are never conclusions extracted from the user's files.
export const folderPlanChoices: FolderPlanChoice[] = [
  { id: "deduction", title: "方向一：悬疑还原", genre: "近未来悬疑", players: 6, minutes: 210,
    experience: "以推理为主，通过不同视角逐步还原事件。", ratios: { deduction: 65, emotion: 20, mechanics: 15 },
    premise: "一座浮岛的导航记录在撤离前夕被篡改，六名值守者需要找出事故因果，并决定是否公开可能阻断救援的真相。",
    outline: ["建立各自的不完整经历，围绕异常导航记录提出最初解释。", "交叉比对维护记录与私人信息，发现多次选择共同造成事故。", "完成因果还原，再决定证据公开范围与救援优先顺序。"],
    mechanism: "分散信息 → 互相核验 → 关键证据解锁；仅借鉴抽象结构。", risk: "必要结论必须有可获得证据；改变人数时要重分私人信息，避免单人垄断关键线索。" },
  { id: "emotion", title: "方向二：关系与抉择", genre: "当代群像", players: 5, minutes: 180,
    experience: "以关系和选择为主，让每个人都能改变结局。", ratios: { deduction: 25, emotion: 60, mechanics: 15 },
    premise: "一间即将关闭的夜校收到最后一笔匿名资助，五位旧成员在整理归还清单时，发现彼此对那次停课有不同理解。",
    outline: ["通过遗留物与归还任务，建立每个人对夜校的记忆和诉求。", "交换私人经历，修正关系误解，辨认各自曾付出的代价。", "决定资助用途与公开的记忆版本，承担对具体关系的后果。"],
    mechanism: "私人信息分轮更新 → 关系重释 → 有后果的共同选择。", risk: "不能依赖强制煽情；每个角色都需要独立目标和影响结局的行动，阅读负担需留给试玩检验。" },
  { id: "interaction", title: "方向三：协商与行动", genre: "架空群岛", players: 6, minutes: 240,
    experience: "以协商和行动为主，在有限资源下形成不同联盟。", ratios: { deduction: 30, emotion: 20, mechanics: 50 },
    premise: "群岛的潮汐闸门即将失灵，六位代表掌握不同检修记录和资源，需要在风暴到来前共同决定修复次序。",
    outline: ["分配公开资源与私人约束，提出各自的检修优先级。", "行动开放新证据并改变谈判条件，识别看似互斥方案的因果联系。", "核实修复方案并共同执行，资源选择形成不同代价的结局。"],
    mechanism: "行动获得证据 → 资源制约协商 → 集体决策改变结果。", risk: "资源不能锁死必要证据；主持触发条件需有兜底，玩家人数与时长变化可能放大等待。" },
];
export const folderArchitecture = [
  { title: "真相与因果", detail: "识别真正发生的事、关键动机，以及事件怎样互相影响。" },
  { title: "时间线", detail: "整理事件先后、角色行踪和需要核对的时间冲突。" },
  { title: "人物与关系", detail: "整理角色目标、秘密、重要关系和有后果的选择。" },
  { title: "信息分配", detail: "区分每名玩家在每一轮知道、误解和暂时不知道的事。" },
  { title: "线索与结论", detail: "连接必要结论、支持证据和玩家获得线索的方式。" },
  { title: "轮次与体验节奏", detail: "整理每轮行动、揭示时机、主持触发条件和终局选择。" },
];
