import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_API_VERSION,
  AnthropicRequestError,
  createAnthropicMessagesRequester,
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

  it("响应不是有效 JSON 时抛出错误，不当成正常回复", async () => {
    const send = createAnthropicMessagesRequester(config, {
      timeoutMs: 1_000,
      fetchImpl: async () => new Response("not-json", { status: 200 }),
    });

    await expect(send(pingBody)).rejects.toBeInstanceOf(Error);
  });
});
