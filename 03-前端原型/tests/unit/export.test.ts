import { describe, expect, test } from "vitest";
import { projectSchema, blankDecisions } from "../../src/domain/models";
import { emptyResearch } from "../../src/domain/research";
import { emptyBlueprintData } from "../../src/domain/blueprint";
import { artifactSchema, type Artifact } from "../../src/domain/production";
import { exportArtifacts, exportCharacterDirectories } from "../../src/domain/export";
import { crc32, createZip, prepareExport } from "../../src/services/export-service";

const time = "2026-09-08T00:00:00.000Z";
function artifact(input: Partial<Artifact> = {}) { return artifactSchema.parse({ id: "a1", logicalKey: "character:a", module: "character", title: "甲角色本", audience: "player", characterId: "a", roundId: null, blueprintVersionId: "v1", version: 1, content: "甲的正文", createdAt: time, plannedPath: null, origin: "mock", ...input }); }
function project(artifacts: Artifact[] = []) {
  return projectSchema.parse({ id: "project-export", title: "测试剧本", note: "", template: "blank", readOnly: false, revision: 4, createdAt: time, updatedAt: time, decisions: blankDecisions, research: emptyResearch(), blueprint: { draft: emptyBlueprintData(), revision: 1, savedAt: time, sourceLabel: "作者数据", versions: ["v1", "v2"].map((id) => ({ id, label: id, createdAt: time, data: emptyBlueprintData() })) }, production: { artifacts, jobs: [], reviews: [] } });
}

describe("已有正文导出", () => {
  test("仅选择指定蓝图的最新版本，乱序历史不覆盖新版，空新稿不回退旧稿", () => {
    const p = project([artifact({ id: "new", version: 2, content: "新版" }), artifact(), artifact({ id: "other", blueprintVersionId: "v2", version: 3, content: "其他蓝图" })]);
    expect(exportArtifacts(p, "v1", "all").map((item) => item.content)).toEqual(["新版"]);
    expect(exportArtifacts(p, "missing", "all")).toEqual([]);
    p.production!.artifacts.push(artifact({ id: "empty", version: 4, content: " " }));
    expect(exportArtifacts(p, "v1", "all")).toEqual([]);
  });
  test("角色包不含主持正文，全包按角色和主持隔离，名称不能越出包内路径", () => {
    const p = project([artifact(), artifact({ id: "b", logicalKey: "character:b", characterId: "../../乙", title: "../../甲角色本", content: "乙私密" }), artifact({ id: "h", logicalKey: "host", module: "host", audience: "host", characterId: null, content: "主持谜底" })]);
    const players = prepareExport(p, "v1", "character", time);
    expect(players.materialCount).toBe(2);
    expect(players.files.map((file) => file.content).join("\n")).not.toContain("主持谜底");
    expect(players.files.filter((file) => file.path.endsWith(".md") && file.path !== "00-使用说明.md").every((file) => file.path.startsWith("玩家材料/角色-"))).toBe(true);
    const all = prepareExport(p, "v1", "all", time);
    expect(all.materialCount).toBe(3);
    expect(all.files.some((file) => file.path.startsWith("主持材料-含谜底/") && file.content === "主持谜底")).toBe(true);
    expect(all.files.every((file) => !file.path.split("/").includes(".."))).toBe(true);
    expect(new Set(all.files.map((file) => file.path)).size).toBe(all.files.length);
    const manifest = JSON.parse(all.files.find((file) => file.path.endsWith(".json"))!.content);
    expect(manifest.blueprint.id).toBe("v1");
    expect(manifest.checks.humanPlaytest).toContain("尚未真人试玩");
    expect(manifest.checks.realAIReview).toContain("未接入");
    expect(manifest.checks.fullStaticConsistency).toContain("未执行");
    expect(manifest.materials.map((item: { id: string }) => item.id)).toEqual(["a1", "b", "h"]);
  });
  test("不同原始角色ID即使清理、截断或大小写碰撞仍隔离，跨分类和蓝图目录一致", () => {
    const ids = ["a/b", "a_b", "Case", "case", `${"长".repeat(70)}甲`, `${"长".repeat(70)}乙`, "é", "e\u0301"];
    const records = ids.flatMap((characterId, index) => [
      artifact({ id: `character-${index}`, logicalKey: `character:${characterId}`, characterId, content: `角色秘密${index}` }),
      artifact({ id: `private-${index}`, logicalKey: `private:${characterId}`, characterId, module: "private", content: `私人更新${index}` }),
      artifact({ id: `older-${index}`, logicalKey: `character:${characterId}`, characterId, blueprintVersionId: "v2", content: `另一版${index}` }),
    ]);
    const p = project(records);
    const directories = exportCharacterDirectories(p);
    expect(new Set([...directories.values()].map((path) => path.normalize("NFC").toLowerCase())).size).toBe(ids.length);
    expect([...directories.values()].every((path) => new TextEncoder().encode(path).length < 255)).toBe(true);
    const maps = (["character", "private", "all"] as const).map((scope) => {
      const manifest = JSON.parse(prepareExport(p, "v1", scope, time).files.find((file) => file.path.endsWith(".json"))!.content);
      return new Map(manifest.materials.map((item: { characterId: string; path: string }) => [item.characterId, item.path.split("/")[1]]));
    });
    for (const id of ids) {
      expect(maps[0].get(id)).toBe(directories.get(id));
      expect(maps[1].get(id)).toBe(directories.get(id));
      expect(maps[2].get(id)).toBe(directories.get(id));
    }
    const other = JSON.parse(prepareExport(p, "v2", "all", time).files.find((file) => file.path.endsWith(".json"))!.content);
    expect(other.materials.every((item: { characterId: string; path: string }) => item.path.split("/")[1] === directories.get(item.characterId))).toBe(true);
    p.production!.artifacts.reverse();
    expect([...exportCharacterDirectories(p)]).toEqual([...directories]);
  });
  test("无正文或版本不存在拒绝生成包，空分类也不伪造", () => {
    expect(() => prepareExport(project(), "v1", "all")).toThrow("还没有这类正文");
    expect(() => prepareExport(project([artifact()]), "v1", "host")).toThrow("还没有这类正文");
    expect(() => prepareExport(project([artifact()]), "missing", "all")).toThrow("选择已经保存");
  });
  test("标准ZIP存储格式含UTF-8、正确CRC、中央目录及结束记录", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const files = [{ path: "玩家/甲.md", content: "你好，剧本。" }, { path: "manifest.json", content: '{"version":1}' }];
    const zip = createZip(files); const view = new DataView(zip.buffer); const decoder = new TextDecoder();
    let offset = 0;
    const locations: number[] = [];
    for (const file of files) {
      locations.push(offset);
      expect(view.getUint32(offset, true)).toBe(0x04034b50);
      expect(view.getUint16(offset + 6, true)).toBe(0x0800);
      expect(view.getUint16(offset + 8, true)).toBe(0);
      const length = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true);
      expect(decoder.decode(zip.slice(offset + 30, offset + 30 + nameLength))).toBe(file.path);
      const body = zip.slice(offset + 30 + nameLength, offset + 30 + nameLength + length);
      expect(decoder.decode(body)).toBe(file.content); expect(view.getUint32(offset + 14, true)).toBe(crc32(body));
      offset += 30 + nameLength + length;
    }
    const centralStart = offset;
    for (const [index, file] of files.entries()) {
      expect(view.getUint32(offset, true)).toBe(0x02014b50);
      expect(view.getUint32(offset + 42, true)).toBe(locations[index]);
      const nameLength = view.getUint16(offset + 28, true);
      expect(decoder.decode(zip.slice(offset + 46, offset + 46 + nameLength))).toBe(file.path);
      offset += 46 + nameLength;
    }
    expect(view.getUint32(offset, true)).toBe(0x06054b50);
    expect(view.getUint16(offset + 10, true)).toBe(files.length);
    expect(view.getUint32(offset + 16, true)).toBe(centralStart);
    expect(view.getUint32(offset + 12, true)).toBe(offset - centralStart);
    expect(zip.length).toBe(offset + 22);
  });
});
