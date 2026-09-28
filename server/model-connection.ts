import OpenAI from "openai";
import type {
  ResponseCreateParamsNonStreaming,
  ResponseFormatTextJSONSchemaConfig,
} from "openai/resources/responses/responses.js";
import type { ModelSettings } from "./model-settings.js";

const CONNECTION_TIMEOUT_MS = 15_000;

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

const failureMessages: Record<ModelConnectionFailureKind, string> = {
  auth: "API Key 无效或没有访问此模型的权限，请检查密钥与服务商账户。",
  endpoint: "找不到 Responses 接口或模型，请检查 Base URL 和模型名称。",
  "rate-limit": "模型服务正在限流或额度不足，请稍后重试并检查账户额度。",
  timeout: "连接测试超时，请检查服务地址或稍后重试。",
  "request-rejected": "模型服务拒绝了测试请求，请检查 Base URL、模型名称及 Responses JSON Schema 支持情况。",
  "invalid-output": "连接已建立，但模型未返回有效的结构化测试结果。",
  upstream: "模型服务连接失败，请检查地址、网络和服务状态。",
};

export class ModelConnectionError extends Error {
  constructor(readonly kind: ModelConnectionFailureKind, options?: ErrorOptions) {
    super(failureMessages[kind], options);
    this.name = "ModelConnectionError";
  }
}

export type ModelConnectionRequester = (
  parameters: ResponseCreateParamsNonStreaming,
) => Promise<{ output_text: string; model?: string }>;

function classifyRequestError(error: unknown): ModelConnectionError {
  const status = error && typeof error === "object" && "status" in error
    ? Number(error.status)
    : null;
  const name = error instanceof Error ? error.name : "";
  const options = { cause: error };
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
export async function testModelConnection(
  settings: ModelSettings,
  requester?: ModelConnectionRequester,
): Promise<ModelConnectionResult> {
  if (!settings.apiKey.trim()) throw new ModelConnectionError("auth");
  const send = requester ?? (() => {
    const client = new OpenAI({
      apiKey: settings.apiKey,
      baseURL: settings.baseUrl,
      timeout: CONNECTION_TIMEOUT_MS,
      maxRetries: 0,
    });
    return (parameters: ResponseCreateParamsNonStreaming) => client.responses.create(parameters);
  })();

  const startedAt = Date.now();
  let reply: Awaited<ReturnType<ModelConnectionRequester>>;
  try {
    reply = await send({
      model: settings.model,
      store: false,
      input: "请按 JSON Schema 只返回 ok 为 true 的对象，用于测试连接。",
      max_output_tokens: 64,
      text: { format: connectionFormat },
    });
  } catch (error) {
    throw classifyRequestError(error);
  }

  let output: unknown;
  try {
    output = JSON.parse(reply.output_text) as unknown;
  } catch (error) {
    throw new ModelConnectionError("invalid-output", { cause: error });
  }
  if (!output || typeof output !== "object" || Array.isArray(output)
    || Object.keys(output).length !== 1 || !("ok" in output) || output.ok !== true) {
    throw new ModelConnectionError("invalid-output");
  }

  return { model: reply.model?.trim() || settings.model, latencyMs: Date.now() - startedAt };
}
