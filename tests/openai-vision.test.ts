import { describe, expect, it } from "vitest";
import { OpenAIResponsesVisionAdapter } from "../server/openai-vision.js";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";

const validObservation = {
  titleOriginal: "2025 年收入增长 40%",
  claimedGrowthPercent: 40,
  older: { period: "2024 年", value: 80, unit: "万元", evidenceText: "2024 年 80 万元" },
  newer: { period: "2025 年", value: 100, unit: "万元", evidenceText: "2025 年 100 万元" },
  unreadableItems: [],
};

describe("OpenAI Responses 视觉适配器", () => {
  it("以服务端图片数据请求严格 JSON 观察值并关闭响应存储", async () => {
    let sent: ResponseCreateParamsNonStreaming | undefined;
    const adapter = new OpenAIResponsesVisionAdapter(
      { baseUrl: "https://proxy.example/v1", apiKey: "test-key", model: "gpt-4.1-mini" },
      async (payload) => {
        sent = payload;
        return { output_text: JSON.stringify(validObservation) };
      },
    );

    const result = await adapter.extract({
      buffer: Buffer.from("chart-bytes"),
      mimeType: "image/png",
    });

    expect(result).toEqual(validObservation);
    expect(sent?.store).toBe(false);
    expect(sent?.text?.format).toMatchObject({ type: "json_schema", strict: true });
    const userMessage = Array.isArray(sent?.input) ? sent.input[0] : undefined;
    expect(userMessage).toMatchObject({
      role: "user",
      content: [
        { type: "input_text" },
        { type: "input_image", detail: "high" },
      ],
    });
  });

  it("没有 API Key 时拒绝构造适配器", () => {
    expect(() => new OpenAIResponsesVisionAdapter({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "  ",
      model: "gpt-4.1-mini",
    })).toThrow("API Key is required");
  });

  it("拒绝无法解析的模型 JSON 文本", async () => {
    const adapter = new OpenAIResponsesVisionAdapter(
      { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "gpt-4.1-mini" },
      async () => ({ output_text: "not-json" }),
    );

    await expect(adapter.extract({
      buffer: Buffer.from("chart-bytes"),
      mimeType: "image/png",
    })).rejects.toThrow();
  });
});
