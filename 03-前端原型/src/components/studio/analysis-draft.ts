import type { WorkbenchState } from "@/domain/workbench";

export type Direction = NonNullable<WorkbenchState["authorDirections"]>[number];
export type AnalysisDraft = { outline: string; directions: Direction[]; basis: string | null };
// Session storage isolates tabs, including duplicated/opener tabs; memory protects failed writes during client navigation.
const memory = new Map<string, AnalysisDraft>();
const failures = new Map<string, unknown>();
const draftKey = (id: string) => `juben-workbench:analysis-draft:${id}`;
export function analysisDraftBasis(state: WorkbenchState) {
  return JSON.stringify([state.sourceRevision, state.analysisRevision, state.analysisSourceRevision, state.authorRevision, state.authorAnalysisRevision, state.authorOutline, state.authorDirections]);
}
export function readAnalysisDraft(id: string): { draft: AnalysisDraft | null; error: unknown } {
  if (typeof window === "undefined") return { draft: null, error: null };
  if (memory.has(id)) return { draft: memory.get(id)!, error: failures.get(id) ?? null };
  try {
    // Legacy localStorage remains untouched. A session tombstone prevents reimport after save/discard.
    const raw = window.sessionStorage.getItem(draftKey(id)) ?? window.localStorage.getItem(draftKey(id));
    if (!raw) return { draft: null, error: null };
    const value = JSON.parse(raw);
    if (value === null) return { draft: null, error: null };
    if (typeof value.outline !== "string" || !Array.isArray(value.directions) || !value.directions.every((d: Direction) => d && ["id", "title", "summary", "outline", "risk"].every(k => typeof d[k as keyof Direction] === "string"))) throw new Error("本机作者草稿格式异常，已保留原记录，请先备份后处理。");
    return { draft: { outline: value.outline, directions: value.directions, basis: typeof value.basis === "string" ? value.basis : null }, error: null };
  } catch (error) { return { draft: null, error }; }
}
export function persistAnalysisDraft(id: string, draft: AnalysisDraft | null) {
  if (draft) memory.set(id, draft); else memory.delete(id);
  try {
    window.sessionStorage.setItem(draftKey(id), JSON.stringify(draft));
    failures.delete(id);
  } catch (error) { failures.set(id, error); throw error; }
}
