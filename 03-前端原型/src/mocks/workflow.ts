import type { WorkflowStage } from "@/domain/models";

export const workflow: WorkflowStage[] = [
  { id: "materials", name: "材料中心", shortName: "整理材料", purpose: "先看清手中有什么，再判断还能分析什么。", outcome: "材料清单、阅读范围与识别问题", nextPhase: "B" },
  { id: "analysis", name: "参考本拆解", shortName: "拆解参考", purpose: "把故事拆成事实、信息、关系与玩家行动。", outcome: "带有来源依据的参考本拆解", nextPhase: "B" },
  { id: "mechanisms", name: "机制提炼", shortName: "提炼机制", purpose: "留下促成玩家互动的抽象方法，重建具体故事。", outcome: "机制取舍、迁移前提与风险", nextPhase: "B" },
  { id: "direction", name: "原创方向", shortName: "确定方向", purpose: "确定想写给谁、写什么，以及希望玩家经历什么。", outcome: "人数、题材、时长与体验约定", nextPhase: "B" },
  { id: "blueprint", name: "原创蓝图", shortName: "搭建蓝图", purpose: "让人物、事件和证据先在同一份底稿里成立。", outcome: "人物、关系、时间线、信息与证据体系", nextPhase: "C" },
  { id: "generation", name: "正文生成", shortName: "生成正文", purpose: "把共同底稿转成每位玩家与主持人各自的材料。", outcome: "角色本、私人信息、线索和主持手册", nextPhase: "D" },
  { id: "review", name: "审查中心", shortName: "检查修订", purpose: "每一个问题都能找到证据，每一次修订都有依据。", outcome: "带版本与证据位置的问题清单", nextPhase: "D" },
  { id: "playtest", name: "真人试玩", shortName: "记录试玩", purpose: "把真实玩家的卡点和选择，带回下一次修订。", outcome: "实际时长、参与程度、证据路径与反馈", nextPhase: "E" },
  { id: "export", name: "成品与导出", shortName: "整理成品", purpose: "检查每份材料的收件人，再准备下一场开本。", outcome: "按受众和阶段整理的开本包", nextPhase: "E" },
];
