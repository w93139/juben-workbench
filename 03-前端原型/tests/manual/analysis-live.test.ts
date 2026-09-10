/** Explicitly opt-in. Normal unit/E2E commands never run paid verification. */
import { it } from "vitest";
import { mkdirSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { StudioEngine, openAITransport } from "@/server/studio-models";
import { StudioSettingsStore } from "@/server/studio-settings";
import { StudioJobStore } from "@/server/studio-job-store";
import { analysisBatches } from "@/server/long-analysis";
import { guardedVerificationFetch, type VerificationCall } from "./live-analysis-guard";

it.skipIf(process.env.STUDIO_LIVE_VERIFY !== "1")("当前主模型真实分段及汇总：自有样例、最多3次、累计预留不超过3元", async () => {
  const config = new StudioSettingsStore(process.env.STUDIO_LIVE_SETTINGS_ROOT ?? resolve("runtime-data")).config();
  if (!config || config.baseUrl !== "https://maas-api.antdigital.com/v1") throw new Error("仅使用已配置的蚂蚁官方连接，未调用模型。");
  const documents = Array.from({ length: 10 }, (_, i) => ({ id: `test-role-${i}`, name: `自有测试角色${i}.txt`, text: `【自有验证样例，非用户原剧本】角色${i}在第${i + 1}轮获得记录${i}。角色0负责保管钟表，角色9负责公开原始账册。记录只证明事件顺序，不能单独证明动机。`.padEnd(3000, `校对记录${i}：同一事件须用独立来源交叉核实；不能把推断写成事实。`) }));
  const batches = analysisBatches(documents);
  if (batches.length !== 2) throw new Error("测试计划不再是两批加一次汇总，未调用模型。");
  const network = globalThis.fetch;
  const catalogResponse = await network("https://maas.antdigital.com/api/v1/model-service/public/page-list?page=1&pageSize=500", { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!catalogResponse.ok) throw new Error("无法核对公开价格，未调用模型。");
  const catalog = await catalogResponse.json();
  const item = catalog?.data?.items?.find((value: { name: string }) => value.name === config.mainModel);
  const price = (value: unknown) => { const match = typeof value === "string" && value.match(/^\s*[¥￥]\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*M\s*$/i); if (!match) throw new Error("价格格式未知，未调用模型。"); return Number(match[1]); };
  const inputPrice = price(item?.inPrice), outputPrice = price(item?.outPrice);
  if (item?.status !== "RELEASED" || !Number.isFinite(inputPrice + outputPrice)) throw new Error("当前模型或价格不可用，未调用模型。");
  const checkedAt = Date.now();
  const folder = resolve("runtime-data/verification"); mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, "analysis-live.json");
  if (existsSync(file)) throw new Error("已存在本次验证记录，不自动重复付费；先核对已有报告。");
  const report = { model: config.mainModel, source: "synthetic-fixture", capFen: 300, reservedUpperFen: 0, status: "running", calls: [] as VerificationCall[], failureCode: "", elapsedMs: 0 };
  const save = () => { const temp = file + ".tmp"; writeFileSync(temp, JSON.stringify(report, null, 2), { mode: 0o600 }); renameSync(temp, file); };
  writeFileSync(file, JSON.stringify(report), { mode: 0o600, flag: "wx" });
  const store = new StudioJobStore(":memory:");
  globalThis.fetch = guardedVerificationFetch({ network, baseUrl: config.baseUrl, model: config.mainModel, inputPrice, outputPrice, checkedAt, report, save });
  const startedAt = Date.now();
  try {
    const engine = new StudioEngine(() => config, openAITransport, Date.now, store);
    const task = await engine.start("analyze", { documents, instructions: "只用于验证真实分段和来源回查；简洁列出明确事实、推断与待定，提出两个原创方向，不把重复校对文字扩写成故事事实。" });
    let state = engine.get(task.jobId);
    while (state.status === "running") { await new Promise(resolve => setTimeout(resolve, 500)); state = engine.get(task.jobId); }
    const passed = state.status === "completed" && state.result?.kind === "analysis" && state.result.analysis.coverage?.documents === 10 && report.calls.length === 3;
    report.elapsedMs = Date.now() - startedAt; report.status = passed ? "completed" : "failed"; report.failureCode = state.error?.code ?? (passed ? "" : "VERIFICATION_FAILED"); save();
    console.info(JSON.stringify({ model: report.model, status: report.status, calls: report.calls.length, reservedUpperFen: report.reservedUpperFen, elapsedMs: report.elapsedMs, failureCode: report.failureCode }));
    if (!passed) throw new Error("真实拆解验证未通过；只查看诊断，不自动重试。");
  } finally { globalThis.fetch = network; store.close(); if (report.status === "running") { report.status = "interrupted"; report.elapsedMs = Date.now() - startedAt; save(); } }
});
