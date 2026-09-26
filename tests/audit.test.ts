import { describe, expect, it } from "vitest";
import { evaluateGrowth, type AuditObservation } from "../shared/audit.js";

function confirmedObservation(
  overrides: Partial<AuditObservation> = {},
): AuditObservation {
  return {
    titleOriginal: "2025 年收入增长 40%",
    claimedGrowthPercent: 40,
    older: {
      period: "2024 年",
      value: 80,
      unit: "万元",
      evidenceText: "2024 年 80 万元",
      valueSource: "preset",
    },
    newer: {
      period: "2025 年",
      value: 100,
      unit: "万元",
      evidenceText: "2025 年 100 万元",
      valueSource: "preset",
    },
    unreadableItems: [],
    confirmed: true,
    source: "preset-example",
    ...overrides,
  };
}

describe("图内增长率审计", () => {
  it("使用程序计算增长率，并指出标题与图内数字矛盾", () => {
    const result = evaluateGrowth(confirmedObservation());

    expect(result.calculatedGrowthPercent).toBe(25);
    expect(result.formula).toBe("(100 - 80) / 80 × 100 = 25%");
    expect(result.status).toBe("contradictory");
    expect(result.summary).toBe("标题写 40%，已确认数字算得 25%，相差 15 个百分点。");
  });

  it("按图内数字支持标题中的 25% 主张", () => {
    const result = evaluateGrowth(
      confirmedObservation({
        titleOriginal: "2025 年收入增长 25%",
        claimedGrowthPercent: 25,
      }),
    );

    expect(result.calculatedGrowthPercent).toBe(25);
    expect(result.status).toBe("consistent");
    expect(result.summary).toBe("标题写 25%，已确认数字算得 25%，图内一致。");
  });

  it("百分比不精确相等时按图内矛盾分级", () => {
    const result = evaluateGrowth(
      confirmedObservation({
        titleOriginal: "2025 年收入增长 25.4%",
        claimedGrowthPercent: 25.4,
      }),
    );

    expect(result.calculatedGrowthPercent).toBe(25);
    expect(result.status).toBe("contradictory");
    expect(result.summary).toBe("标题写 25.4%，已确认数字算得 25%，相差 0.4 个百分点。");
  });

  it("不会把小于 0.01 个百分点的差值舍入成一致", () => {
    const result = evaluateGrowth(
      confirmedObservation({
        titleOriginal: "2025 年收入增长 25.004%",
        claimedGrowthPercent: 25.004,
      }),
    );

    expect(result.status).toBe("contradictory");
    expect(result.summary).toBe("标题写 25.004%，已确认数字算得 25%，相差 0.004 个百分点。");
  });

  it("把未确认观察值降级，且不显示确定百分比", () => {
    const result = evaluateGrowth(confirmedObservation({ confirmed: false }));

    expect(result.status).toBe("needs-confirmation");
    expect(result.calculatedGrowthPercent).toBeNull();
    expect(result.reasons).toContain("请先确认或更正图表观察值。");
  });

  it("关键数字看不清时不计算；用户补入并确认数字后重新计算", () => {
    const unreadable = confirmedObservation({
      titleOriginal: "2025 年收入增长 25%",
      claimedGrowthPercent: 25,
      newer: {
        period: "2025 年",
        value: null,
        unit: "万元",
        evidenceText: "2025 年数值标签无法辨认",
        valueSource: "unreadable",
      },
      unreadableItems: ["2025 年数值标签无法辨认"],
    });

    expect(evaluateGrowth(unreadable).calculatedGrowthPercent).toBeNull();

    const corrected = evaluateGrowth({
      ...unreadable,
      newer: { ...unreadable.newer, value: 100, valueSource: "user" },
    });

    expect(corrected.calculatedGrowthPercent).toBe(25);
    expect(corrected.status).toBe("consistent");
    expect(corrected.reasons).toContain("新数值由用户手动更正。");
  });

  it("旧值为 0 时要求确认，不做除零计算", () => {
    const result = evaluateGrowth(
      confirmedObservation({ older: { ...confirmedObservation().older, value: 0 } }),
    );

    expect(result.status).toBe("needs-confirmation");
    expect(result.calculatedGrowthPercent).toBeNull();
    expect(result.reasons).toContain("旧值为 0，无法计算增长率。");
  });

  it("单位不一致时不把数值直接相除", () => {
    const result = evaluateGrowth(
      confirmedObservation({
        newer: { ...confirmedObservation().newer, unit: "元" },
      }),
    );

    expect(result.status).toBe("needs-confirmation");
    expect(result.calculatedGrowthPercent).toBeNull();
    expect(result.reasons).toContain("两个数值的单位不一致。");
  });

  it("年份顺序不清时不判断增长方向", () => {
    const result = evaluateGrowth(
      confirmedObservation({
        older: { ...confirmedObservation().older, period: "较早一组" },
        newer: { ...confirmedObservation().newer, period: "较晚一组" },
      }),
    );

    expect(result.status).toBe("needs-confirmation");
    expect(result.calculatedGrowthPercent).toBeNull();
    expect(result.reasons).toContain("时间顺序无法从标签确认。");
  });

  it("缺少图中证据文字时不输出一致或矛盾结论", () => {
    const result = evaluateGrowth(
      confirmedObservation({
        newer: { ...confirmedObservation().newer, evidenceText: null },
      }),
    );

    expect(result.status).toBe("needs-confirmation");
    expect(result.reasons).toContain("新数值缺少可复查的图内文字依据。");
  });

  it("缺少可比较的标题增长率时只展示计算值并说明不能分级", () => {
    const result = evaluateGrowth(
      confirmedObservation({ claimedGrowthPercent: null }),
    );

    expect(result.calculatedGrowthPercent).toBe(25);
    expect(result.status).toBe("needs-confirmation");
    expect(result.reasons).toContain("标题中没有可比较的增长率主张。");
  });
});
