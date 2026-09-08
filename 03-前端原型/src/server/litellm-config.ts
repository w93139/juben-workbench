import { chmodSync, lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { modelAllocationSchema, type ModelAllocation } from "@/domain/model-evaluation";
import { LocalApiError } from "./local-security";

const aliases = [["studio-main", "mainModel"], ["studio-review-a", "reviewA"], ["studio-review-b", "reviewB"]] as const;
const quote = (value: string) => JSON.stringify(value);

export function liteLLMConfig(allocation: ModelAllocation) {
  const selected = modelAllocationSchema.parse(allocation);
  const models = aliases.map(([alias, field]) => `  - model_name: ${quote(alias)}\n    litellm_params:\n      model: ${quote(`custom_openai/${selected[field]}`)}\n      api_base: os.environ/ANT_MAAS_API_BASE\n      api_key: os.environ/ANT_MAAS_API_KEY`).join("\n");
  return `# Generated locally after the bounded evaluation. Contains no credentials.\nmodel_list:\n${models}\n\nlitellm_settings:\n  drop_params: false\n  set_verbose: false\n  turn_off_message_logging: true\n\ngeneral_settings:\n  master_key: os.environ/LITELLM_MASTER_KEY\n  store_prompts_in_spend_logs: false\n`;
}

export function writeLiteLLMConfig(allocation: ModelAllocation, root = resolve(process.cwd(), "runtime-data")) {
  const target = join(root, "litellm-config.yaml"), temporary = join(root, `litellm-config.${randomUUID()}.tmp`);
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 }); const info = lstatSync(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(); chmodSync(root, 0o700);
    writeFileSync(temporary, liteLLMConfig(allocation), { mode: 0o600, flag: "wx" }); renameSync(temporary, target); return target;
  } catch { throw new LocalApiError(503, "LiteLLM本机配置未能安全生成，模型分配没有生效。"); }
  finally { try { unlinkSync(temporary); } catch { /* successful rename */ } }
}
