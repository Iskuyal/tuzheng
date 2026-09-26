import type { CrossElementState } from "../shared/cross-image.js";
import type { AxisRiskAssessment } from "../shared/axis-risk.js";

export function crossStateLabel(state: CrossElementState): string {
  if (state === "aligned") return "一致";
  if (state === "confirmed-by-user") return "你已确认一致";
  if (state === "missing") return "图上没读到";
  return "不一致";
}

/** 柱形高度按各自范围归一化，用于「原图轴范围」与「从零起点」两版对照。 */
export function axisBarPercent(heights: [number, number] | null, index: 0 | 1): number {
  if (!heights) return 0;
  const tallest = Math.max(heights[0], heights[1]);
  if (tallest <= 0) return 0;
  return Math.round((heights[index] / tallest) * 100);
}

export function axisRangeText(risk: AxisRiskAssessment): string {
  if (risk.axisMin === null) return "（未读到）";
  const unit = risk.unit ? ` ${risk.unit}` : "";
  return risk.axisMax === null
    ? `（起点 ${risk.axisMin}${unit}）`
    : `（${risk.axisMin}–${risk.axisMax}${unit}）`;
}
