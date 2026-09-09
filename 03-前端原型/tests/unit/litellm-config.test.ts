import { describe, expect, it } from "vitest";
import { liteLLMConfig } from "@/server/litellm-config";

describe("LiteLLM无密钥配置", () => {
  it("生成三个不同的固定别名并只引用环境变量", () => {
    const value = liteLLMConfig({ mainModel: "model/main:v1", reviewA: "model-a", reviewB: "model-b" });
    expect(value).toContain('model_name: "studio-main"'); expect(value).toContain('model: "custom_openai/model/main:v1"');
    expect(value).toContain("os.environ/ANT_MAAS_API_KEY"); expect(value).toContain("os.environ/LITELLM_MASTER_KEY");
    expect(value).toContain("num_retries: 0"); expect(value).toContain("drop_params: false");
    expect(value.indexOf("general_settings:")).toBeLessThan(value.indexOf("store_prompts_in_spend_logs: false"));
    expect(value).not.toContain("sk-test");
  });
  it("拒绝相同模型，避免两路审查实际落到同一模型", () => {
    expect(() => liteLLMConfig({ mainModel: "same", reviewA: "same", reviewB: "other" })).toThrow("不同模型");
  });
});
