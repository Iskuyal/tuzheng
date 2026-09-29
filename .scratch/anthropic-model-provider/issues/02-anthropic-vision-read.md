# 02：图片读取按所选协议执行（Anthropic Messages 适配器）

**What to build:** 协议选为 Anthropic 时，上传图片与对照图读取都经 Messages 适配器完成：图片以 base64 块发送，强制工具调用返回观察结构，claims 与模型轨迹面板照常展示。

**Blocked by:** 01：协议选择与按协议保存（需要 activeProvider 与配置分派）

**Status:** completed

- [x] 观察 JSON Schema 与视觉提示词抽到协议中立模块，Responses 与 Messages 两适配器共用同一份语义。
- [x] 新增 `server/anthropic-messages.ts`（底层发送器，可注入 fetch）与 `server/anthropic-vision.ts`（`AnthropicMessagesVisionAdapter`，可注入 requester）。
- [x] 适配器工厂按 `activeProvider` 构造；主图与对照图读取路径自动继承；`ModelReadTrace` 字段齐全。
- [x] 解析 `tool_use.input` 为观察值；缺 `tool_use`、`stop_reason === "max_tokens"` 或 JSON 不可用时归类 `invalid-output`；超时与上游失败沿用现有错误码与降级文案。
- [x] 契约与错误测试：URL/请求头/图片块/`tool_choice`/`max_tokens` 断言，解析与降级断言，路由层按协议构造适配器断言；`npm test`、`npm run test:e2e`、`npm run build` 通过。
- [x] 用真实 Anthropic 端点做连接测试与图片读取在线实测（真实模型、耗时、工具调用返回）；网关不支持的部分如实记录，证据写入 `docs/evidence/`。

## Comments

**2026-09-28 本地验收：**`npm test` 116/116（新增 `anthropic-messages.test.ts` 3 例、`anthropic-vision.test.ts` 4 例、路由层「启用 Anthropic 且无该协议密钥时不构造适配器」1 例）、`npm run test:e2e` 48/48、`npm run build` 通过。

**2026-09-28 在线实测（已通过，DeepSeek 官方端点）：**用团队提供的真实密钥配置 `https://api.deepseek.com/anthropic/v1` + `deepseek-flash`：应用「测试连接」成功（644 毫秒）；经 `/api/audit/image` 真实读取 `conflict.png` 1.2 秒返回 40%、80/100，`consistent.png` 首次因模型结构不符被拒、重试 1.3 秒返回 25%、80/100。过程中发现并修复一处协议兼容问题：DeepSeek 思考模式与强制工具调用互斥（400），Anthropic 请求改为显式关闭思考后两条路径都通过。commandcode 网关 `/messages` 仍不可用（仅 Claude 且受套餐限制），如实记录。详见 `docs/evidence/anthropic-provider-2026-09-28.md`。
