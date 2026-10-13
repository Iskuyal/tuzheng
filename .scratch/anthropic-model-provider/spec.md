# Anthropic Messages 协议支持：设置、连接测试与图片读取

Status: completed（任务01—03均已完成；历史规划正文保留）

## Problem Statement

当前模型接入只支持 OpenAI Responses 兼容协议（`server/openai-vision.ts`、`server/model-connection.ts` 直接使用 OpenAI SDK 与 `text.format` 结构化输出）。阶段四的来源核验需要模型稳定地选择并调用受限工具；2026-09-28 的规格已记下「当前已用的具体模型是否稳定返回工具调用仍须在线验证」这一风险。团队决定先增加第二种协议：Anthropic Messages（`x-api-key`、`anthropic-version`、`/messages`、原生工具调用），让演示与评测可以在两种协议间选择，而不是被单一提供方锁住。

## Solution

在设置页新增「接口协议」选择，两种协议各自保存地址、模型与密钥，切换时自动带出：

1. **OpenAI Responses 兼容**（默认，保持现状）：Base URL 填到版本段（如 `https://api.openai.com/v1`），服务端追加 `/responses`，结构化输出用 `text.format` JSON Schema。
2. **Anthropic Messages**：Base URL 同样只填到版本段（如 `https://api.anthropic.com/v1`），服务端追加 `/messages`；结构化输出用**强制工具调用**（`tools` + `tool_choice: {type: "tool"}`，`input_schema` 复用同一份观察结构）。

图片读取与连接测试都按所选协议执行；既有 Responses 路径的行为与默认值不变。

## User Stories

1. 作为读者，我想在设置页选择接口协议，并让地址、模型与密钥按协议分别保存，以免切换协议时反复重填。
2. 作为读者，我想切换协议时自动带出该协议已保存的配置，并看到对应的地址填写说明（追加 `/responses` 还是 `/messages`）。
3. 作为读者，我想在保存或测试连接时收到针对所选协议的错误提示（如把完整 `/messages` 地址填进 Base URL）。
4. 作为开发者，我想沿用现有设置文件的用户无需重新配置：旧文件自动迁移为 Responses 配置。
5. 作为评审，我想看到连接测试按所选协议真实执行（Responses JSON Schema 或 Messages 工具调用）并给出分类失败原因。
6. 作为读者，我想让图片读取按所选协议工作，并保持原有模型轨迹面板（模型名、耗时、token、原始返回）。
7. 作为团队，我想在 commandcode 网关上实测 Anthropic 协议；不支持时如实记录并保持「待在线验证」，不把替身测试写成在线通过。

## Implementation Decisions

- 设置文件结构升级为 `{activeProvider, providers: {provider: {baseUrl, model, apiKey}}}`；读取时兼容旧扁平结构（无 `provider` 字段）并迁移为 Responses 配置，补默认 Anthropic 配置（`https://api.anthropic.com/v1` / `claude-sonnet-4-6`）。
- 协议枚举 `openai-responses | anthropic`；「未配置/格式无效」等既有错误语义不变。
- Base URL 校验规则不变（HTTPS/回环、无凭证/查询/哈希、拒绝完整接口路径）；拒绝文案按所选协议指向 `/responses` 或 `/messages`。
- Anthropic 走零依赖 `fetch`（不新增 SDK 依赖）：`x-api-key` + `authorization: Bearer`（兼容网关）+ `anthropic-version: 2023-06-01`；超时用 `AbortSignal.timeout`；非 2xx 抛出带 `status` 的错误以复用现有失败分类。
- 视觉读取用强制工具调用取得结构化输出；`max_tokens` 4096，`stop_reason === "max_tokens"` 或无匹配 `tool_use` 块视为 `invalid-output`。观察结构、提示词与 `VisionModelError` 抽到协议中立模块，两适配器共用。
- 图片读取路径（主图与对照图）、`ModelReadTrace`、错误码与阶段五任务 03 的失败恢复文案保持不变。
- 连接测试按 `activeProvider` 分派；失败分类沿用 auth / endpoint / rate-limit / timeout / request-rejected / invalid-output / upstream，文案提及对应协议的接口与结构化输出形态。

## Testing Decisions

- 存储：新旧文件往返、迁移、默认值、无效协议值拒绝。
- API：设置读写包含两种协议且不回传密钥；保存某协议不覆盖另一协议；完整接口地址拒绝文案按协议区分；测试连接按协议校验并沿用分类。
- 适配器：注入 requester/fetch 校验请求契约（URL 拼接、请求头、图片块、`tool_choice`、`max_tokens`）与解析（`tool_use.input`、usage 映射、非结构化/截断降级为 `invalid-output`）、错误分类（超时/上游）。
- 浏览器：设置页协议切换、地址说明与成功文案变化、测试连接请求体含协议且不保存；320/390/1280 无横向溢出。
- 真实调用单独记录：端点、模型、样例、耗时与未验证范围；替身与预置不计入在线验收。

## Out of Scope

- Gemini 等其他协议；`/chat/completions` 兼容协议；按 URL 自动识别协议。
- 阶段四的编排、检索与工具轨迹实现（本特性只备好协议能力，工具调用从中受益）。
- 改动现有 Responses 路径语义、默认值或阶段五已验收的失败恢复行为。

## Further Notes

**2026-09-28 决定记录：**用户明确要求「先添加 Anthropic 协议支持，再继续阶段四任务」；已确认按协议各存一份配置，并计划在 commandcode 网关实测 Anthropic 协议。本目录两票完成后回到阶段四任务 01（CPI 来源核验闭环），阶段四规格与顺序不变。
