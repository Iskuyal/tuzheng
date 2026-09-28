import { describe, expect, it } from "vitest";
import {
  ModelConnectionError,
  testModelConnection,
} from "../server/model-connection.js";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";

const config = {
  baseUrl: "https://model.example/v1",
  model: "reader-x",
  apiKey: "test-secret",
};

describe("Responses 模型连接测试", () => {
  it("只发送短文本与严格结构化请求，不上传图片或回传密钥", async () => {
    let sent: ResponseCreateParamsNonStreaming | undefined;
    const result = await testModelConnection(config, async (parameters) => {
      sent = parameters;
      return { output_text: '{"ok":true}', model: "reader-x" };
    });

    expect(sent).toMatchObject({
      model: "reader-x",
      store: false,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(sent?.input).toEqual(expect.any(String));
    expect(sent?.max_output_tokens).toBeLessThanOrEqual(64);
    expect(result).toMatchObject({ model: "reader-x" });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });

  it("把鉴权失败与不符合结构的回复分成可理解的错误", async () => {
    await expect(testModelConnection(config, async () => {
      throw Object.assign(new Error("secret upstream text"), { status: 401 });
    })).rejects.toMatchObject({ kind: "auth" });

    await expect(testModelConnection(config, async () => ({
      output_text: "not-json",
      model: "reader-x",
    }))).rejects.toMatchObject({ kind: "invalid-output" });
    expect(new ModelConnectionError("auth").message).not.toContain("secret upstream text");
  });

  it("上游拒绝测试请求时不武断声称模型不支持结构化输出", async () => {
    await expect(testModelConnection(config, async () => {
      throw Object.assign(new Error("upstream request rejected"), { status: 400 });
    })).rejects.toMatchObject({
      kind: "request-rejected",
      message: expect.stringContaining("模型名称"),
    });
  });
});
