import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blueprintFingerprintHex, checkHandoffPackage, handoffPackageSchema, renderHandoffMarkdown } from "@/domain/handoff-package";

describe("仓库策划交接样例", () => {
  it("自造 JSON 符合当前契约，指纹正确且 Markdown 与渲染结果一致", async () => {
    const folder = resolve(process.cwd(), "../01-产品需求/09-策划交接包样例");
    const pkg = handoffPackageSchema.parse(JSON.parse(readFileSync(resolve(folder, "样例-策划交接包.json"), "utf8")));
    expect(pkg.project.id).toBe("synthetic-planning-example");
    expect(checkHandoffPackage(pkg)).toEqual([]);
    expect(pkg.revision.blueprintFingerprint).toBe(await blueprintFingerprintHex(pkg.blueprint!));
    expect(readFileSync(resolve(folder, "样例-策划交接包.md"), "utf8")).toBe(renderHandoffMarkdown(pkg) + "\n");
    expect(pkg.reviewPlan.playtest).toEqual([]);
  });
});
