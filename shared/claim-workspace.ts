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
  events: ClaimAuditEvent[];
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

function createEvent(
  workspace: ClaimWorkspace,
  entry: ClaimWorkspaceEntry,
  fields: Pick<ClaimAuditEvent, "at" | "action" | "changes" | "result">,
): ClaimAuditEvent {
  return {
    id: workspace.events.length + 1,
    claimId: entry.observation.id,
    claimText: entry.observation.claimText,
    ...fields,
  };
}

function appendEvent(events: ClaimAuditEvent[], event: ClaimAuditEvent): ClaimAuditEvent[] {
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

export function previousResultStatus(events: ClaimAuditEvent[], index: number): AuditStatus | null {
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
  let changed = false;
  let recorded: ClaimAuditEvent | null = null;

  const claims = workspace.claims.map((entry) => {
    if (entry.observation.id !== claimId) return entry;

    const draftValues = copyValues(entry.draftValues);
    let change: ClaimAuditChange;
    if (edit.kind === "growth-percent") {
      change = {
        field: "claimedGrowthPercent",
        from: entry.draftValues.claimedGrowthPercent,
        to: edit.value,
      };
      draftValues.claimedGrowthPercent = edit.value;
    } else {
      change = {
        field: `${edit.point}.${edit.kind}`,
        from: entry.draftValues[edit.point][edit.kind],
        to: edit.value,
      };
      const point = draftValues[edit.point];
      if (edit.kind === "value") {
        point.value = edit.value;
        point.valueSource = edit.value === null ? "unreadable" : "user";
      } else {
        point[edit.kind] = edit.value;
      }
    }

    // 输入没有真正改变数值时不记事件，也不清掉已有结论。
    if (change.from === change.to) return entry;
    changed = true;

    recorded = createEvent(workspace, entry, {
      at,
      action: "correct",
      changes: [change],
      result: null,
    });

    return {
      ...entry,
      draftValues,
      confirmedValues: null,
      confirmationState: "pending" as const,
      result: null,
    };
  });

  if (!changed || !recorded) return workspace;
  return { ...workspace, claims, events: appendEvent(workspace.events, recorded) };
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
  let changed = false;
  let recorded: ClaimAuditEvent | null = null;

  const claims = workspace.claims.map((entry) => {
    if (entry.observation.id !== claimId) return entry;
    changed = true;

    recorded = createEvent(workspace, entry, {
      at,
      action: entry.confirmationState === "confirmed" ? "recompute" : "confirm",
      changes: [],
      result: { status: result.status, summary: result.summary },
    });

    return {
      ...entry,
      confirmedValues: copyValues(entry.draftValues),
      confirmationState: "confirmed" as const,
      result,
    };
  });

  if (!changed || !recorded) return workspace;
  return { ...workspace, claims, events: appendEvent(workspace.events, recorded) };
}

export function resetClaimWorkspace(workspace: ClaimWorkspace): ClaimWorkspace {
  return {
    source: workspace.source,
    claims: workspace.claims.map((entry) => pendingEntry(workspace.source, entry.observation)),
    events: [],
  };
}
