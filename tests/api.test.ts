import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, type VisionAdapter } from "../server/app.js";
import type { AuditObservation } from "../shared/audit.js";

const visionObservation = {
  titleOriginal: "2025 年收入增长 40%",
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

describe("单图审计 API", () => {
  it("列出三个团队自制样例", async () => {
    const response = await request(createApp()).get("/api/samples").expect(200);

    expect(response.body.samples).toHaveLength(3);
  });

  it("把模糊样例作为预置示例返回，不伪装成模型输出", async () => {
    const response = await request(createApp())
      .post("/api/audit/sample")
      .send({ id: "unclear" })
      .expect(200);

    expect(response.body.observation.source).toBe("preset-example");
    expect(response.body.observation.confirmed).toBe(false);
    expect(response.body.observation.newer.value).toBeNull();
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

  it("把上传图片交给适配器，再把结构校验后的结果留待用户确认", async () => {
    const visionAdapter: VisionAdapter = {
      extract: async () => visionObservation,
    };

    const response = await request(createApp({ visionAdapter }))
      .post("/api/audit/image")
      .attach("image", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: "chart.png",
        contentType: "image/png",
      })
      .expect(200);

    expect(response.body.observation.source).toBe("vision-model");
    expect(response.body.observation.confirmed).toBe(false);
    expect(response.body.observation.older.valueSource).toBe("model");
  });

  it("对用户确认的数据在服务端返回确定性图内结论", async () => {
    const observation: AuditObservation = {
      titleOriginal: "2025 年收入增长 40%",
      claimedGrowthPercent: 40,
      older: { ...visionObservation.older, valueSource: "preset" },
      newer: { ...visionObservation.newer, valueSource: "preset" },
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
});
