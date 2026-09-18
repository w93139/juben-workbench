import { z } from "zod";
import { studioBudgetResponseSchema, studioCostPreviewSchema, studioQuoteSchema } from "@/domain/studio-budget";
import type { StudioOperation } from "@/domain/studio";
import type { WorkbenchState } from "@/domain/workbench";
import { localJson, studioJobInput } from "./studio-client";

export async function readStudioBudget(projectId: string, offset = 0, signal?: AbortSignal) {
  return studioBudgetResponseSchema.parse(await localJson(`/api/studio/budget?projectId=${encodeURIComponent(projectId)}&offset=${offset}`, { signal })).budget;
}
async function budgetAction(body: unknown) {
  return localJson("/api/studio/budget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
export async function saveStudioBudget(projectId: string, capFen: number, revision: number) {
  return studioBudgetResponseSchema.parse(await budgetAction({ action: "configure", projectId, capFen, revision })).budget!;
}
export async function reconcileStudioCharge(projectId: string, callId: string, version: number, actualFen: number, note: string) {
  return studioBudgetResponseSchema.parse(await budgetAction({ action: "reconcile", projectId, callId, version, actualFen, note })).budget!;
}
export async function refreshStudioPrices() {
  return z.object({ quotes: z.array(studioQuoteSchema).min(1).max(3) }).strict().parse(await budgetAction({ action: "prices" })).quotes;
}
export async function previewStudioJob(projectId: string, state: WorkbenchState, operation: StudioOperation) {
  return studioCostPreviewSchema.parse(await budgetAction({ action: "preview", projectId, operation, input: studioJobInput(state, operation) }));
}
