import { describe, expect, it } from "vitest";
import { MockProjectService } from "@/services/mock-project-service";
import { ServiceError, type StoragePort } from "@/services/contracts";
import { classifySource, sourceImportPolicy, sourceKinds, sourceSizeLabel, type SourceFileInput } from "@/domain/source-import";

class Memory implements StoragePort {
  raw: string | null = null;
  fail = false;
  read() { return this.raw; }
  write(value: string) { if (this.fail) throw new ServiceError("STORAGE_UNAVAILABLE", "模拟容量不足"); this.raw = value; }
  exclusive<T>(operation: () => Promise<T>) { return operation(); }
}
async function setup() {
  const storage = new Memory(); let id = 0;
  const service = new MockProjectService(storage, () => "2026-09-08T02:00:00.000Z", () => String(++id));
  const project = await service.create({ title: "整套材料", note: "", template: "blank" });
  return { storage, service, project };
}
function file(name: string, relativePath?: string, size = 100): SourceFileInput { return { name, relativePath, size, mime: "", lastModified: 1234 }; }

describe("多格式材料导入", () => {
  it("分类给出各自的未来处理方式，不把音视频、压缩包视为OCR结果", () => {
    expect(["扫描.TIFF", "文件.PDF", "文档.doc", "录音.flac", "视频.MOV", "字幕.srt", "整包.7z", "工具.exe"].map(classifySource)).toEqual(["image", "pdf", "document", "audio", "video", "subtitle", "archive", "unknown"]);
    expect(sourceKinds.audio.plan).toContain("语音转写");
    expect(sourceKinds.video.plan).toContain("画面文字识别");
    expect(sourceKinds.archive.plan).toContain("待解包");
    expect(sourceSizeLabel(3 * 1024 ** 3)).toBe("3 GB");
  });

  it("预览不写入，系统文件、空文件和不支持项可明确略过后登记其余素材", async () => {
    const { service, storage, project } = await setup(); const before = storage.raw;
    const preview = await service.previewSourceFiles(project.id, [file("角色.pdf", "整包/玩家/角色.pdf"), file("提示.mp3", "整包/音频/提示.mp3"), file(".DS_Store", "整包/.DS_Store"), file("空.txt", undefined, 0), file("工具.exe")]);
    expect(preview.eligibleCount).toBe(2); expect(preview.skippedCount).toBe(3);
    expect(preview.rows.slice(2).map((row) => row.reason)).toEqual(["隐藏或系统文件，已略过", "空文件，已略过", "不支持的格式，已略过"]);
    expect(storage.raw).toBe(before);
    const next = await service.registerSourceFiles(project.id, project.revision, preview.rows.filter((row) => row.eligible).map((row) => row.file));
    expect(next.research.documents.map((doc) => doc.kind)).toEqual(["PDF", "音频"]);
    expect(next.research.documents.every((doc) => doc.status === "registered" && doc.fixtureId === null)).toBe(true);
    expect(next.research.issues).toEqual([]);
    await expect(service.startResearchJob(next.id, next.revision, "ocr")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("保留子目录同名文件，不把不同修改时间的版本一律去重", async () => {
    const { service, project } = await setup();
    const a = file("001.jpg", "素材/角色A/001.jpg"); const b = file("001.jpg", "素材/角色B/001.jpg");
    const p = await service.registerSourceFiles(project.id, 0, [a, b]);
    expect(p.research.documents.map((doc) => doc.relativePath)).toEqual([a.relativePath, b.relativePath]);
    const preview = await service.previewSourceFiles(p.id, [a, b, { ...a, lastModified: 5678 }]);
    expect(preview.rows.map((row) => row.eligible)).toEqual([false, false, true]);
    expect(preview.rows[0].reason).toContain("疑似重复");
  });

  it("整批超过10份、项目超过30份和大于30MB的文件可登记，大文件只有提醒", async () => {
    const { service, storage, project } = await setup();
    const files = Array.from({ length: 40 }, (_, i) => file(`${i}.png`, `图片/${i}.png`, 40 * 1024 ** 2));
    files.push(file("主持录像.mp4", "视频/主持录像.mp4", 3 * 1024 ** 3));
    const preview = await service.previewSourceFiles(project.id, files);
    expect(preview.eligibleCount).toBe(41); expect(preview.rows.at(-1)?.warning).toContain("大文件可登记");
    const p = await service.registerSourceFiles(project.id, 0, files);
    expect(p.research.documents).toHaveLength(41);
    expect((await new MockProjectService(storage).get(p.id)).research.documents.at(-1)?.size).toBe(3 * 1024 ** 3);
    expect(storage.raw!.length).toBeLessThan(30000); // bytes were never stored
  });

  it("数量保护在Service执行，达到5000份后拒绝新批次且原数据不变", async () => {
    const { service, storage, project } = await setup(); let p = project;
    const excessive = Array.from({ length: sourceImportPolicy.batchFiles + 1 }, (_, i) => file(`${i}.txt`));
    await expect(service.previewSourceFiles(p.id, excessive)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.registerSourceFiles(p.id, p.revision, excessive)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    for (const start of [0, 2000, 4000]) {
      const files = Array.from({ length: Math.min(2000, 5000 - start) }, (_, i) => file(`${start + i}.txt`));
      p = await service.registerSourceFiles(p.id, p.revision, files);
    }
    expect(p.research.documents).toHaveLength(5000);
    const before = storage.raw;
    await expect(service.registerSourceFiles(p.id, p.revision, [file("新增.txt")])).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.addResearchDemo(p.id, p.revision)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.raw).toBe(before);
  });

  it("非法相对路径、无效批次和只读写入不会产生部分登记", async () => {
    const { service, storage, project } = await setup(); const before = storage.raw;
    for (const path of ["../逃逸.txt", "/绝对/逃逸.txt", "包/../逃逸.txt", "包\\逃逸.txt", "包/其他名字.txt"]) {
      const preview = await service.previewSourceFiles(project.id, [file("逃逸.txt", path)]);
      expect(preview.rows[0].eligible).toBe(false);
      await expect(service.registerSourceFiles(project.id, 0, [file("有效.pdf"), file("逃逸.txt", path)])).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(service.registerSourceFiles("demo-names", 0, [file("素材.mp4")])).rejects.toMatchObject({ code: "READ_ONLY" });
    // @ts-expect-error validate untyped callers at the service boundary
    await expect(service.previewSourceFiles(project.id, [{}])).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.raw).toBe(before);
  });

  it("保存失败保持原记录，重试一次成功；旧预览不能覆盖后来修改", async () => {
    const { service, storage, project } = await setup(); const files = [file("音轨.wav")]; const before = storage.raw;
    storage.fail = true;
    await expect(service.registerSourceFiles(project.id, 0, files)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(storage.raw).toBe(before); storage.fail = false;
    const saved = await service.registerSourceFiles(project.id, 0, files);
    await expect(service.registerSourceFiles(project.id, 0, files)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await service.get(project.id)).research.documents).toHaveLength(1);
    expect(saved.research.materialRevision).toBe(1);
  });

  it("格式2项目保留研究记录，读取不写，首次成功修改才升级为3", async () => {
    const { service, storage, project } = await setup();
    const p = await service.addResearchDemo(project.id, 0);
    storage.raw = JSON.stringify({ schemaVersion: 2, projects: [p] }); const before = storage.raw;
    expect((await service.get(p.id)).research).toEqual(p.research); expect(storage.raw).toBe(before);
    storage.fail = true;
    await expect(service.registerSourceFiles(p.id, p.revision, [file("原音.wav")])).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(storage.raw).toBe(before); storage.fail = false;
    const next = await service.registerSourceFiles(p.id, p.revision, [file("原音.wav")]);
    expect(next.research.documents[0]).toEqual(p.research.documents[0]);
    expect(JSON.parse(storage.raw!).schemaVersion).toBe(3);
  });

  it("旧格式接受过的特殊文件名原样保留，不被新导入规则判坏", async () => {
    const { service, storage, project } = await setup();
    const originals = ["旧\\页.pdf", "旧\n页.pdf"].map((name, index) => ({ id: `old-${index}`, name, size: 100, mime: "application/pdf", origin: "local-metadata", kind: "待分类", audience: "待确认", edition: "待确认", status: "registered", fixtureId: null }));
    storage.raw = JSON.stringify({ schemaVersion: 2, projects: [{ ...project, research: { ...project.research, documents: originals } }] });
    const before = storage.raw;
    expect((await service.get(project.id)).research.documents).toEqual(originals);
    expect(storage.raw).toBe(before);
    const next = await service.registerSourceFiles(project.id, 0, [file("新音频.wav")]);
    expect(next.research.documents.slice(0, 2)).toEqual(originals);
    expect((await new MockProjectService(storage).get(project.id)).research.documents.slice(0, 2)).toEqual(originals);
  });
});
