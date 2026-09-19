import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioEngine, openAITransport, type ModelTransport } from "@/server/studio-models";
import { StudioJobStore } from "@/server/studio-job-store";
import { StudioBilling } from "@/server/studio-billing";
import { StudioPrices } from "@/server/studio-pricing";
import { previewStudioCost } from "@/server/studio-cost-preview";
import { reviewContractIssues } from "@/server/studio-review-contract";
import { studioArtifactSchema, studioReviewResultSchema, type StudioScopedAudit } from "@/domain/studio";
import { plannedArtifact, reviewAudit, reviewBlueprint } from "../fixtures/studio-review";

const config = { baseUrl: "https://maas-api.antdigital.com/v1", apiKey: "test-synthetic-only", mainModel: "main", reviewA: "review-a", reviewB: "review-b" };
const power = async () => ({ assertActive() {}, async release() {} });
const input = () => ({ blueprint: reviewBlueprint() });
const roots: string[] = [], stores: StudioJobStore[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function wait(engine: StudioEngine, id: string) { for (let index = 0; index < 5000; index++) { const view = engine.get(id); if (view.status !== "running") return view; await new Promise(resolve => setImmediate(resolve)); } throw new Error("not settled"); }
function response(payload: unknown, artifact: boolean) {
  if (artifact) return { ...plannedArtifact(payload as Parameters<typeof plannedArtifact>[0]), content: "自造正文用于完整覆盖。".repeat(3300) };
  const scoped = payload as { sources?: { partId: string; hash: string; content: string }[] };
  return { ...reviewAudit(), ...(scoped.sources ? { coverage: scoped.sources.map(source => ({ partId: source.partId, hash: source.hash, quote: source.content.slice(0, 12) })) } : {}) };
}
const fake: ModelTransport = async (_config, _model, _instructions, payload, schema) => response(payload, schema === studioArtifactSchema);
const database = (path = ":memory:") => { const store = new StudioJobStore(path); stores.push(store); return store; };
const engine = (store: StudioJobStore, transport = fake) => new StudioEngine(() => config, transport, Date.now, store, power);

it("长篇首次只生成并保存，重新预览后完整五路原文覆盖、旧预览零调用拒绝、账本与免费复用一致", async () => {
  const store = database(); store.budget.configure("segmented", 1000000, 0);
  const prices = new StudioPrices(vi.fn<typeof fetch>(async () => Response.json({ success: true, data: { items: ["main", "review-a", "review-b"].map(name => ({ name, inPrice: "¥1/M", outPrice: "¥2/M", status: "RELEASED", type: "TEXT_GENERATE", offShelfFlag: 0, modelProtocolCompatibility: { openai_chat_completions: true }, protocolParameters: [{ protocolName: "openai_chat_completions", parameters: { response_format: true } }] })) } })));
  const billing = new StudioBilling(store.budget, prices), service = new StudioEngine(() => config, openAITransport, Date.now, store, power, billing);
  const seen: { model: string; sourceIds: string[]; instruction: string }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)), payload = JSON.parse(body.messages[1].content);
    if (payload.sources) seen.push({ model: body.model, sourceIds: payload.sources.map((source: { partId: string }) => source.partId), instruction: body.messages[0].content });
    return Response.json({ model: body.model, usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(response(payload, !!payload.target)) } }] });
  }); vi.stubGlobal("fetch", fetcher);
  const preview = () => previewStudioCost(billing, config, "segmented", "review", input(), store.production);
  const old = await preview(), firstPreview = await preview();
  const start = (previewId: string, revision = 1) => service.start("review", input(), randomUUID(), { projectId: "segmented", revision, previewId });
  const first = await wait(service, (await start(firstPreview.previewId)).jobId);
  expect(first.error?.code).toBe("REVIEW_PLAN_READY"); expect(seen).toHaveLength(0); expect(fetcher).toHaveBeenCalledTimes(11);
  const original = first.reviewProgress!.review.artifacts;
  expect(Buffer.byteLength(JSON.stringify(original))).toBeGreaterThan(600000);
  expect(first.reviewProgress!.review.segmented!.units.every(unit => unit.state === "pending")).toBe(true);
  await expect(start(old.previewId)).rejects.toThrow("费用预览"); expect(fetcher).toHaveBeenCalledTimes(11);
  const p = await preview(); expect(p.reviewMode).toBe("segmented"); expect(p.callsMax).toBe(first.reviewProgress!.review.segmented!.plan.callsMax + 11);
  expect(p.checkpoint!.totalUnits).toBeGreaterThan(246);
  const completed = await wait(service, (await start(p.previewId)).jobId);
  expect(completed.status).toBe("completed"); if (completed.result?.kind !== "review") throw new Error(JSON.stringify(completed.error));
  expect(completed.result.passed).toBe(true); expect(completed.result.artifacts).toEqual(original); expect(studioReviewResultSchema.safeParse(completed.result).success).toBe(true);
  const segmented = completed.result.segmented!;
  expect(seen).toHaveLength(segmented.plan.callsMax);
  for (const part of segmented.plan.parts) {
    expect(seen.filter(call => call.sourceIds.length === 1 && call.sourceIds[0] === part.id).map(call => call.model).sort()).toEqual(["main", "review-a", "review-a", "review-b", "review-b"]);
  }
  expect(fetcher).toHaveBeenCalledTimes(p.callsMax); expect(store.budget.snapshot("segmented")!.totalCalls).toBe(p.callsMax);
  store.budget.configure("segmented", p.callsMax, 1);
  const cached = await preview(); expect(cached.checkpoint?.allCached).toBe(true); expect(cached.budget.remainingFen).toBe(0);
  const snapshots = vi.spyOn(store.production, "snapshot");
  expect((await wait(service, (await start(cached.previewId, 2)).jobId)).status).toBe("completed"); expect(fetcher).toHaveBeenCalledTimes(p.callsMax);
  expect(snapshots.mock.calls.length).toBeLessThan(10);
  const tampered = structuredClone(completed.result); tampered.segmented!.units.pop(); expect(studioReviewResultSchema.safeParse(tampered).success).toBe(false);
}, 60000);

it("某段B失败而A已保存，关闭重开数据库仅补缺项且早期阻断不能被最终通过抹除", async () => {
  const root = mkdtempSync(join(tmpdir(), "segmented-db-")); roots.push(root); const path = join(root, "jobs.sqlite"), store = database(path);
  let fail = true, scope: string | undefined;
  const call = vi.fn<ModelTransport>(async (...args) => {
    const payload = args[3] as { scope?: { id: string }; sources?: unknown[]; reports?: object };
    if (payload.scope) {
      scope ??= payload.scope.id;
      if (payload.scope.id === scope && args[1] === config.reviewB && args[2].includes("独立审核") && fail) throw new Error("synthetic B failure");
      if (payload.scope.id === scope && args[1] === config.reviewA && args[2].includes("独立审核")) return { ...response(payload, false), blocking: ["前段角色动机矛盾未修复"] };
    }
    return fake(...args);
  });
  const service = engine(store, call); await wait(service, (await service.start("review", input(), randomUUID())).jobId);
  const failed = await wait(service, (await service.start("review", input(), randomUUID())).jobId);
  expect(failed.status).toBe("failed"); expect(failed.reviewProgress!.review.segmented!.units[0].state).toBe("saved");
  expect(failed.reviewProgress!.review.segmented!.units[1].state).toBe("interrupted");
  const count = call.mock.calls.length; stores.splice(stores.indexOf(store), 1); store.close(); fail = false;
  const reopened = database(path), restarted = engine(reopened, call);
  expect(restarted.get(failed.jobId).reviewProgress?.review.segmented?.units[0].state).toBe("saved");
  const done = await wait(restarted, (await restarted.start("review", input(), randomUUID())).jobId);
  expect(done.status).toBe("completed"); if (done.result?.kind !== "review") throw new Error("missing review");
  expect(done.result.passed).toBe(false); expect(done.result.validationId).toBeUndefined(); expect(done.result.segmented!.units[0].report!.blocking).toEqual(["前段角色动机矛盾未修复"]);
  expect(call.mock.calls.slice(count).some(args => args[4] === studioArtifactSchema)).toBe(false);
  expect(call.mock.calls.filter(args => (args[3] as { scope?: { id: string } }).scope?.id === scope && args[1] === config.reviewA && args[2].includes("独立审核"))).toHaveLength(1);
}, 60000);

it("范围覆盖、哈希、原文引用和报告容量独立校验，同伴报告不能成为原文证据", () => {
  const source = { partId: "part-a", hash: "a".repeat(64), content: "真实输入段落" }, payload = { blueprint: reviewBlueprint(), sources: [source], reports: { own: "仅出现在模型报告中的幻觉" } };
  const valid = response(payload, false) as StudioScopedAudit;
  expect(reviewContractIssues("sr-test", valid, payload)).toEqual([]);
  expect(reviewContractIssues("sr-test", { ...valid, coverage: [{ ...valid.coverage[0], hash: "b".repeat(64) }] }, payload).join()).toContain("覆盖");
  expect(reviewContractIssues("sr-test", { ...valid, evidence: [{ location: "报告", quote: payload.reports.own, conclusion: "不实" }] }, payload).join()).toContain("引用");
  expect(reviewContractIssues("sr-test", { ...valid, warnings: Array.from({ length: 10 }, () => "长".repeat(2000)) }, payload).join()).toContain("40000");
});

it("不可交付的最大报告计划在任何分段付费前拒绝，正文保留且再次尝试不能绕过", async () => {
  const store = database(), bp = reviewBlueprint();
  bp.rounds = Array.from({ length: 4 }, (_, index) => ({ ...bp.rounds[0], id: `R${index + 1}`, name: `第${index + 1}轮` }));
  const call = vi.fn<ModelTransport>(async (_c, _m, _i, payload, schema) => schema === studioArtifactSchema ? { ...plannedArtifact(payload as Parameters<typeof plannedArtifact>[0]), content: "长".repeat(120000) } : reviewAudit());
  const service = engine(store, call), first = await wait(service, (await service.start("review", { blueprint: bp }, randomUUID())).jobId);
  expect(first.error?.message).toContain("64 MiB"); expect(first.reviewProgress!.review.artifacts.length).toBeGreaterThan(10);
  const count = call.mock.calls.length; expect(call.mock.calls.some(args => (args[3] as { scope?: unknown }).scope)).toBe(false);
  const again = await wait(service, (await service.start("review", { blueprint: bp }, randomUUID())).jobId);
  expect(again.error?.message).toContain("64 MiB"); expect(call).toHaveBeenCalledTimes(count);
  expect(again.reviewProgress!.review.artifacts).toEqual(first.reviewProgress!.review.artifacts);
}, 60000);
