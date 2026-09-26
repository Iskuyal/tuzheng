import type { CrossElementState } from "../shared/cross-image.js";
import type { AxisRiskAssessment } from "../shared/axis-risk.js";

export function crossStateLabel(state: CrossElementState): string {
  if (state === "aligned") return "一致";
  if (state === "confirmed-by-user") return "你已确认一致";
  if (state === "missing") return "图上没读到";
  return "不一致";
}

/** 已知轴上限时按完整轴范围绘制；未知时才用较高柱作为顶端。 */
export function axisBarPercent(heights: [number, number] | null, index: 0 | 1, scaleHeight?: number | null): number {
  if (!heights) return 0;
  const tallest = Math.max(heights[0], heights[1]);
  const range = scaleHeight != null && scaleHeight > 0 ? Math.max(scaleHeight, tallest) : tallest;
  if (range <= 0) return 0;
  return Math.round((heights[index] / range) * 100);
}

export function axisRangeText(risk: AxisRiskAssessment): string {
  if (risk.axisMin === null) return "（未读到）";
  const unit = risk.unit ? ` ${risk.unit}` : "";
  return risk.axisMax === null
    ? `（起点 ${risk.axisMin}${unit}）`
    : `（${risk.axisMin}–${risk.axisMax}${unit}）`;
}
