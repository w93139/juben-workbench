/** Development delivery, never a project completion or playtest score. */
export const developmentPhases = [
  { id: "A", name: "基础工作台", delivered: true, status: "用户已验收", scope: "项目、决定状态、本机保存与恢复" },
  { id: "B", name: "材料与创作方案", delivered: true, status: "开发完成", scope: "目录登记、模拟拆解、上下文讨论与方案蓝图" },
  { id: "C", name: "故事蓝图", delivered: true, status: "用户已验收", scope: "整体调整、影响预览、按需细项与蓝图版本" },
  { id: "D", name: "生成与双模型审查", delivered: true, status: "本轮待你测试", scope: "分模块模拟生成、主Agent协调双审、上下文修订" },
  { id: "E", name: "试玩与导出", delivered: false, status: "分类导出已开发，试玩录入待开发", scope: "分类及全包ZIP下载已实现；真人试玩记录待开发" },
] as const;
export const developmentPercent = Math.round(100 * developmentPhases.filter((phase) => phase.delivered).length / developmentPhases.length);
