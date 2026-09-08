import { describe, expect, it } from "vitest";
import { MockProjectService } from "@/services/mock-project-service";
import { ServiceError, type StoragePort } from "@/services/contracts";
import { demoContentSchema, envelopeSchema } from "@/domain/models";
import snapshot from "@/mocks/names-beyond.json";

class MemoryStorage implements StoragePort {
  raw: string | null = null;
  failWrite = false;
  private queue: Promise<unknown> = Promise.resolve();
  read() { return this.raw; }
  write(value: string) {
    if (this.failWrite) throw new ServiceError("STORAGE_UNAVAILABLE", "模拟存储已满");
    this.raw = value;
  }
  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation, operation);
    this.queue = pending.catch(() => undefined);
    return pending;
  }
}
function setup() {
  const storage = new MemoryStorage();
  let id = 0;
  return { storage, service: new MockProjectService(storage, () => "2026-09-07T01:00:00.000Z", () => String(++id)) };
}
const input = { title: "原创项目", note: "初始创意", template: "names-beyond" as const };

describe("演示数据契约", () => {
  it("结构相互引用完整，来源可追溯，历史检查没有冒充真人测试", () => {
    const demo = demoContentSchema.parse(snapshot);
    expect(demo.characters).toHaveLength(5);
    expect(demo.relationships).toHaveLength(10);
    expect(demo.knowledge).toHaveLength(36);
    expect(demo.clues).toHaveLength(23);
    expect(demo.rounds.reduce((sum, round) => sum + round.minutes, 0)).toBe(demo.plannedMinutes);
    const characterIds = new Set(demo.characters.map((c) => c.id));
    demo.relationships.forEach((r) => r.participants.forEach((id) => expect(characterIds.has(id)).toBe(true)));
    demo.claims.filter((c) => c.tier === "required").forEach((claim) => expect(demo.clues.some((clue) => clue.supports.includes(claim.id))).toBe(true));
    expect(demo.sources.every((s) => /^[a-f0-9]{64}$/.test(s.sha256))).toBe(true);
    expect(demo.checks.find((c) => c.kind === "human")?.origin).toBe("not-run");
    expect(demo.checks.find((c) => c.kind === "simulation")?.origin).toBe("not-run");
  });
});

describe("项目保存与边界", () => {
  it("原始样例只读，首次读取不写存储", async () => {
    const { service, storage } = setup();
    const original = await service.get("demo-names");
    await expect(service.update(original.id, 0, { title: "改名", note: "" })).rejects.toMatchObject({ code: "READ_ONLY" });
    await expect(service.setDecision(original.id, 0, original.decisions[0].id, "open")).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(storage.raw).toBeNull();
  });
  it("副本与空项目隔离，重建Service后恢复已保存状态", async () => {
    const { service, storage } = setup();
    const copy = await service.create(input);
    const blank = await service.create({ title: "空白", note: "", template: "blank" });
    await service.setDecision(copy.id, 0, copy.decisions[0].id, "open");
    const restored = new MockProjectService(storage);
    expect((await restored.get(copy.id)).decisions[0].status).toBe("open");
    expect((await restored.get("demo-names")).decisions[0].status).toBe("confirmed");
    expect((await restored.get(blank.id)).revision).toBe(0);
    expect(await restored.getContent(blank.id)).toBeNull();
    expect((await restored.getContent(copy.id))?.checks.find((c) => c.kind === "human")?.origin).toBe("not-run");
  });
  it("返回数据修改不会绕过保存或污染样例", async () => {
    const { service } = setup();
    const baseline = await service.get("demo-names"); baseline.decisions[0].status = "open";
    const content = await service.getContent("demo-names"); content!.characters[0].name = "改名";
    expect((await service.get("demo-names")).decisions[0].status).toBe("confirmed");
    expect((await service.getContent("demo-names"))?.characters[0].name).toBe("许知微");
  });
  it("拒绝过期更新，并行提交只有一个成功", async () => {
    const { service } = setup();
    const p = await service.create(input);
    const results = await Promise.allSettled([
      service.update(p.id, 0, { title: "先提交", note: "A" }),
      service.update(p.id, 0, { title: "后提交", note: "B" }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect((results[1] as PromiseRejectedResult).reason.code).toBe("CONFLICT");
    expect((await service.get(p.id)).note).toBe("A");
  });
  it("保存失败不改变旧值，之后可以重试", async () => {
    const { service, storage } = setup(); const p = await service.create(input); const before = storage.raw;
    storage.failWrite = true;
    await expect(service.update(p.id, 0, { title: "新标题", note: "新备注" })).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(storage.raw).toBe(before);
    storage.failWrite = false;
    expect((await service.update(p.id, 0, { title: "新标题", note: "新备注" })).revision).toBe(1);
  });
  it.each(["", "   ", "字".repeat(41)])("拒绝无效标题 %s", async (title) => {
    const { service, storage } = setup();
    await expect(service.create({ ...input, title })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.raw).toBeNull();
  });
  it("无效项目、决定、状态不写入", async () => {
    const { service, storage } = setup(); const p = await service.create(input); const before = storage.raw;
    await expect(service.get("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.setDecision(p.id, 0, "missing", "open")).rejects.toMatchObject({ code: "NOT_FOUND" });
    // @ts-expect-error exercise the runtime boundary
    await expect(service.setDecision(p.id, 0, p.decisions[0].id, "invalid")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.raw).toBe(before);
  });
  it.each([
    ["{broken", "STORAGE_CORRUPT"],
    [JSON.stringify({ schemaVersion: 4, projects: [] }), "STORAGE_VERSION"],
    [JSON.stringify({ schemaVersion: 1, projects: [{}] }), "STORAGE_CORRUPT"],
  ])("损坏或未知版本保留原始备份：%s", async (raw, code) => {
    const { service, storage } = setup(); storage.raw = raw;
    await expect(service.list()).rejects.toMatchObject({ code });
    await expect(service.create(input)).rejects.toMatchObject({ code });
    expect(await service.getBackup()).toBe(raw);
    expect((await service.get("demo-names")).readOnly).toBe(true);
  });
  it("恢复必须针对已查看的原始数据，避免清空期间的新更新", async () => {
    const { service, storage } = setup(); storage.raw = "broken";
    await expect(service.resetLocalProjects("old")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(storage.raw).toBe("broken");
    await service.resetLocalProjects("broken");
    expect(envelopeSchema.parse(JSON.parse(storage.raw!)).projects).toEqual([]);
    expect(await service.list()).toHaveLength(1);
  });
  it("拒绝存储中伪造的只读身份或重复ID", async () => {
    const { service, storage } = setup(); const p = await service.create(input);
    storage.raw = JSON.stringify({ schemaVersion: 1, projects: [{ ...p, readOnly: true }] });
    await expect(service.list()).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });
    storage.raw = JSON.stringify({ schemaVersion: 1, projects: [p, p] });
    await expect(service.list()).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });
  });
});
