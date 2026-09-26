import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import expectations from "../samples/expectations.json" with { type: "json" };
import { evaluateGrowth } from "../shared/audit.js";
import { sampleCases } from "../shared/samples.js";

const samplesById = new Map(sampleCases.map((sample) => [sample.id, sample]));

describe("团队自制样例与独立期望结果", () => {
  it("预置标题摘录与每张样例图上可见标题逐字一致", () => {
    for (const sample of sampleCases) {
      const imagePath = join(process.cwd(), "web", "public", sample.imageUrl.slice(1));
      const svg = readFileSync(imagePath, "utf8");
      const visibleTitle = svg.match(/<text x="54" y="112"[^>]*>(.*?)<\/text>/)?.[1];

      expect(visibleTitle).toBe(sample.observation.titleOriginal);
    }
  });

  it("矛盾与一致样例按单独保存的期望值分级", () => {
    for (const id of ["conflict", "consistent"] as const) {
      const sample = samplesById.get(id);
      const expected = expectations[id];
      if (!sample) throw new Error(`Missing sample ${id}`);

      const result = evaluateGrowth({ ...sample.observation, confirmed: true });

      expect(result.status).toBe(expected.status);
      expect(result.calculatedGrowthPercent).toBe(expected.growthPercent);
      expect(result.formula).toBe(expected.formula);
    }
  });

  it("模糊样例默认不计算；用户手动补值后符合期望结果", () => {
    const sample = samplesById.get("unclear");
    if (!sample) throw new Error("Missing unclear sample");

    const beforeCorrection = evaluateGrowth(sample.observation);
    expect(beforeCorrection.status).toBe(expectations.unclear.beforeCorrection.status);
    expect(beforeCorrection.calculatedGrowthPercent).toBe(expectations.unclear.beforeCorrection.growthPercent);

    const afterCorrection = evaluateGrowth({
      ...sample.observation,
      confirmed: true,
      newer: {
        ...sample.observation.newer,
        value: expectations.unclear.manualCorrection,
        valueSource: "user",
      },
    });
    expect(afterCorrection.status).toBe(expectations.unclear.afterCorrection.status);
    expect(afterCorrection.calculatedGrowthPercent).toBe(expectations.unclear.afterCorrection.growthPercent);
    expect(afterCorrection.formula).toBe(expectations.unclear.afterCorrection.formula);
  });
});
