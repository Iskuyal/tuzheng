import {
  evaluateGrowth,
  formatNumber,
  formatPercent,
  type AuditObservation,
  type AuditStatus,
  type ChartObservation,
  type GrowthClaimObservation,
} from "./audit.js";
import type { ClaimWorkspaceValues } from "./claim-workspace.js";

export type CrossElementKey = "metric" | "period" | "unit" | "scope";

export type CrossElementState = "aligned" | "mismatch" | "missing" | "confirmed-by-user";

export interface ClaimScopeView {
  claimId: string;
  claimText: string | null;
  metric: string | null;
  scope: string | null;
  olderPeriod: string | null;
  newerPeriod: string | null;
  olderUnit: string | null;
  newerUnit: string | null;
  /** 这一侧是否已经确认过读数；未确认时不参与数值比较。 */
  confirmed: boolean;
}

export interface CrossElementComparison {
  key: CrossElementKey;
  label: string;
  left: string | null;
  right: string | null;
  state: CrossElementState;
}

export interface CrossImageComparison {
  elements: CrossElementComparison[];
  /** 口径层面缺哪些要素；为空表示四要素齐备且一致。 */
  blockers: CrossElementKey[];
  /** 口径是否通过（四要素齐备且一致，或经用户逐项确认）。 */
  scopeReady: boolean;
  /** 能否进入数值比较：口径通过，且两侧读数都已确认。 */
  ready: boolean;
}

const ELEMENT_LABELS: Record<CrossElementKey, string> = {
  metric: "指标",
  period: "时间",
  unit: "单位",
  scope: "范围／人群",
};

/** 口径文本归一化：去空白、全角转半角、统一小写。空文本视为没读到。 */
export function normalizeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLowerCase();
  return normalized.length ? normalized : null;
}

export function claimScopeView(
  observation: ChartObservation,
  claimId: string,
): ClaimScopeView | null {
  const claim: GrowthClaimObservation | undefined = observation.claims.find((item) => item.id === claimId);
  if (!claim) return null;

  return {
    claimId: claim.id,
    claimText: claim.claimText,
    metric: claim.metric,
    scope: claim.scope,
    olderPeriod: claim.older.period,
    newerPeriod: claim.newer.period,
    olderUnit: claim.older.unit,
    newerUnit: claim.newer.unit,
    confirmed: false,
  };
}

/** 按归一化指标名挑选可配对的对照主张；找不到就不猜。 */
export function pickReferenceClaimId(
  currentClaim: Pick<GrowthClaimObservation, "metric">,
  reference: ChartObservation,
): string | null {
  const metric = normalizeLabel(currentClaim.metric);
  if (!metric) return null;
  const match = reference.claims.find((claim) => normalizeLabel(claim.metric) === metric);
  return match?.id ?? null;
}

function pairState(
  left: string | null,
  right: string | null,
): CrossElementState {
  const leftNormalized = normalizeLabel(left);
  const rightNormalized = normalizeLabel(right);
  if (!leftNormalized || !rightNormalized) return "missing";
  return leftNormalized === rightNormalized ? "aligned" : "mismatch";
}

function comparePair(
  leftValues: (string | null)[],
  rightValues: (string | null)[],
): CrossElementState {
  const states = leftValues.map((value, index) => pairState(value, rightValues[index] ?? null));
  if (states.includes("missing")) return "missing";
  return states.every((state) => state === "aligned") ? "aligned" : "mismatch";
}

/**
 * 比对两张图的主张口径。四个要素里任一缺失或不一致都算阻塞，
 * 用户逐项「确认一致」可以补上读不出的信息（例如图上没写人群范围）。
 */
export function compareClaimScopes(
  left: ClaimScopeView,
  right: ClaimScopeView,
  userConfirmed: CrossElementKey[],
): CrossImageComparison {
  const raw: Array<{ key: CrossElementKey; state: CrossElementState; left: string | null; right: string | null }> = [
    { key: "metric", state: pairState(left.metric, right.metric), left: left.metric, right: right.metric },
    {
      key: "period",
      state: comparePair([left.olderPeriod, left.newerPeriod], [right.olderPeriod, right.newerPeriod]),
      left: [left.olderPeriod, left.newerPeriod].filter(Boolean).join(" → ") || null,
      right: [right.olderPeriod, right.newerPeriod].filter(Boolean).join(" → ") || null,
    },
    {
      key: "unit",
      state: comparePair([left.olderUnit, left.newerUnit], [right.olderUnit, right.newerUnit]),
      left: [left.olderUnit, left.newerUnit].filter(Boolean).join(" / ") || null,
      right: [right.olderUnit, right.newerUnit].filter(Boolean).join(" / ") || null,
    },
    { key: "scope", state: pairState(left.scope, right.scope), left: left.scope, right: right.scope },
  ];

  const elements: CrossElementComparison[] = raw.map((element) => ({
    key: element.key,
    label: ELEMENT_LABELS[element.key],
    left: element.left,
    right: element.right,
    // 「确认一致」只用于补上图上读不到的信息；读到却不一致时不得抹平。
    state: userConfirmed.includes(element.key) && element.state === "missing"
      ? "confirmed-by-user"
      : element.state,
  }));

  const blockers = elements
    .filter((element) => element.state === "mismatch" || element.state === "missing")
    .map((element) => element.key);

  // 口径通过只是前提；两侧读数都确认过才允许进入数值比较。
  const scopeReady = blockers.length === 0;

  return { elements, blockers, scopeReady, ready: scopeReady && left.confirmed && right.confirmed };
}

/** 用确认过的核对值组装一侧的审计观察值，供确定性增长率规则复用。 */
/** 只接受已经确认过的核对值；调用方必须先过口径与确认门禁。 */
export function confirmedAuditObservation(
  chart: ChartObservation,
  claimId: string,
  values: ClaimWorkspaceValues,
): AuditObservation | null {
  const claim = chart.claims.find((item) => item.id === claimId);
  if (!claim) return null;

  return {
    titleOriginal: claim.claimText,
    claimedGrowthPercent: values.claimedGrowthPercent,
    older: { ...values.older },
    newer: { ...values.newer },
    unreadableItems: [...claim.unreadableItems],
    confirmed: true,
    source: chart.source,
  };
}

export interface CrossImageVerdict {
  status: AuditStatus;
  leftGrowthPercent: number | null;
  rightGrowthPercent: number | null;
  differencePoints: number | null;
  summary: string;
  reasons: string[];
}

/**
 * 比较两张图已确认读数算出的增长率。只比较两张图是否自洽，
 * 不涉及两张图之外的现实数据，也不判断作者动机。
 */
export function compareCrossGrowth(
  left: AuditObservation,
  right: AuditObservation,
): CrossImageVerdict {
  const leftResult = evaluateGrowth(left);
  const rightResult = evaluateGrowth(right);

  if (leftResult.status === "needs-confirmation" || rightResult.status === "needs-confirmation") {
    const reasons: string[] = [];
    if (leftResult.status === "needs-confirmation") reasons.push(`当前图：${leftResult.summary}`);
    if (rightResult.status === "needs-confirmation") reasons.push(`对照图：${rightResult.summary}`);
    return {
      status: "needs-confirmation",
      leftGrowthPercent: leftResult.calculatedGrowthPercent,
      rightGrowthPercent: rightResult.calculatedGrowthPercent,
      differencePoints: null,
      summary: "一侧的读数还不能计算增长率，跨图结论保持「待核对」。",
      reasons,
    };
  }

  const leftGrowth = leftResult.calculatedGrowthPercent as number;
  const rightGrowth = rightResult.calculatedGrowthPercent as number;
  const difference = Number(Math.abs(leftGrowth - rightGrowth).toFixed(2));

  if (difference === 0) {
    return {
      status: "consistent",
      leftGrowthPercent: leftGrowth,
      rightGrowthPercent: rightGrowth,
      differencePoints: 0,
      summary: `两张图按各自已确认读数都算得 ${formatPercent(leftGrowth)}，数值一致。`,
      reasons: [],
    };
  }

  return {
    status: "contradictory",
    leftGrowthPercent: leftGrowth,
    rightGrowthPercent: rightGrowth,
    differencePoints: difference,
    summary: `当前图算得 ${formatPercent(leftGrowth)}，对照图算得 ${formatPercent(rightGrowth)}，相差 ${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(difference)} 个百分点。`,
    reasons: [],
  };
}

