import { createHash } from "node:crypto";
import { z } from "zod";
import { evaluationResponseProfile } from "@/domain/model-evaluation";
import type { BlueprintData } from "@/domain/blueprint";
import { studioArtifactSchema, studioAuditSchema, type StudioArtifact, type StudioReviewResult } from "@/domain/studio";
import type { StudioConfig } from "./studio-models";
import type { StudioProductionStore } from "./studio-production-store";
import { artifactInstructions, artifactPayload, artifactPlanDigest, type ArtifactPlan } from "./artifact-plan";
import { artifactIssues, reviewContractIssues } from "./studio-review-contract";

export const auditInstructions = {
  designGate: "按剧本设计六道门检查蓝图内容，而不只看字段是否非空。核对每角色贡献与关系、时间因果、知识来源、必要结论可获得证据、轮次主持兜底。未成形内容必须阻断。给原文定位和摘录，所有真人试玩状态not-run。",
  independent: "独立审核整个蓝图和全部正文，核对语义完整性、时间线、证据可获得性、角色贡献、泄漏、主持可执行性及正文是否只是提纲。仅有schema不能通过。逐项给真实原文定位和摘录。任何未解决问题写blocking；不确定的体验写warnings且待真人试玩。contentComplete/playerHostIsolation/findingsAddressed必须诚实。",
  mutual: "逐条复核另一模型报告并回到冻结的原文资料。不能因模型一致或声称运行脚本就采信，需核对引用和规则是否忠实。保留或驳回意见必须给证据；不能用多数票消除阻断。若自己或对方任何阻断仍未解决，写入blocking。不得改写原文以假装修复。",
  coordinator: "最终按原文证据核对两路独审和互审，不能按票数判定。检查正文完整而非摘要，受众隔离，证据规则和未解决阻断。没有实际修改资料不得把旧问题写成已修复。体验效果仍待真人试玩。",
};
export function reviewRequestFingerprint(model: string, instructions: string, payload: unknown, schema: z.ZodType) {
  return createHash("sha256").update(JSON.stringify([model, instructions, payload, z.toJSONSchema(schema), evaluationResponseProfile(model)])).digest("hex");
}
/** Inspection never changes checkpoints, calls a model or grants export authority. */
export function inspectProductionReuse(plan: ArtifactPlan, saved: ReturnType<StudioProductionStore["snapshot"]> | null | undefined, blueprint: BlueprintData, config: StudioConfig) {
  const totalUnits = plan.targets.length + 6;
  const valid = new Set<string>();
  const reports: StudioReviewResult["reports"] = {};
  const artifacts: StudioArtifact[] = [];
  if (saved?.plan && artifactPlanDigest(saved.plan) === artifactPlanDigest(plan)) {
    const check = (id: string, model: string, instructions: string, payload: unknown, schema: z.ZodType): unknown => {
      const unit = saved.units.find(unit => unit.id === id);
      if (!unit?.saved || unit.requestHash !== reviewRequestFingerprint(model, instructions, payload, schema)) return undefined;
      const parsed = schema.safeParse(unit.value);
      if (!parsed.success || reviewContractIssues(id, parsed.data, payload).length) return undefined;
      valid.add(id); return parsed.data;
    };
    const gate = check("designGate", config.mainModel, auditInstructions.designGate, { blueprint }, studioAuditSchema);
    if (gate) reports.designGate = studioAuditSchema.parse(gate);
    for (const target of plan.targets) {
      const value = check(target.id, config.mainModel, artifactInstructions, artifactPayload(blueprint, target), studioArtifactSchema);
      if (value) artifacts.push(studioArtifactSchema.parse(value));
    }
    if (artifacts.length === plan.targets.length && !artifactIssues(blueprint, artifacts).length) {
      const snapshot = { blueprint, artifacts };
      for (const id of ["independentA", "independentB", "mutualA", "mutualB", "coordinator"] as const) {
        const model = id === "coordinator" ? config.mainModel : id.endsWith("A") ? config.reviewA : config.reviewB;
        if ((id.startsWith("mutual") || id === "coordinator") && (!reports.independentA || !reports.independentB)) continue;
        if (id === "coordinator" && (!reports.designGate || !reports.mutualA || !reports.mutualB)) continue;
        const instructions = id === "coordinator" ? auditInstructions.coordinator : id.startsWith("mutual") ? auditInstructions.mutual : auditInstructions.independent;
        const payload = id === "coordinator" ? { snapshot, reports: { ...reports } } : id.startsWith("mutual") ? { snapshot, own: id.endsWith("A") ? reports.independentA : reports.independentB, other: id.endsWith("A") ? reports.independentB : reports.independentA } : snapshot;
        const value = check(id, model, instructions, payload, studioAuditSchema);
        if (value) reports[id] = studioAuditSchema.parse(value);
      }
    }
  }
  const paidIds = new Set(["designGate", ...plan.targets.map(target => target.id), "independentA", "independentB", "mutualA", "mutualB", "coordinator"]);
  return { runId: saved?.runId ?? null, totalUnits, savedUnits: valid.size, interruptedUnits: saved?.units.filter(unit => paidIds.has(unit.id) && !valid.has(unit.id)).length ?? 0, allCached: valid.size === totalUnits };
}
