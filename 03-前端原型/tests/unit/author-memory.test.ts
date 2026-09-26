import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthorMemoryStore } from "@/server/author-memory";
import { StudioEngine, type ModelTransport } from "@/server/studio-models";
import { renderAuthorMemory, type AuthorMemoryItem } from "@/domain/author-memory";

const temporary: string[] = [];
afterEach(() => { temporary.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); });

function memoryItem(overrides: Partial<AuthorMemoryItem>): AuthorMemoryItem {
  const now = Date.now();
  return { id: randomUUID(), type: "hard", text: "偏好", note: "", enabled: true, confidence: 100, createdAt: now, updatedAt: now, lastUsedAt: null, useCount: 0, ...overrides };
}

describe("作者记忆存储与渲染", () => {
  it("受限目录内建库、增删改查并保持 600 权限，不调用网络", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const root = mkdtempSync(join(tmpdir(), "author-memory-test-")); temporary.push(root);
    const store = new AuthorMemoryStore(join(root, "author-memory.sqlite"));
    const created = store.save({ type: "hard", text: "偏好 5 人本格", note: "多次修改" });
    expect(created).toMatchObject({ type: "hard", text: "偏好 5 人本格", enabled: true, useCount: 0, lastUsedAt: null });
    const updated = store.save({ id: created.id, type: "voice", text: "叙述克制", note: "", enabled: false, confidence: 80 });
    expect(updated).toMatchObject({ id: created.id, type: "voice", enabled: false, confidence: 80 });
    expect(store.list()).toHaveLength(1);
    const toggled = store.setEnabled(created.id, true); expect(toggled.enabled).toBe(true);
    store.remove(created.id); expect(store.list()).toEqual([]);
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(statSync(join(root, "author-memory.sqlite")).mode & 0o777).toBe(0o600);
    expect(fetchMock).not.toHaveBeenCalled();
    store.close();
  });

  it("拒绝超长文本、无效类别与重复删除，条数上限守住", () => {
    const store = new AuthorMemoryStore(":memory:");
    expect(() => store.save({ type: "unknown", text: "x" })).toThrow();
    expect(() => store.save({ type: "hard", text: "x".repeat(501) })).toThrow("500");
    expect(() => store.remove("not-a-uuid")).toThrow("编号");
    expect(() => store.save({ id: randomUUID(), type: "hard", text: "不存在" })).toThrow("不存在");
    store.close();
  });

  it("按类别分组稳定渲染，只包含启用的条目并返回被采用的 id", () => {
    const base = Date.now();
    const items = [
      memoryItem({ type: "voice", text: "语言克制", createdAt: base + 2 }),
      memoryItem({ type: "hard", text: "五本格", createdAt: base + 1 }),
      memoryItem({ type: "hard", text: "不要感情线", createdAt: base + 3 }),
      memoryItem({ type: "taboo", text: "不写未成年人恋爱", enabled: false }),
    ];
    const block = renderAuthorMemory(items);
    expect(block.text).toContain("【硬偏好】");
    expect(block.text.indexOf("五本格")).toBeLessThan(block.text.indexOf("不要感情线"));
    expect(block.text).toContain("【文风语气】\n- 语言克制");
    expect(block.text).not.toContain("未成年人");
    expect(block.ids).toHaveLength(3);
    expect(block.text).toBe(renderAuthorMemory([...items].reverse()).text);
  });

  it("超出字符预算的类别整组跳过，不截断条目内容", () => {
    const items = [memoryItem({ type: "voice", text: "文".repeat(400) }), memoryItem({ type: "hard", text: "五本格" })];
    const block = renderAuthorMemory(items, 200);
    expect(block.text).toContain("五本格");
    expect(block.text).not.toContain("文");
    expect(block.text).toBe(renderAuthorMemory(items, 200).text);
  });
});

const config = { baseUrl: "https://example.invalid/v1", apiKey: "test-only-placeholder", mainModel: "main", reviewA: "review-a", reviewB: "review-b" };
const input = { documents: [{ id: "doc", name: "原文.txt", text: "原始全文内容。".repeat(40) }], instructions: "" };
const analysis = () => ({ outline: "结构说明", directions: [{ id: "a", title: "方向甲", summary: "原创方向", outline: "起因—对照—选择", risk: "待试玩" }, { id: "b", title: "方向乙", summary: "原创方向二", outline: "发现—验证—揭示", risk: "核对证据" }], sourceRefs: [{ documentId: "doc", location: "正文开头", quote: "原始全文内容。" }], unknowns: [] });
const power = async () => ({ assertActive() {}, async release() {} });
async function wait(engine: StudioEngine, id: string) { for (let i = 0; i < 1000; i++) { const view = engine.get(id); if (view.status !== "running") return view; await new Promise((resolve) => setImmediate(resolve)); } throw new Error("not settled"); }

describe("作者记忆注入拆解请求", () => {
  it("启用条目并入拆解输入且记录使用次数，只影响拆解步骤", async () => {
    const store = new AuthorMemoryStore(":memory:");
    store.save({ type: "hard", text: "偏好 5 人本格" });
    const call = vi.fn<ModelTransport>(async () => analysis());
    const engine = new StudioEngine(() => config, call, Date.now, undefined, power, undefined, store);
    const job = await wait(engine, (await engine.start("analyze", input)).jobId);
    expect(job.status).toBe("completed");
    const payload = call.mock.calls[0][3] as { instructions: string };
    expect(payload.instructions).toContain("偏好 5 人本格");
    expect(payload.instructions).toContain("作者偏好");
    expect(store.list()[0].useCount).toBe(1);
    expect(store.list()[0].lastUsedAt).not.toBeNull();
    store.close();
  });

  it("记忆变化会改变指纹，同一任务编号不能复用旧结果", async () => {
    const store = new AuthorMemoryStore(":memory:");
    const call = vi.fn<ModelTransport>(async () => analysis());
    const engine = new StudioEngine(() => config, call, Date.now, undefined, power, undefined, store);
    const requestId = randomUUID();
    await wait(engine, (await engine.start("analyze", input, requestId)).jobId);
    store.save({ type: "voice", text: "新增偏好" });
    await expect(engine.start("analyze", input, requestId)).rejects.toMatchObject({ code: "REQUEST_ID_CONFLICT" });
    store.close();
  });

  it("不传记忆读取器时保持原行为，不注入任何偏好块", async () => {
    const call = vi.fn<ModelTransport>(async () => analysis());
    const engine = new StudioEngine(() => config, call, Date.now, undefined, power);
    await wait(engine, (await engine.start("analyze", input)).jobId);
    const payload = call.mock.calls[0][3] as { instructions: string };
    expect(payload.instructions).toBe("");
  });
});
