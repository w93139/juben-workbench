import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import type { StudioBudget, StudioQuote } from "../../src/domain/studio-budget";

export function budgetFixture(projectId: string, capFen = 10000): StudioBudget {
  return { projectId, revision: 1, ledgerRevision: 1, capFen, spentFen: 0, reservedFen: 0, uncertainFen: 0, uncertainCalls: 0, remainingFen: capFen, overrunFen: 0, totalCalls: 0, offset: 0, calls: [] };
}
export const testQuotes = (): StudioQuote[] => ["main", "review-a", "review-b"].map(modelId => ({ provider: "ant", baseUrl: "https://maas-api.antdigital.com/v1", modelId, currency: "CNY", inputPriceMicroCnyPerMillion: 1_000_000, outputPriceMicroCnyPerMillion: 2_000_000, checkedAt: Date.now(), expiresAt: Date.now() + 600000 }));
export async function installBudgetFixture(surface: Page | BrowserContext, defaultCap: number | null = 10000) {
  const budgets = new Map<string, StudioBudget>();
  const controls = { failReconcile: false, failPreview: false, failRead: false, previews: 0, writes: 0 };
  const get = (id: string) => {
    if (!budgets.has(id) && defaultCap != null) budgets.set(id, budgetFixture(id, defaultCap));
    return budgets.get(id) ?? null;
  };
  await surface.route("**/api/studio/budget**", async route => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill(controls.failRead ? { status: 503, json: { error: "自造读取失败" } } : { json: { budget: get(new URL(request.url()).searchParams.get("projectId")!) } });
    const body = request.postDataJSON();
    const budget = body.projectId ? get(body.projectId) : null;
    if (body.action === "prices") return route.fulfill({ json: { quotes: testQuotes() } });
    if (body.action === "preview") {
      controls.previews++;
      if (!budget || controls.failPreview) return route.fulfill({ status: 409, json: { error: "无法核对有效报价，未调用模型。" } });
      return route.fulfill({ json: { projectId: body.projectId, operation: body.operation, previewId: randomUUID(), budget, quotes: testQuotes(), callsMax: body.operation === "review" ? 7 : 1, estimateFen: 50 } });
    }
    if (body.action === "configure") {
      controls.writes++;
      if ((budget?.revision ?? 0) !== body.revision) return route.fulfill({ status: 409, json: { error: "预算已由另一个页面修改，输入已保留。" } });
      const next = budget ?? { ...budgetFixture(body.projectId), revision: 0, ledgerRevision: 0 };
      next.capFen = body.capFen; next.revision++; next.ledgerRevision++; next.remainingFen = Math.max(0, next.capFen - next.spentFen - next.reservedFen - next.uncertainFen);
      budgets.set(body.projectId, next); return route.fulfill({ json: { budget: next } });
    }
    if (body.action === "reconcile" && budget) {
      if (controls.failReconcile) return route.fulfill({ status: 409, json: { error: "费用记录已变化，请重新核对。" } });
      const call = budget.calls.find(call => call.callId === body.callId);
      if (!call || call.version !== body.version || call.state !== "uncertain") return route.fulfill({ status: 409, json: { error: "费用记录已变化" } });
      budget.uncertainFen -= call.reservedFen; budget.uncertainCalls--; budget.spentFen += body.actualFen; budget.ledgerRevision++;
      call.state = "reconciled"; call.actualFen = body.actualFen; call.version++; call.note = body.note;
      return route.fulfill({ json: { budget } });
    }
    return route.fulfill({ status: 400, json: { error: "不支持的预算操作" } });
  });
  return { budgets, controls };
}
/** Make the new user-visible fee confirmation explicit in existing behavior tests. */
export async function confirmStudioCost(page: Page) {
  await page.getByRole("dialog", { name: "本次创作费用" }).getByRole("button", { name: "按项目额度开始" }).click();
}
