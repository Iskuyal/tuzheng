import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import expectations from "../samples/expectations.json" with { type: "json" };
import { evaluateGrowth, toAuditObservation } from "../shared/audit.js";
import { sampleCases } from "../shared/samples.js";

const samplesById = new Map(sampleCases.map((sample) => [sample.id, sample]));

describe("团队自制样例与独立期望结果", () => {
  it("预置标题摘录与每张样例图上可见标题逐字一致", () => {
    for (const sample of sampleCases) {
      const imagePath = join(process.cwd(), "web", "public", sample.imageUrl.slice(1));
      const svg = readFileSync(imagePath, "utf8");
      for (const claim of sample.observation.claims) {
        expect(svg).toContain(claim.claimText);
      }
    }
  });

  it("矛盾与一致样例按单独保存的期望值分级", () => {
    for (const id of ["conflict", "consistent"] as const) {
      const sample = samplesById.get(id);
      const expected = expectations[id];
      if (!sample) throw new Error(`Missing sample ${id}`);
      const claim = sample.observation.claims[0];
      if (!claim) throw new Error(`Missing claim in ${id}`);
      const observation = toAuditObservation(sample.observation, claim);

      const result = evaluateGrowth({ ...observation, confirmed: true });

      expect(result.status).toBe(expected.status);
      expect(result.calculatedGrowthPercent).toBe(expected.growthPercent);
      expect(result.formula).toBe(expected.formula);
    }
  });

  it("模糊样例默认不计算；用户手动补值后符合期望结果", () => {
    const sample = samplesById.get("unclear");
    if (!sample) throw new Error("Missing unclear sample");
    const claim = sample.observation.claims[0];
    if (!claim) throw new Error("Missing unclear claim");
    const observation = toAuditObservation(sample.observation, claim);

    const beforeCorrection = evaluateGrowth(observation);
    expect(beforeCorrection.status).toBe(expectations.unclear.beforeCorrection.status);
    expect(beforeCorrection.calculatedGrowthPercent).toBe(expectations.unclear.beforeCorrection.growthPercent);

    const afterCorrection = evaluateGrowth({
      ...observation,
      confirmed: true,
      newer: {
        ...observation.newer,
        value: expectations.unclear.manualCorrection,
        valueSource: "user",
      },
    });
    expect(afterCorrection.status).toBe(expectations.unclear.afterCorrection.status);
    expect(afterCorrection.calculatedGrowthPercent).toBe(expectations.unclear.afterCorrection.growthPercent);
    expect(afterCorrection.formula).toBe(expectations.unclear.afterCorrection.formula);
  });

  it("三主张预置样例与独立图内结果一致", () => {
    const sample = samplesById.get("multi-claims");
    if (!sample) throw new Error("Missing multi-claim sample");
    const expectedClaims = expectations.multiClaims.resultsAfterReview;

    expect(sample.observation.source).toBe("preset-example");
    expect(sample.observation.claims.map(({ id }) => id)).toEqual(expectedClaims.map(({ id }) => id));

    const incomeClaim = sample.observation.claims.find(({ id }) => id === "revenue-growth");
    const profitClaim = sample.observation.claims.find(({ id }) => id === "profit-growth");
    const userCountClaim = sample.observation.claims.find(({ id }) => id === "user-count-growth");
    if (!incomeClaim || !profitClaim || !userCountClaim) throw new Error("Missing expected claim");

    const incomeResult = evaluateGrowth({
      ...toAuditObservation(sample.observation, incomeClaim),
      confirmed: true,
    });
    expect(incomeClaim.older.value).toBe(expectedClaims[0].olderValue);
    expect(incomeClaim.newer.value).toBe(expectedClaims[0].observedNewer);
    expect(incomeClaim.newer.evidenceText).toBe(expectedClaims[0].newerEvidenceText);
    expect(incomeResult.status).toBe(expectedClaims[0].status);
    expect(incomeResult.calculatedGrowthPercent).toBe(expectedClaims[0].growthPercent);

    const profitObservation = toAuditObservation(sample.observation, profitClaim);
    expect(profitObservation.older.value).toBe(expectedClaims[1].olderValue);
    expect(profitObservation.newer.value).toBe(expectedClaims[1].observedNewer);
    expect(profitObservation.newer.evidenceText).toBe(expectedClaims[1].newerEvidenceText);
    const profitResult = evaluateGrowth({
      ...profitObservation,
      confirmed: true,
      newer: { ...profitObservation.newer, value: expectedClaims[1].correctedNewer, valueSource: "user" },
    });
    expect(profitResult.status).toBe(expectedClaims[1].status);
    expect(profitResult.calculatedGrowthPercent).toBe(expectedClaims[1].growthPercent);

    const userCountObservation = toAuditObservation(sample.observation, userCountClaim);
    expect(userCountObservation.older.value).toBe(expectedClaims[2].olderValue);
    expect(userCountObservation.newer.value).toBe(expectedClaims[2].observedNewer);
    expect(userCountObservation.newer.evidenceText).toBe(expectedClaims[2].newerEvidenceText);
    const userCountResult = evaluateGrowth({ ...userCountObservation, confirmed: true });
    expect(userCountResult.status).toBe(expectedClaims[2].status);
    expect(userCountResult.calculatedGrowthPercent).toBe(expectedClaims[2].growthPercent);
  });
});
