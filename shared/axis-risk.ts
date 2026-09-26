import { formatNumber, formatPercent, type AxisObservation } from "./audit.js";

export type AxisRiskLevel = "ok" | "misleading-risk" | "needs-confirmation";

export interface AxisRiskAssessment {
  level: AxisRiskLevel;
  axisMin: number | null;
  axisMax: number | null;
  unit: string | null;
  /** 按原图轴范围映射后两根柱子的高度；轴起点不是零时较矮的一根可能为 0。 */
  heightsOnAxis: [number, number] | null;
  heightsFromZero: [number, number];
  /** 从零起点看两根柱子的比值（第二条 / 第一条）。 */
  fromZeroRatio: number | null;
  /** 原图轴范围下两根柱子的比值；较矮的一根贴住基线时为 null。 */
  onAxisRatio: number | null;
  summary: string;
  reasons: string[];
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
      onAxisRatio: null,
      summary: "纵轴刻度没有读清，无法判断柱高是否被放大。",
      reasons: ["请确认纵轴的最小值后再判断；只按柱高比较数值容易误判。"],
    };
  }

  if (min >= Math.max(first, second)) {
    return {
      level: "needs-confirmation",
      axisMin: min,
      axisMax: max,
      unit,
      heightsOnAxis: null,
      heightsFromZero,
      fromZeroRatio,
      onAxisRatio: null,
      summary: `填写的纵轴最小值是 ${formatNumber(min)}，不低于两根柱子的数值，无法判断柱高。`,
      reasons: ["请核对纵轴最小值；它应当小于两根柱子的数值。"],
    };
  }

  const heightsOnAxis: [number, number] = [Math.max(0, first - min), Math.max(0, second - min)];
  const onAxisRatio = heightsOnAxis[0] === 0
    ? null
    : Number((heightsOnAxis[1] / heightsOnAxis[0]).toFixed(2));
  const growthPercent = first === 0 ? null : ((second - first) / first) * 100;

  if (min === 0) {
    return {
      level: "ok",
      axisMin: min,
      axisMax: max,
      unit,
      heightsOnAxis,
      heightsFromZero,
      fromZeroRatio,
      onAxisRatio,
      summary: `纵轴从零开始，柱高与数值成比例，${formatNumber(first)} 到 ${formatNumber(second)} 的差异没有被放大${growthPercent === null ? "" : `（实际 ${formatPercent(growthPercent)}）`}。`,
      reasons: [],
    };
  }

  if (min < 0) {
    return {
      level: "ok",
      axisMin: min,
      axisMax: max,
      unit,
      heightsOnAxis,
      heightsFromZero,
      fromZeroRatio,
      onAxisRatio,
      summary: `纵轴从 ${formatNumber(min)} 开始（低于零），两根柱子的高度差比数值差更小，没有放大差异。`,
      reasons: [],
    };
  }

  const shorter = heightsOnAxis[0];
  const amplification = onAxisRatio !== null && fromZeroRatio !== null && fromZeroRatio > 0
    ? Number((onAxisRatio / fromZeroRatio).toFixed(2))
    : null;
  const heightNote = shorter === 0
    ? `按原图轴范围，${formatNumber(first)} 那一根完全贴住基线、看不出高度，${formatNumber(second)} 那一根却占满画布`
    : `按原图轴范围，两根柱子高度是 ${formatNumber(shorter)} 与 ${formatNumber(heightsOnAxis[1])}${amplification === null ? "" : `，高度差被放大约 ${formatNumber(amplification)} 倍`}`;
  const growthNote = growthPercent === null ? "" : `，而两根柱子的数值只相差 ${formatPercent(growthPercent)}`;

  return {
    level: "misleading-risk",
    axisMin: min,
    axisMax: max,
    unit,
    heightsOnAxis,
    heightsFromZero,
    fromZeroRatio,
    onAxisRatio,
    summary: `纵轴从 ${formatNumber(min)} 开始而不是从零开始；${heightNote}${growthNote}。`,
    reasons: [
      "这是呈现方式的风险提示，不能据此认定作者造假。",
    ],
  };
}
