# 01：设置页选择协议、按协议保存并在该协议上测试连接

**What to build:** 用户可在设置页在「OpenAI Responses 兼容」与「Anthropic Messages」之间选择；地址、模型与密钥按协议分别保存并自动带出；连接测试按所选协议真实执行并给出分类结果。

**Blocked by:** 无

**Status:** completed

- [x] 存储结构升级为按协议分组（`activeProvider` + `providers`），旧扁平设置文件读取时自动迁移为 Responses 配置，设置接口不回传密钥。
- [x] 设置页新增「接口协议」选择；切换时带出该协议已存地址与模型，更新地址说明、占位符、协议徽标、测试连接说明与成功文案。
- [x] 保存与测试连接请求体包含协议；保存某协议不覆盖另一协议已存配置；空密钥保留该协议已存密钥，`clearApiKey` 只清除该协议密钥。
- [x] Base URL 校验沿用（HTTPS/回环、拒绝完整接口路径），拒绝文案按协议指向 `/responses` 或 `/messages`。
- [x] 连接测试按协议分派：Responses 发 JSON Schema 短请求；Messages 发强制工具调用短请求并校验 `{ok: true}`；失败分类与 HTTP 映射沿用，文案提及对应协议。
- [x] Anthropic 请求走零依赖 fetch：URL 拼接、`x-api-key` + `authorization: Bearer` + `anthropic-version`，非 2xx 错误带状态码供分类复用。
- [x] 本地行为测试与浏览器端到端测试覆盖协议切换与两条连接测试路径；`npm test`、`npm run test:e2e`、`npm run build` 通过。
- [x] 按实际验证更新 README 与 `docs/PHASES.md` 的状态；真实网关实测另记，未完成前不标「已在线验证」。

## Comments

**2026-09-28 验收（本地 + 实机走查）：**`npm test` 116/116、`npm run test:e2e` 48/48（320／390／1280px，新增「切换协议带出该协议已存配置并按所选协议测试连接」用例）、`npm run build` 通过。Edge 实机走查：旧版扁平设置文件（commandcode 网关）读取时迁移为按协议结构；切换协议带出对应配置与文案；Anthropic 无密钥时测试连接返回「请填写 API Key」而不误用另一协议密钥；保存后设置文件重写为 `{activeProvider, providers}` 且原密钥保留（长度未变，页面与接口不回显）；320/390px 无横向溢出。

**2026-09-28 真实网关探测（连接测试在线部分）：**用可用的 commandcode 网关密钥请求 `https://api.commandcode.ai/provider/v1/messages`：路由存在、鉴权头被接受，且只服务 Claude 模型——deepseek／gpt／glm／kimi 等族被网关以 400 明确拒绝并提示改用 `/chat/completions`（应用归类为 request-rejected），Claude 模型受套餐限制（403 `MODEL_NOT_IN_PLAN`，需 Pro 及以上或按量付费，应用归类为 auth）。因此「成功」状态的在线连接测试仍未完成，保持待验证；诊断中还发现 Anthropic 卡曾被填入一把与可用密钥不同的值（112 位 vs 92 位）而报 401，密钥需与卡片一一对应。

**2026-09-28 附带修复（Responses 在线路径，非本任务新增能力）：**走查中发现网关开始拒绝 `text.verbosity` 字段（HTTP 400 InvalidParameter），已从视觉请求移除；连接测试的 64 输出上限被推理型模型的思考 token 吃光（`status: incomplete`、空输出），上限调整为 512 后真实连接测试成功（3.5 秒）。真实读取复验：`consistent.png` 返回 1 条主张（80→100、标题 25%），耗时 29.5 秒；`conflict.png` 因模型把 `claimedGrowthPercent` 返回为字符串 `"40%"` 而被结构校验拒绝（2/2）。详见 `docs/evidence/anthropic-provider-2026-09-28.md`。
