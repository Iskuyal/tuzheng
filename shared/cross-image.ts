import type { ChartObservation, GrowthClaimObservation } from "./audit.js";

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
    state: userConfirmed.includes(element.key) && element.state !== "aligned"
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
