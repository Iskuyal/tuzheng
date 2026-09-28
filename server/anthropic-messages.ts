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

export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema: unknown;
}

export interface AnthropicMessageRequestBody {
  model: string;
  max_tokens: number;
  messages: Array<{ role: "user"; content: AnthropicRequestContentBlock[] }>;
  tools?: AnthropicToolDefinition[];
  tool_choice?: { type: "tool"; name: string } | { type: "auto" } | { type: "any" };
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
