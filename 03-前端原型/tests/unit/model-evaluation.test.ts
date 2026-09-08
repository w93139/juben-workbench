import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvaluationBudgetLedger } from "@/server/evaluation-budget";
import { antEvaluationTransport, ModelEvaluationEngine, type EvaluationTransport } from "@/server/model-evaluation";
import { StudioSettingsStore } from "@/server/studio-settings";

const roots: string[] = [];
const modelIds = ["premium", "cheap-a", "cheap-b", "cheap-c"];
const catalogItem = (name: string, index: number) => ({ name, displayName: name, provider: `P${index}`, status: "RELEASED", contextLength: 128000, inPrice: `¥${index + 1}/M`, outPrice: `¥${index + 2}/M`, type: "TEXT_GENERATE", offShelfFlag: 0 });
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
  return { root, settings, engine: new ModelEvaluationEngine(settings, customTransport, () => new EvaluationBudgetLedger(join(root, "budget.sqlite")), () => {}) };
}
async function finished(engine: ModelEvaluationEngine) { for (let attempt = 0; attempt < 100; attempt++) { const view = engine.get(); if (!["running", "cancelling"].includes(view.status)) return view; await new Promise(resolve => setTimeout(resolve, 2)); } throw new Error("evaluation did not finish"); }
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("剧本领域小样测评", () => {
  it("发现阶段零内容调用，付费阶段记录用量并自动分配三个不同模型", async () => {
    const { settings, engine } = setup(); const discovered = await engine.discover(fetcher as typeof fetch);
    expect(discovered).toMatchObject({ status: "discovered", completedCalls: 0, maximumCalls: 12, spentFen: 0 });
    engine.start(); const done = await finished(engine);
    expect(done.status).toBe("completed"); expect(done.completedCalls).toBe(12); expect(done.spentFen).toBeGreaterThan(0); expect(done.spentFen).toBeLessThanOrEqual(1000);
    expect(new Set(Object.values(done.allocation!)).size).toBe(3); expect(settings.safe({}).configured).toBe(true);
  });
  it("调用失败后将最高费用列为待核对并停止后续调用", async () => {
    const { engine } = setup(async () => { throw new DOMException("timeout", "AbortError"); }); await engine.discover(fetcher as typeof fetch); engine.start(); const done = await finished(engine);
    expect(done.status).toBe("blocked"); expect(done.completedCalls).toBe(0); expect(done.uncertainFen).toBeGreaterThan(0); expect(done.allocation).toBeNull();
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
    const restored = new ModelEvaluationEngine(settings, transport, () => new EvaluationBudgetLedger(join(root, "budget.sqlite")), () => {});
    expect(restored.get()).toMatchObject({ status: "discovered", maximumCalls: 12, connectionRevision: 1 });
  });
  it("两个服务实例不能重复启动同一轮；取消只产生一个在途待核对", async () => {
    let calls = 0;
    const pending: EvaluationTransport = async (_connection, _model, _system, _prompt, signal) => { calls++; return await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true })); };
    const { root, settings, engine } = setup(pending); await engine.discover(fetcher as typeof fetch);
    const second = new ModelEvaluationEngine(settings, pending, () => new EvaluationBudgetLedger(join(root, "budget.sqlite")), () => {}); expect(second.get().status).toBe("discovered");
    engine.start(); expect(() => second.start()).toThrow("另一工作台进程"); engine.cancel(); const done = await finished(engine);
    expect(done.status).toBe("cancelled"); expect(done.uncertainFen).toBeGreaterThan(0); expect(calls).toBe(1);
  });
  it("长队列中公开价格超过10分钟后不再预留或调用下一项", async () => {
    let now = 1_800_000_000_000, calls = 0; vi.spyOn(Date, "now").mockImplementation(() => now);
    const delayed: EvaluationTransport = async (...args) => { calls++; const result = await transport(...args); now += 11 * 60 * 1000; return result; };
    const { engine } = setup(delayed); await engine.discover(fetcher as typeof fetch); engine.start(); const done = await finished(engine);
    expect(done.status).toBe("blocked"); expect(calls).toBe(1); expect(done.completedCalls).toBe(1); expect(done.reservedFen).toBe(0); expect(done.uncertainFen).toBe(0);
  });
  it("真实传输要求完成标志、Token用量和实际模型编号一致", async () => {
    const connection = { baseUrl: "https://maas-api.antdigital.com/v1", apiKey: "test-only" };
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async () => Response.json({ model: "model-a", choices: [{ finish_reason: "stop", message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      await expect(antEvaluationTransport(connection, "model-a", "system", "prompt", new AbortController().signal)).resolves.toMatchObject({ promptTokens: 10, completionTokens: 5 });
      await expect(antEvaluationTransport(connection, "model-b", "system", "prompt", new AbortController().signal)).rejects.toThrow("实际模型");
    } finally { globalThis.fetch = original; }
  });
});
