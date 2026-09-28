import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, type VisionAdapter, type VisionReadResult } from "../server/app.js";
import { ModelConnectionError } from "../server/model-connection.js";
import { VisionModelError } from "../server/vision-error.js";
import {
  DEFAULT_PROVIDER_CONFIGS,
  type ModelProvider,
  type ModelSettings,
  type ModelSettingsStore,
  type ProviderConfig,
} from "../server/model-settings.js";
import type { AuditObservation } from "../shared/audit.js";

const visionClaim = {
  claimText: "2025 年收入增长 40%",
  metric: "营业收入",
  scope: "全国门店",
  claimedGrowthPercent: 40,
  older: {
    period: "2024 年",
    value: 80,
    unit: "万元",
    evidenceText: "2024 年 80 万元",
  },
  newer: {
    period: "2025 年",
    value: 100,
    unit: "万元",
    evidenceText: "2025 年 100 万元",
  },
  unreadableItems: [],
};

const visionObservation = {
  claims: [visionClaim],
  axis: { label: "营业收入", min: 80, max: 120, unit: "万元" },
};

const visionRead: VisionReadResult = {
  observation: visionObservation,
  model: "vision-test-model",
  requestId: "resp_test_1",
  usage: { inputTokens: 1_204, outputTokens: 88 },
  rawText: JSON.stringify(visionObservation),
};

function memorySettingsStore(
  provider: ModelProvider,
  config: Partial<ProviderConfig> = {},
): ModelSettingsStore {
  let current: ModelSettings = {
    activeProvider: provider,
    providers: {
      "openai-responses": { ...DEFAULT_PROVIDER_CONFIGS["openai-responses"] },
      anthropic: { ...DEFAULT_PROVIDER_CONFIGS.anthropic },
    },
  };
  current.providers[provider] = { ...current.providers[provider], ...config };
  return {
    read: async () => current,
    write: async (settings) => { current = settings; },
  };
}

describe("单图审计 API", () => {
  it("列出团队自制样例", async () => {
    const response = await request(createApp()).get("/api/samples").expect(200);

    expect(response.body.samples).toHaveLength(11);
    expect(response.body.samples.map(({ id }: { id: string }) => id)).toContain("multi-claims");
    expect(response.body.samples.map(({ id }: { id: string }) => id)).not.toContain("eval-rounding");
    const evaluationSample = await request(createApp())
      .post("/api/audit/sample")
      .send({ id: "eval-rounding" })
      .expect(200);
    expect(evaluationSample.body.observation.source).toBe("preset-example");
    expect(evaluationSample.body.sample).toMatchObject({
      id: "eval-rounding",
      name: "固定评测：增长率舍入",
      imageUrl: "/samples/eval-rounding.svg",
    });
  });

  it("把模糊样例作为预置示例返回，不伪装成模型输出", async () => {
    const response = await request(createApp())
      .post("/api/audit/sample")
      .send({ id: "unclear" })
      .expect(200);

    expect(response.body.observation.source).toBe("preset-example");
    expect(response.body.observation.claims).toHaveLength(1);
    expect(response.body.observation.claims[0].newer.value).toBeNull();
    expect(response.body.observation.claims[0]).not.toHaveProperty("confirmed");
    expect(response.body.observation.claims[0]).not.toHaveProperty("result");
  });

  it("返回单图三主张预置观察和来源标记，不附带模型结论", async () => {
    const response = await request(createApp())
      .post("/api/audit/sample")
      .send({ id: "multi-claims" })
      .expect(200);

    expect(response.body.observation.source).toBe("preset-example");
    expect(response.body.observation.claims).toHaveLength(3);
    expect(response.body.observation.claims.map(({ id }: { id: string }) => id)).toEqual([
      "revenue-growth",
      "profit-growth",
      "user-count-growth",
    ]);
    expect(response.body.observation.claims[1].newer.value).toBe(70);
    expect(response.body.observation.claims[1].newer.evidenceText).toBe("2025 年利润 100 万元");
    expect(response.body.observation.claims[2].newer.value).toBeNull();
    expect(response.body.observation.claims[2].newer.evidenceText).toBeNull();
    expect(JSON.stringify(response.body)).not.toMatch(/calculatedGrowthPercent|"result"|"status"/);
  });

  it("没有服务端模型密钥时说明无法运行实时视觉读取", async () => {
    const response = await request(createApp({ visionAdapter: null }))
      .post("/api/audit/image")
      .attach("image", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: "chart.png",
        contentType: "image/png",
      })
      .expect(503);

    expect(response.body.error.code).toBe("MODEL_NOT_CONFIGURED");
  });

  it.each([
    ["timeout", 504, "VISION_TIMEOUT"],
    ["upstream", 502, "VISION_REQUEST_FAILED"],
    ["invalid-output", 502, "INVALID_MODEL_OUTPUT"],
  ] as const)("视觉读取 %s 失败时返回可区分的错误，不附带观察或结论", async (kind, status, code) => {
    const visionAdapter: VisionAdapter = { extract: async () => { throw new VisionModelError(kind); } };
    const response = await request(createApp({ visionAdapter }))
      .post("/api/audit/image")
      .attach("image", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: "chart.png", contentType: "image/png",
      })
      .expect(status);
    expect(response.body.error.code).toBe(code);
    expect(response.body).not.toHaveProperty("observation");
    expect(response.body).not.toHaveProperty("result");
  });

  it("图片格式和体积不符合要求时在适配器前拒绝", async () => {
    let calls = 0;
    const visionAdapter: VisionAdapter = { extract: async () => { calls += 1; return visionRead; } };
    const app = createApp({ visionAdapter });
    const unsupported = await request(app).post("/api/audit/image")
      .attach("image", Buffer.from("not-an-image"), { filename: "fake.png", contentType: "image/png" })
      .expect(415);
    expect(unsupported.body.error.code).toBe("UNSUPPORTED_IMAGE");
    const oversized = await request(app).post("/api/audit/image")
      .attach("image", Buffer.alloc(5 * 1024 * 1024 + 1), { filename: "large.png", contentType: "image/png" })
      .expect(413);
    expect(oversized.body.error.code).toBe("IMAGE_TOO_LARGE");
    expect(calls).toBe(0);
  });

  it("把上传图片交给适配器并返回只含原始观察的 claims[]", async () => {
    const visionAdapter: VisionAdapter = {
      extract: async () => visionRead,
    };

    const response = await request(createApp({ visionAdapter }))
      .post("/api/audit/image")
      .attach("image", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: "chart.png",
        contentType: "image/png",
      })
      .expect(200);

    expect(response.body.observation.source).toBe("vision-model");
    expect(response.body.observation.claims).toHaveLength(1);
    expect(response.body.observation.claims[0].id).toBe("claim-1");
    expect(response.body.observation.claims[0].claimText).toBe(visionClaim.claimText);
    expect(response.body.observation.claims[0].older.value).toBe(80);
    expect(response.body.observation.claims[0].metric).toBe("营业收入");
    expect(response.body.observation.claims[0].scope).toBe("全国门店");
    expect(response.body.observation.axis).toEqual({ label: "营业收入", min: 80, max: 120, unit: "万元" });
    expect(response.body.observation.claims[0]).not.toHaveProperty("confirmed");
    expect(response.body.observation.claims[0]).not.toHaveProperty("result");
  });

  it("返回这次模型读取的模型名、耗时、用量和原始返回", async () => {
    const visionAdapter: VisionAdapter = { extract: async () => visionRead };
    const response = await request(createApp({ visionAdapter }))
      .post("/api/audit/image")
      .attach("image", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: "chart.png",
        contentType: "image/png",
      })
      .expect(200);

    expect(response.body.modelRead).toMatchObject({
      model: "vision-test-model",
      requestId: "resp_test_1",
      usage: { inputTokens: 1_204, outputTokens: 88 },
      rawText: JSON.stringify(visionObservation),
      imageBytes: 8,
    });
    expect(typeof response.body.modelRead.latencyMs).toBe("number");
    expect(response.body.modelRead.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(response.body)).not.toContain("private-test-key");
    expect(JSON.stringify(response.body)).not.toContain("example.com");
  });

  it("预置样例不返回模型读取轨迹", async () => {
    const response = await request(createApp())
      .post("/api/audit/sample")
      .send({ id: "multi-claims" })
      .expect(200);

    expect(response.body.observation.source).toBe("preset-example");
    expect(response.body).not.toHaveProperty("modelRead");
  });

  it("接受没有发现主张的有效空 claims[]", async () => {
    const visionAdapter: VisionAdapter = {
      extract: async () => ({
        ...visionRead,
        observation: { claims: [], axis: null },
        rawText: '{"claims":[],"axis":null}',
      }),
    };
    const response = await request(createApp({ visionAdapter }))
      .post("/api/audit/image")
      .attach("image", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: "chart.png",
        contentType: "image/png",
      })
      .expect(200);

    expect(response.body.observation).toEqual({ source: "vision-model", claims: [], axis: null });
  });

  it("对用户确认的数据在服务端返回确定性图内结论", async () => {
    const observation: AuditObservation = {
      titleOriginal: "2025 年收入增长 40%",
      claimedGrowthPercent: 40,
      older: { ...visionClaim.older, valueSource: "preset" },
      newer: { ...visionClaim.newer, valueSource: "preset" },
      unreadableItems: [],
      confirmed: true,
      source: "preset-example",
    };

    const response = await request(createApp())
      .post("/api/audit/check")
      .send(observation)
      .expect(200);

    expect(response.body.result.calculatedGrowthPercent).toBe(25);
    expect(response.body.result.status).toBe("contradictory");
  });

  it("读取设置时返回两种协议的公开配置，不返回密钥本身", async () => {
    const settingsStore = memorySettingsStore("openai-responses", {
      baseUrl: "https://vision.example/v1",
      model: "chart-reader-v2",
      apiKey: "local-private-key",
    });
    const response = await request(createApp({ settingsStore })).get("/api/settings").expect(200);

    expect(response.body.settings).toEqual({
      activeProvider: "openai-responses",
      providers: {
        "openai-responses": { baseUrl: "https://vision.example/v1", model: "chart-reader-v2", hasApiKey: true },
        anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-6", hasApiKey: false },
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("local-private-key");
  });

  it("远程模型服务 URL 要求 HTTPS，本机回环服务允许 HTTP", async () => {
    const app = createApp({ settingsStore: memorySettingsStore("openai-responses") });
    await request(app)
      .put("/api/settings")
      .send({ provider: "openai-responses", baseUrl: "http://model.example/v1", model: "reader-x", apiKey: "test-key" })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("INVALID_SETTINGS"));

    await request(app)
      .put("/api/settings")
      .send({ provider: "openai-responses", baseUrl: "http://localhost:8080/v1", model: "reader-x", apiKey: "test-key" })
      .expect(200)
      .expect(({ body }) => expect(body.settings.providers["openai-responses"].baseUrl).toBe("http://localhost:8080/v1"));
  });

  it("拒绝完整接口地址，提示指向所选协议，并保留原配置", async () => {
    const app = createApp({ settingsStore: memorySettingsStore("openai-responses", {
      baseUrl: "https://proxy.example/v1",
      model: "reader-x",
      apiKey: "saved-private-key",
    }) });

    for (const baseUrl of [
      "https://api.commandcode.ai/provider/v1/chat/completions",
      "https://api.commandcode.ai/provider/v1/responses/",
      "https://api.commandcode.ai/provider/v1/respon%73es",
      "https://api.commandcode.ai/provider/v1/chat%2Fcompletions",
    ]) {
      const response = await request(app)
        .put("/api/settings")
        .send({ provider: "openai-responses", baseUrl, model: "reader-y", apiKey: "replacement-key" })
        .expect(400);
      expect(response.body.error.code).toBe("INVALID_SETTINGS");
      expect(response.body.error.message).toContain("Base URL");
      expect(response.body.error.message).toContain("/responses");
    }

    const anthropicMessage = await request(app)
      .put("/api/settings")
      .send({
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com/v1/messages",
        model: "claude-x",
        apiKey: "replacement-key",
      })
      .expect(400);
    expect(anthropicMessage.body.error.code).toBe("INVALID_SETTINGS");
    expect(anthropicMessage.body.error.message).toContain("Anthropic Messages");
    expect(anthropicMessage.body.error.message).toContain("/messages");

    const unchanged = await request(app).get("/api/settings").expect(200);
    expect(unchanged.body.settings.activeProvider).toBe("openai-responses");
    expect(unchanged.body.settings.providers["openai-responses"]).toEqual({
      baseUrl: "https://proxy.example/v1",
      model: "reader-x",
      hasApiKey: true,
    });
  });

  it("用未保存的表单参数测试连接，不覆盖本机设置或回传密钥", async () => {
    const settingsStore = memorySettingsStore("openai-responses", {
      baseUrl: "https://saved.example/v1",
      model: "saved-model",
      apiKey: "saved-secret",
    });
    let tested: ModelSettings | undefined;
    const app = createApp({
      settingsStore,
      connectionTester: async (settings) => {
        tested = settings;
        return { model: settings.providers[settings.activeProvider].model, latencyMs: 12 };
      },
    });

    const testedResponse = await request(app)
      .post("/api/settings/test-connection")
      .send({ provider: "openai-responses", baseUrl: "https://new.example/v1", model: "new-model", apiKey: "unsaved-secret" })
      .expect(200);
    expect(tested).toMatchObject({
      activeProvider: "openai-responses",
      providers: {
        "openai-responses": { baseUrl: "https://new.example/v1", model: "new-model", apiKey: "unsaved-secret" },
      },
    });
    expect(testedResponse.body.connection).toEqual({ model: "new-model", latencyMs: 12 });
    expect(JSON.stringify(testedResponse.body)).not.toContain("unsaved-secret");

    const unchanged = await request(app).get("/api/settings").expect(200);
    expect(unchanged.body.settings.providers["openai-responses"]).toEqual({
      baseUrl: "https://saved.example/v1",
      model: "saved-model",
      hasApiKey: true,
    });
  });

  it("测试连接按所选协议沿用该协议已存密钥，并拒绝无密钥与无效地址", async () => {
    let tested: ModelSettings | undefined;
    const app = createApp({
      settingsStore: memorySettingsStore("openai-responses", {
        baseUrl: "https://saved.example/v1",
        model: "saved-model",
        apiKey: "saved-secret",
      }),
      connectionTester: async (settings) => {
        tested = settings;
        return { model: settings.providers[settings.activeProvider].model, latencyMs: 1 };
      },
    });

    await request(app)
      .post("/api/settings/test-connection")
      .send({ provider: "openai-responses", baseUrl: "https://new.example/v1", model: "new-model", apiKey: "" })
      .expect(200);
    expect(tested?.activeProvider).toBe("openai-responses");
    expect(tested?.providers["openai-responses"].apiKey).toBe("saved-secret");

    await request(app)
      .post("/api/settings/test-connection")
      .send({ provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-x", apiKey: "anthropic-secret" })
      .expect(200);
    expect(tested?.activeProvider).toBe("anthropic");
    expect(tested?.providers.anthropic.apiKey).toBe("anthropic-secret");
    expect(tested?.providers["openai-responses"].apiKey).toBe("saved-secret");

    const anthropicWithoutKey = await request(app)
      .post("/api/settings/test-connection")
      .send({ provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-x" })
      .expect(400);
    expect(anthropicWithoutKey.body.error.code).toBe("MODEL_NOT_CONFIGURED");

    const badUrl = await request(app)
      .post("/api/settings/test-connection")
      .send({ provider: "openai-responses", baseUrl: "https://new.example/v1/chat/completions", model: "new-model" })
      .expect(400);
    expect(badUrl.body.error.code).toBe("INVALID_SETTINGS");

    const missingKey = await request(createApp({
      settingsStore: memorySettingsStore("openai-responses", { baseUrl: "https://saved.example/v1", model: "saved-model", apiKey: "" }),
      connectionTester: async () => { throw new Error("should not run"); },
    }))
      .post("/api/settings/test-connection")
      .send({ provider: "openai-responses", baseUrl: "https://new.example/v1", model: "new-model" })
      .expect(400);
    expect(missingKey.body.error.code).toBe("MODEL_NOT_CONFIGURED");
  });

  it("连接失败只返回清楚的分类，不泄露上游错误或密钥", async () => {
    const app = createApp({
      settingsStore: memorySettingsStore("openai-responses", { baseUrl: "https://saved.example/v1", model: "reader-x", apiKey: "saved-secret" }),
      connectionTester: async () => { throw new ModelConnectionError("auth", { cause: new Error("upstream secret") }); },
    });
    const response = await request(app)
      .post("/api/settings/test-connection")
      .send({ baseUrl: "https://saved.example/v1", model: "reader-x" })
      .expect(502);
    expect(response.body.error.code).toBe("MODEL_AUTH_FAILED");
    expect(response.body.error.message).toContain("API Key");
    expect(JSON.stringify(response.body)).not.toContain("upstream secret");
    expect(JSON.stringify(response.body)).not.toContain("saved-secret");
  });

  it("按协议分别保存地址、模型与密钥，切换协议不覆盖另一协议配置", async () => {
    const settingsStore = memorySettingsStore("openai-responses", {
      baseUrl: "https://openai.example/v1",
      model: "gpt-reader",
      apiKey: "openai-secret",
    });
    const app = createApp({ settingsStore });

    const saved = await request(app)
      .put("/api/settings")
      .send({ provider: "anthropic", baseUrl: "https://anthropic.example/v1", model: "claude-reader", apiKey: "anthropic-secret" })
      .expect(200);
    expect(saved.body.settings.activeProvider).toBe("anthropic");
    expect(saved.body.settings.providers.anthropic).toEqual({
      baseUrl: "https://anthropic.example/v1",
      model: "claude-reader",
      hasApiKey: true,
    });
    expect(saved.body.settings.providers["openai-responses"]).toEqual({
      baseUrl: "https://openai.example/v1",
      model: "gpt-reader",
      hasApiKey: true,
    });
    expect(JSON.stringify(saved.body)).not.toContain("anthropic-secret");
    expect(JSON.stringify(saved.body)).not.toContain("openai-secret");

    const retained = await request(app)
      .put("/api/settings")
      .send({ provider: "anthropic", baseUrl: "https://anthropic.example/v2", model: "claude-reader-2", apiKey: "" })
      .expect(200);
    expect(retained.body.settings.providers.anthropic).toMatchObject({
      baseUrl: "https://anthropic.example/v2",
      model: "claude-reader-2",
      hasApiKey: true,
    });

    await request(app)
      .put("/api/settings")
      .send({ provider: "anthropic", baseUrl: "https://anthropic.example/v2", model: "claude-reader-2", clearApiKey: true })
      .expect(200);
    const afterClear = await request(app).get("/api/settings").expect(200);
    expect(afterClear.body.settings.providers.anthropic.hasApiKey).toBe(false);
    expect(afterClear.body.settings.providers["openai-responses"].hasApiKey).toBe(true);
  });

  it("按启用协议创建视觉适配器并读取用户配置的 Base URL/模型", async () => {
    const settingsStore = memorySettingsStore("openai-responses", {
      baseUrl: "https://proxy.example/custom/v1",
      model: "vision-test-model",
      apiKey: "private-test-key",
    });
    let received: ModelSettings | undefined;
    const visionAdapterFactory = (settings: ModelSettings): VisionAdapter => {
      received = settings;
      return { extract: async () => visionRead };
    };

    const response = await request(createApp({ settingsStore, visionAdapterFactory }))
      .post("/api/audit/image")
      .attach("image", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: "chart.png",
        contentType: "image/png",
      })
      .expect(200);

    expect(received?.activeProvider).toBe("openai-responses");
    expect(received?.providers["openai-responses"]).toEqual({
      baseUrl: "https://proxy.example/custom/v1",
      model: "vision-test-model",
      apiKey: "private-test-key",
    });
    expect(response.body.observation.source).toBe("vision-model");
  });

  it("启用 Anthropic 协议且没有该协议密钥时按未配置处理，不构造适配器", async () => {
    const settingsStore = memorySettingsStore("anthropic", {
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-x",
      apiKey: "",
    });
    let factoryCalls = 0;
    const app = createApp({
      settingsStore,
      visionAdapterFactory: () => {
        factoryCalls += 1;
        return { extract: async () => visionRead };
      },
    });

    const response = await request(app)
      .post("/api/audit/image")
      .attach("image", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: "chart.png",
        contentType: "image/png",
      })
      .expect(503);

    expect(response.body.error.code).toBe("MODEL_NOT_CONFIGURED");
    expect(factoryCalls).toBe(0);
  });
});
