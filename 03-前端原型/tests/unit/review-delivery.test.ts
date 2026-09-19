import { expect, it } from "vitest";
import { assertReviewDeliveryCapacity, reviewDeliveryUpperBound } from "@/server/review-delivery";
import { studioExportFiles, studioZipBytes } from "@/server/studio-export-files";
import { createZip } from "@/services/zip";
import { segmentedSummaries } from "@/server/segmented-review";
import { segmentedFixture } from "../fixtures/segmented-review";
import { reviewAudit } from "../fixtures/studio-review";

it("完整ZIP预算含原文/所有报告/JSON/路径/ZIP开销，精确预算接受，少一字节拒绝", () => {
  const fixture = segmentedFixture(), gate = reviewAudit();
  const upper = reviewDeliveryUpperBound(fixture.segmented.plan, fixture.blueprint, fixture.artifacts, gate);
  expect(assertReviewDeliveryCapacity(fixture.segmented.plan, fixture.blueprint, fixture.artifacts, gate, upper)).toBe(upper);
  expect(() => assertReviewDeliveryCapacity(fixture.segmented.plan, fixture.blueprint, fixture.artifacts, gate, upper - 1)).toThrow("64 MiB");
  for (const unit of fixture.segmented.units) {
    unit.report!.warnings = Array.from({ length: 6 }, () => '中文"\\\n'.repeat(300));
    expect(Buffer.byteLength(JSON.stringify(unit.report))).toBeLessThanOrEqual(40000);
  }
  const reports = { designGate: gate, ...segmentedSummaries(fixture.segmented) };
  const files = studioExportFiles({ ...fixture.checkpoint.review, reports }, "作".repeat(80), crypto.randomUUID());
  const zip = createZip(files);
  expect(zip.length).toBe(studioZipBytes(files)); expect(zip.length).toBeLessThanOrEqual(upper);
  const raw = files.find(file => file.path.includes("分段审查原始"))!;
  expect(JSON.parse(raw.content)).toEqual(fixture.segmented);
});
