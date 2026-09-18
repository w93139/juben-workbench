import { expect, it } from "vitest";
import { analysisBatches } from "@/server/long-analysis";
import { ANALYSIS_DIRECT_BYTES } from "@/domain/analysis-limits";
import { analysisVerificationDocuments } from "../manual/analysis-fixture";

it("受控真实验证样例仍触发分段且恰好两批，十份自有材料完整覆盖", () => {
  const documents = analysisVerificationDocuments();
  expect(documents).toHaveLength(10);
  expect(Buffer.byteLength(JSON.stringify({ documents, instructions: "验证" }))).toBeGreaterThan(ANALYSIS_DIRECT_BYTES);
  const batches = analysisBatches(documents);
  expect(batches).toHaveLength(2);
  for (const document of documents) {
    const segments = batches.flat().filter(segment => segment.documentId === document.id);
    expect(segments.map(segment => segment.text).join("")).toBe(document.text);
  }
});
