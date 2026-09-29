import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, type VisionAdapter, type VisionReadResult } from "../server/app.js";
import { SourceInvestigationError } from "../server/source-investigation.js";
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

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sourceReply(options: { calls?: Array<{ id: string; name: string; input: unknown }>; text?: string | null }) {
  return {
    model: "stub-source-model",
    usage: { inputTokens: 120, outputTokens: 40 },
    text: options.text ?? null,
    calls: options.calls ?? [],
    truncated: false,
  };
}

function scriptedSourceDriver(
  replies: Array<ReturnType<typeof sourceReply>>,
  finalizeReply?: ReturnType<typeof sourceReply>,
) {
  let index = 0;
  return {
    model: "stub-source-model",
    async start() { return replies[index++] ?? sourceReply({}); },
    async continue() { return replies[index++] ?? sourceReply({}); },
    async finalize() { return finalizeReply ?? replies[index++] ?? sourceReply({}); },
  };
}

const captionedClaim = {
  claimText: "比上月上涨 0.8%",
  metric: "全国居民消费价格",
  scope: "全国",
  period: "2025-12",
  value: 0.8,
  basis: "month-on-month",
  kind: "direct",
  fromImage: false,
  imageExcerpt: null,
};

describe("CPI 图文来源核验 API", () => {
  it("提供固定资料库清单、样例与链接发布日期", async () => {
    const app = createApp();
    const library = await request(app).get("/api/source-audit/library").expect(200);

    expect(library.body.library.map((entry: { id: string }) => entry.id)).toEqual([
      "stats-cpi-2025-12",
      "stats-term-yoy-mom",
      "stats-cpi-2026-08",
    ]);
    expect(library.body.library[0]).toMatchObject({
      url: "https://www.stats.gov.cn/sj/zxfb/202601/t20260109_1962273.html",
      publisher: "国家统计局",
      publishedAt: "2026-01-09",
      measureCount: 2,
    });
    expect(library.body.library[2].distractor).toBe(true);

    const sample = await request(app).get("/api/source-audit/sample").expect(200);
    expect(sample.body.sample).toMatchObject({
      id: "cpi-2025-12",
      caption: "比上月上涨 0.8%",
      imageUrl: "/samples/cpi-2025-12.png",
    });
    expect(sample.body.sample.note).toContain("不是国家统计局原图");
  });

  it("走完模型自选工具到来源结论的完整路径", async () => {
    const driver = scriptedSourceDriver([
      sourceReply({
        calls: [{
          id: "s1",
          name: "search_source_library",
          input: { metric: "全国居民消费价格", period: "2025-12", scope: "全国", terms: ["同比", "环比"] },
        }],
        text: "先检索 2025 年 12 月的全国 CPI 材料。",
      }),
      sourceReply({
        calls: [{
          id: "r1",
          name: "report_source_finding",
          input: {
            claims: [
              {
                claimText: "2025 年 12 月全国 CPI 上涨 0.8%",
                metric: "全国居民消费价格",
                scope: "全国",
                period: "2025-12",
                value: 0.8,
                basis: null,
                kind: "direct",
                fromImage: true,
                imageExcerpt: "2025 年 12 月全国 CPI 上涨 0.8%",
              },
              captionedClaim,
            ],
            citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
            noApplicableSourceReason: null,
            unresolvedItems: ["图上未标注比较方式。"],
          },
        }],
        text: "用现行命中汇总。",
      }),
    ]);
    const app = createApp({
      settingsStore: memorySettingsStore("anthropic", { apiKey: "sk-test" }),
      investigationDriverFactory: () => driver,
    });

    const response = await request(app)
      .post("/api/source-audit/investigate")
      .field("caption", "比上月上涨 0.8%")
      .attach("image", PNG_HEADER, { filename: "cpi.png", contentType: "image/png" })
      .expect(200);

    const investigation = response.body.investigation;
    expect(investigation.model).toBe("stub-source-model");
    expect(investigation.toolCallsUsed).toBe(1);
    expect(investigation.trace[0]).toMatchObject({ tool: "search_source_library", status: "ok" });
    expect(investigation.conclusions.map((conclusion: { status: string }) => conclusion.status)).toEqual([
      "source-pending",
      "source-mismatch",
    ]);
    expect(investigation.conclusions[1].summary).toContain("环比 0.2%");
    expect(investigation.conclusions[1].citedSourceIds).toEqual(["stats-cpi-2025-12"]);
    expect(investigation.acceptedCitations).toEqual([
      { sourceId: "stats-cpi-2025-12", role: "value-basis", note: null },
    ]);
    expect(investigation.hits.map((hit: { document: { id: string } }) => hit.document.id)).toContain("stats-cpi-2026-08");
    expect(investigation.unresolvedItems).toEqual(["图上未标注比较方式。"]);
    expect(investigation.stopReason).toContain("汇总");
  });

  it("引用错月份材料时保持来源待核对，并列出排除原因", async () => {
    const driver = scriptedSourceDriver([
      sourceReply({
        calls: [{
          id: "s1",
          name: "search_source_library",
          input: { metric: "全国居民消费价格", period: "2025-12", scope: "全国", terms: ["环比"] },
        }],
      }),
      sourceReply({
        calls: [{
          id: "r1",
          name: "report_source_finding",
          input: {
            claims: [captionedClaim],
            citations: [{ sourceId: "stats-cpi-2026-08", role: "value-basis", note: "看起来同为 0.8%" }],
            noApplicableSourceReason: null,
            unresolvedItems: [],
          },
        }],
      }),
    ]);
    const app = createApp({
      settingsStore: memorySettingsStore("anthropic", { apiKey: "sk-test" }),
      investigationDriverFactory: () => driver,
    });

    const response = await request(app)
      .post("/api/source-audit/investigate")
      .field("caption", "比上月上涨 0.8%")
      .attach("image", PNG_HEADER, { filename: "cpi.png", contentType: "image/png" })
      .expect(200);

    const investigation = response.body.investigation;
    expect(investigation.conclusions[0].status).toBe("source-pending");
    expect(investigation.citationsRejected).toHaveLength(1);
    expect(investigation.citationsRejected[0].reason).toContain("口径不一致");
    expect(investigation.excludedSources.map((entry: { sourceId: string }) => entry.sourceId)).toEqual([
      "stats-cpi-2026-08",
      "stats-term-yoy-mom",
    ]);
    expect(investigation.excludedSources[0].reason).toContain("月份");
    // 措辞不得越界成造假或动机判断。
    expect(JSON.stringify(investigation)).not.toMatch(/造假|动机|已核实/);
  });

  it("配文只写月份时按图上标注补全年份，并把补全说明写进结论", async () => {
    const driver = scriptedSourceDriver([
      sourceReply({
        calls: [{
          id: "s1",
          name: "search_source_library",
          input: { metric: "全国居民消费价格", period: "2025-12", scope: "全国", terms: ["环比"] },
        }],
      }),
      sourceReply({
        calls: [{
          id: "r1",
          name: "report_source_finding",
          input: {
            claims: [
              {
                claimText: "2025 年 12 月全国 CPI 上涨 0.8%",
                metric: "全国居民消费价格",
                scope: "全国",
                period: "2025-12",
                value: 0.8,
                basis: null,
                kind: "direct",
                direction: null,
                fromImage: true,
                imageExcerpt: "2025 年 12 月全国 CPI 上涨 0.8%",
              },
              { ...captionedClaim, period: "12 月" },
            ],
            citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
            noApplicableSourceReason: null,
            unresolvedItems: [],
            omittedClaims: [],
          },
        }],
      }),
    ]);
    const app = createApp({
      settingsStore: memorySettingsStore("anthropic", { apiKey: "sk-test" }),
      investigationDriverFactory: () => driver,
    });

    const response = await request(app)
      .post("/api/source-audit/investigate")
      .field("caption", "比上月上涨 0.8%")
      .attach("image", PNG_HEADER, { filename: "cpi.png", contentType: "image/png" })
      .expect(200);

    const investigation = response.body.investigation;
    expect(investigation.claims[1].period).toBe("2025-12");
    expect(investigation.conclusions[1].periodNote).toContain("年份按图上标注的 2025-12 补全");
    expect(investigation.conclusions[1].status).toBe("source-mismatch");
  });

  it("观点与未展开内容随调查结果返回，观点不判假", async () => {
    const driver = scriptedSourceDriver([
      sourceReply({ calls: [{
        id: "s1",
        name: "search_source_library",
        input: { metric: "全国居民消费价格", period: "2025-12", scope: "全国", terms: [] },
      }] }),
      sourceReply({
        calls: [{
          id: "r1",
          name: "report_source_finding",
          input: {
            claims: [
              captionedClaim,
              {
                claimText: "CPI 涨幅回落说明政策效果显现",
                metric: "全国居民消费价格",
                scope: "全国",
                period: "2025-12",
                value: null,
                basis: null,
                kind: "opinion",
                direction: null,
                fromImage: false,
                imageExcerpt: null,
              },
            ],
            citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
            noApplicableSourceReason: null,
            unresolvedItems: [],
            omittedClaims: ["12 月 CPI 比上月便宜"],
          },
        }],
      }),
    ]);
    const app = createApp({
      settingsStore: memorySettingsStore("anthropic", { apiKey: "sk-test" }),
      investigationDriverFactory: () => driver,
    });

    const caption = "比上月上涨 0.8%。CPI 涨幅回落说明政策效果显现。12 月 CPI 比上月便宜。";
    const response = await request(app)
      .post("/api/source-audit/investigate")
      .field("caption", caption)
      .attach("image", PNG_HEADER, { filename: "cpi.png", contentType: "image/png" })
      .expect(200);

    const investigation = response.body.investigation;
    expect(investigation.conclusions[0].status).toBe("source-mismatch");
    expect(investigation.conclusions[1]).toMatchObject({
      status: "not-verifiable",
      claimKind: "opinion",
      officialValue: null,
      difference: null,
      parts: [{ label: "可核验性", status: "insufficient" }],
    });
    expect(investigation.conclusions[1].summary).toContain("不对它做真假定论");
    expect(investigation.conclusions[1].summary).not.toMatch(/造假|虚假|错误/);
    // 未展开的配文内容保留原文，并给出明确提示。
    expect(investigation.omittedClaims).toEqual([
      { claimText: "12 月 CPI 比上月便宜", reason: expect.stringContaining("模型说明"), source: "caption" },
    ]);
    expect(investigation.captionCoverageNote).toContain("12 月 CPI 比上月便宜");
    expect(investigation.captionCoverage).toBeGreaterThan(0);
  });

  it("推断缺少适用环比来源时返回「推断依据不足」，并说明缺哪一项依据", async () => {
    const driver = scriptedSourceDriver([
      sourceReply({ calls: [{
        id: "s1",
        name: "search_source_library",
        input: { metric: "全国居民消费价格", period: "2026-07", scope: "全国", terms: ["环比"] },
      }] }),
      sourceReply({
        calls: [{
          id: "r1",
          name: "report_source_finding",
          input: {
            claims: [{
              claimText: "7 月 CPI 比上月便宜",
              metric: "全国居民消费价格",
              scope: "全国",
              period: "2026-07",
              value: null,
              basis: "month-on-month",
              kind: "inference",
              direction: "down",
              fromImage: false,
              imageExcerpt: null,
            }],
            citations: [],
            noApplicableSourceReason: "资料库没有 2026 年 7 月的发布。",
            unresolvedItems: [],
            omittedClaims: [],
          },
        }],
      }),
    ]);
    const app = createApp({
      settingsStore: memorySettingsStore("anthropic", { apiKey: "sk-test" }),
      investigationDriverFactory: () => driver,
    });

    const response = await request(app)
      .post("/api/source-audit/investigate")
      .field("caption", "7 月 CPI 比上月便宜。")
      .attach("image", PNG_HEADER, { filename: "cpi.png", contentType: "image/png" })
      .expect(200);

    const conclusion = response.body.investigation.conclusions[0];
    expect(conclusion).toMatchObject({ status: "inference-unsupported", claimKind: "inference" });
    expect(conclusion.unresolved.join("")).toContain("2026-07");
    expect(conclusion.summary).toContain("不代表结论为假");
  });

  it("缺少配文或图片时在调用模型前拒绝", async () => {
    let factoryCalls = 0;
    const app = createApp({
      settingsStore: memorySettingsStore("anthropic", { apiKey: "sk-test" }),
      investigationDriverFactory: () => {
        factoryCalls += 1;
        return scriptedSourceDriver([sourceReply({})]);
      },
    });

    const noCaption = await request(app)
      .post("/api/source-audit/investigate")
      .attach("image", PNG_HEADER, { filename: "cpi.png", contentType: "image/png" })
      .expect(400);
    expect(noCaption.body.error.code).toBe("CAPTION_REQUIRED");

    const noImage = await request(app)
      .post("/api/source-audit/investigate")
      .field("caption", "比上月上涨 0.8%")
      .expect(400);
    expect(noImage.body.error.code).toBe("IMAGE_REQUIRED");

    const badImage = await request(app)
      .post("/api/source-audit/investigate")
      .field("caption", "比上月上涨 0.8%")
      .attach("image", Buffer.from("not-an-image"), { filename: "fake.png", contentType: "image/png" })
      .expect(415);
    expect(badImage.body.error.code).toBe("UNSUPPORTED_IMAGE");

    expect(factoryCalls).toBe(0);
  });

  it("没有密钥时给出可操作的提示，不运行调查", async () => {
    let factoryCalls = 0;
    const app = createApp({
      settingsStore: memorySettingsStore("anthropic"),
      investigationDriverFactory: () => {
        factoryCalls += 1;
        return scriptedSourceDriver([sourceReply({})]);
      },
    });

    const response = await request(app)
      .post("/api/source-audit/investigate")
      .field("caption", "比上月上涨 0.8%")
      .attach("image", PNG_HEADER, { filename: "cpi.png", contentType: "image/png" })
      .expect(503);

    expect(response.body.error.code).toBe("MODEL_NOT_CONFIGURED");
    expect(response.body.error.message).toContain("模型设置页");
    expect(response.body).not.toHaveProperty("investigation");
    // 未配置密钥时不借用替身驱动器跑出「通过」。
    expect(factoryCalls).toBe(0);
  });

  it.each([
    ["timeout", 504, "SOURCE_INVESTIGATION_TIMEOUT"],
    ["upstream", 502, "SOURCE_INVESTIGATION_FAILED"],
    ["invalid-output", 502, "SOURCE_INVESTIGATION_INVALID"],
  ] as const)("来源调查 %s 失败时返回可区分的错误且不附带结论", async (kind, status, code) => {
    const app = createApp({
      settingsStore: memorySettingsStore("anthropic", { apiKey: "sk-test" }),
      investigationDriverFactory: () => ({
        model: "stub-source-model",
        start: async () => { throw new SourceInvestigationError(kind); },
        continue: async () => sourceReply({}),
        finalize: async () => sourceReply({}),
      }),
    });

    const response = await request(app)
      .post("/api/source-audit/investigate")
      .field("caption", "比上月上涨 0.8%")
      .attach("image", PNG_HEADER, { filename: "cpi.png", contentType: "image/png" })
      .expect(status);

    expect(response.body.error.code).toBe(code);
    expect(response.body).not.toHaveProperty("investigation");
  });
});
