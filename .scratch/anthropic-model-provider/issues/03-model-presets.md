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

**2026-09-28 完成：**首批收录 5 条预设——Anthropic 协议：DeepSeek 官方 `https://api.deepseek.com/anthropic/v1` + `deepseek-flash`（**已实测**）、阿里云百炼 `https://dashscope.aliyuncs.com/apps/anthropic/v1` + `qwen3-vl-flash`（官方文档）、Anthropic 官方 `https://api.anthropic.com/v1` + `claude-sonnet-4-6`（官方文档）；Responses 协议：commandcode 网关 + `deepseek/deepseek-v4.1-flash`（既有实测）、OpenAI 官方 + `gpt-4.1-mini`（官方文档）。DeepSeek 的实测同时促成一处兼容修复：其思考模式拒绝强制工具调用（400），应用在 Anthropic 请求中显式关闭思考后连接测试与图片读取均通过。Kimi 未收录：其 Anthropic 兼容端点（`api.kimi.com/coding`）的视觉支持未见文档，多模态仅见于 OpenAI 兼容端点，不属于本项目当前两种协议。
