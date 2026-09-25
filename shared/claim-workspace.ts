import {
  type AuditObservation,
  type AuditResult,
  type ChartObservation,
  type DataPointObservation,
  type GrowthClaimObservation,
  type ObservationSource,
  toAuditObservation,
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
}

function copyValues(values: ClaimWorkspaceValues): ClaimWorkspaceValues {
  return {
    claimedGrowthPercent: values.claimedGrowthPercent,
    older: { ...values.older },
    newer: { ...values.newer },
  };
}

function valuesFromObservation(observation: AuditObservation): ClaimWorkspaceValues {
  return {
    claimedGrowthPercent: observation.claimedGrowthPercent,
    older: { ...observation.older },
    newer: { ...observation.newer },
  };
}

export function createClaimWorkspace(chartObservation: ChartObservation): ClaimWorkspace {
  return {
    source: chartObservation.source,
    claims: chartObservation.claims.map((observation) => {
      const draftValues = valuesFromObservation(toAuditObservation(chartObservation, observation));
      return {
        observation,
        draftValues,
        confirmedValues: null,
        confirmationState: "pending",
        result: null,
      };
    }),
  };
}

export function updateClaimDraft(
  workspace: ClaimWorkspace,
  claimId: string,
  edit: ClaimWorkspaceEdit,
): ClaimWorkspace {
  let changed = false;
  const claims = workspace.claims.map((entry) => {
    if (entry.observation.id !== claimId) return entry;
    changed = true;

    const draftValues = copyValues(entry.draftValues);
    if (edit.kind === "growth-percent") {
      draftValues.claimedGrowthPercent = edit.value;
    } else {
      const point = draftValues[edit.point];
      if (edit.kind === "value") {
        point.value = edit.value;
        point.valueSource = edit.value === null ? "unreadable" : "user";
      } else {
        point[edit.kind] = edit.value;
      }
    }

    return {
      ...entry,
      draftValues,
      confirmedValues: null,
      confirmationState: "pending" as const,
      result: null,
    };
  });

  return changed ? { ...workspace, claims } : workspace;
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
): ClaimWorkspace {
  let changed = false;
  const claims = workspace.claims.map((entry) => {
    if (entry.observation.id !== claimId) return entry;
    changed = true;
    return {
      ...entry,
      confirmedValues: copyValues(entry.draftValues),
      confirmationState: "confirmed" as const,
      result,
    };
  });

  return changed ? { ...workspace, claims } : workspace;
}
