import { installBudgetFixture } from "./budget-fixture";
import type { Page } from "@playwright/test";
import { emptyWorkbench, workbenchSchema, type WorkbenchState } from "../../src/domain/workbench";
import { emptyBlueprintData } from "../../src/domain/blueprint";

const dbName = "juben-workbench:authoring:v1";
export const analysis = { outline: "原始灯塔材料的事件和信息顺序。", directions: [{ id: "one", title: "责任与选择", summary: "围绕共同选择重建原创故事", outline: "发现—核验—选择", risk: "节奏待真人试玩" }, { id: "two", title: "孤岛谜案", summary: "围绕证据还原新事件", outline: "调查—矛盾—还原", risk: "核对每个角色的贡献" }], sourceRefs: [{ documentId: "doc", location: "正文开头", quote: "自有测试原文" }], unknowns: [] };
export function prepared(): WorkbenchState {
  const state = emptyWorkbench(); state.revision = 1; state.sourceRevision = 1;
  state.documents = [{ id: "doc", name: "原始剧本.txt", size: 18, text: "自有测试原文", status: "read", method: "text", warnings: [], excluded: false }];
  state.analysis = analysis; state.analysisSourceRevision = 1; state.choiceId = "one";
  const blueprint = emptyBlueprintData(); blueprint.premise = "原创蓝图的最初大纲"; blueprint.truth = "两份记录的差异来自一次主动替换";
  state.blueprint = blueprint; state.blueprintRevision = 1; state.blueprintSourceRevision = 1; state.blueprintChoiceId = "one";
  return state;
}
export async function writeState(page: Page, base: string, state: WorkbenchState) {
  const valid = workbenchSchema.parse(state); const id = base.split("/projects/")[1].split("/")[0];
  await page.evaluate(async ({ id, valid, dbName }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("projects");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const tx = db.transaction("projects", "readwrite"); tx.objectStore("projects").put(valid, id); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; };
  }), { id, valid, dbName });
}
export async function readState(page: Page, base: string): Promise<WorkbenchState> {
  const id = base.split("/projects/")[1].split("/")[0];
  return page.evaluate(async ({ id, dbName }) => new Promise<WorkbenchState>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const req = db.transaction("projects").objectStore("projects").get(id); req.onsuccess = () => { db.close(); resolve(req.result); }; req.onerror = () => { db.close(); reject(req.error); }; };
  }), { id, dbName });
}
export async function offlineCapability(page: Page) {
  await installBudgetFixture(page);
  await page.route("**/api/studio/capability", route => route.fulfill({ json: { configured: true, message: "自动化测试连接状态，不调用模型" } }));
  await page.route("**/api/studio/analyze", route => route.abort());
  await page.route("**/api/studio/blueprint", route => route.abort());
  await page.route("**/api/studio/review", route => route.abort());
}

