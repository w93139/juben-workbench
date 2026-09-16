import { createHash } from "node:crypto";
import type { z } from "zod";
import { evaluationResponseProfile } from "@/domain/model-evaluation";
import type { AnalysisCallDiagnostic, AnalysisDiagnostics, AnalysisParameters } from "@/domain/analysis-diagnostics";

export const PART_OUTPUT_TOKENS = 4096;
export const FINAL_OUTPUT_TOKENS = 8192;
export const DEFAULT_ANALYSIS_CALL_LIMIT = 64;
export const emptyUsage = () => ({ promptTokens: null, completionTokens: null, totalTokens: null, reasoningTokens: null });
export function analysisParameters(model: string, maximum?: number): AnalysisParameters {
  const profile = evaluationResponseProfile(model);
  return { model, max_tokens: maximum ?? profile.maxTokens, response_format: { type: "json_object" }, ...(profile.reasoningEffort ? { reasoning_effort: profile.reasoningEffort } : {}) };
}
export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fields = new Set(["outline", "directions", "id", "title", "summary", "risk", "sourceRefs", "documentId", "location", "quote", "sourceRefIds", "unknowns", "coverage", "method", "documents", "parts"]);
/** Paths may themselves contain user-controlled object keys. Never record unknown keys/messages/values. */
export function safeIssues(issues: z.core.$ZodIssue[]) {
  return issues.slice(0, 8).map(issue => ({ code: issue.code, path: issue.path.slice(0, 12).map(p => typeof p === "number" ? String(Math.min(Math.max(0, p), 999999)) : fields.has(String(p)) ? String(p) : "[field]").join(".").slice(0, 200) || "$" }));
}
function identifier(value: unknown, secrets: string[]): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(value)) return null;
  if (/sk-|Bearer|authorization|api.?key|password|secret|token/i.test(value) || secrets.some(secret => secret && value.includes(secret))) return null;
  return value;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
export type TransportObservation = Partial<Pick<AnalysisCallDiagnostic, "returnedModel" | "httpStatus" | "providerRequestId" | "finishReason" | "responseBodyBytes" | "contentCharacters" | "usage" | "failure" | "issues">>;
/** Construct a new allowlisted object. No spread of upstream data, even nested errors. */
export function observeEnvelope(value: unknown, secret: string): TransportObservation {
  const envelope = record(value), choice = record(Array.isArray(envelope.choices) ? envelope.choices[0] : undefined), message = record(choice.message);
  const usage = record(envelope.usage), details = record(usage.completion_tokens_details);
  const content = message.content;
  const contentCharacters = typeof content === "string" ? content.length : Array.isArray(content) ? content.reduce((n, item) => n + (typeof item === "string" ? item.length : record(item).type === "text" && typeof record(item).text === "string" ? (record(item).text as string).length : 0), 0) : null;
  return { returnedModel: identifier(envelope.model, [secret]), providerRequestId: identifier(envelope.id, [secret]),
    finishReason: typeof choice.finish_reason !== "string" ? null : ["stop", "length", "content_filter", "tool_calls", "function_call"].includes(choice.finish_reason) ? choice.finish_reason as AnalysisCallDiagnostic["finishReason"] : "other",
    contentCharacters, usage: { promptTokens: number(usage.prompt_tokens), completionTokens: number(usage.completion_tokens), totalTokens: number(usage.total_tokens), reasoningTokens: number(details.reasoning_tokens) } };
}
export function observeHeaders(response: Response, secret: string): TransportObservation {
  return { httpStatus: response.status, providerRequestId: identifier(response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? response.headers.get("x-trace-id"), [secret]) };
}
export function sumUsage(calls: AnalysisCallDiagnostic[]): AnalysisDiagnostics["usage"] {
  const metric = (name: keyof AnalysisCallDiagnostic["usage"]) => ({ known: calls.reduce((n, call) => n + (call.usage[name] ?? 0), 0), missingCalls: calls.filter(call => call.usage[name] === null).length });
  return { promptTokens: metric("promptTokens"), completionTokens: metric("completionTokens"), totalTokens: metric("totalTokens"), reasoningTokens: metric("reasoningTokens") };
}
