import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_API_VERSION,
  AnthropicRequestError,
  createAnthropicMessagesRequester,
  requestAnthropicToolCall,
  type AnthropicMessageRequestBody,
} from "../server/anthropic-messages.js";

const config = {
  baseUrl: "https://anthropic.example/v1/",
  model: "claude-x",
  apiKey: "test-secret",
};

const pingBody: AnthropicMessageRequestBody = {
  model: "claude-x",
  max_tokens: 64,
  messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
};

describe("Anthropic Messages 发送器", () => {
  it("把请求发到 Base URL 下的 /messages，并带上密钥与协议版本", async () => {
    let url: string | URL | undefined;
    let init: RequestInit | undefined;
    const send = createAnthropicMessagesRequester(config, {
      timeoutMs: 1_000,
      fetchImpl: async (input, requestInit) => {
        url = input as string;
        init = requestInit;
        return new Response(JSON.stringify({ id: "msg_1", content: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await send(pingBody);

    expect(String(url)).toBe("https://anthropic.example/v1/messages");
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-api-key")).toBe("test-secret");
    expect(headers.get("authorization")).toBe("Bearer test-secret");
    expect(headers.get("anthropic-version")).toBe(ANTHROPIC_API_VERSION);
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "claude-x", max_tokens: 64 });
  });

  it("非 2xx 响应抛出带状态码的错误，供失败分类复用", async () => {
    const send = createAnthropicMessagesRequester(config, {
      timeoutMs: 1_000,
      fetchImpl: async () => new Response("rate limited", { status: 429 }),
    });

    await expect(send(pingBody)).rejects.toBeInstanceOf(AnthropicRequestError);
    await expect(send(pingBody)).rejects.toMatchObject({ status: 429 });
  });

  it("把上游错误正文带进错误信息，余额不足一类的问题可直接定位", async () => {
    const send = createAnthropicMessagesRequester(config, {
      timeoutMs: 1_000,
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "Insufficient Balance" } }), { status: 402 }),
    });

    await expect(send(pingBody)).rejects.toMatchObject({
      status: 402,
      detail: expect.stringContaining("Insufficient Balance"),
    });
    await expect(send(pingBody)).rejects.toThrow(/HTTP 402/);
  });

  it("响应不是有效 JSON 时抛出错误，不当成正常回复", async () => {
    const send = createAnthropicMessagesRequester(config, {
      timeoutMs: 1_000,
      fetchImpl: async () => new Response("not-json", { status: 200 }),
    });

    await expect(send(pingBody)).rejects.toBeInstanceOf(Error);
  });

  it("首选形态被 400 拒绝时回退为自动工具选择且不带思考字段", async () => {
    const seen: AnthropicMessageRequestBody[] = [];
    const reply = await requestAnthropicToolCall(async (body) => {
      seen.push(body);
      if (seen.length === 1) throw new AnthropicRequestError(400, "bad request");
      return { content: [{ type: "tool_use", name: "connection_check", input: { ok: true } }] };
    }, "connection_check", (variant) => ({
      model: "claude-x",
      max_tokens: 8,
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      tool_choice: variant.toolChoice,
      ...(variant.thinking ? { thinking: variant.thinking } : {}),
    }));

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      tool_choice: { type: "tool", name: "connection_check" },
      thinking: { type: "disabled" },
    });
    expect(seen[1]?.tool_choice).toEqual({ type: "auto" });
    expect(seen[1]?.thinking).toBeUndefined();
    expect(reply.content).toHaveLength(1);
  });

  it("非 400 错误不回退，只请求一次", async () => {
    let calls = 0;
    await expect(requestAnthropicToolCall(async () => {
      calls += 1;
      throw new AnthropicRequestError(500, "server error");
    }, "connection_check", (variant) => ({
      model: "claude-x",
      max_tokens: 8,
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      tool_choice: variant.toolChoice,
      ...(variant.thinking ? { thinking: variant.thinking } : {}),
    }))).rejects.toMatchObject({ status: 500 });
    expect(calls).toBe(1);
  });
});
