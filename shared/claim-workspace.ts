import {
  type AuditObservation,
  type AuditResult,
  type AuditStatus,
  type ChartObservation,
  type DataPointObservation,
  type GrowthClaimObservation,
  type ObservationSource,
  toDataPointObservation,
} from "./audit.js";

export interface ClaimWorkspaceValues {
  claimedGrowthPercent: number | null;
  older: DataPointObservation;
  newer: DataPointObservation;
}

export type ClaimWorkspaceEdit =
  | { kind: "growth-percent"; value: number | null }
  | { kind: "period" | "unit"; point: "older" | "newer"; value: string | null }
  | { kind: "value"; point: "older" | "newer"; value: number | null };

export type ClaimAuditAction = "correct" | "confirm" | "recompute";

export type ClaimAuditField =
  | "claimedGrowthPercent"
  | "older.period"
  | "older.value"
  | "older.unit"
  | "newer.period"
  | "newer.value"
  | "newer.unit";

export interface ClaimAuditChange {
  field: ClaimAuditField;
  from: number | string | null;
  to: number | string | null;
}

export interface ClaimAuditEvent {
  id: number;
  at: string;
  claimId: string;
  claimText: string | null;
  action: ClaimAuditAction;
  changes: ClaimAuditChange[];
  result: { status: AuditStatus; summary: string } | null;
}

export interface ClaimWorkspaceEntry {
  observation: GrowthClaimObservation;
  draftValues: ClaimWorkspaceValues;
  confirmedValues: ClaimWorkspaceValues | null;
  confirmationState: "pending" | "confirmed";
  result: AuditResult | null;
}

export interface ClaimWorkspace {
  source: ObservationSource;
  claims: ClaimWorkspaceEntry[];
  events: ClaimAuditLog;
}

function copyValues(values: ClaimWorkspaceValues): ClaimWorkspaceValues {
  return {
    claimedGrowthPercent: values.claimedGrowthPercent,
    older: { ...values.older },
    newer: { ...values.newer },
  };
}

export function initialDraftValues(
  source: ObservationSource,
  observation: GrowthClaimObservation,
): ClaimWorkspaceValues {
  return {
    claimedGrowthPercent: observation.claimedGrowthPercent,
    older: toDataPointObservation(source, observation.older),
    newer: toDataPointObservation(source, observation.newer),
  };
}

function pendingEntry(source: ObservationSource, observation: GrowthClaimObservation): ClaimWorkspaceEntry {
  return {
    observation,
    draftValues: initialDraftValues(source, observation),
    confirmedValues: null,
    confirmationState: "pending",
    result: null,
  };
}

export interface ClaimEditResult {
  values: ClaimWorkspaceValues;
  change: ClaimAuditChange;
  changed: boolean;
}

/**
 * 把一次编辑作用到核对值上：返回新值与变化前后的值，数值没变时 changed 为 false
 * （调用方据此既不记事件也不清结论）。两条路径共用这一份规则。
 */
export function applyClaimEdit(
  values: ClaimWorkspaceValues,
  edit: ClaimWorkspaceEdit,
): ClaimEditResult {
  const next = copyValues(values);

  if (edit.kind === "growth-percent") {
    const to = edit.value === null || !Number.isFinite(edit.value) ? null : edit.value;
    next.claimedGrowthPercent = to;
    return {
      values: next,
      change: { field: "claimedGrowthPercent", from: values.claimedGrowthPercent, to },
      changed: values.claimedGrowthPercent !== to,
    };
  }

  const point = next[edit.point];
  const field: ClaimAuditField = `${edit.point}.${edit.kind}`;
  if (edit.kind === "value") {
    const to = edit.value === null || !Number.isFinite(edit.value) ? null : edit.value;
    const from = values[edit.point].value;
    const changed = from !== to;
    if (changed) {
      point.value = to;
      point.valueSource = to === null ? "unreadable" : "user";
    }
    return { values: next, change: { field, from, to }, changed };
  }

  const to = edit.value || null;
  point[edit.kind] = to;
  return {
    values: next,
    change: { field, from: values[edit.point][edit.kind], to },
    changed: values[edit.point][edit.kind] !== to,
  };
}

export function valuesFromObservation(observation: AuditObservation): ClaimWorkspaceValues {
  return {
    claimedGrowthPercent: observation.claimedGrowthPercent,
    older: { ...observation.older },
    newer: { ...observation.newer },
  };
}

export type ClaimAuditLog = ClaimAuditEvent[];

export interface ClaimAuditReview {
  action: "confirm" | "recompute";
  result: { status: AuditStatus; summary: string };
}

export interface ClaimAuditTarget {
  claimId: string;
  claimText: string | null;
}

function appendEvent(events: ClaimAuditLog, event: ClaimAuditEvent): ClaimAuditLog {
  const previous = events.at(-1);
  const mergeable = previous !== undefined
    && previous.action === "correct"
    && previous.claimId === event.claimId
    && previous.changes.length === 1
    && event.action === "correct"
    && event.changes.length === 1
    && previous.changes[0].field === event.changes[0].field;

  if (!mergeable) return [...events, event];

  const merged: ClaimAuditEvent = {
    ...previous,
    at: event.at,
    changes: [{ ...previous.changes[0], to: event.changes[0].to }],
  };
  // 逐字输入又回到原值时净变化为空，不留一条没有实际变化的记录。
  if (merged.changes[0].from === merged.changes[0].to) return events.slice(0, -1);
  return [...events.slice(0, -1), merged];
}

function newEvent(
  events: ClaimAuditLog,
  target: ClaimAuditTarget,
  fields: Omit<ClaimAuditEvent, "id" | "claimId" | "claimText">,
): ClaimAuditEvent {
  return {
    id: events.length + 1,
    claimId: target.claimId,
    claimText: target.claimText,
    ...fields,
  };
}

/** 记录一次读数更正；没有真正改变数值时返回原记录，不产生空事件。 */
export function recordCorrection(
  events: ClaimAuditLog,
  target: ClaimAuditTarget,
  change: ClaimAuditChange,
  at: string = new Date().toISOString(),
): ClaimAuditLog {
  if (change.from === change.to) return events;
  return appendEvent(events, newEvent(events, target, {
    at,
    action: "correct",
    changes: [change],
    result: null,
  }));
}

/** 记录一次确认或重算及其结论。 */
export function recordReview(
  events: ClaimAuditLog,
  target: ClaimAuditTarget,
  review: ClaimAuditReview,
  at: string = new Date().toISOString(),
): ClaimAuditLog {
  return appendEvent(events, newEvent(events, target, {
    at,
    action: review.action,
    changes: [],
    result: review.result,
  }));
}

export function previousResultStatus(events: ClaimAuditLog, index: number): AuditStatus | null {
  const event = events[index];
  const status = event?.result?.status;
  if (!event || !status) return null;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (events[cursor].claimId !== event.claimId) continue;
    const previous = events[cursor].result;
    if (previous) return previous.status === status ? null : previous.status;
  }
  return null;
}

export function createClaimWorkspace(chartObservation: ChartObservation): ClaimWorkspace {
  return {
    source: chartObservation.source,
    claims: chartObservation.claims.map((observation) => pendingEntry(chartObservation.source, observation)),
    events: [],
  };
}

export function updateClaimDraft(
  workspace: ClaimWorkspace,
  claimId: string,
  edit: ClaimWorkspaceEdit,
  at: string = new Date().toISOString(),
): ClaimWorkspace {
  let recorded: { target: ClaimAuditTarget; change: ClaimAuditChange } | null = null;

  const claims = workspace.claims.map((entry) => {
    if (entry.observation.id !== claimId) return entry;

    const applied = applyClaimEdit(entry.draftValues, edit);
    // 输入没有真正改变数值时不记事件，也不清掉已有结论。
    if (!applied.changed) return entry;

    recorded = {
      target: { claimId, claimText: entry.observation.claimText },
      change: applied.change,
    };

    return {
      ...entry,
      draftValues: applied.values,
      confirmedValues: null,
      confirmationState: "pending" as const,
      result: null,
    };
  });

  if (!recorded) return workspace;
  const { target, change } = recorded;
  return { ...workspace, claims, events: recordCorrection(workspace.events, target, change, at) };
}

export function toClaimAuditSubmission(
  workspace: ClaimWorkspace,
  claimId: string,
): AuditObservation | null {
  const entry = workspace.claims.find(({ observation }) => observation.id === claimId);
  if (!entry) return null;

  return {
    titleOriginal: entry.observation.claimText,
    claimedGrowthPercent: entry.draftValues.claimedGrowthPercent,
    older: { ...entry.draftValues.older },
    newer: { ...entry.draftValues.newer },
    unreadableItems: [...entry.observation.unreadableItems],
    confirmed: true,
    source: workspace.source,
  };
}

export function completeClaimReview(
  workspace: ClaimWorkspace,
  claimId: string,
  result: AuditResult,
  at: string = new Date().toISOString(),
): ClaimWorkspace {
  let recorded: { target: ClaimAuditTarget; review: ClaimAuditReview } | null = null;

  const claims = workspace.claims.map((entry) => {
    if (entry.observation.id !== claimId) return entry;

    recorded = {
      target: { claimId, claimText: entry.observation.claimText },
      review: {
        action: entry.confirmationState === "confirmed" ? "recompute" : "confirm",
        result: { status: result.status, summary: result.summary },
      },
    };

    return {
      ...entry,
      confirmedValues: copyValues(entry.draftValues),
      confirmationState: "confirmed" as const,
      result,
    };
  });

  if (!recorded) return workspace;
  const { target, review } = recorded;
  return { ...workspace, claims, events: recordReview(workspace.events, target, review, at) };
}

export function resetClaimWorkspace(workspace: ClaimWorkspace): ClaimWorkspace {
  return {
    source: workspace.source,
    claims: workspace.claims.map((entry) => pendingEntry(workspace.source, entry.observation)),
    events: [],
  };
}
