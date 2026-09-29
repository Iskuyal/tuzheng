# 03：主流模型预设（只收录支持图片输入的型号）

**What to build:** 设置页按协议列出常用模型预设，选取即填入地址与型号；预设只收录支持图片输入（多模态）的型号，避免接入纯文本模型导致读图不可用。

**Blocked by:** 01：协议选择与按协议保存

**Status:** completed

- [x] 新增 `shared/model-presets.ts`：每条预设含协议、Base URL、型号、说明、出处链接与验证状态（`live` 已实测 / `documented` 官方文档），只收录多模态型号。
- [x] 设置页新增「常用模型预设」选择：按当前协议过滤，选取后覆盖该协议的地址与型号，密钥不受影响，并显示来源与验证状态说明。
- [x] `ModelProvider` 类型抽到 `shared/model-providers.ts`，服务端与设置页共用一份定义。
- [x] 预设数据测试（HTTPS、非空、id 唯一、不含完整接口路径、DeepSeek 与通义千问 flash 多模态条目存在）与浏览器用例（按协议过滤、选取填入）。
- [x] `npm test`、`npm run test:e2e`、`npm run build` 通过。
- [x] 按实测更新 README 预设表与 `docs/evidence/anthropic-provider-2026-09-28.md`。

## Comments

**2026-09-28 完成：**首批收录 11 条预设，两种协议都覆盖「厂商官方」与「中转站」，且只收录支持图片输入的型号——

- **Anthropic Messages 协议**（6 条）：DeepSeek 官方 `https://api.deepseek.com/anthropic/v1` + `deepseek-flash`（**已实测**）；阿里云百炼 `https://dashscope.aliyuncs.com/apps/anthropic/v1` + `qwen3.8-flash`（官方文档：多模态、支持 Function Calling）；智谱开放平台 `https://open.bigmodel.cn/api/anthropic/v1` + `glm-5.3-flash`（官方文档：GLM-5 系列首个原生多模态）；OpenCode Zen `https://opencode.ai/zen/v1` + `qwen3.8-flash`；OpenRouter `https://openrouter.ai/api/v1` + `deepseek/deepseek-v4.1-flash`；Anthropic 官方 + `claude-sonnet-4-6`。
- **OpenAI Responses 兼容协议**（5 条）：DeepSeek 官方 `https://api.deepseek.com/v1` + `deepseek-flash`（端点探测 200）；commandcode 网关（既有实测）；OpenCode Zen + `gpt-5.6-luna`；OpenRouter + `openai/gpt-5.6-luna`；OpenAI 官方 + `gpt-4.1-mini`。

**2026-09-28 配套兼容修复：**智谱 GLM-5.3-Flash 的思考不可关闭、且不支持强制工具选择；DeepSeek 的思考模式同样与强制工具调用互斥。应用改为两段式：先按「关闭思考 + 强制工具调用」请求，被 400 拒绝时回退为「不带思考字段 + 自动工具选择」再试一次（`requestAnthropicToolCall`，仅 400 触发一次重试）。DeepSeek 路径在改动后重跑真机复验通过（连接 653 毫秒、读取 1.14 秒、40%/80→100）。
