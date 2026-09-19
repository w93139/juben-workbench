import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { buildReviewPlan, prepareReviewScopes, reviewPlanDigest, reviewScopePayload, verifyReviewPlan } from "@/server/review-plan";
import { reviewArtifacts, reviewBlueprint } from "../fixtures/studio-review";

it("超过600KB全文稳定分段且每个UTF-16字符恰好覆盖一次，emoji不拆开", () => {
  const artifacts = reviewArtifacts().map(artifact => ({ ...artifact, content: ' 开场😀\n"证词"\\时间线。'.repeat(5000) }));
  const blueprint = reviewBlueprint();
  expect(Buffer.byteLength(JSON.stringify(artifacts))).toBeGreaterThan(600000);
  const plan = buildReviewPlan(blueprint, artifacts);
  expect(reviewPlanDigest(buildReviewPlan(blueprint, artifacts))).toBe(reviewPlanDigest(plan));
  for (const artifact of artifacts) {
    const parts = plan.parts.filter(part => part.artifactId === artifact.id);
    expect(parts[0].start).toBe(0); expect(parts.at(-1)!.end).toBe(artifact.content.length);
    let reconstructed = "";
    for (const [index, part] of parts.entries()) {
      if (index) expect(part.start).toBe(parts[index - 1].end);
      const content = artifact.content.slice(part.start, part.end);
      expect(content.length).toBeGreaterThan(0);
      expect(content.isWellFormed()).toBe(true);
      expect(part.hash).toBe(createHash("sha256").update(content).digest("hex"));
      expect(Buffer.byteLength(JSON.stringify(content))).toBeLessThanOrEqual(plan.limits.partBytes);
      reconstructed += content;
    }
    expect(reconstructed).toBe(artifact.content);
  }
  expect(plan.callsMax).toBe(5 * (plan.parts.length + plan.links.length));
});

it("全部关联组相邻原文有可追踪连接，共享连接去重但保留所有组依据", () => {
  const artifacts = reviewArtifacts(), blueprint = reviewBlueprint();
  const plan = buildReviewPlan(blueprint, artifacts, { partBytes: 40 });
  for (const group of plan.groups) for (let index = 1; index < group.parts.length; index++) {
    const ids = [group.parts[index - 1], group.parts[index]].sort();
    expect(plan.links.some(link => JSON.stringify(link.parts) === JSON.stringify(ids) && link.groups.includes(group.id))).toBe(true);
  }
  expect(plan.groups.some(group => group.id === "character:A")).toBe(true);
  expect(plan.groups.some(group => group.id === "round:R1")).toBe(true);
  expect(plan.groups.some(group => group.id === "source:A")).toBe(true);
  expect(new Set(plan.links.map(link => link.id)).size).toBe(plan.links.length);
  expect(plan.links.some(link => link.groups.length > 1)).toBe(true);
  for (const scope of [plan.parts[0], plan.links[0]]) {
    const payload = reviewScopePayload(plan, blueprint, artifacts, scope.id);
    for (const source of payload.sources) expect(source.content).toBe(artifacts.find(artifact => artifact.id === source.id)!.content.slice(source.start, source.end));
  }
});

it.each(["gap", "duplicate", "missing", "link", "metadata", "text", "blueprint", "version"])("篡改%s不能凭覆盖数量通过", mode => {
  const artifacts = reviewArtifacts(), blueprint = reviewBlueprint(), plan = buildReviewPlan(blueprint, artifacts);
  if (mode === "gap") plan.parts[0].start++;
  if (mode === "duplicate") plan.parts.push(plan.parts[0]);
  if (mode === "missing") plan.parts.pop();
  if (mode === "link") plan.links.pop();
  if (mode === "metadata") artifacts[0].title += "改";
  if (mode === "text") artifacts[0].content += "改";
  if (mode === "blueprint") blueprint.premise += "改";
  if (mode === "version") Object.assign(plan, { version: "untrusted" });
  expect(() => verifyReviewPlan(plan, blueprint, artifacts)).toThrow("不一致");
});

it("JSON转义计入容量，恰好边界接受，一字符超界分段，无法容纳原子则拒绝", () => {
  const artifact = { ...reviewArtifacts()[0], content: '"\\😀' };
  const size = Buffer.byteLength(JSON.stringify(artifact.content));
  const plan = buildReviewPlan(reviewBlueprint(), [artifact], { partBytes: size });
  expect(plan.parts).toHaveLength(1);
  expect(buildReviewPlan(reviewBlueprint(), [artifact], { partBytes: size - 1 }).parts).toHaveLength(2);
  expect(() => buildReviewPlan(reviewBlueprint(), [{ ...artifact, content: "😀" }], { partBytes: 5 })).toThrow("单个正文字符");
});

it.each(["empty", "whitespace", "duplicate", "source", "duplicateSource", "character", "round"])("无效%s输入明确拒绝而不无声漏组", mode => {
  const artifacts = reviewArtifacts();
  if (mode === "empty") artifacts.splice(0);
  if (mode === "whitespace") artifacts[0].content = "  \n ";
  if (mode === "duplicate") artifacts.push(artifacts[0]);
  if (mode === "source") artifacts[0].sourceIds = ["nonexistent"];
  if (mode === "duplicateSource") artifacts[0].sourceIds.push(artifacts[0].sourceIds[0]);
  if (mode === "character") artifacts[0].characterId = "nonexistent";
  if (mode === "round") artifacts[0].roundId = "nonexistent";
  expect(() => buildReviewPlan(reviewBlueprint(), artifacts)).toThrow();
});

it("分段、关联和最终完整请求超限均拒绝，不自动扩大或截断", () => {
  const artifacts = reviewArtifacts(), blueprint = reviewBlueprint();
  expect(() => buildReviewPlan(blueprint, artifacts, { maxParts: 1 })).toThrow("分段数量");
  expect(() => buildReviewPlan(blueprint, artifacts, { maxLinks: 1 })).toThrow("关联数量");
  expect(() => buildReviewPlan(blueprint, artifacts, { contextBytes: 1000, reportReserveBytes: 2 })).toThrow("请求容量");
  expect(() => buildReviewPlan(blueprint, artifacts, { reportReserveBytes: 1 })).toThrow("空报告");
  expect(() => buildReviewPlan(blueprint, artifacts, { partBytes: NaN })).toThrow("参数无效");
  expect(() => buildReviewPlan(blueprint, artifacts, { contextBytes: 600001 })).toThrow("参数无效");
  const plan = buildReviewPlan(blueprint, artifacts, { reportReserveBytes: 10 });
  expect(() => reviewScopePayload(plan, blueprint, artifacts, plan.parts[0].id, { report: "无法容纳的完整报告" })).toThrow("预留容量");
  expect(() => reviewScopePayload(plan, blueprint, artifacts, "unknown")).toThrow("范围不存在");
});

it("规划预检计入最终scope和全部组信息，精确容量可取请求，少一字节提前拒绝", () => {
  const artifacts = [reviewArtifacts()[0]], blueprint = reviewBlueprint();
  const plan = buildReviewPlan(blueprint, artifacts, { reportReserveBytes: 2 });
  const payload = reviewScopePayload(plan, blueprint, artifacts, plan.parts[0].id);
  const capacity = Buffer.byteLength(JSON.stringify(payload));
  const exact = buildReviewPlan(blueprint, artifacts, { reportReserveBytes: 2, contextBytes: capacity });
  expect(reviewScopePayload(exact, blueprint, artifacts, exact.parts[0].id)).toEqual(payload);
  expect(() => buildReviewPlan(blueprint, artifacts, { reportReserveBytes: 2, contextBytes: capacity - 1 })).toThrow("完整审查范围");
  const linked = buildReviewPlan(blueprint, reviewArtifacts(), { reportReserveBytes: 2 });
  const read = prepareReviewScopes(linked, blueprint, reviewArtifacts());
  const maximum = Math.max(...[...linked.parts, ...linked.links].map(scope => Buffer.byteLength(JSON.stringify(read(scope.id)))));
  expect(() => buildReviewPlan(blueprint, reviewArtifacts(), { reportReserveBytes: 2, contextBytes: maximum - 1 })).toThrow("完整审查范围");
});

it("执行读取器仅建立一次冻结输入，外部修改或修改返回载荷不能覆盖原文", () => {
  const artifacts = reviewArtifacts(), blueprint = reviewBlueprint(), plan = buildReviewPlan(blueprint, artifacts);
  const read = prepareReviewScopes(plan, blueprint, artifacts), id = plan.parts[0].id;
  const before = read(id), expected = structuredClone(before);
  artifacts[0].content = "变动"; blueprint.premise = "变动"; plan.parts[0].start++;
  before.blueprint.premise = "变动"; before.sources[0].sourceIds.push("变动");
  expect(read(id)).toEqual(expected);
});
