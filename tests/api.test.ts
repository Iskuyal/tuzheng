import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, type VisionAdapter, type VisionReadResult } from "../server/app.js";
import type { ModelSettings, ModelSettingsStore } from "../server/model-settings.js";
import type { AuditObservation } from "../shared/audit.js";

const visionClaim = {
  claimText: "2025 年收入增长 40%",
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

const visionObservation = { claims: [visionClaim] };

const visionRead: VisionReadResult = {
  observation: visionObservation,
  model: "vision-test-model",
  requestId: "resp_test_1",
  usage: { inputTokens: 1_204, outputTokens: 88 },
  rawText: JSON.stringify(visionObservation),
};

function memorySettingsStore(initial: ModelSettings): ModelSettingsStore {
  let current = { ...initial };
  return {
    read: async () => ({ ...current }),
    write: async (settings) => { current = { ...settings }; },
  };
}

describe("单图审计 API", () => {
  it("列出四个团队自制样例", async () => {
    const response = await request(createApp()).get("/api/samples").expect(200);

    expect(response.body.samples).toHaveLength(4);
    expect(response.body.samples.map(({ id }: { id: string }) => id)).toContain("multi-claims");
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
      extract: async () => ({ ...visionRead, observation: { claims: [] }, rawText: '{"claims":[]}' }),
    };
    const response = await request(createApp({ visionAdapter }))
      .post("/api/audit/image")
      .attach("image", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: "chart.png",
        contentType: "image/png",
      })
      .expect(200);

    expect(response.body.observation).toEqual({ source: "vision-model", claims: [] });
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

  it("读取设置时只返回密钥配置状态，不返回密钥本身", async () => {
    const settingsStore = memorySettingsStore({
      baseUrl: "https://vision.example/v1",
      model: "chart-reader-v2",
      apiKey: "local-private-key",
    });
    const response = await request(createApp({ settingsStore })).get("/api/settings").expect(200);

    expect(response.body.settings).toEqual({
      baseUrl: "https://vision.example/v1",
      model: "chart-reader-v2",
      hasApiKey: true,
    });
    expect(JSON.stringify(response.body)).not.toContain("local-private-key");
  });

  it("远程 Responses 服务 URL 要求 HTTPS，本机回环服务允许 HTTP", async () => {
    const app = createApp({ settingsStore: memorySettingsStore({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      apiKey: "",
    }) });
    await request(app)
      .put("/api/settings")
      .send({ baseUrl: "http://model.example/v1", model: "reader-x", apiKey: "test-key" })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("INVALID_SETTINGS"));

    await request(app)
      .put("/api/settings")
      .send({ baseUrl: "http://localhost:8080/v1", model: "reader-x", apiKey: "test-key" })
      .expect(200)
      .expect(({ body }) => expect(body.settings.baseUrl).toBe("http://localhost:8080/v1"));
  });

  it("保存自定义 Responses 端点、模型和密钥，并允许清除密钥", async () => {
    const settingsStore = memorySettingsStore({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      apiKey: "",
    });
    const app = createApp({ settingsStore });

    const saved = await request(app)
      .put("/api/settings")
      .send({ baseUrl: "https://proxy.example/v1", model: "reader-x", apiKey: "test-key" })
      .expect(200);
    expect(saved.body.settings).toEqual({
      baseUrl: "https://proxy.example/v1",
      model: "reader-x",
      hasApiKey: true,
    });
    expect(JSON.stringify(saved.body)).not.toContain("test-key");

    const retained = await request(app)
      .put("/api/settings")
      .send({ baseUrl: "https://proxy.example/v2", model: "reader-y", apiKey: "" })
      .expect(200);
    expect(retained.body.settings).toMatchObject({
      baseUrl: "https://proxy.example/v2",
      model: "reader-y",
      hasApiKey: true,
    });

    await request(app)
      .put("/api/settings")
      .send({ baseUrl: "https://proxy.example/v2", model: "reader-y", clearApiKey: true })
      .expect(200);
    const afterClear = await request(app).get("/api/settings").expect(200);
    expect(afterClear.body.settings.hasApiKey).toBe(false);
  });

  it("根据服务端设置创建视觉适配器并读取用户配置的 Base URL/模型", async () => {
    const settingsStore = memorySettingsStore({
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

    expect(received).toEqual({
      baseUrl: "https://proxy.example/custom/v1",
      model: "vision-test-model",
      apiKey: "private-test-key",
    });
    expect(response.body.observation.source).toBe("vision-model");
  });
});
