import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

it.each([false, true])("手动入口 live=%s：干运行或未确认轮换均不读取凭据配置", live => {
  const root = mkdtempSync(join(tmpdir(), "single-batch-entry-"));
  const settings = join(root, "settings"); mkdirSync(settings, { mode: 0o700 });
  const file = join(settings, "studio-settings.json"), invalid = "INVALID_JSON_READ_WOULD_THROW";
  writeFileSync(file, invalid, { mode: 0o600 });
  const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("STUDIO_") && !key.startsWith("VITEST"))), NODE_ENV: "test" as const };
  env.STUDIO_LIVE_VERIFY = live ? "1" : "0"; env.STUDIO_LIVE_SETTINGS_ROOT = settings;
  try {
    const result = spawnSync(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.live.config.ts", "--disableConsoleIntercept"], { cwd: process.cwd(), env, encoding: "utf8", timeout: 15000 });
    const output = result.stdout + result.stderr;
    expect(result.error).toBeUndefined(); expect(result.status).toBe(live ? 1 : 0);
    expect(output).not.toContain("本机模型配置无法安全读取");
    if (live) expect(output).toContain("缺少单次授权、凭据轮换确认或明确费用选择");
    else { expect(output).toContain("synthetic-fixture; NOT-original-failure"); expect(output).toContain('"hardMoneyCap": false'); }
    expect(readFileSync(file, "utf8")).toBe(invalid);
  } finally { rmSync(root, { recursive: true }); }
}, 20000);
