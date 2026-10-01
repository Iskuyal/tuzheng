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
- **还需人工盯的（2026-10-02 部分已推翻，见下条）**：火山方舟 Ark（文档是 JS 外壳、探测不可判定）、Groq / Together / xAI / Gemini（本机网络或 WAF 拦截，未核实）、硅基流动与 Kimi coding 的 Anthropic 面（路由存在但缺「这个面收图片」的原句）。**其中 Kimi coding 的 Anthropic 面 2026-10-02 已推翻**：官方《Model Configuration》写明该 API 同时支持 OpenAI 与 Anthropic 协议并给出两种 base，型号表把 `k3` 标为「Image, video」，已补进预设；硅基流动本轮未重查，仍按旧结论。
- **另有 3 处现存预设需要人拍板**：OpenRouter 的 `sourceUrl` 已 404（现行链接见下）、DeepSeek Responses 的 baseUrl 与官方口径不一致、OpenAI `gpt-4.1-mini` 无法从官方页复核（见文末「现有预设核对」）。
- **2026-10-02 收口**（细节见「未核实清单收口（2026-10-02）」与「2026-10-02 收口：逐条证据」）：原表的 **13 行**（第 10 行含 4 家，**合计 17 个对象**；其中第 7 行 StepFun 一行对应两侧 **2 个**预设）推进为 —— **4 项能补**：阶跃星辰 StepFun 的 Responses 面与 Anthropic 面、智谱开放平台 Response API、Kimi 编码套餐的 Anthropic 面，共 **4 个新预设**（含 StepFun 两侧）；**4 项确认不能收**：Together（兼容矩阵无 `responses`）、Gemini 的 OpenAI 兼容面（只有 `chat/completions`）、千帆 `/v2/responses`（官方写明只服务文本生成类模型）、ModelScope（0 个多模态型号）；**6 项仍不能补（缺一项硬证据）**：火山方舟（对照探测不可判定）、DeepInfra Anthropic 面、七牛云 Anthropic 面、Gitee AI、无问芯穹 Infini、AI-ML API；**3 项本机网络不可达**：Groq、Groq 视觉型号、xAI。4 + 4 + 6 + 3 = 17，与上表逐行对得上。本轮仍是 **0 次真实模型调用**，`documented → live` 升格按用户 2026-10-01 的决定**继续暂缓**。

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
| 智谱 Responses 面 `https://open.bigmodel.cn/api/paas/v4` | `/responses`、`/messages`、控制路径**全部 401** | 该网关先鉴权后路由，**不可判定**；官方只文档化 Anthropic 兼容面与 OpenAI Chat 兼容面，故给智谱保留 Anthropic 一条即可。**2026-10-02 已推翻**：官方《Response API 兼容》给出**独立的** Responses 基址 `https://open.bigmodel.cn/api/v1`（不是这里探的 `/api/paas/v4`），该基址对照探测可判定，已补进预设 |
| 硅基流动 Anthropic 面 `https://api.siliconflow.cn/v1/messages` | `/messages` **401**（控制 404）⇒ 路由存在；`/responses` 404 | **缺图片证据**：官方 Messages 文档（https://docs.siliconflow.com/cn/api-reference/chat-completions/messages ）示例模型是 `moonshotai/Kimi-K2-Instruct` 纯文本调用，全文未出现图片字段；平台虽有 VL 型号（`Qwen/Qwen3.5-27B` 等在 models.dev 标记含 image），但不能假定 Messages 面收图 |
| OpenCode Zen 的 `/chat/completions` 面 | 官方 issue：`gpt-5.6-luna` 在 `chat/completions` 上**所有图片输入 400** | 这是「预设必须落在正确端点」的反例：luna 必须走 `/responses`（维护者已确认），现有 Zen Responses 预设正确 |
| Mistral / Perplexity / aihubmix | 本机 curl `000`（DNS 通、连接超时） | 网络不可达，未核实，不作为可收条目 |

## 未核实清单收口（2026-10-02）

> 本节把原来 13 行「未核实／需人工确认」（第 10 行含 4 家，**合计 17 个对象**；第 7 行 StepFun 一行对应两侧 2 个预设）逐条推到结论：**能补 → 已补进预设／仍不能补（写清缺什么）／本机网络不可达无法判（给出可复核命令与替代路径）**。逐条原句、状态码与命令见下一节「2026-10-02 收口：逐条证据」。
> 口径 4 从严执行：**对照探测两者同码 → 不可判定 → 不得据此下结论**，因此「官方文档写了路径、但本机探测不可判定」的条目仍不收（火山方舟），本轮只把它推进到「缺哪一步」写清楚。

| # | 对象 | 本轮判定 | 本轮新证据（出处） | 一句话原因 |
| --- | --- | --- | --- | --- |
| 1 | 火山方舟 Volcengine Ark `https://ark.cn-beijing.volces.com/api/v3` | **仍不能补**（探测不可判定） | 目标路径与控制路径同码：`POST` `/responses`、`/messages`、`/__dsh_probe__` 全 401，换 GET／OPTIONS／DELETE／空体／坏 JSON／表单体也全 401；国际站 `ark.ap-southeast.bytepluses.com/api/v3` 同样全 401。文档站两页都是 JS 外壳（HTTP 200、正文 60 字符） | 口径 4：两者同码即不可判定；文档面也拿不到 base_url／图片原句 |
| 2 | Groq `https://api.groq.com/openai/v1` | **本机网络不可达无法判** | 本轮 `POST /responses`、`/messages`、`/__dsh_probe__` 全部 **403 `{"error":{"message":"Forbidden"}}`**（WAF，与 10-01 一致）；官方文档原句已拿到（见下节 G2） | 探测被 WAF 拦，无法做对照；文档面已具备，等可达网络复核 |
| 3 | xAI `https://api.x.ai/v1` | **本机网络不可达无法判** | `api.x.ai:443` 连接超时（`000`，`Connect Timeout Error (attempted address: api.x.ai:443, timeout: 10000ms)`）；官方 `docs.x.ai/llms.txt` 给出 `base_url="https://api.x.ai/v1"` 与 `curl https://api.x.ai/v1/responses` | 路由有官方文档，但图片证据与对照探测都拿不到 |
| 4 | Google Gemini OpenAI 兼容面 `…/v1beta/openai` | **确认不能收**（该兼容面未文档化 `/responses`）＋本机不可达 | 官方《OpenAI compatibility》只给 `base_url="https://generativelanguage.googleapis.com/v1beta/openai/"` + `chat.completions.create` + `curl …/v1beta/openai/chat/completions`；域名本机 `000` 超时 | 官方兼容面文档里没有 `/responses`，本应用要的正是它 |
| 5 | Together AI `https://api.together.xyz/v1` | **确认不能收**（无 `/responses`） | 官方《OpenAI compatibility》的 Endpoint compatibility matrix 逐条列出 `chat/completions`（含 vision 输入）、`completions`、`embeddings`、`images`、`audio`、`models`，**没有 responses**；本机全部路径 403（Cloudflare） | 兼容矩阵里没有本应用要走的端点；vision 只走 `/v1/chat/completions` |
| 6 | DeepInfra Anthropic 面 `https://api.deepinfra.com/anthropic/v1` | **仍不能补**（缺该面图片原句） | 复核：`POST /anthropic/v1/messages` → **401 `{"type":"error","error":{"type":"authentication_error","message":"missing API key"}}`**，控制路径 404，`/messagesx`、`/zzz_not_a_route`、`/a/b/c` 均 404 ⇒ 路由存在；但 `integrations/anthropic` 与 `api-reference/…/anthropic-messages` 两页正文里 `image` 只出现在左侧导航（Vision & OCR 等），且明说 *"Not all Anthropic-specific features may be supported."* | 路由有、图片证据没有；OpenAI 面的模态元数据不能外推到 Messages 面 |
| 7 | 阶跃星辰 StepFun | **能补（两侧，已补）** | Responses：官方《Responses API》*"## 请求地址 `POST https://api.stepfun.com/v1/responses`"*、*"当前支持 `step-5-preview` 和 `step-3.7-flash`"*、图片块 *"总为 `input_image`"*；Messages：官方《Messages API》*"以 Anthropic Messages API 兼容的格式调用 Step 模型，支持流式输出、工具调用、图片输入与思考深度配置。"*，普通 API 通道 base `https://api.stepfun.com` → `POST https://api.stepfun.com/v1/messages`，图片块 `type: image`（URL／base64）；探测 `https://api.stepfun.com/v1` 的 `/responses`、`/messages` 均 401、控制路径与三个兄弟路径均 404 | 两侧都满足：文档写出该面的图片字段 + 该面型号 + 对照探测 |
| 8 | Kimi 编码端点 `https://api.kimi.com/coding/v1` | **能补（Anthropic 面，已补）**；Responses 面仍不收 | 官方《Model Configuration》*"Kimi Code API supports both OpenAI and Anthropic protocols. Base URLs: … Anthropic compatible China `https://api.kimi.com/coding/` …"*，型号表 `k3` 的多模态输入是 *"Image, video"*；探测 `https://api.kimi.com/coding/v1/{messages,responses,chat/completions}` 均 401、控制路径与兄弟路径 404 | Anthropic 面：文档点名该协议面 + 型号表写出图片输入 + 对照探测；Responses 面官方只写「OpenAI compatible」、未点名 `/responses`，本轮不收 |
| 9 | 七牛云 AI `https://api.qnaigc.com/v1` | **仍不能补**（缺该面图片原句） | 官方《实时推理请求 API 接入说明》*"七牛云AI大模型推理 API…兼容 OpenAI API 和 Anthropic API 接口格式"*、接入域名 `https://api.qnaigc.com/v1`、接口表 *"/v1/messages 兼容Anthropic API格式"*，但图片说明挂在 **`/v1/chat/completions`** 那一行（*"支持图片文字识别、文件识别 图片格式：支持 JPG、JPEG、PNG、BMP、PDF"*）；探测 `/v1/messages` 401、控制路径与兄弟路径 404 ⇒ 路由存在 | `/responses` 本就没有（404）；Anthropic 面缺「收图」原句与型号对应 |
| 10 | Gitee AI／无问芯穹 Infini／AI-ML API／ModelScope | 前三家 **仍不能补**；ModelScope **确认不能收** | 三家的 `/responses`、`/messages` 均 401、控制路径与兄弟路径 404 ⇒ 路由存在；但 Gitee 模型页是 JS 壳（正文 369 字符）、Infini 的 `docs.infini-ai.com/gen-studio/api/maas.html` 已 404、AI-ML API 的 Responses 端点文档明说 *"This endpoint is currently used only with OpenAI models."* 且图片示例全在 `/v1/chat/completions` 面；ModelScope 在 models.dev 里 **0 个** vision 型号（`/responses` 400 `Invalid model id`） | 前三家缺「某型号在该面收图」的证据；ModelScope 缺多模态型号 |
| 11 | 智谱 Responses 面 | **能补（已补）** | 官方《Response API 兼容》：*"Response API 的基址是 https://open.bigmodel.cn/api/v1，不是对话补全使用的 https://open.bigmodel.cn/api/paas/v4"*、*"工具与多模态 支持文本、图片、文件输入"*、接口一览 *"Base URL： https://open.bigmodel.cn/api/v1 … POST /responses 创建 Response"*，并有 `model = "glm-5.3"` + `{"type": "input_image", "image_url": "https://cdn.bigmodel.cn/static/logo/register.png"}` 的图像理解示例；探测该 base 的 `POST /responses` 返回缺鉴权（HTTP 200 + `code 1001`），控制路径与 `/responsesx` 返回 `code 500 "404 NOT_FOUND"`，`GET /responses/{id}` 返回缺鉴权 | 原先探的 `/api/paas/v4` 是对话补全基址；官方文档给出独立的 `/api/v1` |
| 12 | 千帆 `/v2/responses` 的图片支持 | **确认不能收** | 官方《创建模型响应》*"POST https://qianfan.baidubce.com/v2/responses"* 的「支持模型列表」写明 *"支持文本生成类模型，详细模型列表请参见 Responses API 使用指南-支持模型"*，而「视觉理解」在文档目录里是**独立端点**；探测 `/v2/responses` 401、控制路径与兄弟路径 404 ⇒ 路由存在 | 该面官方口径只服务文本生成类模型，图片走另一个端点 |
| 13 | Groq 视觉型号 | **本机网络不可达无法判** | 与 #2 同一 WAF 阻塞；models.dev `groq` 仍标 `qwen/qwen3.8-27b`、`qwen/qwen3.6-27b` 的输入含 image | 与 #2 合并复核：网络可达后一条命令即可判定 |

---

## 2026-10-02 收口：逐条证据、探测状态码与可复核命令

### 0. 工具口径的变化（先说清楚，免得复现不了）

- **10-01 用的 `curl.exe` 在本机沙箱里已不可用**：任何 HTTPS 请求都返回 `curl: (35) schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030e)` → 状态码一律 `000`。这不是网络不可达（同一时刻 `node fetch` 访问 `api.moonshot.cn` 得到 401、`api.stepfun.com` 得到 401）。
- 因此本轮改用 **Node 内置 `fetch`**（OpenSSL，不走 schannel）。10-01 表里由 curl 得到的 `000`（xAI、Gemini、Mistral 等）本轮用 Node 复核：xAI 与 Gemini 仍然是 `000`（连接超时），结论不变。
- **探测口径不变**，并**新增反向对照**：除了 `/<目标>` 与 `/__dsh_probe__`，还 POST `<目标>x`、`/zzz_not_a_route`、`/a/b/c`，确认 401 不是「`/v1` 下兜底路由」造成的。本轮对 DeepInfra Anthropic、StepFun `/v1`、Kimi Code `/coding/v1`、七牛云 `/v1`、Gitee `/v1`、Infini `/maas/v1`、AI-ML API `/v1`、ModelScope `/v1`、千帆 `/v2` 都做了这组反向对照：**目标路径 401/400，三个兄弟路径全部 404**。
- **0 次真实模型调用**：全程无 API Key、未发送图片、未跑 `npm run eval:source-audit`。所有 401/403 只能证明「路由存在／缺鉴权」，**不等于读图可用**。

### 0b. 可复核命令

Windows 上按原样粘贴即可（用 PowerShell here-string 管道给 `node --input-type=module`；**不要写成 `node -e '…'`**——PowerShell 传参给原生程序时会吃掉内层双引号，JS 源码里的字符串会被剥掉引号而报 `SyntaxError`，本轮踩过这个坑）：

```powershell
@'
const B = "https://api.stepfun.com/v1";
const body = JSON.stringify({ model: "probe", max_tokens: 16, messages: [{ role: "user", content: "hi" }] });
for (const p of ["messages", "responses", "__dsh_probe__", "messagesx", "zzz_not_a_route"]) {
  const r = await fetch(`${B}/${p}`, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(20000) });
  console.log(p.padEnd(18), r.status);
}
'@ | node --input-type=module
```

实测输出（2026-10-02）：`messages 401`、`responses 401`、`__dsh_probe__ 404`、`messagesx 404`、`zzz_not_a_route 404` ⇒ 两条路由都存在。

Linux／macOS（`curl` 正常的环境）等价写法：

```bash
BASE=https://api.stepfun.com/v1
for p in responses messages __dsh_probe__ responsesx zzz_not_a_route; do
  printf '%-18s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    -X POST -H 'content-type: application/json' -d '{"model":"probe","input":"hi"}' "$BASE/$p")"
done
```

- 判定：控制路径（`__dsh_probe__`）与兄弟路径 404、目标路径 401/400 → **路由存在**；两者同码 → **不可判定**。
- 本机若 `curl.exe` 仍报 `schannel ... SEC_E_NO_CREDENTIALS`，不要把它当 `000` 结论：那是本机 TLS 凭证问题，不是目标不可达。
- **替代路径（本机不可达那几条）**：`https://api.groq.com`、`https://console.groq.com`、`https://api.x.ai`、`https://generativelanguage.googleapis.com` 在本机分别被 WAF 403／连接超时挡住。复核可以用能过 WAF 的出口（例如同一台机器上的浏览器、或另一网络），命令同上、把 `BASE` 换成对应地址；官方文档原句已经记在下面，届时只差对照探测这一步。

### 1. 已补进预设（4 条，两侧共 4 个预设）

#### S7-a. 阶跃星辰 StepFun · Responses 面（`openai-responses`）

| 字段 | 值 |
| --- | --- |
| baseUrl | `https://api.stepfun.com/v1` |
| model | `step-3.7-flash` |
| sourceUrl | https://platform.stepfun.com/docs/zh/api-reference/responses/responses-create.md |

- **官方原句**：*"调用 Responses API，获取模型生成的响应数据。该接口兼容 OpenAI Responses API 的请求与响应格式。"*；*"## 请求地址 `POST https://api.stepfun.com/v1/responses`"*；*"`model` … 当前支持 `step-5-preview` 和 `step-3.7-flash`"*；图片块 *"`type` `string` 总为 `input_image`"*、*"`image_url` … 推荐使用 base64 data URL"*；示例 `base_url="https://api.stepfun.com/v1"`。
- **接口实测**：`POST https://api.stepfun.com/v1/responses` → **401 `{"error":{"message":"Incorrect API key provided","type":"invalid_api_key"}}`**；控制路径 `/v1/__dsh_probe__` → **404**；兄弟路径 `/v1/responsesx`、`/v1/zzz_not_a_route`、`/v1/a/b/c` → **404**。⇒ 路由存在。
- **型号多模态证据**（2026-10-02 逐字复核过的两页）：概览页（https://platform.stepfun.com/docs/zh/guides/models/step-3.7-flash.md ）*"阶跃星辰的旗舰多模态推理模型。基于 198B 总参数 / 11B 激活参数的稀疏 MoE 架构，原生支持图片和视频理解。"*、关键信息栏 *"高速推理 + 原生多模态"*；快速上手页（https://platform.stepfun.com/docs/zh/guides/models/step-3.7-flash-quickstart.md ）的输入能力表 *"| Step 3.7 Flash | `step-3.7-flash` | 文本、图片、视频 |"*，并写明 *"Step 5 Preview 和 Step 3.7 Flash 支持图片输入。Step 3.5 Flash 不支持图片输入，请改用支持图片的模型。"*；models.dev `stepfun` 给 `step-3.7-flash` 标 `input=[text,image,video]`。
  - **更正说明**：本节初稿把这两页写成了「快速学会使用 Step 3.7 Flash 的原生多模态能力：图片理解和视频理解」「高速推理 + 原生多模态 + 工具调用 · 阶跃星辰旗舰多模态推理模型」。独立审查复核时这两句在**当时的线上页面里逐字不存在**（那是我从第三方渲染的文档索引缓存里读到的描述），已按上面逐字复核过的原文替换。结论不变，但「引号里必须是线上原句」这条口径要守住。
- **baseUrl 口径**：应用自行追加 `/responses`，故填 `…/v1`（官方示例也是这个 base）。

#### S7-b. 阶跃星辰 StepFun · Anthropic Messages 面（`anthropic`）

| 字段 | 值 |
| --- | --- |
| baseUrl | `https://api.stepfun.com/v1` |
| model | `step-3.7-flash` |
| sourceUrl | https://platform.stepfun.com/docs/zh/api-reference/chat/messages-create.md |

- **官方原句**：*"以 Anthropic Messages API 兼容的格式调用 Step 模型，支持流式输出、工具调用、图片输入与思考深度配置。"*；通道表 *"| 普通 API | `https://api.stepfun.com` | `POST https://api.stepfun.com/v1/messages` |"*、*"| Step Plan | `https://api.stepfun.com/step_plan` | `POST https://api.stepfun.com/step_plan/v1/messages` |"*；图片块 *"| 图片块 | `image` | `source` 支持 URL 写法 `{"type":"url","url":"https://..."}`，或 Base64 写法 `{"type":"base64","media_type":"image/png","data":"..."}`。 |"*。
- **接口实测**：`POST https://api.stepfun.com/v1/messages` → **401 `Incorrect API key provided`**；控制路径 → **404**；兄弟路径 `/v1/messagesx`、`/v1/zzz_not_a_route`、`/v1/a/b/c` → **404**。⇒ 路由存在。`POST https://api.stepfun.com/step_plan/v1/messages` 也 401（控制 404），但 `/step_plan/messages` 是 404——所以**只能填到 `…/v1` 或 `…/step_plan/v1`**，不能填 `…/step_plan`。
- **本应用口径**：应用只追加 `/messages`，因此 baseUrl 取**普通 API 通道**的 `https://api.stepfun.com/v1`（Step Plan 订阅通道等价，留给用户按套餐自选）。

#### Z11. 智谱开放平台 · Response API（`openai-responses`）

| 字段 | 值 |
| --- | --- |
| baseUrl | `https://open.bigmodel.cn/api/v1` |
| model | `glm-5.3` |
| sourceUrl | https://docs.bigmodel.cn/cn/guide/develop/responses/introduction |

- **官方原句**：*"智谱提供独立的 Response API 协议。您可以使用现有的 OpenAI SDK responses 接口，或直接发 HTTP 请求，只需修改 API Key、基础 URL 和模型编码"*；*"Response API 的基址是 https://open.bigmodel.cn/api/v1，不是对话补全使用的 https://open.bigmodel.cn/api/paas/v4。请求超时为 7200 秒。"*；*"工具与多模态 支持文本、图片、文件输入，以及函数、命名空间、自定义工具和联网搜索"*；接口一览 *"Base URL： https://open.bigmodel.cn/api/v1 … POST /responses 创建 Response …"*；图像理解示例：`client.responses.create(model = "glm-5.3", input = [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "请描述这张图片的内容"}, {"type": "input_image", "image_url": "https://cdn.bigmodel.cn/static/logo/register.png"}]}])`。
- **接口实测**（该网关用 HTTP 200 包业务码，所以对照看的是**响应体里的业务码**，不是 HTTP 状态码）：`POST https://open.bigmodel.cn/api/v1/responses` → `200 {"code":1001,"msg":"Header中未收到Authorization参数，无法进行身份验证。","success":false}`（缺鉴权）；控制路径 `/api/v1/__dsh_probe__` → `200 {"code":500,"msg":"404 NOT_FOUND","success":false}`；兄弟路径 `/api/v1/responsesx` → `404 NOT_FOUND`；`GET /api/v1/responses/resp-probe` → `code 1001`（与文档的 `GET /responses/{response_id}` 对得上）；`https://api.z.ai/api/v1` 行为一致（国际站）。
- **口径要点**：`/api/paas/v4`（对话补全基址）本轮复测仍然是**全路径 401、不可判定**，但那不是 Responses 面；官方文档点名的 Responses 基址是 `/api/v1`。models.dev `zhipuai` 的 `api` 记的是 `/api/paas/v4`，**不能**用它当作 Response API 的基址。

#### K8. Kimi 编码套餐 · Anthropic Messages 面（`anthropic`）

| 字段 | 值 |
| --- | --- |
| baseUrl | `https://api.kimi.com/coding/v1` |
| model | `k3` |
| sourceUrl | https://www.kimi.com/code/docs/en/kimi-code/models.html |

- **官方原句**：*"Kimi Code API supports both OpenAI and Anthropic protocols. Base URLs: … Anthropic compatible China `https://api.kimi.com/coding/` Overseas `https://api.kimi.ai/coding/`"*；型号表 *"Model ID k3 k3-256k kimi-for-coding kimi-for-coding-highspeed"* 与 *"Multimodal input Image, video | Image only | Image, video | Image, video"*（即 `k3` = Image, video，`k3-256k` = Image only）；*"If the conversation history includes video files, switching directly will fail because K3-256k does not support video input."*
- **接口实测**：官方 Anthropic base 是 `https://api.kimi.com/coding/`（Claude Code 再自动拼 `/v1/messages`），所以完整端点正是本应用要打的 `https://api.kimi.com/coding/v1/messages` → **401 `Invalid Authentication`**；控制路径 `/coding/v1/__dsh_probe__` → **404 `resource_not_found_error`**；兄弟路径 `/coding/v1/messagesx`、`/coding/v1/zzz_not_a_route`、`/coding/v1/a/b/c` → **404**；而 `https://api.kimi.com/coding/messages`（少了 `/v1`）→ **404** —— 与文档「base 不带 /v1、客户端自动拼 /v1/messages」完全一致。⇒ 路由存在。
- **注意（写进预设 note）**：这是**编码套餐**端点，官方 FAQ 明确 *"When the requested capability exceeds your plan's entitlements, the server returns 401."*（没有 k3 权益时也返回 401）。所以「401」在这家既可能是密钥错、也可能是套餐不足——预设说明里如实写明，不把它读成「密钥无效」。
- **Responses 面本轮不收**：官方只说 "OpenAI compatible"（base `https://api.kimi.com/coding/v1`），**没有点名 `/responses`**；虽然探测到该 base 下 `/responses`、`/chat/completions` 都 401（控制 404），但「哪一个是官方那套 OpenAI 兼容面」没有原句，按「宁少勿假」只收 Anthropic 面。

### 2. 已核实且确认不能收（4 条）

#### T5. Together AI —— 官方兼容矩阵里没有 `responses`

- 官方《OpenAI compatibility》的 *"Endpoint compatibility matrix"* 逐条列出：`chat.completions.create` → `POST /v1/chat/completions`（Supported）、*"`chat.completions.create` (vision input) | `POST /v1/chat/completions` | Supported"*、`completions.create`、`embeddings.create`、`images.generate`、`audio.*`、`models.list`，以及 `assistants.*`、`fine_tuning.jobs.*`、`batches.*` 的「Not supported」，**通篇没有 `responses`**（https://docs.together.ai/docs/openai-api-compatibility ，本轮经第三方渲染可读）。
- 本机 `POST https://api.together.xyz/v1/{responses,messages,__dsh_probe__}` 全部 **403**（Cloudflare HTML 挑战页），探测无效。
- 结论：Together 的多模态走 `/v1/chat/completions`，**不是**本应用要的 `/responses`；本轮确认不收。

#### G4. Google Gemini 的 OpenAI 兼容面 —— 文档只给 `chat/completions`

- 官方《OpenAI compatibility》：`base_url="https://generativelanguage.googleapis.com/v1beta/openai/"`，示例一律 `client.chat.completions.create(...)`，REST 示例 `curl "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"`；该页没有出现 `responses`（https://ai.google.dev/gemini-api/docs/openai ，经第三方渲染可读）。
- 本机 `generativelanguage.googleapis.com` 全部路径连接超时（`000`），无法探测。
- 结论：官方文档里这个兼容面不提供 `/responses`，**不适用**；若以后官方文档出现 `/responses` 再复议。

#### Q12. 百度千帆 `/v2/responses` —— 官方写明只服务文本生成类模型

- 官方《创建模型响应》：*"POST https://qianfan.baidubce.com/v2/responses"*、*"支持模型列表 支持文本生成类模型，详细模型列表请参见 Responses API 使用指南-支持模型"*（https://cloud.baidu.com/doc/qianfan-api/s/vmhejnuy8 ）；同一份文档目录里「视觉理解」是**独立端点**（`POST 视觉理解`），与 Responses API 并列。
- 接口实测：`POST https://qianfan.baidubce.com/v2/responses` → **401 `invalid_iam_token`**；控制路径 → **404 `ResourceNotFound`**；兄弟路径 `/v2/responsesx`、`/v2/zzz_not_a_route`、`/v2/a/b/c` → **404**。⇒ 路由存在，但该面官方口径不含视觉。
- 结论：本应用要把图发到 `/responses`，千帆的该面按官方文档只吃文本生成类模型 —— 确认不收（图片应该走它的「视觉理解」端点，那是另一种协议形态）。

#### M10-d. ModelScope 推理 API —— 没有多模态型号

- `/responses` 返回 **400 `{"error":{"message":"Invalid model id: probe"}}`**（控制路径 404）⇒ 路由存在；`/messages` 为 403。
- models.dev `modelscope`（`api=https://api-inference.modelscope.cn/v1`）共 7 个型号、**vision 型号 0 个** —— criterion 2 无解。
- 结论：确认不收（缺「该端点下的型号有图片输入」这一条硬证据）。

### 3. 仍不能补（缺指定的一项证据：6 个对象，分 4 小节）

#### AK1. 火山方舟 Volcengine Ark —— 路由探测不可判定，文档取不到原句

- CN 基址 `https://ark.cn-beijing.volces.com/api/v3`：`POST /responses`、`/messages`、`/__dsh_probe__` **全部 401 `AuthenticationError`**（同一个错误体、带 request id）。换成国际站 `https://ark.ap-southeast.bytepluses.com/api/v3` 同样全 401。
- 报文形态差异也没有用：GET／OPTIONS／DELETE、空体、坏 JSON（`{`）、表单体（`application/x-www-form-urlencoded`）在三个路径上仍然同码（401；个别 OPTIONS 是 404，但控制路径也是 404，说明不了目标路径）。
- 文档站 `https://docs.volcengine.com/docs/ark/responses-api-text-generation`、`https://www.volcengine.com/docs/82379/1569618`、`https://docs.volcengine.com/docs/ark/multimodal-understanding?lang=zh` 返回 HTTP 200 但正文只有 60 字符（JS 外壳），拿不到 base_url／图片字段原句。BytePlus 侧 `https://docs.byteplus.com/en/docs/modelark/create-model-responses-api` 也只能取到标题。
- models.dev `volcengine` 的 `api` 正是该 baseUrl、vision 型号 12 个（`doubao-seed-1-6-vision-250815`、`doubao-seed-2-1-pro-260628` 等）——但**这只解决 criterion 2，解决不了 criterion 1/4**。
- 结论：**仍不能补**。缺的是一步其中之一：① 能过鉴权的探测（有 key 时打一次 `/api/v3/responses`，看是 401 鉴权错还是 404）；② 人或浏览器抄一段官方「创建 Response」的 base_url + 多模态型号示例。

#### D6. DeepInfra Anthropic 面 —— 路由存在，但该面没有图片原句

- 复核 `POST https://api.deepinfra.com/anthropic/v1/messages` → **401 `{"type":"error","error":{"type":"authentication_error","message":"missing API key"}}`**（Anthropic 形态错误体）；控制路径 → **404 `{"detail":"Not Found"}`**；兄弟路径 `/messagesx`、`/zzz_not_a_route`、`/a/b/c` → **404**；`/anthropic/v1/responses` → 404。⇒ `/messages` 路由存在。
- 但 `https://docs.deepinfra.com/integrations/anthropic` 与 `https://docs.deepinfra.com/api-reference/chat-completions/anthropic-messages` 两页正文里，`image` 只出现在左侧导航条目（Vision & OCR、LoRA for Image Generation、Image Generation），集成页还明说 *"Not all Anthropic-specific features may be supported. Standard message creation, streaming, and token counting work as expected."*
- **10-01 已核到、本轮沿用（原本随旧「未核实」表删除，这里补回）**：集成页原句 *"Point the client at the DeepInfra endpoint … `base_url="https://api.deepinfra.com/anthropic"`"*，端点表 *"POST /anthropic/v1/messages Create a message (chat completion)"*；OpenAI 面 `https://api.deepinfra.com/v1/openai` 的 `/responses` 也探测到存在（401，控制 404），但**同样是「有路由、没图片原句」**。本轮的 401 与 10-01 的 400 差异见文末附二该行的说明。
- 结论：**仍不能补** —— 缺「该面收 `image` 块」的原句或示例；Kimi K3 的 vision 标记来自 OpenAI 面元数据，不能外推到 Messages 面。

#### N9. 七牛云 AI —— `/v1/messages` 存在，但图片说明挂在 chat 面

- 官方《实时推理请求 API 接入说明🚀》：*"七牛云AI大模型推理 API 是一个高性能、易集成的Token API (即MaaS服务)，支持50多款主流大模型。兼容 OpenAI API 和 Anthropic API 接口格式"*、*"接入域名： https://api.qnaigc.com/v1"*、接口表 *"/v1/chat/completions 对话型推理接口(兼容OpenAI格式)，支持图片文字识别、文件识别 图片格式：支持 JPG、JPEG、PNG、BMP、PDF 等常见格式，建议使用 JPG 格式 … /v1/messages 兼容Anthropic API格式"*（https://developer-doc.qiniu.com/products/aitokenapi/inference-api/1-real-time-ai-interface-api ）。
- 接口实测：`POST https://api.qnaigc.com/v1/messages` → **401 `{"error":"Missing API key. Provide Authorization: Bearer <key> or x-api-key header."}`**；控制路径与兄弟路径 → **404**；`/v1/responses` → 404（本就没有 Responses 面）。
- models.dev `qiniu-ai`（`api=https://api.qnaigc.com/v1`）有 42 个 vision 型号（`claude-4.5-sonnet`、`gemini-2.5-flash` 等），但**这是型号级元数据，不是「/v1/messages 这个面收图」的证据**。
- 结论：**仍不能补**。差的是一句官方原句（或示例）：在 `/v1/messages` 面用 `source: {type: image/base64}` 调某个多模态型号。

#### G10. Gitee AI／无问芯穹 Infini／AI-ML API —— 路由在三家都存在，但没有面级图片证据

- **Gitee AI** `https://ai.gitee.com/v1`：`/responses` → **401 `{"error":{"code":"401","message":"Unauthorized","type":"server_error"}}`**、`/messages` → **401 `{"error":"Unauthorized"}`**；控制路径与兄弟路径 404。模型页 `https://moark.com/hf-models/Qwen/Qwen2.5-VL-7B-Instruct/api` 是 JS 外壳（正文 369 字符），无文档可引。
- **无问芯穹 Infini** `https://cloud.infini-ai.com/maas/v1`：`/responses` → **401 `{"error":{"message":"Not login",…}}`**、`/messages` → **401 `{"code":10003,"msg":"Not login"}`**；控制路径与兄弟路径 404。`https://docs.infini-ai.com/gen-studio/api/maas.html` 现已 **404**，其 API 参考本轮取不到。
- **AI-ML API** `https://api.aimlapi.com/v1`：`/responses`、`/messages` 均 **401**（`You provided an empty string instead of valid API key`），控制路径 404；其官方《GPT 4.1 Nano》页确实有 *"### Responses Endpoint This endpoint is currently used **only** with OpenAI models."* 与 `## POST /v1/responses` 的 `input_image` schema，但《Vision in Text Models》能力页的图片示例**全部走 `/v1/chat/completions`** —— 面级图片证据仍是缺的。
- 结论：三家都**仍不能补**（缺「某型号在该面收图」的原句/示例）。Gitee／Infini 还缺可引用的 API 文档。

### 4. 本机网络不可达无法判（3 条，合并为 2 组）

#### G2／G13. Groq（含 Groq 的视觉型号）

- 本机：`POST https://api.groq.com/openai/v1/{responses,messages,__dsh_probe__}` → **全部 403 `{"error":{"message":"Forbidden"}}`**；`https://console.groq.com/docs/responses-api` 同样 403（WAF）。与 10-01 一致。
- **文档面本轮已经拿到原句**（经第三方渲染，URL 仍是官方页 https://console.groq.com/docs/responses-api ）：*"Groq's Responses API is fully compatible with OpenAI's Responses API… The Responses API supports both text and image inputs while producing text outputs"*；*"set the base URL to `https://api.groq.com/openai/v1`"*；*"## Image Inputs The Responses API supports image inputs with all vision-capable models."*，示例模型 `qwen/qwen3.6-27b`（models.dev `groq` 标 `input=[text,image]`）。
- 结论：**本机网络不可达无法判**。网络可达后一条对照探测即可定案（文档面已齐）。
- **替代路径**：用能过 WAF 的出口（浏览器／另一网络）对 `https://api.groq.com/openai/v1/{responses,__dsh_probe__}` 做一次 POST 对照；注意 Groq 这条是 **beta**。

#### X3. xAI

- 本机：`api.x.ai:443` 连接超时（`000`，`Connect Timeout Error`）。与 10-01 一致。
- **文档面本轮拿到一半**：`https://docs.x.ai/llms.txt` 给出 `base_url="https://api.x.ai/v1"` 与 `curl https://api.x.ai/v1/responses`（说明 `/v1/responses` 是官方主推面，且 chat 页提到 `prompt_cache_key` 与 `/v1/responses` 同源）；但**没有拿到「该面收图」的原句**。
- 结论：**本机网络不可达无法判**（路由有文档、图片证据与对照探测都缺）。
- **替代路径**：可达网络下复核 `https://docs.x.ai/developers/rest-api-reference/inference` 里 Responses 的 `input_image` 字段，并对 `https://api.x.ai/v1/{responses,__dsh_probe__}` 做 POST 对照。

### 5. 本轮原始探测状态码（2026-10-02，Node fetch）

方法：`POST {"model":"probe",…}`；`000` = 连接超时。**加粗**表示「目标路径 vs 控制路径」形成对照（目标非 404、控制 404）。

| base | `/__dsh_probe__` | `/responses` | `/messages` | 兄弟路径（`<目标>x` `/zzz_not_a_route` `/a/b/c`） |
| --- | --- | --- | --- | --- |
| `https://ark.cn-beijing.volces.com/api/v3` | 401 | 401 | 401 | 401（不可判定） |
| `https://ark.ap-southeast.bytepluses.com/api/v3` | 401 | 401 | — | 401（不可判定） |
| `https://api.groq.com/openai/v1` | 403 | 403 | 403 | 403（WAF） |
| `https://api.x.ai/v1` | 000 | 000 | 000 | 000（超时） |
| `https://generativelanguage.googleapis.com/v1beta/openai` | 000 | 000 | 000 | 000（超时） |
| `https://api.together.xyz/v1` | 403 | 403 | 403 | 403（Cloudflare） |
| `https://api.deepinfra.com/anthropic/v1` | 404 | 404 | **401** | 404 |
| `https://api.stepfun.com/step_plan/v1` | 404 | **401** | **401** | — |
| `https://api.stepfun.com/v1` | 404 | **401** | **401** | 404 |
| `https://api.stepfun.com/step_plan` | 404 | 404 | 404 | — |
| `https://api.kimi.com/coding/v1` | 404 | **401** | **401** | 404 |
| `https://api.kimi.com/coding` | 404 | 404 | 404 | 404 |
| `https://api.qnaigc.com/v1` | 404 | 404 | **401** | 404 |
| `https://ai.gitee.com/v1` | 404 | **401** | **401** | 404 |
| `https://cloud.infini-ai.com/maas/v1` | 404 | **401** | **401** | 404 |
| `https://api.aimlapi.com/v1` | 404 | **401** | **401** | 404 |
| `https://api-inference.modelscope.cn/v1` | 404 | **400**（Invalid model id） | 403 | 404 |
| `https://open.bigmodel.cn/api/v1` | 200 / `code 500 404 NOT_FOUND` | **200 / `code 1001`（缺鉴权）** | 401 | 200 / `404 NOT_FOUND` |
| `https://api.z.ai/api/v1` | 200 / `code 500 404 NOT_FOUND` | **200 / `code 1001`（缺鉴权）** | 401 | 200 / `404 NOT_FOUND` |
| `https://open.bigmodel.cn/api/paas/v4` | 401 | 401 | 401 | 401（不可判定） |
| `https://qianfan.baidubce.com/v2` | 404 | **401** | 404 | 404 |

**文档 URL 状态码（2026-10-02）**：`docs.bigmodel.cn/cn/guide/develop/responses/introduction` 200；`platform.stepfun.com/docs/zh/api-reference/{responses/responses-create.md,chat/messages-create.md}` 200；`www.kimi.com/code/docs/en/kimi-code/models.html` 200；`cloud.baidu.com/doc/qianfan-api/s/vmhejnuy8`（创建模型响应）200；`developer-doc.qiniu.com/products/aitokenapi/inference-api/1-real-time-ai-interface-api` 200；`docs.deepinfra.com` 两页 200；`docs.aimlapi.com` 两页 200；`docs.together.ai/docs/openai-api-compatibility` 200（第三方渲染）；`ai.google.dev/gemini-api/docs/openai` 200（第三方渲染）；`docs.x.ai/llms.txt` 200（第三方渲染）；`console.groq.com/docs/responses-api` 403（第三方渲染可读）；`docs.volcengine.com/docs/ark/*`、`www.volcengine.com/docs/82379/1569618`、`docs.byteplus.com/en/docs/modelark/create-model-responses-api` 200 但为 JS 外壳；`docs.infini-ai.com/gen-studio/api/maas.html` 404；`moark.com/hf-models/*/api` 200 但为 JS 外壳。

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
| `https://api.deepinfra.com/anthropic/v1` | 404 | 404 | **400**（10-01 那次是 `400 JSON decode error`——报文形态与 10-02 不同；10-02 用 Node fetch 带 `{"model":"probe",…}` 复测为 **401 `missing API key`**。两轮结论一致：路由存在、只是缺鉴权。见「2026-10-02 原始探测状态码」表同一行） |
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
