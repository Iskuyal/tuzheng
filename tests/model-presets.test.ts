import { describe, expect, it } from "vitest";
import { MODEL_PRESETS, presetsFor } from "../shared/model-presets.js";
import { MODEL_PROVIDERS } from "../shared/model-providers.js";

const completedEndpointSuffixes = ["/responses", "/messages", "/chat/completions", "/completions"];

describe("常用模型预设", () => {
  it("每条预设都有协议、地址、型号、说明与出处，且 id 唯一", () => {
    expect(MODEL_PRESETS.length).toBeGreaterThanOrEqual(8);
    for (const preset of MODEL_PRESETS) {
      expect(MODEL_PROVIDERS).toContain(preset.protocol);
      expect(preset.baseUrl.startsWith("https://")).toBe(true);
      expect(preset.model.trim().length).toBeGreaterThan(0);
      expect(preset.note.length).toBeGreaterThan(0);
      expect(preset.sourceUrl.startsWith("https://")).toBe(true);
      expect(["live", "documented"]).toContain(preset.verification);
    }
    const ids = MODEL_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("两种协议都覆盖厂商官方 DeepSeek 与中转站，Qwen / GLM 使用 flash 多模态型号", () => {
    for (const protocol of MODEL_PROVIDERS) {
      const presets = presetsFor(protocol);
      expect(presets.length).toBeGreaterThan(0);
      expect(presets.some((preset) => preset.baseUrl.startsWith("https://api.deepseek.com"))).toBe(true);
      expect(presets.some((preset) =>
        ["https://opencode.ai/zen/v1", "https://openrouter.ai/api/v1", "https://api.commandcode.ai/provider/v1"]
          .includes(preset.baseUrl))).toBe(true);
    }

    expect(MODEL_PRESETS.find((preset) => preset.id === "deepseek-anthropic-flash")).toMatchObject({
      protocol: "anthropic",
      baseUrl: "https://api.deepseek.com/anthropic/v1",
      model: "deepseek-flash",
      verification: "live",
    });
    expect(MODEL_PRESETS.find((preset) => preset.id === "deepseek-responses-flash")).toMatchObject({
      protocol: "openai-responses",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-flash",
    });
    expect(MODEL_PRESETS.find((preset) => preset.id === "dashscope-anthropic-qwen-flash")).toMatchObject({
      protocol: "anthropic",
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic/v1",
      model: "qwen3.8-flash",
    });
    expect(MODEL_PRESETS.find((preset) => preset.id === "zhipu-anthropic-glm-flash")).toMatchObject({
      protocol: "anthropic",
      baseUrl: "https://open.bigmodel.cn/api/anthropic/v1",
      model: "glm-5.3-flash",
    });
  });

  it("预设的 Base URL 都是可保存的根地址，不含完整接口路径", () => {
    for (const preset of MODEL_PRESETS) {
      const path = decodeURIComponent(new URL(preset.baseUrl).pathname).replace(/\/+$/, "").toLowerCase();
      expect(completedEndpointSuffixes.some((suffix) => path.endsWith(suffix))).toBe(false);
    }
  });
});
