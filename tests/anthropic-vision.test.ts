import { describe, expect, it } from "vitest";
import { AnthropicMessagesVisionAdapter } from "../server/anthropic-vision.js";
import type { AnthropicMessageRequestBody } from "../server/anthropic-messages.js";

const validObservation = {
  claims: [{
    claimText: "2025 年收入增长 40%",
    metric: "营业收入",
    scope: "全国门店",
    claimedGrowthPercent: 40,
    older: { period: "2024 年", value: 80, unit: "万元", evidenceText: "2024 年 80 万元" },
    newer: { period: "2025 年", value: 100, unit: "万元", evidenceText: "2025 年 100 万元" },
    unreadableItems: [],
  }],
  axis: null,
};

const config = {
  baseUrl: "https://anthropic.example/v1",
  model: "claude-x",
  apiKey: "test-secret",
};

function image() {
  return { buffer: Buffer.from("chart-bytes"), mimeType: "image/png" as const };
}

describe("Anthropic Messages 视觉适配器", () => {
  it("以 base64 图片块与强制工具调用请求结构化观察值", async () => {
    let sent: AnthropicMessageRequestBody | undefined;
    const adapter = new AnthropicMessagesVisionAdapter(config, async (body) => {
      sent = body;
      return {
        id: "msg_abc123",
        model: "claude-x-20260101",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "record_chart_observation", input: validObservation }],
        usage: { input_tokens: 1_500, output_tokens: 220 },
      };
    });

    const result = await adapter.extract(image());

    expect(result).toEqual({
      observation: validObservation,
      model: "claude-x-20260101",
      requestId: "msg_abc123",
      usage: { inputTokens: 1_500, outputTokens: 220 },
      rawText: JSON.stringify(validObservation, null, 2),
    });
    expect(sent?.model).toBe("claude-x");
    expect(sent?.max_tokens).toBeGreaterThan(0);
    expect(sent?.tool_choice).toEqual({ type: "tool", name: "record_chart_observation" });
    expect(sent?.tools?.[0]).toMatchObject({ name: "record_chart_observation" });

    const content = sent?.messages[0]?.content ?? [];
    const imageBlock = content.find((block) => block.type === "image");
    expect(imageBlock).toMatchObject({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: Buffer.from("chart-bytes").toString("base64"),
      },
    });
    const textBlock = content.find((block) => block.type === "text");
    expect(textBlock && "text" in textBlock ? textBlock.text : "")
      .toContain("柱状图刻度看不清时仍返回 axis 对象");
  });

  it("没有 API Key 或模型名时拒绝构造适配器", () => {
    expect(() => new AnthropicMessagesVisionAdapter({ ...config, apiKey: "  " }))
      .toThrow("API Key is required");
    expect(() => new AnthropicMessagesVisionAdapter({ ...config, model: " " }))
      .toThrow("模型名称是必填项。");
  });

  it("缺少工具块或输出被截断时按无效输出降级", async () => {
    const noToolUse = new AnthropicMessagesVisionAdapter(config, async () => ({
      content: [{ type: "text", text: "这是一张图表。" }],
    }));
    await expect(noToolUse.extract(image())).rejects.toMatchObject({ kind: "invalid-output" });

    const truncated = new AnthropicMessagesVisionAdapter(config, async () => ({
      stop_reason: "max_tokens",
      content: [{ type: "tool_use", name: "record_chart_observation", input: { claims: [] } }],
    }));
    await expect(truncated.extract(image())).rejects.toMatchObject({ kind: "invalid-output" });

    const wrongTool = new AnthropicMessagesVisionAdapter(config, async () => ({
      content: [{ type: "tool_use", name: "other_tool", input: {} }],
    }));
    await expect(wrongTool.extract(image())).rejects.toMatchObject({ kind: "invalid-output" });
  });

  it("超时与上游失败按现有失败种类分类", async () => {
    const timedOut = new AnthropicMessagesVisionAdapter(config, async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    await expect(timedOut.extract(image())).rejects.toMatchObject({ kind: "timeout" });

    const upstreamFailed = new AnthropicMessagesVisionAdapter(config, async () => {
      throw new Error("boom");
    });
    await expect(upstreamFailed.extract(image())).rejects.toMatchObject({ kind: "upstream" });
  });
});
