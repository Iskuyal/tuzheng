import { describe, expect, it } from "vitest";
import {
  ModelConnectionError,
  testAnthropicConnection,
  testModelConnection,
  testResponsesConnection,
} from "../server/model-connection.js";
import type { ModelProvider, ModelSettings, ProviderConfig } from "../server/model-settings.js";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";
import type { AnthropicMessageRequestBody } from "../server/anthropic-messages.js";

const config: ProviderConfig = {
  baseUrl: "https://model.example/v1",
  model: "reader-x",
  apiKey: "test-secret",
};

function settingsFor(provider: ModelProvider, overrides: Partial<ProviderConfig> = {}): ModelSettings {
  const active: ProviderConfig = { ...config, ...overrides };
  const inactive: ProviderConfig = { ...config };
  return {
    activeProvider: provider,
    providers: {
      "openai-responses": provider === "openai-responses" ? active : inactive,
      anthropic: provider === "anthropic" ? active : inactive,
    },
  };
}

describe("Responses 模型连接测试", () => {
  it("只发送短文本与严格结构化请求，不上传图片或回传密钥", async () => {
    let sent: ResponseCreateParamsNonStreaming | undefined;
    const result = await testResponsesConnection(config, async (parameters) => {
      sent = parameters;
      return { output_text: '{"ok":true}', model: "reader-x" };
    });

    expect(sent).toMatchObject({
      model: "reader-x",
      store: false,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(sent?.input).toEqual(expect.any(String));
    expect(sent?.max_output_tokens).toBeLessThanOrEqual(512);
    expect(result).toMatchObject({ model: "reader-x" });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });

  it("把鉴权失败与不符合结构的回复分成可理解的错误", async () => {
    await expect(testResponsesConnection(config, async () => {
      throw Object.assign(new Error("secret upstream text"), { status: 401 });
    })).rejects.toMatchObject({ kind: "auth" });

    await expect(testResponsesConnection(config, async () => ({
      output_text: "not-json",
      model: "reader-x",
    }))).rejects.toMatchObject({ kind: "invalid-output" });
    expect(new ModelConnectionError("auth").message).not.toContain("secret upstream text");
  });

  it("上游拒绝测试请求时不武断声称模型不支持结构化输出", async () => {
    await expect(testResponsesConnection(config, async () => {
      throw Object.assign(new Error("upstream request rejected"), { status: 400 });
    })).rejects.toMatchObject({
      kind: "request-rejected",
      message: expect.stringContaining("模型名称"),
    });
  });
});

describe("Anthropic Messages 模型连接测试", () => {
  it("发送强制工具调用短请求并校验 ok 为 true", async () => {
    let sent: AnthropicMessageRequestBody | undefined;
    const result = await testAnthropicConnection(config, async (body) => {
      sent = body;
      return {
        model: "claude-x",
        content: [{ type: "tool_use", name: "connection_check", input: { ok: true } }],
        usage: { input_tokens: 9, output_tokens: 2 },
      };
    });

    expect(sent).toMatchObject({
      model: "reader-x",
      max_tokens: 512,
      tool_choice: { type: "tool", name: "connection_check" },
    });
    expect(sent?.tools?.[0]?.input_schema).toMatchObject({ required: ["ok"] });
    expect(sent?.thinking).toEqual({ type: "disabled" });
    expect(result).toMatchObject({ model: "claude-x" });
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });

  it("把鉴权失败、非结构化回复与超时分成可理解的错误", async () => {
    await expect(testAnthropicConnection(config, async () => {
      throw Object.assign(new Error("secret upstream text"), { status: 401 });
    })).rejects.toMatchObject({ kind: "auth" });

    await expect(testAnthropicConnection(config, async () => ({
      content: [{ type: "text", text: "连接正常" }],
    }))).rejects.toMatchObject({ kind: "invalid-output" });

    await expect(testAnthropicConnection(config, async () => ({
      content: [{ type: "tool_use", name: "connection_check", input: { ok: false } }],
    }))).rejects.toMatchObject({ kind: "invalid-output" });

    await expect(testAnthropicConnection(config, async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    })).rejects.toMatchObject({ kind: "timeout" });

    expect(new ModelConnectionError("auth", { provider: "anthropic" }).message)
      .not.toContain("secret upstream text");
  });

  it("上游拒绝测试请求时提示指向 Messages 工具调用", async () => {
    await expect(testAnthropicConnection(config, async () => {
      throw Object.assign(new Error("upstream request rejected"), { status: 400 });
    })).rejects.toMatchObject({
      kind: "request-rejected",
      message: expect.stringContaining("Messages 工具调用"),
    });
  });
});

describe("连接测试按启用协议分派", () => {
  it("Anthropic 启用时走工具调用路径，Responses 路径不被调用", async () => {
    let responsesCalled = 0;
    const result = await testModelConnection(settingsFor("anthropic"), {
      responsesRequester: async () => {
        responsesCalled += 1;
        return { output_text: '{"ok":true}' };
      },
      anthropicRequester: async () => ({
        model: "claude-x",
        content: [{ type: "tool_use", name: "connection_check", input: { ok: true } }],
      }),
    });

    expect(result.model).toBe("claude-x");
    expect(responsesCalled).toBe(0);
  });

  it("Responses 启用时走 JSON Schema 路径，Anthropic 路径不被调用", async () => {
    let anthropicCalled = 0;
    const result = await testModelConnection(settingsFor("openai-responses"), {
      responsesRequester: async () => ({ output_text: '{"ok":true}', model: "reader-x" }),
      anthropicRequester: async () => {
        anthropicCalled += 1;
        return { content: [] };
      },
    });

    expect(result.model).toBe("reader-x");
    expect(anthropicCalled).toBe(0);
  });
});
