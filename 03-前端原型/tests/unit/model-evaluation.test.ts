import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluationViewSchema } from "@/domain/model-evaluation";
import { EvaluationBudgetLedger } from "@/server/evaluation-budget";
import { antEvaluationTransport, ModelEvaluationEngine, type EvaluationTransport } from "@/server/model-evaluation";
import { RESEARCH_SELECTION_POLICY } from "@/domain/model-shortlist";
import { discoverAntModels } from "@/server/model-discovery";
import { StudioSettingsStore } from "@/server/studio-settings";

const roots: string[] = [];
// Engine regression fixtures retain their synthetic candidate pool. Production discovery is tested separately.
const fixtureDiscovery: typeof discoverAntModels = (connection, call, signal, preferred, excluded) => discoverAntModels(connection, call, signal, preferred, excluded, { ids: ["cheap-c", "premium", "cheap-a", "cheap-b", "cheap-d", "cheap-e", "legacy-bad"], initialCount: 4 });
const modelIds = ["premium", "cheap-a", "cheap-b", "cheap-c"];
const catalogItem = (name: string, index: number) => ({ name, displayName: name, provider: `P${index}`, status: "RELEASED", contextLength: 128000, inPrice: `¥${index + 1}/M`, outPrice: `¥${index + 2}/M`, type: "TEXT_GENERATE", offShelfFlag: 0, modelProtocolCompatibility: { openai_chat_completions: true }, protocolParameters: [{ protocolName: "openai_chat_completions", parameters: { response_format: true } }] });
const fetcher = async (input: string | URL | Request) => String(input).endsWith("/models") ? Response.json({ data: modelIds.map(id => ({ id })) }) : Response.json({ success: true, data: { items: modelIds.map(catalogItem) } });
const transport: EvaluationTransport = async (_connection, _model, _system, prompt) => {
  const content = prompt.includes("测试片段")
    ? { facts: [{ statement: "顾遥完成钥匙交接", sourceQuote: "21:40，顾遥把钥匙交给林川", kind: "明确事实" }, { statement: "监控记录林川仍在北厅", sourceQuote: "22:10，监控记录林川仍在北厅", kind: "明确事实" }, { statement: "北厅门锁已经内部反锁", sourceQuote: "22:05，北厅门锁已从内部反锁", kind: "明确事实" }], inferences: [{ statement: "反锁时间与监控位置之间存在需要解释的矛盾", supportQuotes: ["22:05，北厅门锁已从内部反锁", "22:10，监控记录林川仍在北厅"] }], causalChain: ["21:40交接钥匙", "22:05北厅反锁", "22:10监控仍见林川"], unknowns: ["监控时钟是否准确"] }
    : prompt.includes("全新的中文")
      ? { title: "潮汐账本", premise: "海上研究站即将沉没，每个人持有不同撤离记录，公开时机会改变同伴的信任与救援决定。", playerBehaviors: ["决定公开记录的先后顺序", "根据信任关系交换局部记录"], originalChanges: ["重建全部人物身份与角色关系", "重建每个人隐瞒记录的个人动机", "重建研究站撤离事件及完整因果", "重建分轮获得的信息与证据线索"], risks: ["公开信息过多可能造成阅读拥堵", "强势玩家可能垄断公开顺序"] }
      : { findings: [{ category: "时间线矛盾", evidence: "停电后摄像头仍确认行动", proposal: "补充备用电源或改为人工目击" }, { category: "线索缺口", evidence: "必要结论没有任何支持线索", proposal: "增加可获得的门禁与痕迹线索" }], verdict: "阻断" };
  return { content: JSON.stringify(content), promptTokens: 300, completionTokens: 200, latencyMs: 10 };
};
function setup(customTransport = transport) {
  const root = mkdtempSync(join(tmpdir(), "model-evaluation-")); roots.push(root);
  const settings = new StudioSettingsStore(join(root, "settings")); settings.save({ revision: 0, baseUrl: "https://maas-api.antdigital.com/v1", apiKey: "test-only", mainModel: "", reviewA: "", reviewB: "" }, {});
  return { root, settings, engine: new ModelEvaluationEngine(settings, customTransport, () => new EvaluationBudgetLedger(join(root, "budget.sqlite")), () => {}, fixtureDiscovery) };
}
async function finished(engine: ModelEvaluationEngine) { for (let attempt = 0; attempt < 100; attempt++) { const view = engine.get(); if (!["running", "cancelling"].includes(view.status)) return view; await new Promise(resolve => setTimeout(resolve, 2)); } throw new Error("evaluation did not finish"); }
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("剧本领域小样测评", () => {
  it("忽略接口后续增加的展示字段，避免已打开页面因加字段中断", () => {
    const parsed = evaluationViewSchema.parse({
      status: "idle", phase: "尚未读取候选模型", connectionRevision: 0,
      priceCheckedAt: null, updatedAt: Date.now(), budgetCapFen: 1000,
      spentFen: 0, reservedFen: 0, uncertainFen: 0, candidates: [], scores: [],
      allocation: null, completedCalls: 0, maximumCalls: 0, plannedMaximumFen: 0,
      error: null, futureDisplayField: "可安全忽略",
    });
    expect(parsed).not.toHaveProperty("futureDisplayField");
  });
  it("允许三次候选替换累计保存超过四条排除记录", () => {
    const excludedModels = Array.from({ length: 16 }, (_, index) => ({ modelId: `excluded-${index}`, displayName: `排除候选${index}`, reason: "响应不兼容", costFen: 1, usageEstimated: false, occurredAt: Date.now() }));
    const parsed = evaluationViewSchema.parse({ status: "blocked", phase: "等待替换候选", connectionRevision: 1, priceCheckedAt: Date.now(), updatedAt: Date.now(), budgetCapFen: 1000, spentFen: 16, reservedFen: 0, uncertainFen: 0, candidates: [], scores: [], taskResults: [], excludedModels, allocation: null, completedCalls: 0, maximumCalls: 48, plannedMaximumFen: 0, resumeCount: 3, resumeAllowed: false, error: "候选已用尽" });
    expect(parsed.excludedModels).toHaveLength(16);
  });
  it("发现阶段零内容调用，付费阶段记录用量并自动分配三个不同模型", async () => {
    const { settings, engine } = setup(); const discovered = await engine.discover(fetcher as typeof fetch);
    expect(discovered).toMatchObject({ status: "discovered", completedCalls: 0, maximumCalls: 12, spentFen: 0 });
    engine.start(); const done = await finished(engine);
    expect(done.status).toBe("completed"); expect(done.completedCalls).toBe(12); expect(done.spentFen).toBeGreaterThan(0); expect(done.spentFen).toBeLessThanOrEqual(1000);
    expect(new Set(Object.values(done.allocation!)).size).toBe(3); expect(settings.safe({}).configured).toBe(true);
  });
  it("旧候选计划不能用900 Token预留直接启动4096 Token测评", async () => {
    const { root, settings, engine } = setup(); const discovered = await engine.discover(fetcher as typeof fetch); const file = join(root, "budget.sqlite"); const value = new EvaluationBudgetLedger(file);
    value.saveView("ant-model-selection-v1", JSON.stringify({ ...discovered, responsePolicyVersion: null, viewRevision: discovered.viewRevision + 1 })); value.close();
    const restored = new ModelEvaluationEngine(settings, transport, () => new EvaluationBudgetLedger(file), () => {}, fixtureDiscovery); expect(() => restored.start()).toThrow("免费重新读取候选模型");
  });
  it("调用失败后将最高费用列为待核对并停止后续调用", async () => {
    const { engine } = setup(async () => { throw new DOMException("timeout", "AbortError"); }); await engine.discover(fetcher as typeof fetch); engine.start(); const done = await finished(engine);
    expect(done.status).toBe("blocked"); expect(done.completedCalls).toBe(0); expect(done.uncertainFen).toBeGreaterThan(0); expect(done.allocation).toBeNull();
  });
  it("用户续测时保留已完成得分，只补做剩余候选", async () => {
    let calls = 0; const successful = new Map<string, number>();
    const interrupted: EvaluationTransport = async (...args) => { calls++; if (calls === 5) throw new DOMException("upstream ended", "AbortError"); const key = `${args[1]}:${args[3].slice(0, 20)}`; successful.set(key, (successful.get(key) ?? 0) + 1); return transport(...args); };
    const { engine } = setup(interrupted); await engine.discover(fetcher as typeof fetch); engine.start(); const stopped = await finished(engine);
    expect(stopped).toMatchObject({ status: "blocked", completedCalls: 4, resumeCount: 0 }); expect(stopped.scores).toHaveLength(1); expect(stopped.taskResults).toHaveLength(4);
    await engine.resume(fetcher as typeof fetch); const done = await finished(engine);
    expect(done).toMatchObject({ status: "completed", completedCalls: 12, resumeCount: 1 }); expect(done.scores).toHaveLength(4); expect(done.uncertainFen).toBeGreaterThan(0); expect(calls).toBe(13); expect([...successful.values()].every(count => count === 1)).toBe(true);
  });
  it("并发续测只有一个请求能进入价格核对", async () => {
    let calls = 0;
    const interrupted: EvaluationTransport = async (...args) => { calls++; if (calls === 4) throw new DOMException("upstream ended", "AbortError"); return transport(...args); };
    const { engine } = setup(interrupted); await engine.discover(fetcher as typeof fetch); engine.start(); await finished(engine);
    let release!: (response: Response) => void;
    const delayed = async (input: string | URL | Request) => String(input).endsWith("/models") ? fetcher(input) : new Promise<Response>(resolve => { release = resolve; });
    const first = engine.resume(delayed as typeof fetch); await Promise.resolve();
    await expect(engine.resume(fetcher as typeof fetch)).rejects.toThrow("请勿重复点击");
    release(Response.json({ success: true, data: { items: modelIds.map(catalogItem) } })); await first; await finished(engine);
    expect(calls).toBe(13);
  });
  it("另一个进程持有旧blocked视图时不能在首次续测后再次续测", async () => {
    let calls = 0;
    const twiceInterrupted: EvaluationTransport = async (...args) => { calls++; if (calls === 4 || calls === 5) throw new DOMException("upstream ended", "AbortError"); return transport(...args); };
    const { root, settings, engine } = setup(twiceInterrupted); await engine.discover(fetcher as typeof fetch); engine.start(); await finished(engine);
    const stale = new ModelEvaluationEngine(settings, twiceInterrupted, () => new EvaluationBudgetLedger(join(root, "budget.sqlite")), () => {}, fixtureDiscovery); expect(stale.get().resumeCount).toBe(0);
    await engine.resume(fetcher as typeof fetch); const stoppedAgain = await finished(engine); expect(stoppedAgain.resumeCount).toBe(1);
    await expect(stale.resume(fetcher as typeof fetch)).rejects.toThrow("其他进程更新"); expect(calls).toBe(5);
  });
  it("另一个进程缓存的旧running视图不能覆盖续测后的最新blocked结果", async () => {
    let rejectCall!: (reason: Error) => void; let calls = 0;
    const pending: EvaluationTransport = async () => { calls++; return await new Promise((_, reject) => { rejectCall = reject; }); };
    const { root, settings, engine } = setup(pending); await engine.discover(fetcher as typeof fetch); engine.start();
    const observer = new ModelEvaluationEngine(settings, pending, () => new EvaluationBudgetLedger(join(root, "budget.sqlite")), () => {}, fixtureDiscovery); expect(observer.get().status).toBe("running");
    const staleCancel = new ModelEvaluationEngine(settings, pending, () => new EvaluationBudgetLedger(join(root, "budget.sqlite")), () => {}, fixtureDiscovery); expect(staleCancel.get().status).toBe("running");
    const staleConnection = new ModelEvaluationEngine(settings, pending, () => new EvaluationBudgetLedger(join(root, "budget.sqlite")), () => {}, fixtureDiscovery); expect(staleConnection.get().status).toBe("running");
    rejectCall(new DOMException("first stopped", "AbortError")); await finished(engine);
    await engine.resume(fetcher as typeof fetch); rejectCall(new DOMException("second stopped", "AbortError")); const latest = await finished(engine); expect(latest.resumeCount).toBe(1);
    expect(() => staleCancel.cancel()).toThrow("没有可停止的在途调用"); expect(staleCancel.get()).toMatchObject({ status: "blocked", resumeCount: 1 });
    staleConnection.connectionChanged(); expect(staleConnection.get()).toMatchObject({ status: "blocked", resumeCount: 1 });
    const future = latest.updatedAt + 121_000; vi.spyOn(Date, "now").mockReturnValue(future);
    expect(observer.get()).toMatchObject({ status: "blocked", resumeCount: 1, viewRevision: latest.viewRevision });
    await observer.resume(fetcher as typeof fetch); rejectCall(new DOMException("third stopped", "AbortError")); const resumed = await finished(observer);
    expect(resumed).toMatchObject({ status: "blocked", resumeCount: 2 }); expect(calls).toBe(3);
  });
  it("已知Token用量超过预留时记录较大待核对金额并禁止续测", async () => {
    const overage: EvaluationTransport = async (...args) => ({ ...await transport(...args), promptTokens: 1_000_000, completionTokens: 900 });
    const { engine } = setup(overage); await engine.discover(fetcher as typeof fetch); engine.start(); const stopped = await finished(engine);
    expect(stopped.status).toBe("blocked"); expect(stopped.resumeAllowed).toBe(false); expect(stopped.uncertainFen).toBeGreaterThan(2);
    await expect(engine.resume(fetcher as typeof fetch)).rejects.toThrow("不允许自动续测");
  });
  it("只复述字段名和JSON结构但没有金标证据的模型不能获得角色", async () => {
    const shallow: EvaluationTransport = async (_connection, _model, _system, prompt) => ({ content: JSON.stringify(prompt.includes("测试片段")
      ? { facts: [{ statement: "这是普通事实一", sourceQuote: "这里没有真实原句一", kind: "明确事实" }, { statement: "这是普通事实二", sourceQuote: "这里没有真实原句二", kind: "明确事实" }, { statement: "这是普通事实三", sourceQuote: "这里没有真实原句三", kind: "明确事实" }], inferences: [{ statement: "这是没有依据的分析推断", supportQuotes: ["这里没有真实原句一", "这里没有真实原句二"] }], causalChain: ["普通节点一", "普通节点二", "普通节点三"], unknowns: ["这是普通问题"] }
      : prompt.includes("全新的中文") ? { title: "普通标题", premise: "这是一个满足长度但没有承载目标机制的普通故事方向描述内容。", playerBehaviors: ["进行普通交流行为", "进行普通选择行为"], originalChanges: ["普通变化内容一", "普通变化内容二", "普通变化内容三", "普通变化内容四"], risks: ["存在普通风险内容", "还有普通风险内容"] }
        : { findings: [{ category: "时间线矛盾", evidence: "这是重复题目分类的普通描述", proposal: "保持原样以后再进行一般处理" }, { category: "线索缺口", evidence: "这是重复题目分类的普通描述二", proposal: "保持原样以后再进行一般处理" }], verdict: "阻断" }), promptTokens: 300, completionTokens: 200, latencyMs: 10 });
    const { engine } = setup(shallow); await engine.discover(fetcher as typeof fetch); engine.start(); const done = await finished(engine);
    expect(done.status).toBe("blocked"); expect(done.allocation).toBeNull(); expect(done.scores.every(score => score.structure < 60 || score.evidence < 70 || score.originality < 60)).toBe(true);
  });
  it("候选、得分和费用状态可从SQLite恢复，不会在刷新后伪装成零消费", async () => {
    const { root, settings, engine } = setup(); await engine.discover(fetcher as typeof fetch);
    const restored = new ModelEvaluationEngine(settings, transport, () => new EvaluationBudgetLedger(join(root, "budget.sqlite")), () => {}, fixtureDiscovery);
    expect(restored.get()).toMatchObject({ status: "discovered", maximumCalls: 12, connectionRevision: 1 });
  });
  it("两个服务实例不能重复启动同一轮；取消只产生一个在途待核对", async () => {
    let calls = 0;
    const pending: EvaluationTransport = async (_connection, _model, _system, _prompt, signal) => { calls++; return await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true })); };
    const { root, settings, engine } = setup(pending); await engine.discover(fetcher as typeof fetch);
    const second = new ModelEvaluationEngine(settings, pending, () => new EvaluationBudgetLedger(join(root, "budget.sqlite")), () => {}, fixtureDiscovery); expect(second.get().status).toBe("discovered");
    engine.start(); expect(() => second.start()).toThrow("另一工作台进程"); engine.cancel(); const done = await finished(engine);
    expect(done.status).toBe("cancelled"); expect(done.uncertainFen).toBeGreaterThan(0); expect(calls).toBe(1);
  });
  it("长队列中报价过期且免费刷新失败时不再预留或调用下一项", async () => {
    let now = 1_800_000_000_000, calls = 0; vi.spyOn(Date, "now").mockImplementation(() => now);
    const delayed: EvaluationTransport = async (...args) => { calls++; const result = await transport(...args); now += 11 * 60 * 1000; return result; };
    const refreshFails = async (input: string | URL | Request) => calls ? new Response("unavailable", { status: 503 }) : fetcher(input);
    const { engine } = setup(delayed); await engine.discover(refreshFails as typeof fetch); engine.start(); const done = await finished(engine);
    expect(done.status).toBe("blocked"); expect(calls).toBe(1); expect(done.completedCalls).toBe(1); expect(done.reservedFen).toBe(0); expect(done.uncertainFen).toBe(0);
  });
  it("真实传输要求完成标志和模型编号一致，缺少Token用量时按上限估算", async () => {
    const connection = { baseUrl: "https://maas-api.antdigital.com/v1", apiKey: "test-only" };
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async () => Response.json({ model: "model-a", choices: [{ finish_reason: "stop", message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      await expect(antEvaluationTransport(connection, "model-a", "system", "prompt", new AbortController().signal)).resolves.toMatchObject({ promptTokens: 10, completionTokens: 5, usageEstimated: false });
      await expect(antEvaluationTransport(connection, "model-b", "system", "prompt", new AbortController().signal)).resolves.toMatchObject({ identityUnverifiable: "服务回传的实际模型编号与候选不一致，无法确认计费模型" });
      globalThis.fetch = async () => Response.json({ model: "model-a", choices: [{ finish_reason: "stop", message: { content: "{}" } }] });
      await expect(antEvaluationTransport(connection, "model-a", "system", "prompt", new AbortController().signal)).resolves.toMatchObject({ promptTokens: 8000, completionTokens: 4096, usageEstimated: true });
      globalThis.fetch = async () => Response.json({ model: "model-a", choices: [{ finish_reason: "stop", message: { content: "{}" } }], usage: { prompt_tokens: 30000 } });
      await expect(antEvaluationTransport(connection, "model-a", "system", "prompt", new AbortController().signal)).rejects.toThrow("异常Token用量");
      globalThis.fetch = async () => Response.json({ model: "model-a", choices: [{ finish_reason: "stop", message: { content: [{ type: "text", text: "{" }, { type: "text", text: "}" }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      await expect(antEvaluationTransport(connection, "model-a", "system", "prompt", new AbortController().signal)).resolves.toMatchObject({ content: "{}", incompatibleReason: undefined, responseNotes: ["服务以文本分片返回正文，已按顺序合并评分"] });
      globalThis.fetch = async () => Response.json({ model: "model-a", choices: [{ finish_reason: "stop", message: { content: [{ type: "reasoning", text: "不可作为最终正文" }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      await expect(antEvaluationTransport(connection, "model-a", "system", "prompt", new AbortController().signal)).resolves.toMatchObject({ content: "", incompatibleReason: "服务没有返回可评分的最终正文" });
      globalThis.fetch = async () => Response.json({ model: "model-a", choices: [{ finish_reason: "length", message: { content: "{\"unfinished\":" } }], usage: { prompt_tokens: 10, completion_tokens: 900 } });
      await expect(antEvaluationTransport(connection, "model-a", "system", "prompt", new AbortController().signal)).resolves.toMatchObject({ incompatibleReason: "服务以length结束，正文可能不完整", promptTokens: 10, completionTokens: 900 });
      globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      await expect(antEvaluationTransport(connection, "model-a", "system", "prompt", new AbortController().signal)).resolves.toMatchObject({ identityUnverifiable: "服务未回传实际模型编号，无法确认计费模型" });
    } finally { globalThis.fetch = original; }
  });
  it("一个候选返回可核算但不兼容的正文时只排除该模型，其余候选继续", async () => {
    const incompatible: EvaluationTransport = async (...args) => args[1] === "cheap-a"
      ? { content: "", promptTokens: 20, completionTokens: 10, latencyMs: 10, incompatibleReason: "服务以length结束，正文可能不完整" }
      : transport(...args);
    const { engine } = setup(incompatible); await engine.discover(fetcher as typeof fetch); engine.start(); const done = await finished(engine);
    expect(done.status).toBe("completed"); expect(done.completedCalls).toBe(9); expect(done.scores.map(item => item.modelId)).not.toContain("cheap-a");
    expect(done.excludedModels).toEqual([expect.objectContaining({ modelId: "cheap-a", reason: expect.stringContaining("length") })]); expect(done.allocation).not.toBeNull();
  });
  it("实际计费模型身份无法确认时按最高预留待核对并禁止续测", async () => {
    const unknownIdentity: EvaluationTransport = async () => ({ content: "{}", promptTokens: 20, completionTokens: 10, latencyMs: 10, identityUnverifiable: "服务未回传实际模型编号，无法确认计费模型" });
    const { engine } = setup(unknownIdentity); await engine.discover(fetcher as typeof fetch); engine.start(); const stopped = await finished(engine);
    expect(stopped).toMatchObject({ status: "blocked", completedCalls: 0, resumeAllowed: false }); expect(stopped.uncertainFen).toBeGreaterThan(0);
    await expect(engine.resume(fetcher as typeof fetch)).rejects.toThrow("不允许自动续测");
  });
  it("候选完成部分题目后被排除，系统自动换入新候选并保留历史进度", async () => {
    const fiveIds = [...modelIds, "cheap-d"];
    const fiveFetcher = async (input: string | URL | Request) => String(input).endsWith("/models") ? Response.json({ data: fiveIds.map(id => ({ id })) }) : Response.json({ success: true, data: { items: fiveIds.map(catalogItem) } });
    let incompatibleId = "", shallowId = "", incompatibleCalls = 0;
    const mixed: EvaluationTransport = async (...args) => {
      if (args[1] === incompatibleId && ++incompatibleCalls === 2) return { content: "", promptTokens: 20, completionTokens: 10, latencyMs: 10, incompatibleReason: "服务以length结束，正文可能不完整" };
      if (args[1] === shallowId) return { content: "{}", promptTokens: 20, completionTokens: 10, latencyMs: 10 };
      return transport(...args);
    };
    const { engine } = setup(mixed); const discovered = await engine.discover(fiveFetcher as typeof fetch); incompatibleId = discovered.candidates[1]!.id; shallowId = discovered.candidates[2]!.id;
    engine.start(); const done = await finished(engine);
    expect(done.status).toBe("completed"); expect(done.taskResults.filter(item => item.modelId === incompatibleId)).toHaveLength(1);
    expect(incompatibleCalls).toBe(2); expect(done.resumeCount).toBe(1); expect(done.maximumCalls).toBe(13); expect(done.completedCalls).toBe(13); expect(done.scores).toHaveLength(4);
  });
  it("真实旧记录的一项得分、四项截断和旧异常可分批升级，费用记录保持不变", async () => {
    const sixIds = [...modelIds, "cheap-d", "legacy-bad"];
    const sixFetcher = async (input: string | URL | Request) => String(input).endsWith("/models") ? Response.json({ data: sixIds.map(id => ({ id })) }) : Response.json({ success: true, data: { items: sixIds.map(catalogItem) } });
    const { root, settings, engine } = setup(); const discovered = await engine.discover(sixFetcher as typeof fetch); const selected = discovered.candidates[0]!;
    const score = { modelId: selected.id, total: 64, structure: 71, evidence: 48, originality: 53, format: 100, latencyMs: 1000, promptTokens: 614, completionTokens: 5461, costFen: 20, usageEstimated: false, notes: ["旧汇总"] };
    const lengthIds = sixIds.filter(id => id !== selected.id && id !== "legacy-bad");
    const excludedModels = [
      ...lengthIds.map(id => ({ modelId: id, displayName: id, reason: "服务以length结束，正文可能不完整", costFen: 1, usageEstimated: false, occurredAt: Date.now() })),
      { modelId: "legacy-bad", displayName: "legacy-bad", reason: "旧版严格解析连续中断，已保留费用并跳过该候选", costFen: null, usageEstimated: true, occurredAt: Date.now() },
    ];
    const file = join(root, "budget.sqlite"); const value = new EvaluationBudgetLedger(file);
    value.reserve("ant-model-selection-v1", "score-cost", 20); value.settle("score-cost", 20);
    for (const [index] of lengthIds.entries()) { value.reserve("ant-model-selection-v1", `length-${index}`, 1); value.settle(`length-${index}`, 1); }
    for (const callId of ["legacy-1", "legacy-2"]) { value.reserve("ant-model-selection-v1", callId, 2); value.markUncertain(callId); }
    const legacyDiscovered = { ...discovered, responsePolicyVersion: undefined };
    value.saveView("ant-model-selection-v1", JSON.stringify({ ...legacyDiscovered, status: "blocked", spentFen: 24, uncertainFen: 4, scores: [score], taskResults: [], excludedModels, completedCalls: 3, maximumCalls: 9, resumeCount: 3, resumeAllowed: false, lastFailure: { modelId: lengthIds.at(-1), taskIndex: 0, category: "response", occurredAt: Date.now() }, viewRevision: 12, error: "旧版长度不足" })); value.close();
    const called: string[] = []; const resumedTransport: EvaluationTransport = async (...args) => { called.push(args[1]); return transport(...args); };
    const restored = new ModelEvaluationEngine(settings, resumedTransport, () => new EvaluationBudgetLedger(file), () => {}, fixtureDiscovery); await restored.resume(sixFetcher as typeof fetch); const done = await finished(restored);
    expect(done.status).toBe("completed"); expect(done.responsePolicyVersion).toBe("openai-json/3-model-limits"); expect(done.resumeCount).toBe(0); expect(done.scores).toHaveLength(4);
    expect(done.spentFen).toBeGreaterThan(24); expect(done.uncertainFen).toBe(4); expect(called).not.toContain(selected.id);
    expect(done.excludedModels).toEqual(expect.arrayContaining([expect.objectContaining({ modelId: "legacy-bad" }), expect.objectContaining({ reason: expect.stringContaining("已取得三个合格模型") })]));
  });
  it("旧截断替补超过四模型上限时明确停止，不暗中增加调用", async () => {
    const sixIds = [...modelIds, "cheap-d", "cheap-e"];
    const sixFetcher = async (input: string | URL | Request) => String(input).endsWith("/models") ? Response.json({ data: sixIds.map(id => ({ id })) }) : Response.json({ success: true, data: { items: sixIds.map(catalogItem) } });
    const { root, settings, engine } = setup(); const discovered = await engine.discover(sixFetcher as typeof fetch); const selected = discovered.candidates[0]!;
    const score = { modelId: selected.id, total: 64, structure: 71, evidence: 48, originality: 53, format: 100, latencyMs: 1000, promptTokens: 614, completionTokens: 5461, costFen: 20, usageEstimated: false, notes: ["旧汇总"] };
    const lengthIds = sixIds.filter(id => id !== selected.id).slice(0, 4);
    const exclusions = lengthIds.map(id => ({ modelId: id, displayName: id, reason: "服务以length结束，正文可能不完整", costFen: 1, usageEstimated: false, occurredAt: Date.now() }));
    const file = join(root, "budget.sqlite"); const value = new EvaluationBudgetLedger(file);
    value.reserve("ant-model-selection-v1", "old-score", 20); value.settle("old-score", 20);
    for (const [index] of lengthIds.entries()) { value.reserve("ant-model-selection-v1", `old-length-${index}`, 1); value.settle(`old-length-${index}`, 1); }
    const legacyDiscovered = { ...discovered, responsePolicyVersion: undefined };
    value.saveView("ant-model-selection-v1", JSON.stringify({ ...legacyDiscovered, status: "blocked", spentFen: 24, scores: [score], taskResults: [], excludedModels: exclusions, completedCalls: 3, maximumCalls: 9, resumeCount: 3, resumeAllowed: false, lastFailure: { modelId: lengthIds.at(-1), taskIndex: 0, category: "response", occurredAt: Date.now() }, viewRevision: 15, error: "旧版长度不足" })); value.close();
    let calls = 0; const shallow: EvaluationTransport = async () => { calls++; return { content: "{}", promptTokens: 20, completionTokens: 10, latencyMs: 10 }; };
    const restored = new ModelEvaluationEngine(settings, shallow, () => new EvaluationBudgetLedger(file), () => {}, fixtureDiscovery); await restored.resume(sixFetcher as typeof fetch); const done = await finished(restored);
    expect(done).toMatchObject({ status: "blocked", responsePolicyVersion: "openai-json/3-model-limits", resumeAllowed: false }); expect(done.scores).toHaveLength(4); expect(calls).toBe(9);
    expect(done.excludedModels).toEqual(expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining("最多比较4个模型") })]));
  });
  it("自动换候选时已评分模型若下架，会在新付费调用前停止", async () => {
    const fiveIds = [...modelIds, "cheap-d"]; let unavailable = false; let scoredId = ""; let incompatibleId = ""; let calls = 0;
    const changingFetcher = async (input: string | URL | Request) => {
      const ids = unavailable ? fiveIds.filter(id => id !== scoredId) : fiveIds;
      return String(input).endsWith("/models") ? Response.json({ data: ids.map(id => ({ id })) }) : Response.json({ success: true, data: { items: ids.map(catalogItem) } });
    };
    const changingTransport: EvaluationTransport = async (...args) => {
      calls++;
      if (args[1] === incompatibleId) { unavailable = true; return { content: "", promptTokens: 20, completionTokens: 10, latencyMs: 10, incompatibleReason: "服务以length结束，正文可能不完整" }; }
      if (args[1] !== scoredId) return { content: "{}", promptTokens: 20, completionTokens: 10, latencyMs: 10 };
      return transport(...args);
    };
    const { engine } = setup(changingTransport); const discovered = await engine.discover(changingFetcher as typeof fetch); scoredId = discovered.candidates[0]!.id; incompatibleId = discovered.candidates[1]!.id;
    engine.start(); const stopped = await finished(engine);
    expect(stopped.status).toBe("blocked"); expect(stopped.allocation).toBeNull(); expect(stopped.scores.map(item => item.modelId)).toContain(scoredId); expect(calls).toBe(10);
    expect(stopped.error).toContain("已有得分或题目记录的模型已不在当前可用价格表中");
  });
  it("修订版只免费规划，原子归档旧报告，累计费用保留并在用户开始后测试", async () => {
    let calls = 0;
    const tracked: EvaluationTransport = async (...args) => { calls++; return transport(...args); };
    const { root, settings, engine } = setup(tracked); const discovered = await engine.discover(fetcher as typeof fetch);
    const file = join(root, "budget.sqlite"); const ledger = new EvaluationBudgetLedger(file); const session = "ant-model-selection-v1";
    ledger.reserve(session, "old-paid", 62); ledger.settle("old-paid", 62); ledger.reserve(session, "old-unknown", 24); ledger.markUncertain("old-unknown");
    const old = { ...discovered, taskVersion: null, status: "blocked", completedCalls: 0, resumeAllowed: false, viewRevision: 27, spentFen: 62, uncertainFen: 24, error: "旧规则失败" };
    ledger.saveView(session, JSON.stringify(old)); ledger.close();
    const restored = new ModelEvaluationEngine(settings, tracked, () => new EvaluationBudgetLedger(file), () => {}, fixtureDiscovery);
    await expect(restored.resume(fetcher as typeof fetch)).rejects.toThrow("旧成绩不能混入新规则");
    const plan = await restored.prepareRevised(fetcher as typeof fetch);
    expect(calls).toBe(0); expect(plan).toMatchObject({ status: "discovered", spentFen: 62, uncertainFen: 24, archivedViewRevision: 27, taskVersion: "juben-model-eval/1.1", completedCalls: 0 });
    expect(restored.archived(27)).toMatchObject({ error: "旧规则失败", spentFen: 62, uncertainFen: 24 });
    expect(plan.scores).toEqual([]); expect(plan.taskResults).toEqual([]);
    const rival = new ModelEvaluationEngine(settings, tracked, () => new EvaluationBudgetLedger(file), () => {}, fixtureDiscovery); rival.get();
    restored.start(); expect(() => rival.start()).toThrow("另一工作台进程"); const done = await finished(restored);
    expect(done.status).toBe("completed"); expect(calls).toBe(12); expect(done.spentFen).toBeGreaterThan(62); expect(done.uncertainFen).toBe(24);
  });
  it("新计划开始前账本若变化则拒绝调用，旧报告不能被反复归档清空", async () => {
    let calls = 0; const tracked: EvaluationTransport = async (...args) => { calls++; return transport(...args); };
    const { root, settings, engine } = setup(tracked); const discovered = await engine.discover(fetcher as typeof fetch); const file = join(root, "budget.sqlite"); const session = "ant-model-selection-v1";
    const ledger = new EvaluationBudgetLedger(file); ledger.saveView(session, JSON.stringify({ ...discovered, status: "blocked", taskVersion: null, viewRevision: 20, resumeAllowed: false }));
    const restored = new ModelEvaluationEngine(settings, tracked, () => new EvaluationBudgetLedger(file), () => {}, fixtureDiscovery);
    await restored.prepareRevised(fetcher as typeof fetch);
    const beforeRefresh = restored.get();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60 * 1000);
    expect(() => restored.start()).toThrow("超过10分钟");
    const refreshed = await restored.prepareRevised(fetcher as typeof fetch);
    expect(refreshed.archivedViewRevision).toBe(beforeRefresh.archivedViewRevision);
    expect(refreshed.viewRevision).toBeGreaterThan(beforeRefresh.viewRevision); expect(calls).toBe(0);
    ledger.reserve(session, "outside-change", 10); ledger.markUncertain("outside-change");
    expect(() => restored.start()).toThrow("费用账本已变化"); expect(calls).toBe(0); expect(restored.archived(20).taskVersion).toBeNull(); ledger.close();
  });
  it("研究计划保留同规则三题成绩和旧费用，只对新候选执行六题；失败候选不再调用", async () => {
    const { root, settings } = setup(); const file = join(root, "budget.sqlite");
    const ids = [...RESEARCH_SELECTION_POLICY.ids]; const calls: string[] = [];
    const publicFetch = async (input: string | URL | Request) => String(input).endsWith("/models") ? Response.json({ data: [...ids, "unresearched"].map(id => ({ id })) }) : Response.json({ success: true, data: { items: [...ids, "unresearched"].map(catalogItem) } });
    const tracked: EvaluationTransport = async (...args) => { calls.push(args[1]); return transport(...args); };
    const engine = new ModelEvaluationEngine(settings, tracked, () => new EvaluationBudgetLedger(file), () => {});
    const discovered = await engine.discover(publicFetch as typeof fetch);
    expect(discovered.candidates.map(item => item.id)).toEqual(ids.slice(0, 3));
    const qwen = ids[0]!;
    const score = { modelId: qwen, total: 83, structure: 92, evidence: 82, originality: 63, format: 100, latencyMs: 100, promptTokens: 900, completionTokens: 1200, costFen: 28, usageEstimated: false, notes: ["同规则已完成"] };
    const taskResults = [0, 1, 2].map(taskIndex => ({ modelId: qwen, taskIndex, structure: 92, evidence: 82, originality: 63, format: 100, latencyMs: 30, promptTokens: 300, completionTokens: 400, costFen: 9, usageEstimated: false, notes: ["完成"] }));
    const ledger = new EvaluationBudgetLedger(file); const session = "ant-model-selection-v1";
    ledger.reserve(session, "prior-cost", 91); ledger.settle("prior-cost", 91); ledger.reserve(session, "prior-uncertain", 63); ledger.markUncertain("prior-uncertain");
    ledger.saveView(session, JSON.stringify({ ...discovered, candidatePolicyVersion: null, status: "blocked", scores: [score, { ...score, modelId: "unresearched" }], taskResults: [...taskResults, ...taskResults.map(item => ({ ...item, modelId: "unresearched" }))], completedCalls: 6, spentFen: 91, uncertainFen: 63, resumeCount: 3, lastFailure: { modelId: ids[3], taskIndex: 0, category: "service", occurredAt: Date.now() }, viewRevision: 55 }));
    const prepared = await engine.prepareRevised(publicFetch as typeof fetch);
    expect(prepared).toMatchObject({ status: "discovered", spentFen: 91, uncertainFen: 63, completedCalls: 3, maximumCalls: 9, archivedViewRevision: 55 });
    expect(prepared.scores).toEqual([score]); expect(calls).toEqual([]); expect(prepared.excludedModels.map(item => item.modelId)).toContain(ids[3]);
    expect(engine.archived(55).candidatePolicyVersion).toBeNull(); expect(engine.archived(55).scores).toHaveLength(2);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60 * 1000);
    const refreshed = await engine.prepareRevised(publicFetch as typeof fetch); expect(refreshed.scores).toEqual([score]); expect(refreshed.archivedViewRevision).toBe(55);
    engine.start(); const done = await finished(engine);
    expect(done.status).toBe("completed"); expect(done.completedCalls).toBe(9); expect(calls).toHaveLength(6); expect(calls).not.toContain(qwen); expect(calls).not.toContain(ids[3]); expect(calls).not.toContain("unresearched"); expect(done.uncertainFen).toBe(63); ledger.close();
  });
  it.each([false, true])("服务恢复费用已落盘=%s时，研究计划不能绕过费用阻断再调用", async (alreadyUncertain) => {
    const { root, settings, engine } = setup(); const discovered = await engine.discover(fetcher as typeof fetch);
    const file = join(root, "budget.sqlite"); const ledger = new EvaluationBudgetLedger(file); const session = "ant-model-selection-v1";
    ledger.reserve(session, "pending-old-request", 30);
    if (alreadyUncertain) ledger.markUncertain("pending-old-request");
    ledger.saveView(session, JSON.stringify({ ...discovered, candidatePolicyVersion: null, status: "running", reservedFen: 30, updatedAt: Date.now() - 130_000, lastFailure: null }));
    const stopped = new ModelEvaluationEngine(settings, transport, () => new EvaluationBudgetLedger(file), () => {}, fixtureDiscovery);
    expect(stopped.get()).toMatchObject({ status: "blocked", reservedFen: 0, uncertainFen: 30, resumeAllowed: false, lastFailure: { category: "usage" } });
    await expect(stopped.prepareRevised(fetcher as typeof fetch)).rejects.toThrow("不需要重新规划");
    await expect(stopped.resume(fetcher as typeof fetch)).rejects.toThrow("不允许自动续测"); ledger.close();
  });
  it("针对性候选不发送平台明确不支持的temperature参数", async () => {
    const captured: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body); captured.push(body);
      return Response.json({ model: body.model, choices: [{ finish_reason: "stop", message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }));
    try {
      for (const model of RESEARCH_SELECTION_POLICY.ids) await antEvaluationTransport({ baseUrl: "https://maas-api.antdigital.com/v1", apiKey: "test-only" }, model, "system", "prompt", new AbortController().signal);
      for (const body of captured.slice(0, 3)) expect(body).not.toHaveProperty("temperature");
      expect(captured[3]?.temperature).toBe(0);
      expect(captured.map(body => body.max_tokens)).toEqual([4096, 16384, 8192, 4096]);
      expect(captured[2]?.reasoning_effort).toBe("low");
      expect(captured[1]).not.toHaveProperty("reasoning_effort");
      expect(captured.every(body => (body.response_format as { type: string }).type === "json_object")).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
  it("响应诊断仅保存计数和固定枚举，不保存正文或隐藏推理", async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async () => Response.json({ model: "a", choices: [{ finish_reason: "length", message: { content: "{partial", reasoning_content: "private-thinking" } }], usage: { prompt_tokens: 30, completion_tokens: 4096, completion_tokens_details: { reasoning_tokens: 4000 } } });
      const result = await antEvaluationTransport({ baseUrl: "https://maas-api.antdigital.com/v1", apiKey: "test-only" }, "a", "system", "prompt", new AbortController().signal);
      expect(result.responseDiagnostic).toEqual({ finishReason: "length", contentCharacters: 8, reasoningCharacters: 16, reasoningTokens: 4000, requestedOutputTokens: 4096, timeoutMs: 90000 });
      expect(JSON.stringify(result.responseDiagnostic)).not.toContain("private-thinking");
    } finally { globalThis.fetch = original; }
  });
  it("真实旧记录第二次停在同一候选时，下一次只跳过该候选并换入其他模型", async () => {
    const { root, settings, engine } = setup(); const discovered = await engine.discover(fetcher as typeof fetch); const selected = discovered.candidates[0]!; const incompatible = discovered.candidates[1]!;
    const score = { modelId: selected.id, total: 64, structure: 71, evidence: 48, originality: 53, format: 100, latencyMs: 1000, promptTokens: 614, completionTokens: 5461, costFen: 20, usageEstimated: false, notes: ["旧汇总"] };
    const file = join(root, "budget.sqlite"); const value = new EvaluationBudgetLedger(file); value.reserve("ant-model-selection-v1", "old-a", 2); value.markUncertain("old-a"); value.reserve("ant-model-selection-v1", "old-b", 2); value.markUncertain("old-b");
    value.saveView("ant-model-selection-v1", JSON.stringify({ ...discovered, status: "blocked", scores: [score], taskResults: [], completedCalls: 3, resumeCount: 1, resumeAllowed: true, viewRevision: 8, error: "模型服务返回的正文结构不完整，已停止后续付费调用。" })); value.close();
    const called: string[] = []; const resumedTransport: EvaluationTransport = async (...args) => { called.push(args[1]); return transport(...args); };
    const restored = new ModelEvaluationEngine(settings, resumedTransport, () => new EvaluationBudgetLedger(file), () => {}, fixtureDiscovery); await restored.resume(fetcher as typeof fetch); const done = await finished(restored);
    expect(called).not.toContain(incompatible.id); expect(done.excludedModels).toEqual([expect.objectContaining({ modelId: incompatible.id, reason: expect.stringContaining("旧版严格解析") })]); expect(done.scores).toHaveLength(3);
  });
});

it("当前Qwen完成、Pro截断、Kimi中断可免费修复一次；保留账本，只补六题", async () => {
  const { root, settings } = setup(); const file = join(root, "budget.sqlite");
  const ids = [...RESEARCH_SELECTION_POLICY.ids]; const calls: string[] = [];
  const publicFetch = async (input: string | URL | Request) => String(input).endsWith("/models") ? Response.json({ data: ids.map(id => ({ id })) }) : Response.json({ success: true, data: { items: ids.map(catalogItem) } });
  const tracked: EvaluationTransport = async (...args) => { calls.push(args[1]); return transport(...args); };
  const engine = new ModelEvaluationEngine(settings, tracked, () => new EvaluationBudgetLedger(file), () => {});
  const discovered = await engine.discover(publicFetch as typeof fetch);
  const qwen = ids[0]!;
  const score = { modelId: qwen, total: 83, structure: 92, evidence: 82, originality: 63, format: 100, latencyMs: 100, promptTokens: 900, completionTokens: 1200, costFen: 28, usageEstimated: false, notes: ["已完成"] };
  const taskResults = [0, 1, 2].map(taskIndex => ({ modelId: qwen, taskIndex, structure: 92, evidence: 82, originality: 63, format: 100, latencyMs: 30, promptTokens: 300, completionTokens: 400, costFen: 9, usageEstimated: false, notes: ["完成"] }));
  const ledger = new EvaluationBudgetLedger(file); const session = "ant-model-selection-v1";
  ledger.reserve(session, "old-cost", 96); ledger.settle("old-cost", 96); ledger.reserve(session, "old-uncertain", 122); ledger.markUncertain("old-uncertain");
  const prior = { ...discovered, responsePolicyVersion: "openai-json/2-4096", status: "blocked", scores: [score], taskResults, completedCalls: 3, spentFen: 96, uncertainFen: 122, viewRevision: 48,
    excludedModels: [{ modelId: ids[1], displayName: "Pro", reason: "服务以length结束", costFen: 5, usageEstimated: false, occurredAt: Date.now(), responseDiagnostic: { finishReason: "length", contentCharacters: 0, reasoningCharacters: 7059, reasoningTokens: 4096, requestedOutputTokens: 4096 } }, { modelId: ids[3], displayName: "Flash", reason: "历史请求未返回", costFen: null, usageEstimated: true, occurredAt: Date.now() }],
    lastFailure: { modelId: ids[2], taskIndex: 0, category: "service", occurredAt: Date.now() } };
  ledger.saveView(session, JSON.stringify(prior)); engine.get();
  await expect(engine.resume(publicFetch as typeof fetch)).rejects.toThrow("免费准备修复计划"); expect(calls).toEqual([]);
  const prepared = await engine.prepareRevised(publicFetch as typeof fetch);
  expect(prepared).toMatchObject({ status: "discovered", completedCalls: 3, maximumCalls: 9, spentFen: 96, uncertainFen: 122, reservedFen: 0, archivedViewRevision: 48, startedAt: null });
  expect(prepared.candidates.map(item => item.id)).toEqual(ids.slice(0, 3));
  expect(prepared.scores).toEqual([score]); expect(prepared.taskResults).toEqual(taskResults);
  expect(prepared.excludedModels.map(item => item.modelId)).toEqual([ids[3]]); expect(calls).toEqual([]);
  expect(engine.archived(48).excludedModels).toHaveLength(2);
  engine.start(); const done = await finished(engine);
  expect(done.status).toBe("completed"); expect(done.completedCalls).toBe(9); expect(calls).toHaveLength(6); expect(calls).not.toContain(qwen); expect(calls).not.toContain(ids[3]); expect(done.uncertainFen).toBe(122);
  ledger.saveView(session, JSON.stringify({ ...done, status: "blocked", allocation: null, lastFailure: prior.lastFailure }));
  await expect(engine.prepareRevised(publicFetch as typeof fetch)).rejects.toThrow("不需要重新规划");
  ledger.close();
});

it.each(["usage", "budget"])("请求修复不能绕过%s阻断", async category => {
  const { root, engine } = setup(); const discovered = await engine.discover(fetcher as typeof fetch);
  const ledger = new EvaluationBudgetLedger(join(root, "budget.sqlite"));
  ledger.saveView("ant-model-selection-v1", JSON.stringify({ ...discovered, status: "blocked", responsePolicyVersion: "openai-json/2-4096", lastFailure: { modelId: "kimi-k3", taskIndex: 0, category, occurredAt: Date.now() } }));
  await expect(engine.prepareRevised(fetcher as typeof fetch)).rejects.toThrow("不需要重新规划"); ledger.close();
});

it("超时记录实际类别和耗时，不误指余额权限，不自动重试", async () => {
  const calls: string[] = []; const { engine } = setup(async (_connection, model) => { calls.push(model); throw new DOMException("sensitive upstream context", "TimeoutError"); });
  await engine.discover(fetcher as typeof fetch); engine.start(); const stopped = await finished(engine);
  expect(stopped.status).toBe("blocked"); expect(stopped.lastFailure).toMatchObject({ category: "service", code: "timeout", elapsedMs: expect.any(Number) });
  expect(stopped.error).toContain("等待本题回答超时"); expect(stopped.error).not.toContain("请检查蚂蚁平台额度"); expect(JSON.stringify(stopped)).not.toContain("sensitive upstream context");
  expect(stopped.activeRequest).toBeNull(); expect(stopped.uncertainFen).toBeGreaterThan(0); expect(calls).toHaveLength(1);
});

it.each([[401, "认证"], [403, "权限"], [429, "限流"], [503, "服务暂时异常"], [400, "请求参数"]])("HTTP %s显示具体类型，不泄露上游正文", async (status, expected) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("sensitive upstream response", { status: Number(status) })));
  try { await expect(antEvaluationTransport({ baseUrl: "https://maas-api.antdigital.com/v1", apiKey: "test-only" }, "kimi-k3", "s", "p", new AbortController().signal)).rejects.toThrow(String(expected)); }
  finally { vi.unstubAllGlobals(); }
});

it("长请求跨过报价有效期时免费刷新当前候选后继续，不重做已有题", async () => {
  let calls = 0, reads = 0; const started = Date.now();
  const { engine } = setup(async (...args) => { const result = await transport(...args); calls++; if (calls === 1) vi.spyOn(Date, "now").mockReturnValue(started + 11 * 60 * 1000); return result; });
  const countFetch = async (input: string | URL | Request) => { reads++; return fetcher(input); };
  await engine.discover(countFetch as typeof fetch); engine.start(); const done = await finished(engine);
  expect(done.status).toBe("completed"); expect(reads).toBe(4); expect(calls).toBe(12); expect(done.completedCalls).toBe(12);
});

it("请求等待状态带新版本持久化，其他服务实例能看到当前题及预留", async () => {
  let finishRequest!: (value: Awaited<ReturnType<EvaluationTransport>>) => void;
  const { root, settings, engine } = setup(() => new Promise(resolve => { finishRequest = resolve; }));
  const discovered = await engine.discover(fetcher as typeof fetch); engine.start();
  const observer = new ModelEvaluationEngine(settings, transport, () => new EvaluationBudgetLedger(join(root, "budget.sqlite")), () => {}, fixtureDiscovery);
  const live = observer.get(); expect(live.status).toBe("running"); expect(live.activeRequest).toMatchObject({ modelId: expect.any(String), startedAt: expect.any(Number), timeoutMs: 90000 });
  expect(live.viewRevision).toBeGreaterThan(discovered.viewRevision); expect(live.reservedFen).toBeGreaterThan(0);
  engine.cancel(); finishRequest(await transport({ baseUrl: "test", apiKey: "test-only" }, "test", "s", "p", new AbortController().signal));
  await finished(engine);
});

it("发送前状态保存失败释放零费用，不把本地故障记为模型扣费", async () => {
  const { root, settings } = setup(); const ledger = new EvaluationBudgetLedger(join(root, "budget.sqlite")); let calls = 0;
  const engine = new ModelEvaluationEngine(settings, async (...args) => { calls++; return transport(...args); }, () => ledger, () => {}, fixtureDiscovery);
  await engine.discover(fetcher as typeof fetch);
  const original = ledger.saveView.bind(ledger); let failed = false;
  vi.spyOn(ledger, "saveView").mockImplementation((session, serialized) => {
    if (!failed && JSON.parse(serialized).activeRequest) { failed = true; throw new Error("disk failure with private path"); }
    original(session, serialized);
  });
  engine.start(); const done = await finished(engine);
  expect(done).toMatchObject({ status: "blocked", spentFen: 0, uncertainFen: 0, reservedFen: 0, resumeAllowed: false, lastFailure: { code: "local", category: "usage" } });
  expect(done.error).toContain("未发送模型请求"); expect(calls).toBe(0); expect(JSON.stringify(done)).not.toContain("private path");
});

it("刷新后价格上涨超计划额度时保留首题，不再发起第二题", async () => {
  let calls = 0; const started = Date.now();
  const { engine } = setup(async (...args) => { const result = await transport(...args); calls++; vi.spyOn(Date, "now").mockReturnValue(started + 11 * 60 * 1000); return result; });
  const priceFetch = async (input: string | URL | Request) => String(input).endsWith("/models") ? fetcher(input) : Response.json({ success: true, data: { items: modelIds.map((id, i) => ({ ...catalogItem(id, i), ...(calls ? { inPrice: "¥10000/M", outPrice: "¥10000/M" } : {}) })) } });
  await engine.discover(priceFetch as typeof fetch); engine.start(); const done = await finished(engine);
  expect(done.status).toBe("blocked"); expect(done.error).toContain("新价格下剩余测评超过计划额度"); expect(calls).toBe(1); expect(done.completedCalls).toBe(1); expect(done.reservedFen).toBe(0); expect(done.uncertainFen).toBe(0);
});
