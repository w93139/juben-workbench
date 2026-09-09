# LiteLLM 本机网关

这里固定使用已发布的 `litellm[proxy]==1.100.0`，不复制或修改外部 staging 工程。外部 staging 标记的 1.101.0 尚无同版本PyPI正式包，因此不直接作为运行依赖。工作台的小样测评负责质量评分、截断判断、费用账本和自动换候选；LiteLLM只负责后续统一转发、别名和调用记录。生成配置显式设为`num_retries: 0`，避免代理在工作台不知道的情况下重复产生费用。

模型分配完成后，工作台会在 Git 忽略的 `runtime-data/litellm-config.yaml` 生成三个别名：`studio-main`、`studio-review-a`、`studio-review-b`。文件只有模型编号和环境变量占位符，不含 API Key。启动代理时需由本机进程提供 `ANT_MAAS_API_BASE`、`ANT_MAAS_API_KEY` 与随机的 `LITELLM_MASTER_KEY`，并设置 `LITELLM_TELEMETRY=false`。密钥不得作为命令行参数或提交到仓库。

本阶段先完成可复查的选型、人民币估算预算和无密钥配置生成。自动拉起代理、健康检查、进程恢复和工作台切换到 `http://127.0.0.1:4000/v1` 在下一后端批次完成；在此之前，已分配模型仍使用蚂蚁官方兼容接口。LiteLLM自身的美元预算功能不作为人民币保护；工作台按公开价用SQLite在请求前预留，采用10元估算限额，最终费用仍以蚂蚁平台账单为准。
