import { describe, expect, it } from "vitest";
import { evaluateGrowth, toAuditObservation } from "../shared/audit.js";
import {
  claimScopeView,
  compareClaimScopes,
  normalizeLabel,
  pickReferenceClaimId,
} from "../shared/cross-image.js";
import { sampleCases } from "../shared/samples.js";

const samplesById = new Map(sampleCases.map((sample) => [sample.id, sample]));
const observationOf = (id: string) => {
  const sample = samplesById.get(id as never);
  if (!sample) throw new Error(`Missing sample ${id}`);
  return sample.observation;
};

describe("口径标签归一化", () => {
  it("忽略空白、大小写与全半角差异", () => {
    expect(normalizeLabel("  营业收入 ")).toBe("营业收入");
    expect(normalizeLabel("营业收入")).toBe("营业收入");
    expect(normalizeLabel("ＡＢＣ")).toBe("abc");
    expect(normalizeLabel("Store Revenue")).toBe("storerevenue");
    expect(normalizeLabel("")).toBeNull();
    expect(normalizeLabel("   ")).toBeNull();
    expect(normalizeLabel(null)).toBeNull();
  });

  it("按归一化后的指标名挑选候选对照主张", () => {
    const reference = observationOf("cross-b-consistent");
    expect(pickReferenceClaimId({ ...reference.claims[0] }, reference)).toBe("revenue-growth");
    expect(pickReferenceClaimId({ ...reference.claims[0], metric: "利润" }, reference)).toBeNull();
    expect(pickReferenceClaimId({ ...reference.claims[0], metric: " 营业收入 " }, reference)).toBe("revenue-growth");
  });
});

describe("口径四要素比对", () => {
  const left = claimScopeView(observationOf("cross-a-revenue"), "revenue-growth");
  const consistent = claimScopeView(observationOf("cross-b-consistent"), "revenue-growth");
  const mismatch = claimScopeView(observationOf("cross-b-scope-mismatch"), "revenue-growth");

  it("四要素齐备且一致时口径通过", () => {
    if (!left || !consistent) throw new Error("缺少样例主张");
    const result = compareClaimScopes(left, consistent, []);
    expect(result.scopeReady).toBe(true);
    expect(result.ready).toBe(false); // 两侧还没确认读数
    expect(result.blockers).toEqual([]);
    expect(result.elements.map(({ key, state }) => [key, state])).toEqual([
      ["metric", "aligned"],
      ["period", "aligned"],
      ["unit", "aligned"],
      ["scope", "aligned"],
    ]);
  });

  it("范围不一致时停在待核对，并指出差在范围", () => {
    if (!left || !mismatch) throw new Error("缺少样例主张");
    const result = compareClaimScopes(left, mismatch, []);
    expect(result.scopeReady).toBe(false);
    expect(result.blockers).toEqual(["scope"]);
    expect(result.elements.find(({ key }) => key === "scope")).toMatchObject({
      state: "mismatch",
      left: "全国门店",
      right: "直营门店",
    });
  });

  it("要素缺失时同样停在待核对，用户确认一致后可比较", () => {
    const missing = { ...left!, scope: null };
    const blocked = compareClaimScopes(missing, consistent!, []);
    expect(blocked.scopeReady).toBe(false);
    expect(blocked.elements.find(({ key }) => key === "scope")?.state).toBe("missing");

    const confirmed = compareClaimScopes(missing, consistent!, ["scope"]);
    expect(confirmed.scopeReady).toBe(true);
    expect(confirmed.blockers).toEqual([]);
    expect(confirmed.elements.find(({ key }) => key === "scope")?.state).toBe("confirmed-by-user");
  });

  it("时间与单位按两个观察点分别比对", () => {
    if (!left || !consistent) throw new Error("缺少样例主张");
    const otherPeriod = { ...consistent, newerPeriod: "2026 年" };
    expect(compareClaimScopes(left, otherPeriod, []).blockers).toEqual(["period"]);

    const otherUnit = { ...consistent, olderUnit: "元" };
    expect(compareClaimScopes(left, otherUnit, []).blockers).toEqual(["unit"]);

    const noPeriod = { ...consistent, olderPeriod: null };
    expect(compareClaimScopes(left, noPeriod, []).elements.find(({ key }) => key === "period")?.state).toBe("missing");
  });

  it("已确认的读数才进入数值比较", () => {
    if (!left || !consistent) throw new Error("缺少样例主张");
    // 对照图未确认时，即使口径一致也不能给数值结论
    expect(compareClaimScopes(left, { ...consistent, confirmed: false }, []).ready).toBe(false);
    expect(compareClaimScopes({ ...left, confirmed: false }, consistent, []).ready).toBe(false);
    expect(compareClaimScopes({ ...left, confirmed: true }, { ...consistent, confirmed: true }, []).ready).toBe(true);
  });
});
