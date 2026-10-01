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

  it("2026-10-01 按端点核实新增的 6 条：两侧各能落到它支持的那个端点", () => {
    const expected = [
      ["minimax-anthropic-m3-flash", "anthropic", "https://api.minimax.cn/anthropic/v1", "MiniMax-M3.1-Flash-Preview"],
      ["fireworks-anthropic-kimi-k3", "anthropic", "https://api.fireworks.ai/inference/v1", "accounts/fireworks/models/kimi-k3"],
      ["dashscope-responses-qwen-flash", "openai-responses", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen3.8-flash"],
      ["moonshot-responses-kimi-k3", "openai-responses", "https://api.moonshot.cn/v1", "kimi-k3"],
      ["minimax-responses-m3-flash", "openai-responses", "https://api.minimax.cn/v1", "MiniMax-M3.1-Flash-Preview"],
      ["nebius-responses-deepseek-flash", "openai-responses", "https://api.tokenfactory.nebius.com/v1", "deepseek-ai/DeepSeek-V4.1-Flash"],
    ] as const;
    for (const [id, protocol, baseUrl, model] of expected) {
      expect(MODEL_PRESETS.find((preset) => preset.id === id)).toMatchObject({ protocol, baseUrl, model, verification: "documented" });
    }

    // 两侧同时覆盖的服务商：百炼与 MiniMax（这正是本轮要补的不对称）。
    for (const protocol of MODEL_PROVIDERS) {
      const presets = presetsFor(protocol);
      expect(presets.some((preset) => preset.baseUrl.startsWith("https://dashscope.aliyuncs.com"))).toBe(true);
      expect(presets.some((preset) => preset.baseUrl.startsWith("https://api.minimax.cn"))).toBe(true);
      expect(presets.length).toBeGreaterThanOrEqual(8);
    }
  });

  it("未做真实验证的预设必须在说明里写明，避免把「按文档」读成「已实测」", () => {
    for (const preset of MODEL_PRESETS) {
      if (preset.verification === "documented") expect(preset.note).toContain("未做");
    }
  });

  it("预设的 Base URL 都是可保存的根地址，不含完整接口路径", () => {
    for (const preset of MODEL_PRESETS) {
      const path = decodeURIComponent(new URL(preset.baseUrl).pathname).replace(/\/+$/, "").toLowerCase();
      expect(completedEndpointSuffixes.some((suffix) => path.endsWith(suffix))).toBe(false);
    }
  });
});
