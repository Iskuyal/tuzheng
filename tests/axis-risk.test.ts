import { describe, expect, it } from "vitest";
import { assessAxisRisk } from "../shared/axis-risk.js";
import type { AxisObservation } from "../shared/audit.js";
import { sampleCases } from "../shared/samples.js";

const axisOf = (id: string): AxisObservation | null => {
  const sample = sampleCases.find((item) => item.id === id);
  if (!sample) throw new Error(`Missing sample ${id}`);
  return sample.observation.axis ?? null;
};

describe("柱状图纵轴风险", () => {
  it("从零开始时判为没有放大", () => {
    const assessment = assessAxisRisk(axisOf("axis-zero-based"), [80, 100]);
    expect(assessment.level).toBe("ok");
    expect(assessment.heightsOnAxis).toEqual([80, 100]);
    expect(assessment.summary).toContain("没有被放大");
  });

  it("纵轴不从零开始时判为可能误读，并说明柱高差", () => {
    const assessment = assessAxisRisk(axisOf("axis-truncated"), [80, 100]);
    expect(assessment.level).toBe("misleading-risk");
    expect(assessment.heightsOnAxis).toEqual([0, 20]);
    expect(assessment.heightsFromZero).toEqual([80, 100]);
    expect(assessment.summary).toContain("完全贴住基线");
    expect(assessment.summary).toContain("25%");
    expect(assessment.reasons.join(" ")).toContain("不能据此认定作者造假");
  });

  it("刻度读不清时停在需要确认，用户填了最小值后重新判断", () => {
    const unknown = assessAxisRisk(axisOf("axis-unknown-start"), [80, 100]);
    expect(unknown.level).toBe("needs-confirmation");
    expect(unknown.heightsOnAxis).toBeNull();

    const filled = assessAxisRisk(axisOf("axis-unknown-start"), [80, 100], 80);
    expect(filled.level).toBe("misleading-risk");
    expect(filled.axisMin).toBe(80);
    expect(filled.heightsOnAxis).toEqual([0, 20]);
    expect(filled.summary).toContain("轴上限未读到");
    expect(filled.summary).not.toContain("原图轴范围");
  });

  it("填的起点不低于柱子数值时要求重新核对，不硬给结论", () => {
    const assessment = assessAxisRisk(axisOf("axis-unknown-start"), [80, 100], 120);
    expect(assessment.level).toBe("needs-confirmation");
    expect(assessment.summary).toContain("不低于两根柱子的数值");
  });

  it("轴上限低于已确认数值时要求重新核对", () => {
    const assessment = assessAxisRisk({ label: "营业收入", min: 80, max: 90, unit: "万元" }, [80, 100]);
    expect(assessment.level).toBe("needs-confirmation");
    expect(assessment.heightsOnAxis).toBeNull();
  });

  it("轴起点高于较矮柱时要求重新核对", () => {
    const assessment = assessAxisRisk({ label: "营业收入", min: 90, max: 120, unit: "万元" }, [80, 100]);
    expect(assessment.level).toBe("needs-confirmation");
    expect(assessment.heightsOnAxis).toBeNull();
  });

  it("轴低于零时如实说明差异被压缩，不当作放大", () => {
    const assessment = assessAxisRisk({ label: "营业收入", min: -50, max: 120, unit: "万元" }, [80, 100]);
    expect(assessment.level).toBe("ok");
    expect(assessment.summary).toContain("低于零");
    expect(assessment.summary).toContain("没有放大差异");
  });

  it("给出比值与放大倍数", () => {
    const truncating = assessAxisRisk(axisOf("axis-truncated"), [80, 100]);
    expect(truncating.fromZeroRatio).toBe(1.25);
    expect(truncating.onAxisRatio).toBeNull();

    const mild = assessAxisRisk({ label: "营业收入", min: 40, max: 120, unit: "万元" }, [80, 100]);
    expect(mild.onAxisRatio).toBe(1.5);
    expect(mild.summary).toContain("放大约 1.2 倍");
  });

  it("没有轴信息时同样要求确认", () => {
    const assessment = assessAxisRisk(null, [80, 100]);
    expect(assessment.level).toBe("needs-confirmation");
    expect(assessment.fromZeroRatio).toBe(1.25);
  });
});
