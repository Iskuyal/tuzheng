export type ObservationSource = "preset-example" | "vision-model";
export type ValueSource = "preset" | "model" | "user" | "unreadable";
export type AuditStatus = "consistent" | "contradictory" | "needs-confirmation";

export interface DataPointObservation {
  period: string | null;
  value: number | null;
  unit: string | null;
  evidenceText: string | null;
  valueSource: ValueSource;
}

export interface RawDataPointObservation {
  period: string | null;
  value: number | null;
  unit: string | null;
  evidenceText: string | null;
}

export interface AxisObservation {
  label: string | null;
  min: number | null;
  max: number | null;
  unit: string | null;
}

export interface GrowthClaimObservation {
  id: string;
  claimText: string | null;
  /** 口径：指标名与范围／人群。读不清或图上没写时为 null，不推断。 */
  metric: string | null;
  scope: string | null;
  claimedGrowthPercent: number | null;
  older: RawDataPointObservation;
  newer: RawDataPointObservation;
  unreadableItems: string[];
}

export interface ChartObservation {
  source: ObservationSource;
  claims: GrowthClaimObservation[];
  /** 柱状图的纵轴范围；非柱状图或读不清时为 null。 */
  axis?: AxisObservation | null;
}

export interface ModelReadTrace {
  model: string;
  latencyMs: number;
  imageBytes: number;
  requestId: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
  rawText: string;
}

export interface AuditObservation {
  titleOriginal: string | null;
  claimedGrowthPercent: number | null;
  older: DataPointObservation;
  newer: DataPointObservation;
  unreadableItems: string[];
  confirmed: boolean;
  source: ObservationSource;
}

export interface AuditResult {
  status: AuditStatus;
  calculatedGrowthPercent: number | null;
  formula: string | null;
  summary: string;
  reasons: string[];
}

export function initialValueSource(
  source: ObservationSource,
  point: RawDataPointObservation,
): ValueSource {
  if (point.value === null) return "unreadable";
  return source === "preset-example" ? "preset" : "model";
}

export function toDataPointObservation(
  source: ObservationSource,
  point: RawDataPointObservation,
): DataPointObservation {
  return { ...point, valueSource: initialValueSource(source, point) };
}

export function toAuditObservation(
  chartObservation: ChartObservation,
  claim: GrowthClaimObservation,
): AuditObservation {
  return {
    titleOriginal: claim.claimText,
    claimedGrowthPercent: claim.claimedGrowthPercent,
    older: toDataPointObservation(chartObservation.source, claim.older),
    newer: toDataPointObservation(chartObservation.source, claim.newer),
    unreadableItems: [...claim.unreadableItems],
    confirmed: false,
    source: chartObservation.source,
  };
}

function formatNumber(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits }).format(value);
}

function formatPercent(value: number): string {
  return `${formatNumber(value)}%`;
}

function needsConfirmation(
  reason: string,
  calculatedGrowthPercent: number | null = null,
  formula: string | null = null,
): AuditResult {
  return {
    status: "needs-confirmation",
    calculatedGrowthPercent,
    formula,
    summary: reason,
    reasons: [reason],
  };
}

function periodKey(period: string | null): number | null {
  if (!period) return null;

  const yearMatch = period.match(/(?:19|20|21)\d{2}/);
  if (!yearMatch) return null;

  const year = Number(yearMatch[0]);
  const remainder = period.slice((yearMatch.index ?? 0) + yearMatch[0].length);
  const quarterMatch = remainder.match(/(?:第\s*)?([1-4])\s*(?:季度|季|Q)/i);
  if (quarterMatch) return year * 100 + Number(quarterMatch[1]) * 3;

  const monthMatch = remainder.match(/(?:第\s*)?([1-9]|1[0-2])\s*月/);
  if (monthMatch) return year * 100 + Number(monthMatch[1]);

  return year * 100;
}

export function evaluateGrowth(observation: AuditObservation): AuditResult {
  if (!observation.confirmed) {
    return needsConfirmation("请先确认或更正图表观察值。");
  }

  if (observation.older.value === null || observation.newer.value === null) {
    return needsConfirmation("关键数值尚未读清；请补充或更正后再计算。");
  }

  const olderUnit = observation.older.unit?.trim().toLocaleLowerCase();
  const newerUnit = observation.newer.unit?.trim().toLocaleLowerCase();
  if (!olderUnit || !newerUnit || olderUnit !== newerUnit) {
    return needsConfirmation("两个数值的单位不一致。");
  }

  if (!observation.older.evidenceText?.trim()) {
    return needsConfirmation("旧数值缺少可复查的图内文字依据。");
  }
  if (!observation.newer.evidenceText?.trim()) {
    return needsConfirmation("新数值缺少可复查的图内文字依据。");
  }

  const olderPeriod = periodKey(observation.older.period);
  const newerPeriod = periodKey(observation.newer.period);
  if (olderPeriod === null || newerPeriod === null || newerPeriod <= olderPeriod) {
    return needsConfirmation("时间顺序无法从标签确认。");
  }

  const oldValue = observation.older.value;
  const newValue = observation.newer.value;
  if (oldValue === 0) {
    return needsConfirmation("旧值为 0，无法计算增长率。");
  }

  const growth = Number((((newValue - oldValue) / oldValue) * 100).toFixed(2));
  const formula = `(${formatNumber(newValue)} - ${formatNumber(oldValue)}) / ${formatNumber(oldValue)} × 100 = ${formatPercent(growth)}`;
  const reasons: string[] = [];

  if (observation.older.valueSource === "user") {
    reasons.push("旧数值由用户手动更正。");
  }
  if (observation.newer.valueSource === "user") {
    reasons.push("新数值由用户手动更正。");
  }

  if (!observation.titleOriginal?.trim() || observation.claimedGrowthPercent === null) {
    return {
      status: "needs-confirmation",
      calculatedGrowthPercent: growth,
      formula,
      summary: `已确认数字算得 ${formatPercent(growth)}，但标题没有可比较的增长率主张。`,
      reasons: [...reasons, "标题中没有可比较的增长率主张。"],
    };
  }

  const difference = Math.abs(growth - observation.claimedGrowthPercent);
  const consistent = growth === observation.claimedGrowthPercent;
  const status: AuditStatus = consistent ? "consistent" : "contradictory";
  const summary = consistent
    ? `标题写 ${formatPercent(observation.claimedGrowthPercent)}，已确认数字算得 ${formatPercent(growth)}，图内一致。`
    : `标题写 ${formatNumber(observation.claimedGrowthPercent, 6)}%，已确认数字算得 ${formatPercent(growth)}，相差 ${formatNumber(difference, 6)} 个百分点。`;

  return { status, calculatedGrowthPercent: growth, formula, summary, reasons };
}
