/** Version changes invalidate old paid previews and incompatible checkpoints. */
export const REVIEW_PROTOCOL = "review-checkpoints/1";
export const reviewUnits = [
  { id: "designGate", label: "蓝图检查", role: "main", dependencies: [] },
  { id: "artifacts", label: "正文材料", role: "main", dependencies: ["designGate"] },
  { id: "independentA", label: "独立检查A", role: "reviewA", dependencies: ["artifacts"] },
  { id: "independentB", label: "独立检查B", role: "reviewB", dependencies: ["artifacts"] },
  { id: "mutualA", label: "相互核对A", role: "reviewA", dependencies: ["independentA", "independentB"] },
  { id: "mutualB", label: "相互核对B", role: "reviewB", dependencies: ["independentA", "independentB"] },
  { id: "coordinator", label: "主模型复核", role: "main", dependencies: ["mutualA", "mutualB"] },
] as const;
export type ReviewUnitId = (typeof reviewUnits)[number]["id"];
