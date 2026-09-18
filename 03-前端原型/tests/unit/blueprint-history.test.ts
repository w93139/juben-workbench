import { expect, it } from "vitest";
import { archiveCurrentBlueprint, assertHistoryVersion, removeBlueprintHistory } from "@/domain/blueprint-history";
import { blueprintDataSchema, checkBlueprint, emptyBlueprintData } from "@/domain/blueprint";
import { affectedReferences, newBlueprintRow, removeBlueprintRow, sectionLabels, type EditableBlueprintSection } from "@/domain/blueprint-editing";
import { applyBlueprintDraft } from "@/domain/blueprint-drafts";
import { workbenchSchema, reviewCurrent } from "@/domain/workbench";
import { createProjectBackup, parseProjectBackup, serializeProjectBackup } from "@/domain/project-backup";
import { backupFixture } from "../fixtures/project-backup";
import { completeBlueprint } from "../fixtures/blueprint";

it("历史清理使用独立CAS，不影响当前正文、通过资格或草稿正式基准", () => {
  const { state } = backupFixture(); const before = structuredClone(state), selected = structuredClone(state.versions[0]);
  expect(reviewCurrent(state)).toBe(true); removeBlueprintHistory(state, 0, 0, selected);
  expect(state.historyRevision).toBe(1); expect(state.versions).toEqual(before.versions.slice(1)); expect(reviewCurrent(state)).toBe(true);
  expect({ ...state, versions: before.versions, historyRevision: 0 }).toEqual(before);
  const cleaned = structuredClone(state); expect(() => removeBlueprintHistory(state, 0, 0, selected)).toThrow("历史版本已"); expect(state).toEqual(cleaned);
});
it("满额拒绝提交后，清理一份即可提交原草稿，新版递增且旧通过失效", () => {
  const { state } = backupFixture(), draft = state.blueprintDrafts[1], before = structuredClone(state);
  expect(() => applyBlueprintDraft(state, draft.id, draft.revision)).toThrow("20份"); expect(state).toEqual(before);
  removeBlueprintHistory(state, 0, 0, state.versions[0]); applyBlueprintDraft(state, draft.id, draft.revision);
  expect(state.blueprint).toEqual(draft.data); expect(state.revision).toBe(10); expect(state.blueprintRevision).toBe(4); expect(state.historyRevision).toBe(2); expect(state.versions).toHaveLength(20); expect(state.versions.at(-1)).toEqual({ revision: before.blueprintRevision, data: before.blueprint }); expect(reviewCurrent(state)).toBe(false);
});
it.each(["list", "row", "job"])("历史%s变化时不删除选中内容", kind => {
  const { state } = backupFixture(), selected = structuredClone(state.versions[0]);
  if (kind === "list") state.historyRevision++;
  if (kind === "row") state.versions[0].data.truth = "同编号下的不同内容";
  if (kind === "job") state.job = { jobId: "synthetic", operation: "blueprint", phase: "生成中", sourceRevision: 2, blueprintRevision: 3 };
  const before = structuredClone(state); expect(() => removeBlueprintHistory(state, 0, 0, selected)).toThrow(); expect(state).toEqual(before);
});
it("重新归档旧版也递增历史CAS，过期对照不能恢复；没有蓝图不造历史", () => {
  const { state } = backupFixture(); state.versions = [state.versions[0]]; const selected = structuredClone(state.versions[0]);
  archiveCurrentBlueprint(state); expect(state.historyRevision).toBe(1); expect(() => assertHistoryVersion(state, 0, 0, selected)).toThrow();
  state.blueprint = null; archiveCurrentBlueprint(state); expect(state.historyRevision).toBe(1);
});
it("旧备份默认历史CAS，新备份往返保留，重复revision历史按索引和内容区别", () => {
  const { project, state } = backupFixture(); const old = { ...state, historyRevision: undefined }; expect(workbenchSchema.parse(old).historyRevision).toBe(0);
  state.versions[1].revision = state.versions[0].revision; removeBlueprintHistory(state, 0, 1, state.versions[1]); expect(state.versions[0].data.premise).toBe("自造历史0");
  const backup = createProjectBackup(project, state, true); expect(parseProjectBackup(serializeProjectBackup(backup)).workbench.historyRevision).toBe(1);
});
it("删除角色保留全部悬空引用，私人线索不会自动公开，原快照可撤销", () => {
  const data = completeBlueprint(); data.clues[0].characterIds = ["B"]; const original = structuredClone(data);
  const next = removeBlueprintRow(data, "characters", "B");
  expect(data).toEqual(original); expect(next.clues[0].characterIds).toEqual(["B"]); expect(next.knowledge[0].characterId).toBe("B"); expect(next.relationships[0].toId).toBe("B");
  expect(affectedReferences(data, "characters", "B")).toHaveLength(3); expect(checkBlueprint(next).some(i => i.section === "clues" && i.severity === "error")).toBe(true);
  next.characters = original.characters; expect(checkBlueprint(next)).toEqual([]);
});
it("九类未完成新增记录可持久化为草稿，编号固定，文本12000字保留", () => {
  const data = emptyBlueprintData();
  for (const section of Object.keys(sectionLabels) as EditableBlueprintSection[]) Object.assign(data, { [section]: [newBlueprintRow(section, `new-${section}`)] });
  data.characters[0].privateInformation = "秘密".repeat(6000);
  const saved = blueprintDataSchema.parse(data); expect(saved.characters[0].privateInformation).toHaveLength(12000); expect(saved.events[0].id).toBe("new-events"); expect(checkBlueprint(saved).length).toBeGreaterThan(0);
});
it.each([-1, 20, 0.5, NaN])("非法历史位置 %s 不删除尾项或其他内容", index => {
  const { state } = backupFixture(), before = structuredClone(state);
  expect(() => removeBlueprintHistory(state, 0, index, undefined as never)).toThrow("历史版本已"); expect(state).toEqual(before);
});
