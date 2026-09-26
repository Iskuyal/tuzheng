import type { AxisObservation } from "./audit.js";

export type AxisRiskLevel = "ok" | "misleading-risk" | "needs-confirmation";

export interface AxisRiskAssessment {
  level: AxisRiskLevel;
  axisMin: number | null;
  axisMax: number | null;
  unit: string | null;
  /** 按原图轴范围映射后两根柱子的高度；轴起点不是零时较矮的一根可能为 0。 */
  heightsOnAxis: [number, number] | null;
  heightsFromZero: [number, number];
  /** 从零起点看两根柱子的比值（第二条 / 第一条），保留两位小数。 */
  fromZeroRatio: number | null;
  summary: string;
  reasons: string[];
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value: number): string {
  return `${formatNumber(value)}%`;
}

/**
 * 判断柱状图纵轴是否可能放大视觉差异。只看呈现方式，
 * 不判断作者动机，也不把「可能误读」写成结论。
 */
export function assessAxisRisk(
  axis: AxisObservation | null,
  values: [number, number],
  overrideMin?: number | null,
): AxisRiskAssessment {
  const [first, second] = values;
  const unit = axis?.unit ?? null;
  const fromZeroRatio = first === 0 ? null : Number((second / first).toFixed(2));
  const heightsFromZero: [number, number] = [first, second];

  // 用户手填的最小值优先于图上读数；读不到又没填时才要求确认。
  const min = overrideMin ?? axis?.min ?? null;
  const max = axis?.max ?? null;

  if (min === null) {
    return {
      level: "needs-confirmation",
      axisMin: null,
      axisMax: max,
      unit,
      heightsOnAxis: null,
      heightsFromZero,
      fromZeroRatio,
      summary: "纵轴刻度没有读清，无法判断柱高是否被放大。",
      reasons: ["请确认纵轴的最小值后再判断；只按柱高比较数值容易误判。"],
    };
  }
  const heightsOnAxis: [number, number] = [Math.max(0, first - min), Math.max(0, second - min)];

  if (min <= 0) {
    return {
      level: "ok",
      axisMin: min,
      axisMax: max,
      unit,
      heightsOnAxis,
      heightsFromZero,
      fromZeroRatio,
      summary: `纵轴从 ${formatNumber(min)} 开始，柱高与数值成比例，${formatNumber(first)} 到 ${formatNumber(second)} 的差异没有被放大。`,
      reasons: [],
    };
  }

  const taller = heightsOnAxis[1];
  const shorter = heightsOnAxis[0];
  const heightNote = shorter === 0
    ? `按原图轴范围，${formatNumber(first)} 那一根完全贴住基线、看不出高度，${formatNumber(second)} 那一根却占满画布`
    : `按原图轴范围，两根柱子高度是 ${formatNumber(shorter)} 与 ${formatNumber(taller)}`;

  return {
    level: "misleading-risk",
    axisMin: min,
    axisMax: max,
    unit,
    heightsOnAxis,
    heightsFromZero,
    fromZeroRatio,
    summary: `纵轴从 ${formatNumber(min)} 开始而不是从零开始；${heightNote}，容易让人以为差异远大于实际的 ${formatPercent(((second - first) / first) * 100)}。`,
    reasons: [
      "这是呈现方式的风险提示，不能据此认定作者造假。",
    ],
  };
}
