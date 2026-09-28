# 02：图片读取按所选协议执行（Anthropic Messages 适配器）

**What to build:** 协议选为 Anthropic 时，上传图片与对照图读取都经 Messages 适配器完成：图片以 base64 块发送，强制工具调用返回观察结构，claims 与模型轨迹面板照常展示。

**Blocked by:** 01：协议选择与按协议保存（需要 activeProvider 与配置分派）

**Status:** ready-for-human

- [x] 观察 JSON Schema 与视觉提示词抽到协议中立模块，Responses 与 Messages 两适配器共用同一份语义。
- [x] 新增 `server/anthropic-messages.ts`（底层发送器，可注入 fetch）与 `server/anthropic-vision.ts`（`AnthropicMessagesVisionAdapter`，可注入 requester）。
- [x] 适配器工厂按 `activeProvider` 构造；主图与对照图读取路径自动继承；`ModelReadTrace` 字段齐全。
- [x] 解析 `tool_use.input` 为观察值；缺 `tool_use`、`stop_reason === "max_tokens"` 或 JSON 不可用时归类 `invalid-output`；超时与上游失败沿用现有错误码与降级文案。
- [x] 契约与错误测试：URL/请求头/图片块/`tool_choice`/`max_tokens` 断言，解析与降级断言，路由层按协议构造适配器断言；`npm test`、`npm run test:e2e`、`npm run build` 通过。
- [ ] 用 commandcode 网关按 Anthropic 协议做连接测试与图片读取在线实测（真实模型、耗时、工具调用返回）；网关不支持时如实记录失败并保持「本地验收，待在线验证」，证据写入 `docs/evidence/`。

## Comments

**2026-09-28 本地验收：**`npm test` 116/116（新增 `anthropic-messages.test.ts` 3 例、`anthropic-vision.test.ts` 4 例、路由层「启用 Anthropic 且无该协议密钥时不构造适配器」1 例）、`npm run test:e2e` 48/48、`npm run build` 通过。

**2026-09-28 在线实测（未通过，原因在网关账户侧）：**该网关的 `/messages` 路由存在且鉴权头被接受；但当前账户密钥没有 Claude 模型权限——`/models` 列出 `claude-sonnet-4-6`、`claude-sonnet-5` 等，带这些模型 id 的请求返回 403，被正确归类为 auth；不受支持的模型 id 返回 400 并被归类 request-rejected。因此「真实成功的连接测试与图片读取」仍待具备 Claude 权限的密钥（或官方 Anthropic 密钥）完成，本任务保持待人工验证。详见 `docs/evidence/anthropic-provider-2026-09-28.md`。
