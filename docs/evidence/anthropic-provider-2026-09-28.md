# Anthropic Messages 协议支持与在线探测（2026-09-28）

在 Edge 实机走查模型设置页：旧版扁平设置文件（commandcode 网关，模型 `deepseek/deepseek-v4.1-flash`）读取时自动迁移为按协议结构；切换「接口协议」到 Anthropic Messages 后带出该协议的地址（`https://api.anthropic.com/v1`）与模型占位、地址说明改为「服务端会自行调用 `/messages`」、协议徽标与测试说明同步更新；Anthropic 无密钥时点「测试连接」返回「请填写 API Key，或先保存密钥后再测试连接。」，没有误用另一协议已保存的密钥。切回 Responses 保存后，设置文件重写为 `{activeProvider, providers}` 结构，原密钥保留（长度不变），页面与读取接口都不回显密钥；320px 与 390px 视口无横向溢出。

**Anthropic 协议在线探测（重点结论）：**用本机已保存的网关密钥请求 `https://api.commandcode.ai/provider/v1/messages`。该路由存在且接受 `x-api-key` / `authorization: Bearer` / `anthropic-version` 头：无效密钥被拒绝并正确归类为「API Key 无效」（auth），不受支持的模型 id 返回 `Model "..." is not supported on this endpoint` 并归类 request-rejected。`/models` 列出该网关的 Claude 模型（`claude-sonnet-4-6`、`claude-sonnet-5`、`claude-opus-5` 等），但用其中有效 id 请求返回 403——**当前账户密钥没有 `/messages` 路由上的 Claude 模型权限**，因此成功的在线连接测试与在线图片读取都尚未完成，相关任务保持「本地验收，待在线验证」。

**附带发现与修复（Responses 在线路径，非本次新增能力）：**2026-09-28 实测发现两点上游行为变化。其一，网关对未知字段返回 400（`json: unknown field "verbosity"`），视觉请求中的 `text.verbosity: "low"` 已移除。其二，连接测试 64 输出上限被模型的思考 token 吃光（`status: incomplete`、`reasoning_tokens: 64`、空输出），上限调整为 512 后真实连接测试成功（模型 `deepseek/deepseek-v4.1-flash`，3.5 秒）。修复后真实读取复验：`consistent.png` 返回 1 条主张（标题 25%、80→100），耗时 29.5 秒、输出 3,237 tokens；`conflict.png` 连续两次被结构校验拒绝，原因是模型把 `claimedGrowthPercent` 返回为字符串 `"40%"`（期望 number）。模型当前还表现出：单主张读取耗时从 09-26 的 3.2—4.4 秒升至约 30 秒，多主张样例（`multi-claims.png`）在 45 秒超时内未完成。这些是端点/模型行为变化，应用按设计拒绝不可用输出，未做数值猜测。

**边界说明：**本记录中的本地测试（116 条行为测试、48 条浏览器用例、构建）使用替身与预置数据，不代表真实模型调用；在线部分只覆盖上述具体端点、模型与样例，不代表 Anthropic 协议本身在官方端点的可用性，也不能外推识别准确率。建议具备 Claude 权限的密钥或官方 Anthropic 端点后再补做成功路径的在线验收。
