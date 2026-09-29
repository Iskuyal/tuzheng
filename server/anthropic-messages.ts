import type { ProviderConfig } from "./model-settings.js";

/** 官方要求的协议版本；兼容网关同样接受。 */
export const ANTHROPIC_API_VERSION = "2023-06-01";

export interface AnthropicImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export type AnthropicRequestContentBlock = AnthropicImageBlock | AnthropicTextBlock;

/** 工具结果的回传块：多轮编排里把程序执行结果交回模型。 */
export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type AnthropicTurnBlock =
  | AnthropicImageBlock
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicTurn {
  role: "user" | "assistant";
  content: AnthropicTurnBlock[];
}

export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema: unknown;
}

export interface AnthropicMessageRequestBody {
  model: string;
  max_tokens: number;
  messages: AnthropicTurn[];
  tools?: AnthropicToolDefinition[];
  tool_choice?: { type: "tool"; name: string } | { type: "auto" } | { type: "any" };
  /** 部分提供方（如 DeepSeek）默认开启思考，思考模式会拒绝强制工具调用；结构化提取显式关闭。 */
  thinking?: { type: "disabled" } | { type: "enabled"; budget_tokens?: number };
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id?: string;
  name: string;
  input: unknown;
}

export interface AnthropicTextResponseBlock {
  type: "text";
  text: string;
}

export type AnthropicResponseBlock =
  | AnthropicToolUseBlock
  | AnthropicTextResponseBlock
  | { type: string };

export interface AnthropicReply {
  id?: string;
  model?: string;
  stop_reason?: string | null;
  content: AnthropicResponseBlock[];
  usage?: { input_tokens?: number; output_tokens?: number } | null;
}

export type AnthropicMessagesRequester = (body: AnthropicMessageRequestBody) => Promise<AnthropicReply>;

export class AnthropicRequestError extends Error {
  constructor(readonly status: number, options?: ErrorOptions) {
    super(`Anthropic Messages 请求失败（HTTP ${status}）。`, options);
    this.name = "AnthropicRequestError";
  }
}

export interface AnthropicToolCallVariant {
  toolChoice: { type: "tool"; name: string } | { type: "auto" };
  thinking?: { type: "disabled" };
}

/**
 * 结构化提取的工具调用变体：首选「关闭思考 + 强制工具调用」（DeepSeek、Anthropic 等），
 * 回退为「不带思考字段 + 自动工具选择」（GLM-5.3-Flash 思考不可关闭、部分提供方不支持强制选择）。
 */
export function anthropicToolCallVariants(toolName: string): [AnthropicToolCallVariant, AnthropicToolCallVariant] {
  return [
    { toolChoice: { type: "tool", name: toolName }, thinking: { type: "disabled" } },
    { toolChoice: { type: "auto" } },
  ];
}

/**
 * 工具循环的变体：首选「关闭思考」，被 400 拒绝时去掉 thinking 字段重试；
 * 两种变体都让模型自行选择工具，服务端不在此处指定具体工具名。
 */
export function anthropicTurnVariants(): [AnthropicToolCallVariant, AnthropicToolCallVariant] {
  return [
    { toolChoice: { type: "auto" }, thinking: { type: "disabled" } },
    { toolChoice: { type: "auto" } },
  ];
}

/** 首选变体被 400 拒绝时，用回退变体再请求一次；其他错误直接抛出。 */
export async function requestAnthropicTurn(
  send: AnthropicMessagesRequester,
  buildBody: (variant: AnthropicToolCallVariant) => AnthropicMessageRequestBody,
): Promise<AnthropicReply> {
  const [preferred, fallback] = anthropicTurnVariants();
  try {
    return await send(buildBody(preferred));
  } catch (error) {
    if (error instanceof AnthropicRequestError && error.status === 400) {
      return await send(buildBody(fallback));
    }
    throw error;
  }
}

/** 结构化提取用的强制工具调用；多轮调查请用 requestAnthropicTurn 自带工具声明。 */
export async function requestAnthropicToolCall(
  send: AnthropicMessagesRequester,
  toolName: string,
  buildBody: (variant: AnthropicToolCallVariant) => AnthropicMessageRequestBody,
): Promise<AnthropicReply> {
  const [preferred, fallback] = anthropicToolCallVariants(toolName);
  try {
    return await send(buildBody(preferred));
  } catch (error) {
    if (error instanceof AnthropicRequestError && error.status === 400) {
      return await send(buildBody(fallback));
    }
    throw error;
  }
}

export interface AnthropicMessagesSenderOptions {
  timeoutMs: number;
  /** 测试注入用的 fetch 替身。 */
  fetchImpl?: typeof fetch;
}

/**
 * 零依赖的 Messages 请求发送器：Base URL 只填到版本段，这里追加 `/messages`。
 * 超时经 AbortSignal 抛出 name 为 TimeoutError 的错误，便于沿用现有失败分类。
 */
export function createAnthropicMessagesRequester(
  config: ProviderConfig,
  options: AnthropicMessagesSenderOptions,
): AnthropicMessagesRequester {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/messages`;
  const sendFetch = options.fetchImpl ?? fetch;

  return async (body) => {
    const response = await sendFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        // 部分兼容网关只校验 Bearer；官方端点会忽略这个头。
        "authorization": `Bearer ${config.apiKey}`,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    if (!response.ok) {
      throw new AnthropicRequestError(response.status);
    }
    return await response.json() as AnthropicReply;
  };
}
