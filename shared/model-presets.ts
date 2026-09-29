import type { ModelProvider } from "./model-providers.js";

/**
 * 常用模型预设：只收录支持图片输入（多模态）的型号——纯文本模型无法完成读图，
 * 会造成「看起来接入成功、实际读不了图」的误导。
 * verification=live 表示本项目做过真实调用并记录在 docs/evidence/。
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
  {
    id: "deepseek-anthropic-flash",
    label: "DeepSeek 官方 · V4.1 Flash 多模态",
    protocol: "anthropic",
    baseUrl: "https://api.deepseek.com/anthropic/v1",
    model: "deepseek-flash",
    note: "官方 Anthropic 兼容端点；2026-09-28 实测单张图约 1.4 秒，读数与预期一致（思考模式会拒绝强制工具调用，应用已自动关闭思考）。",
    sourceUrl: "https://api-docs.deepseek.com/zh-cn/guides/anthropic_api",
    verification: "live",
  },
  {
    id: "dashscope-anthropic-qwen-vl-flash",
    label: "阿里云百炼 · 通义千问 VL Flash 多模态",
    protocol: "anthropic",
    baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic/v1",
    model: "qwen3-vl-flash",
    note: "百炼的 Anthropic 兼容端点（官方口径填到 /apps/anthropic，本应用只追加 /messages，故填到 /v1）；视觉需用 VL 型号。文档列出、未做真实调用。",
    sourceUrl: "https://www.alibabacloud.com/help/zh/model-studio/anthropic-api-messages",
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
    id: "commandcode-responses-deepseek",
    label: "commandcode 网关 · DeepSeek V4.1 Flash",
    protocol: "openai-responses",
    baseUrl: "https://api.commandcode.ai/provider/v1",
    model: "deepseek/deepseek-v4.1-flash",
    note: "本项目既有在线验收端点；2026-09-28 实测单张读取约 30 秒，模型偶发把百分比返回为字符串而被结构校验拒绝。",
    sourceUrl: "https://api.commandcode.ai/provider/v1/models",
    verification: "live",
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
