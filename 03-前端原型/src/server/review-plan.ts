import { createHash } from "node:crypto";
import type { BlueprintData } from "@/domain/blueprint";
import { studioArtifactSchema, type StudioArtifact } from "@/domain/studio";
import { SINGLE_CONTEXT_BYTES } from "@/domain/analysis-limits";
import { LocalApiError } from "./local-security";
import { reviewPlanSchema, type ReviewPart, type ReviewLink, type ReviewPlan } from "@/domain/review-plan";
export type { ReviewPart, ReviewLink, ReviewPlan } from "@/domain/review-plan";

/** UTF-16 offsets refer to the unmodified artifact.content; hashes use UTF-8. */
const defaults = { partBytes: 48_000, contextBytes: SINGLE_CONTEXT_BYTES, reportReserveBytes: 200_000, maxParts: 2048, maxLinks: 8192 };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const textHash = (value: string) => createHash("sha256").update(value).digest("hex");
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const fail = (message: string): never => { throw new LocalApiError(413, `${message}；未截断正文，本次超限请求未发起。此前成功阶段及费用仍保留。`); };
const boundary = (text: string, end: number) => end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end]) ? end - 1 : end;

function partSource(artifact: StudioArtifact, part: ReviewPart) {
  const { content, ...metadata } = artifact;
  return { ...metadata, partId: part.id, start: part.start, end: part.end, hash: part.hash, content: content.slice(part.start, part.end) };
}

/** No model output or summary determines the coverage plan. */
export function buildReviewPlan(blueprint: BlueprintData, input: StudioArtifact[], options: Partial<typeof defaults> = {}): ReviewPlan {
  const limits = { ...defaults, ...options };
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) fail("审查容量参数无效");
  if (limits.reportReserveBytes < bytes({})) fail("审查报告预留容量不足以容纳空报告");
  if (limits.contextBytes > SINGLE_CONTEXT_BYTES || limits.reportReserveBytes >= limits.contextBytes) fail("审查请求容量参数无效");
  if (!input.length || input.length > 240) fail("正文材料数量必须在1至240份之间");
  // Validate without adopting Zod's trim transforms: offsets always refer to the original text.
  for (const artifact of input) if (!studioArtifactSchema.safeParse(artifact).success) fail("正文格式不符合分段审查契约");
  const artifacts = input;
  if (new Set(artifacts.map(item => item.id)).size !== artifacts.length) fail("正文编号重复");
  const rows = [...blueprint.characters, ...blueprint.relationships, ...blueprint.events, ...blueprint.knowledge, ...blueprint.clues, ...blueprint.claims, ...blueprint.rounds, ...blueprint.triggers, ...blueprint.endings];
  const sourceIds = new Set(rows.map(row => row.id));
  if (sourceIds.size !== rows.length) fail("蓝图来源编号重复");
  const parts: ReviewPart[] = [];
  const grouped = new Map<string, ReviewPart[]>();
  const addGroup = (id: string, entries: ReviewPart[]) => grouped.set(id, [...(grouped.get(id) ?? []), ...entries]);
  for (const artifact of artifacts) {
    if (!artifact.sourceIds.length || new Set(artifact.sourceIds).size !== artifact.sourceIds.length || artifact.sourceIds.some(id => !sourceIds.has(id))) fail("正文来源缺失、重复或不存在");
    if (artifact.characterId !== null && !blueprint.characters.some(row => row.id === artifact.characterId)) fail("正文角色不存在");
    if (artifact.roundId !== null && !blueprint.rounds.some(row => row.id === artifact.roundId)) fail("正文轮次不存在");
    const entries: ReviewPart[] = [];
    let start = 0;
    while (start < artifact.content.length) {
      let low = start + 1, high = artifact.content.length, end = start;
      // JSON escaping and UTF-8 length are both accounted for; never split a surrogate pair.
      while (low <= high) {
        const midpoint = Math.floor((low + high) / 2), candidate = boundary(artifact.content, midpoint);
        if (bytes(artifact.content.slice(start, candidate)) <= limits.partBytes) { end = candidate; low = midpoint + 1; }
        else high = midpoint - 1;
      }
      if (end <= start) fail("单个正文字符超过分段容量");
      const part: ReviewPart = { id: `part-${hash([artifact.id, start, end, textHash(artifact.content.slice(start, end))])}`, artifactId: artifact.id, start, end, hash: textHash(artifact.content.slice(start, end)) };
      if (bytes({ blueprint, sources: [partSource(artifact, part)] }) + limits.reportReserveBytes > limits.contextBytes) fail("蓝图及正文单段超出审查请求容量");
      entries.push(part); parts.push(part); start = end;
      if (parts.length > limits.maxParts) fail("正文分段数量超过审查计划上限");
    }
    addGroup(`artifact:${artifact.id}`, entries);
    if (artifact.characterId !== null) addGroup(`character:${artifact.characterId}`, entries);
    if (artifact.roundId !== null) addGroup(`round:${artifact.roundId}`, entries);
    for (const id of artifact.sourceIds) addGroup(`source:${id}`, entries);
  }
  const byArtifact = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const roundOrder = (part: ReviewPart) => blueprint.rounds.findIndex(round => round.id === byArtifact.get(part.artifactId)!.roundId);
  const artifactOrder = new Map(artifacts.map((artifact, index) => [artifact.id, index]));
  const links = new Map<string, ReviewLink>();
  const groups: ReviewPlan["groups"] = [];
  for (const [id, members] of [...grouped.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    members.sort((a, b) => roundOrder(a) - roundOrder(b) || artifactOrder.get(a.artifactId)! - artifactOrder.get(b.artifactId)! || a.start - b.start);
    groups.push({ id, parts: members.map(part => part.id) });
    for (let index = 1; index < members.length; index++) {
      const pair = [members[index - 1], members[index]];
      const ids = pair.map(part => part.id).sort() as [string, string];
      const key = `link-${hash(ids)}`;
      const prior = links.get(key);
      if (prior) { prior.groups.push(id); continue; }
      const sources = pair.map(part => partSource(byArtifact.get(part.artifactId)!, part));
      if (bytes({ blueprint, sources }) + limits.reportReserveBytes > limits.contextBytes) fail("关联正文对超出审查请求容量");
      links.set(key, { id: key, parts: ids, groups: [id] });
      if (links.size > limits.maxLinks) fail("跨角色及轮次关联数量超过审查计划上限");
    }
  }
  const plan: ReviewPlan = { version: "segmented-review/1", blueprintHash: hash(blueprint), artifacts: artifacts.map(artifact => ({ id: artifact.id, hash: hash(artifact), length: artifact.content.length })), parts, groups, links: [...links.values()], limits, callsMax: 5 * (parts.length + links.size) };
  // Group annotations are complete only now. Count the exact envelope, not just source text.
  const scopePayload = scopeReader(plan, blueprint, artifacts);
  for (const scope of [...parts, ...plan.links]) {
    const payload = scopePayload(scope.id, {});
    if (bytes(payload) - bytes({}) + limits.reportReserveBytes > limits.contextBytes) fail("完整审查范围及报告预留超出请求容量");
  }
  return reviewPlanSchema.parse(plan);
}

export const reviewPlanDigest = (plan: ReviewPlan) => hash(plan);

/** Rebuild, rather than trusting client/stored offsets or a claimed coverage count. */
export function verifyReviewPlan(plan: ReviewPlan, blueprint: BlueprintData, artifacts: StudioArtifact[]): void {
  const expected = buildReviewPlan(blueprint, artifacts, plan.limits);
  if (reviewPlanDigest(plan) !== reviewPlanDigest(expected)) fail("审查覆盖清单与冻结资料不一致");
}

/** Produces exact unabridged text for either a local part or a cross-module link. */
function scopeReader(plan: ReviewPlan, blueprint: BlueprintData, artifacts: StudioArtifact[]) {
  const parts = new Map(plan.parts.map(part => [part.id, part]));
  const links = new Map(plan.links.map(link => [link.id, link]));
  const originals = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  return (scopeId: string, reports: unknown = {}) => {
    const part = parts.get(scopeId), link = links.get(scopeId);
    if (!part && !link) fail("审查范围不存在");
    const ids = part ? [part.id] : link!.parts;
    const sources = ids.map(id => { const entry = parts.get(id)!; return partSource(originals.get(entry.artifactId)!, entry); });
    return { blueprint, scope: { id: scopeId, kind: part ? "part" : "link", groups: link?.groups ?? [] }, sources, reports };
  };
}

/** Verify once on admission/reload; keep private immutable inputs for the execution loop. */
export function prepareReviewScopes(plan: ReviewPlan, blueprint: BlueprintData, artifacts: StudioArtifact[]) {
  const frozen = structuredClone({ plan, blueprint, artifacts });
  verifyReviewPlan(frozen.plan, frozen.blueprint, frozen.artifacts);
  const read = scopeReader(frozen.plan, frozen.blueprint, frozen.artifacts);
  return (scopeId: string, reports: unknown = {}) => {
    const payload = read(scopeId, reports);
    if (bytes(reports) > frozen.plan.limits.reportReserveBytes || bytes(payload) > frozen.plan.limits.contextBytes) fail("审查报告或完整请求超过预留容量");
    return structuredClone(payload);
  };
}

/** Convenient one-off inspection. Execution should reuse prepareReviewScopes instead. */
export function reviewScopePayload(plan: ReviewPlan, blueprint: BlueprintData, artifacts: StudioArtifact[], scopeId: string, reports: unknown = {}) {
  return prepareReviewScopes(plan, blueprint, artifacts)(scopeId, reports);
}
