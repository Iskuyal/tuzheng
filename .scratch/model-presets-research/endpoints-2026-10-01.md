# 常用模型预设 · 服务商与端点核实（2026-10-01）

- **检查日期**：2026-10-01（本机 Windows + pwsh + curl 8.21.0）。
- **检索方式**
  1. **未鉴权路由探测**：对每家候选 base URL，`POST` 一个 JSON body 到 `<base>/responses`、`<base>/messages`，并同时 `POST` 一个**控制路径** `<base>/__dsh_probe__`。
     - 判定规则：控制路径 404 而目标路径返回 401/400/403/422 → 判定「该路由存在，只是缺鉴权或参数」；控制路径与目标路径**返回同样的 401/403** → 判定「不可判定」（网关先鉴权后路由）；目标路径 404 且控制路径也 404 → 判定「无此路由」。
  2. **官方文档原文**：curl 抓取 + 仅抽取命中关键词的行（因此下表引用的是文档原句，不是概括）。
  3. **第三方元数据交叉核对**：`https://models.dev/api.json`（provider 的 `api` / `npm` / 每型号 `modalities.input`、`attachment`）与 `https://openrouter.ai/api/v1/models`（`architecture.input_modalities`）。
  4. **0 次真实模型调用**：全程未使用任何 API Key、未发送图片、未运行 `npm run eval:source-audit`。所有 401/403 都是「缺鉴权被拒」的形态，只能证明路由与鉴权头位置，不证明读图成功。
- **口径前提**（来自 `server/anthropic-messages.ts:161` 与 `server/openai-vision.ts`）：应用会自行把 baseUrl 拼成 `<baseUrl>/messages` 或 `<baseUrl>/responses`，所以本文件里的 baseUrl 一律填到**版本段**（如 `/v1`、`/anthropic/v1`），不含 `/messages`、`/responses`。

## 一句话结论

- **OpenAI Responses 侧**本次新查出 4 家「路由 + 官方文档多模态」双证齐全、值得补进预设：阿里云百炼 `compatible-mode/v1`（`qwen3.8-flash`）、Moonshot 官方（`kimi-k3`）、MiniMax 官方（`MiniMax-M3.1-Flash-Preview`）、Nebius Token Factory（`deepseek-ai/DeepSeek-V4.1-Flash`）。
- **Anthropic Messages 侧**新查出 2 家双证齐全：MiniMax 官方 `https://api.minimax.cn/anthropic/v1`（`MiniMax-M3.1-Flash-Preview`，官方文档有图片理解示例）、Fireworks AI `https://api.fireworks.ai/inference/v1`（Kimi K3，官方 API 参考写明 messages 可含 image content）。
- **明确不能补**：只有 `/chat/completions` 的（腾讯混元等，探测 404）、有 `/responses` 路由但**没有图片输入证据**的（百度千帆）、以及一批 404 的第三方站点。
- **还需人工盯的**：火山方舟 Ark（文档是 JS 外壳、探测不可判定）、Groq / Together / xAI / Gemini（本机网络或 WAF 拦截，未核实）、硅基流动与 Kimi coding 的 Anthropic 面（路由存在但缺「这个面收图片」的原句）。
- **另有 3 处现存预设需要人拍板**：OpenRouter 的 `sourceUrl` 已 404（现行链接见下）、DeepSeek Responses 的 baseUrl 与官方口径不一致、OpenAI `gpt-4.1-mini` 无法从官方页复核（见文末「现有预设核对」）。

---

## 结论：建议补进预设的条目

### Anthropic Messages 协议

#### A1. MiniMax 官方 · MiniMax-M3.1-Flash-Preview（**推荐，双证齐全**）

| 字段 | 值 |
| --- | --- |
| protocol | `anthropic` |
| label 建议 | `MiniMax 官方 · M3.1 Flash 多模态` |
| baseUrl | `https://api.minimax.cn/anthropic/v1`（国际站把域名换成 `api.minimax.io`） |
| model | `MiniMax-M3.1-Flash-Preview` |
| verification | `documented`（附带本仓库接口实测：路由存在） |
| sourceUrl | https://platform.minimax.io/docs/api-reference/text-chat-anthropic |

- **证据原句**
  - 文档首页摘要：*"Use the Anthropic API compatible Messages format to call MiniMax models."*
  - 端点定义：*"\`\`\`\`yaml api-reference/text/api/openapi-chat-anthropic.json POST /anthropic/v1/messages"*
  - 图片能力：*"Image Understanding: … text: What does this image show? … - type: image"*
- **接口实测**：`POST https://api.minimax.cn/anthropic/v1/messages` → **401**（`authentication_error`，提示带 API secret key）；控制路径 `/anthropic/v1/__dsh_probe__` → **404**。⇒ 路由存在。
- **note 要点**：官方文档的 base 口径是 `…/anthropic`（SDK 再追加 `/v1/messages`）；本应用自行追加 `/messages`，所以填到 `…/anthropic/v1`。同站 Responses 面另见 R3。

#### A2. Fireworks AI · Kimi K3（**推荐，双证齐全**）

| 字段 | 值 |
| --- | --- |
| protocol | `anthropic` |
| label 建议 | `Fireworks AI · Kimi K3 多模态` |
| baseUrl | `https://api.fireworks.ai/inference/v1` |
| model | `accounts/fireworks/models/kimi-k3` |
| verification | `documented`（附带接口实测：路由存在） |
| sourceUrl | https://docs.fireworks.ai/tools-sdks/anthropic-compatibility |

- **证据原句**
  - *"Fireworks exposes an Anthropic-compatible endpoint at POST /v1/messages."*
  - *"The base URL for the Anthropic SDK is https://api.fireworks.ai/inference (without the /v1 suffix). The SDK appends /v1/messages automatically."*
  - API 参考（https://docs.fireworks.ai/api-reference/anthropic-messages ）：*"Send a structured list of input messages with text and/or image content, and the model will generate the next message in the conversation."*
- **接口实测**：`POST https://api.fireworks.ai/inference/v1/messages` → **404 `Model not found, inaccessible, and/or not deployed`**；控制路径同前缀 → **404 `Path not found: /v1/__dsh_probe__`**。两种 404 的语义不同（前者是模型级错误），据此判定路由存在。
- **note 要点**：文档示例模型是 `accounts/fireworks/models/kimi-k2p5`；Kimi K3 的图片模态来自 models.dev `fireworks-ai` 条目（`accounts/fireworks/models/kimi-k3` 的 `modalities.input` 含 image）。图片在 `/v1/messages` 上只有 API 参考的这句原文，**没有真实调用**。

### OpenAI Responses 协议

#### R1. 阿里云百炼（DashScope）· Qwen3.8 Flash（**推荐，双证齐全**）

| 字段 | 值 |
| --- | --- |
| protocol | `openai-responses` |
| label 建议 | `阿里云百炼 · Qwen3.8 Flash 多模态` |
| baseUrl | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| model | `qwen3.8-flash` |
| verification | `documented`（附带接口实测：路由存在） |
| sourceUrl | https://www.alibabacloud.com/help/en/model-studio/compatibility-with-openai-responses-api |

- **证据原句**
  - *"Alibaba Cloud Model Studio supports the OpenAI-compatible Responses API."*
  - 支持型号列表包含 `qwen3.8-flash`；图片内容块：*"The content type. Valid values are `input_text`, `input_image` (user role only), `input_file` (user role only, supports PDF and images), and `output_text` (assistant role only)."*
  - 旧路径已废弃：*"The legacy path `/api/v2/apps/protocols/compatible-mode/v1/responses` for the OpenAI-compatible Responses API is no longer maintained"*。
- **接口实测**：`POST https://dashscope.aliyuncs.com/compatible-mode/v1/responses` → **401 `InvalidApiKey`**；控制路径 → **404**。国际站 `dashscope-intl.aliyuncs.com/compatible-mode/v1/responses` 同样 401/404。
- **note 要点**：这正是「现有 Responses 预设缺百炼、而 Anthropic 侧已有百炼」的不对称；同一个型号两边都能覆盖。官方另提供工作区专属域名 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，普通用户用上面的默认域名即可。

#### R2. Moonshot / Kimi 官方 · Kimi K3（**推荐，双证齐全**）

| 字段 | 值 |
| --- | --- |
| protocol | `openai-responses` |
| label 建议 | `Moonshot 官方 · Kimi K3 多模态` |
| baseUrl | `https://api.moonshot.cn/v1`（国际站 `https://api.moonshot.ai/v1`） |
| model | `kimi-k3` |
| verification | `documented`（附带接口实测：路由存在） |
| sourceUrl | https://platform.moonshot.cn/docs/api/responses |

- **证据原句**
  - 中文文档：`base_url="https://api.moonshot.cn/v1"`、`curl https://api.moonshot.cn/v1/responses`、*"description: 使用的模型 ID。本接口当前支持 `kimi-k3`。"*
  - 英文文档（同页 `/guides`→`/docs/api/responses.md`）：*"Creates a model response. Provide text or image inputs to generate text or JSON outputs."*
  - 视觉文档（https://platform.moonshot.cn/docs/api/vision ）：*"多模态输入：Kimi K3、Kimi K2.7 Code 和 Kimi K2.6 均支持文本、图片与视频输入。"*
- **接口实测**：`POST https://api.moonshot.cn/v1/responses` → **401 `Incorrect API key provided`**；控制路径 `/v1/__dsh_probe__` → **404**。国际站 `api.moonshot.ai/v1/responses` 同样 401。
- **note 要点**：Moonshot 的 **Anthropic 面仍然收不了**：`api.moonshot.cn/v1/messages` → **404**（控制路径也 404），与 `docs/evidence/anthropic-provider-2026-09-28.md` 的既有结论一致——所以 Kimi 只出现在 Responses 侧。

#### R3. MiniMax 官方 · MiniMax-M3.1-Flash-Preview（**推荐，双证齐全**）

| 字段 | 值 |
| --- | --- |
| protocol | `openai-responses` |
| label 建议 | `MiniMax 官方 · M3.1 Flash 多模态` |
| baseUrl | `https://api.minimax.cn/v1`（国际站 `https://api.minimax.io/v1`） |
| model | `MiniMax-M3.1-Flash-Preview` |
| verification | `documented`（附带接口实测：路由存在） |
| sourceUrl | https://platform.minimax.io/docs/api-reference/responses-create |

- **证据原句**
  - *"Call MiniMax models via the OpenAI Responses API compatible main endpoint. Generates model replies, supports streaming and non-streaming."*
  - 端点与型号：*"\`\`\`\`yaml api-reference/text/api/openapi-responses.json POST /v1/responses"*、`model: MiniMax-M3.1-Flash-Preview`
  - 图片：*"- `input_image`: Image input"*、*"Image input (when `type` is `input_image`). Supported formats: JPEG, …"*
- **接口实测**：`POST https://api.minimax.cn/v1/responses` → **401 `authorized_error`**，控制路径 → **404**；`https://api.minimax.io/v1/responses` 同样 401。
- **note 要点**：MiniMax 两侧都能收（A1 + R3），是本轮唯一「同一家两边都补」的服务商；`api.minimax.chat/v1/responses` 也存在（401），但 models.dev 记的 CN 域名是 `api.minimax.cn`，建议按 `api.minimax.cn` 写。

#### R4. Nebius Token Factory · DeepSeek V4.1 Flash（**推荐，双证齐全**）

| 字段 | 值 |
| --- | --- |
| protocol | `openai-responses` |
| label 建议 | `Nebius Token Factory · DeepSeek V4.1 Flash 多模态` |
| baseUrl | `https://api.tokenfactory.nebius.com/v1` |
| model | `deepseek-ai/DeepSeek-V4.1-Flash` |
| verification | `documented`（附带接口实测：路由存在） |
| sourceUrl | https://docs.tokenfactory.nebius.com/api-reference/inference/create-a-response |

- **证据原句**：端点定义 *"\`\`\`\`yaml https://api.tokenfactory.nebius.com/openapi.json post /v1/responses"*；图片字段出现在 schema 中：*"- message.input_image.image_url"*。
- **接口实测**：`POST https://api.tokenfactory.nebius.com/v1/responses` → **401 `Couldn't authenticate. Reason: token is not present`**，控制路径 → **404**。
- **note 要点**：旧域名 `https://api.studio.nebius.com/v1` 的 `/responses` 也探测到存在（401/404），两者择一即可（建议用官方新域名）。型号的图片模态来自 models.dev `nebius` 条目（`deepseek-ai/DeepSeek-V4.1-Flash` 输入含 image）。

---

## 可以收录但没必要的

| 对象 | 状态 | 为什么不必 |
| --- | --- | --- |
| OpenCode Go `https://opencode.ai/zen/go/v1` | 官方模型表把 `gpt-5.6-luna` 列在 `…/zen/go/v1/responses`；models.dev `opencode-go` 有 vision 型号（`mimo-v2.6-pro`、`grok-4.7` 等） | 与已有的 OpenCode Zen 条目覆盖面重合，多一条只会让人分不清两个 Zen 入口 |
| Command Code 网关的其它 Responses 型号（`gpt-6-luna`、`gpt-6.1-sol`、`z-ai/glm-5.3-flash`、`google/gemini-3.8-flash` 等） | `/provider/v1/models`（HTTP 200）逐条给出 `supported_endpoints` 含 `/responses` | 同一网关已有预设；且这份 `/models` **不提供模态字段**，加型号等于引入未核实结论 |
| OpenRouter 再补一条 Claude/GPT 型号做 Anthropic 备选 | 官方 Messages 文档明确 *"Supports text, images, PDFs, tools, and extended thinking."* | 与既有 OpenRouter 条目同 baseUrl，需求可用改 model 满足 |
| 阿里云工作区专属域名 / 国际站域名 | 同 R1 | 与 `compatible-mode/v1` 等价，留一个默认域名即可 |
| Nebius 旧域名 `api.studio.nebius.com/v1` | 同 R4 | 与 R4 重复 |

## 不能收录及原因

| 服务商 / 端点 | 探测结果（目标 vs 控制路径） | 结论与原因 |
| --- | --- | --- |
| 腾讯混元 `https://api.hunyuan.cloud.tencent.com/v1` | `/responses` 404、`/messages` 404（控制 404） | 只有 `/chat/completions`，两种协议都不适用 |
| PPIO `https://api.ppinfra.com/v3/openai` | 两者 404（控制 404） | 无 `/responses`、无 `/messages` |
| Novita `https://api.novita.ai/v3/openai` | 两者 404（控制 404） | 同上 |
| Hyperbolic `https://api.hyperbolic.xyz/v1` | 两者 404（控制 404） | 同上 |
| Chutes `https://llm.chutes.ai/v1` | 两者 404（控制 404） | 同上 |
| 商汤 SenseNova `https://api.sensenova.cn/compatible-mode/v1` | 两者 404（控制 404） | 同上 |
| 零一万物 `https://api.lingyiwanwu.com/v1` | `/responses` 404；`/messages` 400（控制 404） | `/messages` 返回 400 但响应体为空、语义不明，证据冲突，宁少勿假 |
| 百度千帆 `https://qianfan.baidubce.com/v2` | `/responses` **401**（控制 404）⇒ 路由存在；`/messages` 404 | **缺图片证据**：千帆 API 索引里「视觉理解」是**独立端点**，`/v2/responses` 的文档（https://cloud.baidu.com/doc/qianfan-api/s/omiznmtb2 ）只演示文本；无法证明应用把图发到 `/responses` 能被吃下 |
| 智谱 Responses 面 `https://open.bigmodel.cn/api/paas/v4` | `/responses`、`/messages`、控制路径**全部 401** | 该网关先鉴权后路由，**不可判定**；官方只文档化 Anthropic 兼容面与 OpenAI Chat 兼容面，故给智谱保留 Anthropic 一条即可 |
| 硅基流动 Anthropic 面 `https://api.siliconflow.cn/v1/messages` | `/messages` **401**（控制 404）⇒ 路由存在；`/responses` 404 | **缺图片证据**：官方 Messages 文档（https://docs.siliconflow.com/cn/api-reference/chat-completions/messages ）示例模型是 `moonshotai/Kimi-K2-Instruct` 纯文本调用，全文未出现图片字段；平台虽有 VL 型号（`Qwen/Qwen3.5-27B` 等在 models.dev 标记含 image），但不能假定 Messages 面收图 |
| OpenCode Zen 的 `/chat/completions` 面 | 官方 issue：`gpt-5.6-luna` 在 `chat/completions` 上**所有图片输入 400** | 这是「预设必须落在正确端点」的反例：luna 必须走 `/responses`（维护者已确认），现有 Zen Responses 预设正确 |
| Mistral / Perplexity / aihubmix | 本机 curl `000`（DNS 通、连接超时） | 网络不可达，未核实，不作为可收条目 |

## 未核实/需人工确认

| # | 对象 | 已确认的部分 | 还差什么证据 |
| --- | --- | --- | --- |
| 1 | **火山方舟 Volcengine Ark** `https://ark.cn-beijing.volces.com/api/v3` | 文档页存在且 HTTP 200（https://docs.volcengine.com/docs/ark/responses-api-text-generation 、https://ark.volcengine.com/region:cn-beijing/docs/82379/1569618 ）；models.dev `volcengine` 的 `api` 正是该 baseUrl，vision 型号有 `doubao-seed-2-1-pro-260628`、`doubao-seed-1-6-vision-250815` 等 | 探测不可判定（`/responses`、`/messages`、控制路径**全部 401**）；两个文档 URL 都是 JS 外壳，取不到 base_url/型号原句。需要人用浏览器抄一段官方「创建 Response」的 base_url + 一个多模态型号示例 |
| 2 | **Groq** `https://api.groq.com/openai/v1` | 搜索结果指到官方文档页 `https://console.groq.com/docs/responses-api`（说明 Groq 有 Responses API）；models.dev `groq` vision 型号有 `qwen/qwen3.8-27b`、`qwen/qwen3.6-27b` | 本机对 `api.groq.com` 与 `console.groq.com` 的所有请求（含控制路径、含浏览器 UA）一律 **403**（WAF）。需要能过 WAF 的网络复核 `/responses` 与图片字段 |
| 3 | **xAI** `https://api.x.ai/v1` | 文档站 `docs.x.ai` 存在；models.dev `xai` vision 型号含 `grok-4.7` | `api.x.ai` 与 `docs.x.ai` 本机均 **000 超时**。需确认 `/v1/responses` 是否存在及是否收 `input_image` |
| 4 | **Google Gemini OpenAI 兼容面** `https://generativelanguage.googleapis.com/v1beta/openai` | 无 | 该域名与 `ai.google.dev` 本机均不可达。需确认该兼容面是否只有 `/chat/completions`（若是则**不适用**） |
| 5 | **Together AI** `https://api.together.xyz/v1` | models.dev `togetherai` 有 vision 型号（`deepseek-ai/DeepSeek-V4.1-Flash`、`MiniMaxAI/MiniMax-M3` 等） | `api.together.xyz` 全部路径 **403**（Cloudflare）。需确认是否提供 `/responses` |
| 6 | **DeepInfra Anthropic 面** `https://api.deepinfra.com/anthropic/v1` | 官方原句：*"Point the client at the DeepInfra endpoint … base_url=\"https://api.deepinfra.com/anthropic\""*、端点表 *"POST /anthropic/v1/messages Create a message (chat completion)"*（https://docs.deepinfra.com/integrations/anthropic ）；未鉴权 POST `/anthropic/v1/messages` 返回 **400 JSON decode error**（控制路径 404）⇒ 路由存在；OpenAI 面 `/v1/openai/responses` 也 401/404 存在 | **该面是否收图片**没有原句（`docs.deepinfra.com/api-reference/chat-completions/anthropic-messages` 只列 model/models 字段）。Kimi K3 的 vision 标记来自 OpenAI 面元数据，不能外推到 Messages 面 |
| 7 | **阶跃星辰 StepFun** | Anthropic 面官方原句：*"Messages API（Anthropic 兼容）Base URL：https://api.stepfun.com/step_plan"*、*"ANTHROPIC_BASE_URL 应填写 https://api.stepfun.com/step_plan（不带 /v1）。Claude Code 会在调用时自动拼接 /v1/messages。"*（https://platform.stepfun.com/docs/zh/step-plan/quick-start ）；models.dev `stepfun` vision 型号 `step-3.7-flash`、`step-5-preview`；接口实测 `api.stepfun.com/v1/messages`、`/step_plan/v1/messages`、两处 `/responses` 均 401（控制 404）⇒ 路由都在 | ① 官方只文档化 Chat Completions 与 Messages，`/responses` 无文档原句；② 文档的 Anthropic base 是 `…/step_plan`（工具再拼 `/v1/messages`），而本应用只追加 `/messages`，要填 `…/step_plan/v1`，这个口径差一步需要人确认 StepFun 是否接受 `…/step_plan/v1/messages` |
| 8 | **Kimi 编码端点** `https://api.kimi.com/coding/v1` | `/messages` 与 `/responses` 均 **401**（控制 404）⇒ 两面路由都存在；models.dev `kimi-code-plan-cn` 的 `api` 就是它，vision 型号有 `k3`、`k3-256k`、`kimi-for-coding` | 官方未说明该端点的图片支持（models.dev 把它的 `npm` 记为 openai-compatible）。与 09-28 记录的结论一致：暂不收录 |
| 9 | **七牛云 AI** `https://api.qnaigc.com/v1` | `/messages` **401**（控制 404）⇒ Anthropic 面存在；models.dev `qiniu-ai` 有 vision 型号（`doubao-seed-2.0-mini`、`gemini-3.0-flash-preview` 等） | `/responses` 404（无 Responses 面）；缺「该面收图」的官方原句与型号对应关系 |
| 10 | **Gitee AI / 无问芯穹 Infini / AI-ML API / ModelScope** | Gitee AI `https://ai.gitee.com/v1`：`/responses`、`/messages` 均 401（控制 404）；Infini `https://cloud.infini-ai.com/maas/v1`：两面均 401（控制 404）；AI-ML API `https://api.aimlapi.com/v1`：两面均 401（控制 404）；ModelScope `https://api-inference.modelscope.cn/v1`：`/responses` 400 `Invalid model id`（控制 404）、`/messages` 403 | 这四家路线都在，但没有一家有「型号 + 图片输入」的证据；ModelScope 在 models.dev 里没有任何 vision 型号。要收就得逐个补官方图片示例 |
| 11 | **智谱 Responses 面** | — | 探测不可判定（见「不能收录」表）；若要收，需要官方 Responses/图片文档 |
| 12 | **千帆 `/v2/responses` 的图片支持** | 路由存在 | 官方文档只演示文本；需找到 `input_image` 或等效字段的原句 |
| 13 | **Groq 视觉型号** | models.dev 给 `qwen/qwen3.8-27b`、`qwen/qwen3.6-27b` 标了 image | 与 #2 同一个 WAF 阻塞，一并人工复核 |

---

## 附一：现有预设核对（本次能核的都核了）

| 现有条目 | 本次核对结果 |
| --- | --- |
| DeepSeek 官方 · Anthropic（`live`） | 未复测（无密钥）。文档 200：`base_url` = `https://api.deepseek.com/anthropic`，图片 *"array, type=\"image\" … 支持"*，与 preset 一致 |
| DeepSeek 官方 · Responses（`documented`） | **口径待定**：官方文档写 `base_url` = `https://api.deepseek.com`（不带到 `/v1`），preset 填的是 `https://api.deepseek.com/v1`。`POST /v1/responses` 返回 401，但控制路径 `/v1/__dsh_probe__` 与根路径 `/responses`、`/__dsh_probe__` **全部 401**，鉴权先于路由，无法用探测区分。建议人按官方文档统一为 `https://api.deepseek.com`（需要确认应用侧拼接与文档一致） |
| 阿里云百炼 · Anthropic（`documented`） | `POST https://dashscope.aliyuncs.com/apps/anthropic/v1/messages` → **403 `api-key is required`**（Anthropic 协议的错误体），路由存在；preset 的 `/apps/anthropic/v1` 口径成立 |
| 智谱 · Anthropic（`documented`） | `POST https://open.bigmodel.cn/api/anthropic/v1/messages` → **401**（错误体是 OpenAI 风格的 `{"error":{...}}`），而 `/api/anthropic/v1/__dsh_probe__` 返回 **200 + 鉴权失败 JSON**。两家域名（`open.bigmodel.cn` / `api.z.ai`）行为一致，路由存在 |
| OpenCode Zen · Anthropic（`qwen3.8-flash`） | 官方模型表把 `qwen3.8-flash` 列在 `/messages` ✓；models.dev `opencode` 给 `qwen3.8-flash` 标 `input=text,image,video` ✓ |
| OpenCode Zen · Responses（`gpt-5.6-luna`） | 官方模型表把 `gpt-5.6-luna` 列在 `/responses` ✓；models.dev `opencode` 标 `input=text,image,pdf` ✓；官方 issue #39888 维护者原话：luna 是 Go 上的 Responses-API-only 模型，`chat/completions` 的图片路径异常，**图片在 `/v1/responses` 上验证正常**。注：#39831 记录过 luna/terra 在 Zen `/zen/v1` 出现过上游 403（已关闭） |
| OpenRouter（两条） | baseUrl `https://openrouter.ai/api/v1` ✓（Messages 文档 .md 里就写 `url: https://openrouter.ai/api/v1`；Responses 文档写 `https://openrouter.ai/api/v1/responses`）。**`sourceUrl` 已失效**：预设里的 `…/anthropic-messages/create-messages` 现在 **404**，现行是 https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-a-message （200）；Responses 用 https://openrouter.ai/docs/api_reference/responses/overview （200）。模型模态：`deepseek/deepseek-v4.1-flash` 与 `openai/gpt-5.6-luna` 的 `architecture.input_modalities` 都含 image ✓ |
| Anthropic 官方（`documented`） | `https://docs.anthropic.com/en/api/messages` → **200**；`POST https://api.anthropic.com/v1/messages` → **403**（Cloudflare，未到应用层），无密钥无法进一步 |
| OpenAI 官方（`documented`，`gpt-4.1-mini`） | 官方页 `platform.openai.com/docs/api-reference/responses` → **403**、`developers.openai.com/api/docs/models/gpt-5.6-luna.md` → **403**、`api.openai.com/v1/responses` → **000 不可达**。models.dev `openai` 里 `gpt-4.1-mini` **仍在列表且 `input=text,image,pdf`**，故预设不算过时，但官方侧无法复核 |
| Command Code 网关（`live`） | `GET https://api.commandcode.ai/provider/v1/models` → **200**。`supported_endpoints` 证实：所有 `claude-*` 只列 `/messages`；大多数非 Claude 型号列 `/chat/completions` + `/responses`。与 09-28 记录（`/messages` 只服务自家 Claude、受套餐限制）一致 |

## 附二：探测原始记录（HTTP 状态码）

方法：`POST {"model":"probe"}`（或 `{"model":"probe","max_tokens":16,"messages":[]}`）到 `<base><path>`；`000` = 本机连接超时。

| base | `/__dsh_probe__` | `/responses` | `/messages` |
| --- | --- | --- | --- |
| `https://api.deepseek.com/v1` | — | 401 | 401 |
| `https://api.deepseek.com`（根） | 401 | 401 | 401 |
| `https://dashscope.aliyuncs.com/apps/anthropic/v1` | — | — | 403 |
| `https://dashscope.aliyuncs.com/compatible-mode/v1` | 404 | **401** | 404 |
| `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | 404 | **401** | 404 |
| `https://open.bigmodel.cn/api/anthropic/v1` | 200 | 200 | **401** |
| `https://open.bigmodel.cn/api/paas/v4` | 401 | 401 | 401 |
| `https://api.z.ai/api/anthropic/v1` | 200 | 200 | **401** |
| `https://api.z.ai/api/paas/v4` | 401 | 401 | 401 |
| `https://opencode.ai/zen/v1` | — | 401 | 401 |
| `https://openrouter.ai/api/v1` | — | 401 | 401 |
| `https://api.anthropic.com/v1` | — | — | 403 |
| `https://api.openai.com/v1` | — | 000 | — |
| `https://api.commandcode.ai/provider/v1/models` (GET) | — | 200 | — |
| `https://api.moonshot.cn/v1` | 404 | **401** | 404 |
| `https://api.moonshot.ai/v1` (GET models) | — | — | 401 |
| `https://api.kimi.com/coding/v1` | 404 | **401** | **401** |
| `https://api.siliconflow.cn/v1` | 404 | 404 | **401** |
| `https://ark.cn-beijing.volces.com/api/v3` | 401 | 401 | 401 |
| `https://api.deepinfra.com/v1/openai` | 404 | **401** | 404 |
| `https://api.deepinfra.com/anthropic/v1` | 404 | 404 | **400** |
| `https://api.groq.com/openai/v1` | 403 | 403 | 403 |
| `https://api.together.xyz/v1` | 403 | 403 | 403 |
| `https://api.cerebras.ai/v1` | 403 | 403 | 403 |
| `https://api.fireworks.ai/inference/v1` | 404(Path not found) | 404(Model not found) | 404(Model not found) |
| `https://api.stepfun.com/v1` | 404 | **401** | **401** |
| `https://api.stepfun.com/step_plan/v1` | 404 | **401** | **401** |
| `https://api.minimax.io/v1` | 404 | **401** | 404 |
| `https://api.minimax.chat/v1` | — | **401** | — |
| `https://api.minimax.cn/v1` | 404 | **401** | 404 |
| `https://api.minimax.cn/anthropic/v1` | 404 | 404 | **401** |
| `https://api.tokenfactory.nebius.com/v1` | 404 | **401** | 404 |
| `https://api.studio.nebius.com/v1` | 404 | **401** | 404 |
| `https://qianfan.baidubce.com/v2` | 404 | **401** | 404 |
| `https://api.hunyuan.cloud.tencent.com/v1` | 404 | 404 | 404 |
| `https://api.ppinfra.com/v3/openai` | 404 | 404 | 404 |
| `https://api.novita.ai/v3/openai` | 404 | 404 | 404 |
| `https://api.hyperbolic.xyz/v1` | 404 | 404 | 404 |
| `https://llm.chutes.ai/v1` | 404 | 404 | 404 |
| `https://api.sensenova.cn/compatible-mode/v1` | 404 | 404 | 404 |
| `https://api.lingyiwanwu.com/v1` | 404 | 404 | 400（空体） |
| `https://api-inference.modelscope.cn/v1` | 404 | **400** | 403 |
| `https://ai.gitee.com/v1` | 404 | **401** | **401** |
| `https://cloud.infini-ai.com/maas/v1` | 404 | **401** | **401** |
| `https://api.aimlapi.com/v1` | 404 | **401** | **401** |
| `https://api.qnaigc.com/v1` | 404 | 404 | **401** |
| `https://api.baichuan-ai.com/v1` | 404 | **401** | 404 |
| `https://models.github.ai/inference` | 200 | 200 | 200（全路径返回 `OK`，判不了路由，不作为证据） |
| `https://inference.baseten.co/v1` | 401 | 401 | 401 |
| `https://spark-api-open.xf-yun.com/v1` | 401 | 401 | 401 |
| `https://api.sambanova.ai/v1` | 404 | 404 | 404 |
| `https://api.x.ai/v1` / `https://api.mistral.ai/v1` / `https://api.perplexity.ai` / `https://aihubmix.com/v1` / `https://generativelanguage.googleapis.com/v1beta/openai` / `https://api.minimaxi.com/v1` | 000 | 000 | 000 |

**文档 URL 状态码**：DeepSeek Anthropic 200 / DeepSeek Responses 200；OpenCode Zen 200；OpenRouter Responses 200、Anthropic Messages（新）200、（旧，预设里那个）404；Anthropic 200；OpenAI 官方 403；百炼 Responses（en）200、qwen-api-via-openai-responses 200、百炼 qwen3-8-flash 200；Moonshot 平台 200（responses / responses.md / vision）；Kimi 平台 200（responses.md）；MiniMax responses-create.md 200、text-chat-anthropic.md 200；DeepInfra integrations/anthropic 200、anthropic-messages 200；Fireworks anthropic-compatibility 200、anthropic-messages.md 200；Nebius create-a-response.md 200；StepFun quick-start 200；SiliconFlow Messages 200；千帆 responses 200；火山方舟两页 200（JS 外壳）；Groq 403；xAI / Gemini / Mistral / Perplexity 000。
