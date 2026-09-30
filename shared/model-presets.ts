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
    sourceUrl: "https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-messages",
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

  // OpenAI Responses 兼容协议
  {
    id: "deepseek-responses-flash",
    label: "DeepSeek 官方 · V4.1 Flash 多模态",
    protocol: "openai-responses",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-flash",
    note: "官方 Responses 端点（2026-09-28 探测 /v1/responses 返回 200）；与 Anthropic 面同款多模态 flash 型号。未做完整读取验收。",
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
    sourceUrl: "https://openrouter.ai/docs/api_reference/overview",
    verification: "documented",
  },
  {
    id: "openai-responses-gpt",
    label: "OpenAI 官方 · GPT-4.1 mini",
    protocol: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    note: "官方端点与默认候选型号；支持图片输入与 JSON Schema 输出。未做真实调用。",
    sourceUrl: "https://platform.openai.com/docs/api-reference/responses",
    verification: "documented",
  },
];

export function presetsFor(protocol: ModelProvider): ModelPreset[] {
  return MODEL_PRESETS.filter((preset) => preset.protocol === protocol);
}
