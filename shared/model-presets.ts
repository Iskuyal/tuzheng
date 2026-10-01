import type { ModelProvider } from "./model-providers.js";

/**
 * 常用模型预设：只收录支持图片输入（多模态）的型号——纯文本模型无法完成读图，
 * 会造成「看起来接入成功、实际读不了图」的误导。
 * verification=live 表示本项目做过真实调用并记录在 docs/evidence/，documented 表示仅官方文档。
 * 两种协议都覆盖「厂商官方端点」与「中转站」，便于在不改代码的情况下切换。
 */
export interface ModelPreset {
  id: string;
  label: string;
  protocol: ModelProvider;
  /** 该协议的 Base URL 口径：填到版本段，服务端自行追加 /responses 或 /messages。 */
  baseUrl: string;
  model: string;
  note: string;
  sourceUrl: string;
  verification: "live" | "documented";
}

export const MODEL_PRESETS: ModelPreset[] = [
  // Anthropic Messages 协议
  {
    id: "deepseek-anthropic-flash",
    label: "DeepSeek 官方 · V4.1 Flash 多模态",
    protocol: "anthropic",
    baseUrl: "https://api.deepseek.com/anthropic/v1",
    model: "deepseek-flash",
    note: "官方 Anthropic 兼容端点；2026-09-28 实测连接 644 毫秒、单张图约 1.2—1.4 秒，读数与预期一致（思考模式会拒绝强制工具调用，应用已自动关闭思考）。",
    sourceUrl: "https://api-docs.deepseek.com/zh-cn/guides/anthropic_api",
    verification: "live",
  },
  {
    id: "dashscope-anthropic-qwen-flash",
    label: "阿里云百炼 · Qwen3.8 Flash 多模态",
    protocol: "anthropic",
    baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic/v1",
    model: "qwen3.8-flash",
    note: "百炼 Anthropic 兼容端点（官方口径填到 /apps/anthropic，客户端再追加 /v1/messages，本应用自行追加 /messages 故填到 /v1）；官方文档标注输入模态含图片、支持 Function Calling。未做真实调用。",
    sourceUrl: "https://help.aliyun.com/zh/model-studio/qwen3-8-flash",
    verification: "documented",
  },
  {
    id: "zhipu-anthropic-glm-flash",
    label: "智谱开放平台 · GLM-5.3-Flash 原生多模态",
    protocol: "anthropic",
    baseUrl: "https://open.bigmodel.cn/api/anthropic/v1",
    model: "glm-5.3-flash",
    note: "智谱 Claude 兼容端点；GLM-5.3-Flash 是 GLM-5 系列首个原生多模态模型。它思考不可关闭、且不支持强制工具选择，应用会自动回退为「不关思考 + 自动工具选择」再试一次。未做真实调用。",
    sourceUrl: "https://docs.bigmodel.cn/cn/guide/develop/claude/introduction",
    verification: "documented",
  },
  {
    id: "opencode-zen-anthropic-qwen",
    label: "OpenCode Zen · Qwen3.8 Flash 多模态",
    protocol: "anthropic",
    baseUrl: "https://opencode.ai/zen/v1",
    model: "qwen3.8-flash",
    note: "OpenCode Zen 中转站的 Messages 端点（官方模型表把 qwen3.8-flash 列在 /messages 下）。未做真实调用。",
    sourceUrl: "https://opencode.ai/docs/zh-cn/zen/",
    verification: "documented",
  },
  {
    id: "openrouter-anthropic-deepseek",
    label: "OpenRouter · DeepSeek V4.1 Flash 多模态",
    protocol: "anthropic",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-v4.1-flash",
    note: "OpenRouter 原生 Messages 端点（官方文档说明支持文本、图片、PDF 与工具调用）。未做真实调用。",
    sourceUrl: "https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-a-message",
    verification: "documented",
  },
  {
    id: "anthropic-official-sonnet",
    label: "Anthropic 官方 · Claude Sonnet 4.6",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-6",
    note: "官方端点；模型本身支持图片与工具调用。未做真实调用（需要 Anthropic 官方密钥）。",
    sourceUrl: "https://docs.anthropic.com/en/api/messages",
    verification: "documented",
  },
  {
    id: "minimax-anthropic-m3-flash",
    label: "MiniMax 官方 · M3.1 Flash 多模态",
    protocol: "anthropic",
    baseUrl: "https://api.minimax.cn/anthropic/v1",
    model: "MiniMax-M3.1-Flash-Preview",
    note: "官方文档写明「Use the Anthropic API compatible Messages format to call MiniMax models.」，并给出 POST /anthropic/v1/messages 与图片理解示例（type: image）；文档 base 口径是 …/anthropic（SDK 再拼 /v1/messages），本应用自行追加 /messages 所以填到 …/anthropic/v1。未鉴权探测：该路径 401、同前缀控制路径 404，说明路由存在。未做真实调用。",
    sourceUrl: "https://platform.minimax.io/docs/api-reference/text-chat-anthropic",
    verification: "documented",
  },
  {
    id: "fireworks-anthropic-kimi-k3",
    label: "Fireworks AI · Kimi K3 多模态",
    protocol: "anthropic",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    model: "accounts/fireworks/models/kimi-k3",
    note: "官方写明「Fireworks exposes an Anthropic-compatible endpoint at POST /v1/messages.」，并说明 Anthropic SDK 的 base URL 是 https://api.fireworks.ai/inference（不含 /v1，由 SDK 追加）——本应用只追加 /messages，所以填到 …/inference/v1；API 参考写明 messages 可含 image content。未鉴权探测返回模型级 404、控制路径是另一类 404，据此判定路由存在。Kimi K3 的图片输入来自 models.dev 的模态元数据。未做真实调用。",
    sourceUrl: "https://docs.fireworks.ai/tools-sdks/anthropic-compatibility",
    verification: "documented",
  },
  {
    id: "stepfun-anthropic-step-flash",
    label: "阶跃星辰 StepFun · Step 3.7 Flash 多模态",
    protocol: "anthropic",
    baseUrl: "https://api.stepfun.com/v1",
    model: "step-3.7-flash",
    note: "官方 Messages API 文档写明「以 Anthropic Messages API 兼容的格式调用 Step 模型，支持流式输出、工具调用、图片输入与思考深度配置。」；普通 API 通道 base 是 https://api.stepfun.com、完整地址 POST /v1/messages（客户端自动追加 /v1），本应用只追加 /messages 故填到 …/v1；文档给出图片块 type=image 的 URL 与 Base64 两种写法。未鉴权探测：/v1/messages 返回 401、控制路径与三个兄弟路径均 404，说明路由存在（填 …/step_plan 会 404，必须填 …/v1 或 …/step_plan/v1）。未做真实调用。",
    sourceUrl: "https://platform.stepfun.com/docs/zh/api-reference/chat/messages-create.md",
    verification: "documented",
  },
  {
    id: "kimi-coding-anthropic-k3",
    label: "Kimi 编码套餐 · K3 多模态（Anthropic 面）",
    protocol: "anthropic",
    baseUrl: "https://api.kimi.com/coding/v1",
    model: "k3",
    note: "官方文档写明「Kimi Code API supports both OpenAI and Anthropic protocols」，Anthropic 兼容 base 是 https://api.kimi.com/coding/（客户端自动拼 /v1/messages），本应用只追加 /messages 故填到 …/coding/v1；型号表把 k3 的多模态输入标为「Image, video」。未鉴权探测：该 base 的 /v1/messages 返回 401、控制路径与兄弟路径均 404，而少了 /v1 的 /coding/messages 是 404。注意这是编码套餐端点：官方 FAQ 写明「权益不足时服务器返回 401」，所以 401 也可能表示套餐不足而非密钥错误。未做真实调用。",
    sourceUrl: "https://www.kimi.com/code/docs/en/kimi-code/models.html",
    verification: "documented",
  },

  // OpenAI Responses 兼容协议
  {
    id: "deepseek-responses-flash",
    label: "DeepSeek 官方 · V4.1 Flash 多模态",
    protocol: "openai-responses",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-flash",
    note: "官方 Responses 端点（2026-09-28 探测 /v1/responses 返回 200）；与 Anthropic 面同款多模态 flash 型号。未做完整读取验收。口径差异如实保留：官方文档写 base_url = https://api.deepseek.com（不带到 /v1），本预设保留探测过的 /v1，未鉴权探测无法区分两者。",
    sourceUrl: "https://api-docs.deepseek.com/",
    verification: "documented",
  },
  {
    id: "commandcode-responses-deepseek",
    label: "Command Code 网关 · DeepSeek V4.1 Flash",
    protocol: "openai-responses",
    baseUrl: "https://api.commandcode.ai/provider/v1",
    model: "deepseek/deepseek-v4.1-flash",
    note: "本项目既有在线验收端点（官方写作 Command Code，接口 /models 的 owned_by 为 command-code）；2026-09-28 实测单张读取约 30 秒，模型偶发把百分比返回为字符串而被结构校验拒绝。它的 /messages 面只服务自家 Claude 模型且受套餐限制，因此只列在 Responses 侧。",
    sourceUrl: "https://api.commandcode.ai/provider/v1/models",
    verification: "live",
  },
  {
    id: "opencode-zen-responses",
    label: "OpenCode Zen · GPT-5.6 Luna 多模态",
    protocol: "openai-responses",
    baseUrl: "https://opencode.ai/zen/v1",
    model: "gpt-5.6-luna",
    note: "OpenCode Zen 中转站的 Responses 端点（官方模型表列出 GPT 5.6 Luna 走 /responses）。型号的多模态能力以 Zen 模型页为准，未做真实调用。",
    sourceUrl: "https://opencode.ai/docs/zh-cn/zen/",
    verification: "documented",
  },
  {
    id: "openrouter-responses-luna",
    label: "OpenRouter · GPT-5.6 Luna 多模态",
    protocol: "openai-responses",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-5.6-luna",
    note: "OpenRouter 原生 Responses 端点；模型元数据标注输入模态含图片与文件、支持工具调用。未做真实调用。",
    sourceUrl: "https://openrouter.ai/docs/api_reference/responses/overview",
    verification: "documented",
  },
  {
    id: "openai-responses-gpt",
    label: "OpenAI 官方 · GPT-4.1 mini",
    protocol: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    note: "官方端点与默认候选型号；支持图片输入与 JSON Schema 输出。未做真实调用。官方文档页与 api.openai.com 在核实环境里分别返回 403 与不可达，型号的图片模态只由 models.dev 元数据佐证。",
    sourceUrl: "https://platform.openai.com/docs/api-reference/responses",
    verification: "documented",
  },
  {
    id: "dashscope-responses-qwen-flash",
    label: "阿里云百炼 · Qwen3.8 Flash 多模态",
    protocol: "openai-responses",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.8-flash",
    note: "官方写明「Alibaba Cloud Model Studio supports the OpenAI-compatible Responses API.」，支持型号含 qwen3.8-flash，内容块含 input_image；旧的 /api/v2/apps/protocols/compatible-mode/v1/responses 路径已废弃。未鉴权探测：/compatible-mode/v1/responses 返回 401、控制路径 404。未做真实调用。",
    sourceUrl: "https://www.alibabacloud.com/help/en/model-studio/compatibility-with-openai-responses-api",
    verification: "documented",
  },
  {
    id: "moonshot-responses-kimi-k3",
    label: "Moonshot 官方 · Kimi K3 多模态",
    protocol: "openai-responses",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
    note: "官方 Responses 文档给出 base_url 与「本接口当前支持 kimi-k3」，并写明可「Provide text or image inputs」；视觉文档写明 K3 支持图片与视频输入。它在 Responses 侧可用而 /messages 返回 404，所以只列这一侧。未鉴权探测：/v1/responses 401、控制路径 404。未做真实调用。",
    sourceUrl: "https://platform.moonshot.cn/docs/api/responses",
    verification: "documented",
  },
  {
    id: "minimax-responses-m3-flash",
    label: "MiniMax 官方 · M3.1 Flash 多模态",
    protocol: "openai-responses",
    baseUrl: "https://api.minimax.cn/v1",
    model: "MiniMax-M3.1-Flash-Preview",
    note: "官方写明「Call MiniMax models via the OpenAI Responses API compatible main endpoint.」，端点 POST /v1/responses，内容块含 input_image（支持 JPEG 等）。未鉴权探测：该路径 401、控制路径 404。未做真实调用。",
    sourceUrl: "https://platform.minimax.io/docs/api-reference/responses-create",
    verification: "documented",
  },
  {
    id: "nebius-responses-deepseek-flash",
    label: "Nebius Token Factory · DeepSeek V4.1 Flash 多模态",
    protocol: "openai-responses",
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
    model: "deepseek-ai/DeepSeek-V4.1-Flash",
    note: "官方 API 参考给出 POST /v1/responses，schema 里含 message.input_image.image_url。未鉴权探测：/v1/responses 401、控制路径 404。型号的图片输入来自 models.dev 模态元数据。未做真实调用。",
    sourceUrl: "https://docs.tokenfactory.nebius.com/api-reference/inference/create-a-response",
    verification: "documented",
  },
  {
    id: "zhipu-responses-glm",
    label: "智谱开放平台 · GLM-5.3 多模态（Response API）",
    protocol: "openai-responses",
    baseUrl: "https://open.bigmodel.cn/api/v1",
    model: "glm-5.3",
    note: "官方《Response API 兼容》写明「Response API 的基址是 https://open.bigmodel.cn/api/v1，不是对话补全使用的 https://open.bigmodel.cn/api/paas/v4」，接口一览为 POST /responses，并写明「工具与多模态 支持文本、图片、文件输入」，图像理解示例用 model=glm-5.3 与 type=input_image；这个基址与智谱的 Anthropic 面、对话补全面都不同，别填错。未鉴权探测：POST /responses 返回缺鉴权（HTTP 200 + 业务码 1001）、控制路径与兄弟路径返回业务码 500「404 NOT_FOUND」、GET /responses/{id} 也返回缺鉴权，与文档路径一致。未做真实调用。",
    sourceUrl: "https://docs.bigmodel.cn/cn/guide/develop/responses/introduction",
    verification: "documented",
  },
  {
    id: "stepfun-responses-step-flash",
    label: "阶跃星辰 StepFun · Step 3.7 Flash 多模态",
    protocol: "openai-responses",
    baseUrl: "https://api.stepfun.com/v1",
    model: "step-3.7-flash",
    note: "官方 Responses API 文档写明「该接口兼容 OpenAI Responses API 的请求与响应格式」、请求地址 POST https://api.stepfun.com/v1/responses、当前支持 step-5-preview 与 step-3.7-flash，并给出图片块 type=input_image 的 image_url 字段；官方模型页把 step-3.7-flash 描述为「原生多模态」、快速上手写「图片理解和视频理解」。未鉴权探测：/v1/responses 返回 401、控制路径与兄弟路径均 404。未做真实调用。",
    sourceUrl: "https://platform.stepfun.com/docs/zh/api-reference/responses/responses-create.md",
    verification: "documented",
  },
];

export function presetsFor(protocol: ModelProvider): ModelPreset[] {
  return MODEL_PRESETS.filter((preset) => preset.protocol === protocol);
}
