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
  });

  it("没有轴信息时同样要求确认", () => {
    const assessment = assessAxisRisk(null, [80, 100]);
    expect(assessment.level).toBe("needs-confirmation");
    expect(assessment.fromZeroRatio).toBe(1.25);
  });
});
