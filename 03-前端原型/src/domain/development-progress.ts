/** Development delivery, never a project completion or playtest score. */
export const developmentPhases = [
  { id: "A", name: "基础工作台", delivered: true, status: "用户已验收", scope: "项目、决定状态、本机保存与恢复" },
  { id: "B", name: "材料与创作方案", delivered: true, status: "开发完成", scope: "材料登记、模拟研究、五步界面和集中确认" },
  { id: "C", name: "故事蓝图", delivered: true, status: "用户已验收", scope: "结构编辑、关系与线索检查、蓝图版本" },
  { id: "D", name: "生成与双模型审查", delivered: true, status: "本轮待你测试", scope: "分模块模拟生成、双模型意见、修改与复查" },
  { id: "E", name: "试玩与导出", delivered: false, status: "待开发", scope: "试玩记录、玩家与主持预览、模拟导出" },
] as const;
export const developmentPercent = Math.round(100 * developmentPhases.filter((phase) => phase.delivered).length / developmentPhases.length);
