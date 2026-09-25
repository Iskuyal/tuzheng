import { describe, expect, it } from "vitest";
import { parseVisionObservation } from "../server/observation.js";

const validObservation = {
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

describe("视觉模型结构化观察值校验", () => {
  it("接受符合阶段一观察值结构的输出", () => {
    expect(parseVisionObservation(validObservation)).toEqual(validObservation);
  });

  it("拒绝把缺失数字猜成文本、也拒绝模型增加未声明字段", () => {
    const wrongValue = {
      ...validObservation,
      newer: { ...validObservation.newer, value: "约 100" },
    };
    const unexpectedField = { ...validObservation, confidence: 0.99 };

    expect(() => parseVisionObservation(wrongValue)).toThrow();
    expect(() => parseVisionObservation(unexpectedField)).toThrow();
  });

  it("缺少任何必要观察字段时拒绝整个结果", () => {
    const { unreadableItems: _omitted, ...incomplete } = validObservation;

    expect(() => parseVisionObservation(incomplete)).toThrow();
  });
});
