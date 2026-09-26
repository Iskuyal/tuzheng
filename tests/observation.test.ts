import { describe, expect, it } from "vitest";
import { parseVisionObservation } from "../server/observation.js";

const incomeClaim = {
  claimText: "2025 年营业收入增长 25%",
  metric: "营业收入",
  scope: "全国门店",
  claimedGrowthPercent: 25,
  older: {
    period: "2024 年",
    value: 80,
    unit: "万元",
    evidenceText: "2024 年营业收入 80 万元",
  },
  newer: {
    period: "2025 年",
    value: 100,
    unit: "万元",
    evidenceText: "2025 年营业收入 100 万元",
  },
  unreadableItems: [],
};

const validObservation = { claims: [incomeClaim], axis: { label: "营业收入", min: 0, max: 160, unit: "万元" } };

describe("视觉模型 claims[] 结构化观察值校验", () => {
  it("接受单条与多条主张的图上观察", () => {
    const multiClaimObservation = {
      claims: [
        incomeClaim,
        {
          ...incomeClaim,
          claimText: "2025 年利润增长 40%",
          claimedGrowthPercent: 40,
        },
      ],
    };

    expect(parseVisionObservation(validObservation)).toEqual(validObservation);
    expect(parseVisionObservation(multiClaimObservation)).toEqual(multiClaimObservation);
  });

  it("允许无法辨认的值或缺失证据作为有效观察", () => {
    const observation = {
      claims: [{
        ...incomeClaim,
        newer: { ...incomeClaim.newer, value: null, evidenceText: null },
        unreadableItems: ["2025 年营业收入数值无法辨认"],
      }],
    };

    expect(parseVisionObservation(observation)).toEqual(observation);
  });

  it("接受空 claims[]，不把它伪造成一条主张", () => {
    expect(parseVisionObservation({ claims: [] })).toEqual({ claims: [] });
  });

  it("拒绝字段类型错误、意外字段和模型生成的审计结果", () => {
    const wrongValue = {
      claims: [{ ...incomeClaim, newer: { ...incomeClaim.newer, value: "约 100" } }],
    };
    const unexpectedField = {
      claims: [{ ...incomeClaim, result: { status: "consistent" } }],
    };
    const userState = {
      claims: [{ ...incomeClaim, confirmed: true }],
    };

    expect(() => parseVisionObservation(wrongValue)).toThrow();
    expect(() => parseVisionObservation(unexpectedField)).toThrow();
    expect(() => parseVisionObservation(userState)).toThrow();
  });

  it("拒绝缺少必要观察字段的主张", () => {
    const { unreadableItems: _omitted, ...incompleteClaim } = incomeClaim;

    expect(() => parseVisionObservation({ claims: [incompleteClaim] })).toThrow();
  });
});

describe("口径与坐标轴字段校验", () => {
  it("接受读不清的口径与没有坐标轴的图", () => {
    const observation = {
      claims: [{ ...incomeClaim, metric: null, scope: null }],
      axis: null,
    };
    expect(parseVisionObservation(observation)).toEqual(observation);
  });

  it("轴字段可以整体缺省", () => {
    const observation = { claims: [incomeClaim] };
    expect(parseVisionObservation(observation)).toEqual(observation);
  });

  it("拒绝形状错误的轴与口径", () => {
    expect(() => parseVisionObservation({
      claims: [incomeClaim],
      axis: { label: "营业收入", min: 0, unit: "万元" },
    })).toThrow();
    expect(() => parseVisionObservation({
      claims: [{ ...incomeClaim, scope: 2024 }],
    })).toThrow();
  });
});
