# 01：在模型设置中阻止完整接口地址误填

**What to build:** 读者保存模型连接参数时，如果把 `/chat/completions` 或 `/responses` 等完整接口地址填作 Base URL，页面立即说明应填写服务根路径；已有设置保持不变。

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] 服务端拒绝明显的完整接口地址，返回具体可操作的说明，而不保存错误 URL 或覆盖已有模型、密钥。
- [x] 有效 HTTPS 服务根路径和本机回环 HTTP 路径仍可保存；现有密钥保留与清除规则继续有效。
- [x] 设置页在输入说明与保存失败反馈中清楚说明 Base URL 会自动拼接 `/responses`。
- [x] API 行为测试和页面走查覆盖错误地址、有效地址及原设置保持不变；完整测试、浏览器测试与构建通过。

## Comments

**2026-09-27 本地验收：**真实模型复验时误填 `/chat/completions` 曾使上传返回 HTTP 502；修复后对该路径及 `/responses/` 完整端点的保存请求返回 `INVALID_SETTINGS`（400）和具体填写提示，不改变已有设置。内存设置替身的 API 测试验证 HTTPS 根路径、本机回环 HTTP、留空保留与清除密钥；Edge 320／390px 设置页走查用无效地址保存后，错误提示可见、原 Base URL 与 `hasApiKey` 状态保持不变、无横向溢出。`npm test` 87/87、`npm run test:e2e` 21/21、`npm run build` 通过；没有把替身测试写成新的真实模型调用。
