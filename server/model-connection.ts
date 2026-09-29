import OpenAI from "openai";
import type {
  ResponseCreateParamsNonStreaming,
  ResponseFormatTextJSONSchemaConfig,
} from "openai/resources/responses/responses.js";
import { activeProviderConfig, type ModelProvider, type ModelSettings, type ProviderConfig } from "./model-settings.js";
import {
  createAnthropicMessagesRequester,
  requestAnthropicToolCall,
  type AnthropicMessagesRequester,
  type AnthropicToolUseBlock,
} from "./anthropic-messages.js";

const CONNECTION_TIMEOUT_MS = 15_000;
/** 上限仍是短请求；64 会被推理型模型的思考 token 吃光导致空输出。 */
const CONNECTION_MAX_OUTPUT_TOKENS = 512;

const connectionFormat: ResponseFormatTextJSONSchemaConfig = {
  type: "json_schema",
  name: "connection_check",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
  },
};

const CONNECTION_TOOL_NAME = "connection_check";

const connectionToolSchema = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
};

export interface ModelConnectionResult {
  model: string;
  latencyMs: number;
}

export type ModelConnectionFailureKind =
  | "auth"
  | "endpoint"
  | "rate-limit"
  | "timeout"
  | "request-rejected"
  | "invalid-output"
  | "upstream";

const providerLabels: Record<ModelProvider, { endpoint: string; structuredOutput: string }> = {
  "openai-responses": { endpoint: "Responses", structuredOutput: "Responses JSON Schema" },
  anthropic: { endpoint: "Messages", structuredOutput: "Messages 工具调用" },
};

function failureMessage(kind: ModelConnectionFailureKind, provider: ModelProvider): string {
  const label = providerLabels[provider];
  switch (kind) {
    case "auth":
      return "API Key 无效或没有访问此模型的权限，请检查密钥与服务商账户。";
    case "endpoint":
      return `找不到 ${label.endpoint} 接口或模型，请检查 Base URL 和模型名称。`;
    case "rate-limit":
      return "模型服务正在限流或额度不足，请稍后重试并检查账户额度。";
    case "timeout":
      return "连接测试超时，请检查服务地址或稍后重试。";
    case "request-rejected":
      return `模型服务拒绝了测试请求，请检查 Base URL、模型名称及 ${label.structuredOutput} 支持情况。`;
    case "invalid-output":
      return "连接已建立，但模型未返回有效的结构化测试结果。";
    case "upstream":
      return "模型服务连接失败，请检查地址、网络和服务状态。";
  }
}

export interface ModelConnectionErrorOptions extends ErrorOptions {
  provider?: ModelProvider;
}

export class ModelConnectionError extends Error {
  constructor(readonly kind: ModelConnectionFailureKind, options: ModelConnectionErrorOptions = {}) {
    super(failureMessage(kind, options.provider ?? "openai-responses"), options);
    this.name = "ModelConnectionError";
  }
}

export type ResponsesConnectionRequester = (
  parameters: ResponseCreateParamsNonStreaming,
) => Promise<{ output_text: string; model?: string }>;

function classifyRequestError(error: unknown, provider: ModelProvider): ModelConnectionError {
  const status = error && typeof error === "object" && "status" in error
    ? Number(error.status)
    : null;
  const name = error instanceof Error ? error.name : "";
  const options: ModelConnectionErrorOptions = { provider, cause: error };
  if (status === 401 || status === 403) return new ModelConnectionError("auth", options);
  if (status === 404) return new ModelConnectionError("endpoint", options);
  if (status === 429) return new ModelConnectionError("rate-limit", options);
  if (status === 400 || status === 422) return new ModelConnectionError("request-rejected", options);
  if (name === "APIConnectionTimeoutError" || name === "TimeoutError") {
    return new ModelConnectionError("timeout", options);
  }
  return new ModelConnectionError("upstream", options);
}

/** 只验证 Responses 与 JSON Schema；不发送图片、不保存设置或返回密钥。 */
export async function testResponsesConnection(
  config: ProviderConfig,
  requester?: ResponsesConnectionRequester,
): Promise<ModelConnectionResult> {
  const provider: ModelProvider = "openai-responses";
  if (!config.apiKey.trim()) throw new ModelConnectionError("auth", { provider });
  const send = requester ?? (() => {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: CONNECTION_TIMEOUT_MS,
      maxRetries: 0,
    });
    return (parameters: ResponseCreateParamsNonStreaming) => client.responses.create(parameters);
  })();

  const startedAt = Date.now();
  let reply: Awaited<ReturnType<ResponsesConnectionRequester>>;
  try {
    reply = await send({
      model: config.model,
      store: false,
      input: "请按 JSON Schema 只返回 ok 为 true 的对象，用于测试连接。",
      max_output_tokens: CONNECTION_MAX_OUTPUT_TOKENS,
      text: { format: connectionFormat },
    });
  } catch (error) {
    throw classifyRequestError(error, provider);
  }

  let output: unknown;
  try {
    output = JSON.parse(reply.output_text) as unknown;
  } catch (error) {
    throw new ModelConnectionError("invalid-output", { provider, cause: error });
  }
  if (!output || typeof output !== "object" || Array.isArray(output)
    || Object.keys(output).length !== 1 || !("ok" in output) || output.ok !== true) {
    throw new ModelConnectionError("invalid-output", { provider });
  }

  return { model: reply.model?.trim() || config.model, latencyMs: Date.now() - startedAt };
}

/** 只验证 Messages 与强制工具调用；不发送图片、不保存设置或返回密钥。 */
export async function testAnthropicConnection(
  config: ProviderConfig,
  requester?: AnthropicMessagesRequester,
  fetchImpl?: typeof fetch,
): Promise<ModelConnectionResult> {
  const provider: ModelProvider = "anthropic";
  if (!config.apiKey.trim()) throw new ModelConnectionError("auth", { provider });
  const send = requester
    ?? createAnthropicMessagesRequester(config, { timeoutMs: CONNECTION_TIMEOUT_MS, fetchImpl });

  const startedAt = Date.now();
  let reply: Awaited<ReturnType<AnthropicMessagesRequester>>;
  try {
    reply = await requestAnthropicToolCall(send, CONNECTION_TOOL_NAME, (variant) => ({
      model: config.model,
      max_tokens: CONNECTION_MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "请只调用 connection_check 工具，把 ok 设为 true，用于测试连接。" }],
        },
      ],
      tools: [
        {
          name: CONNECTION_TOOL_NAME,
          description: "返回 { ok: true } 以确认连接与工具调用可用。",
          input_schema: connectionToolSchema,
        },
      ],
      tool_choice: variant.toolChoice,
      ...(variant.thinking ? { thinking: variant.thinking } : {}),
    }));
  } catch (error) {
    throw classifyRequestError(error, provider);
  }

  const toolUse = Array.isArray(reply.content)
    ? reply.content.find((block): block is AnthropicToolUseBlock =>
        block.type === "tool_use"
        && (block as AnthropicToolUseBlock).name === CONNECTION_TOOL_NAME)
    : undefined;
  const input = toolUse?.input;
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).length !== 1 || (input as { ok?: unknown }).ok !== true) {
    throw new ModelConnectionError("invalid-output", { provider });
  }

  return { model: reply.model?.trim() || config.model, latencyMs: Date.now() - startedAt };
}

export interface ModelConnectionDependencies {
  responsesRequester?: ResponsesConnectionRequester;
  anthropicRequester?: AnthropicMessagesRequester;
  /** 测试注入的 fetch 替身，用于断言 Anthropic 路径的真实请求形状。 */
  fetchImpl?: typeof fetch;
}

/** 按本机设置的启用协议选择连接测试路径。 */
export async function testModelConnection(
  settings: ModelSettings,
  dependencies: ModelConnectionDependencies = {},
): Promise<ModelConnectionResult> {
  const { provider, config } = activeProviderConfig(settings);
  return provider === "anthropic"
    ? testAnthropicConnection(config, dependencies.anthropicRequester, dependencies.fetchImpl)
    : testResponsesConnection(config, dependencies.responsesRequester);
}
