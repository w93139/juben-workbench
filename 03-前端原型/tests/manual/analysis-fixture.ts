/** Synthetic, non-user material; keep the approved two reads plus one summary. */
export function analysisVerificationDocuments() {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `test-role-${i}`, name: `自有测试角色${i}.txt`,
    text: `【自有验证样例，非用户原剧本】角色${i}在第${i + 1}轮获得记录${i}。角色0负责保管钟表，角色9负责公开原始账册。记录只证明事件顺序，不能单独证明动机。`.padEnd(1400, `校对记录${i}：同一事件须用独立来源交叉核实；不能把推断写成事实。`),
  }));
}
