import { describe, expect, it } from "vitest";
import expectations from "../samples/expectations.json" with { type: "json" };
import { evaluateGrowth } from "../shared/audit.js";
import {
  completeClaimReview,
  createClaimWorkspace,
  toClaimAuditSubmission,
  updateClaimDraft,
} from "../shared/claim-workspace.js";
import { sampleCases } from "../shared/samples.js";

const sample = sampleCases.find(({ id }) => id === "multi-claims");
if (!sample) throw new Error("Missing multi-claim sample");

describe("单图多主张核对状态", () => {
  it("为每条原始观察建立互相独立的待核对工作状态", () => {
    const workspace = createClaimWorkspace(sample.observation);

    expect(workspace.claims.map(({ observation }) => observation.id)).toEqual([
      "revenue-growth",
      "profit-growth",
      "user-count-growth",
    ]);
    for (const claim of workspace.claims) {
      expect(claim.confirmedValues).toBeNull();
      expect(claim.confirmationState).toBe("pending");
      expect(claim.result).toBeNull();
    }
    expect(workspace.claims[1].draftValues.newer.value).toBe(70);
    expect(workspace.claims[2].draftValues.newer.evidenceText).toBeNull();
  });

  it("更正并重算单条主张时保留其他结果，缺证据时仍要求确认", () => {
    const expected = expectations.multiClaims.resultsAfterReview;
    let workspace = createClaimWorkspace(sample.observation);

    const untouchedBeforeIncomeConfirmation = workspace.claims.filter(
      ({ observation }) => observation.id !== "revenue-growth",
    );
    const incomeResult = evaluateGrowth(toClaimAuditSubmission(workspace, "revenue-growth")!);
    workspace = completeClaimReview(workspace, "revenue-growth", incomeResult);
    expect(incomeResult.status).toBe(expected[0].status);
    expect(incomeResult.calculatedGrowthPercent).toBe(expected[0].growthPercent);
    expect(
      workspace.claims.filter(({ observation }) => observation.id !== "revenue-growth"),
    ).toEqual(untouchedBeforeIncomeConfirmation);

    const incomeBeforeProfitEdit = workspace.claims.find(({ observation }) => observation.id === "revenue-growth");
    workspace = updateClaimDraft(workspace, "profit-growth", {
      kind: "value",
      point: "newer",
      value: expected[1].correctedNewer,
    });

    const incomeAfterProfitEdit = workspace.claims.find(({ observation }) => observation.id === "revenue-growth");
    const profitAfterEdit = workspace.claims.find(({ observation }) => observation.id === "profit-growth");
    expect(incomeAfterProfitEdit).toEqual(incomeBeforeProfitEdit);
    expect(profitAfterEdit?.observation.newer.value).toBe(expected[1].observedNewer);
    expect(profitAfterEdit?.draftValues.newer.value).toBe(expected[1].correctedNewer);
    expect(profitAfterEdit?.confirmationState).toBe("pending");
    expect(profitAfterEdit?.result).toBeNull();

    const profitResult = evaluateGrowth(toClaimAuditSubmission(workspace, "profit-growth")!);
    workspace = completeClaimReview(workspace, "profit-growth", profitResult);
    expect(profitResult.status).toBe(expected[1].status);
    expect(profitResult.calculatedGrowthPercent).toBe(expected[1].growthPercent);
    expect(workspace.claims.find(({ observation }) => observation.id === "revenue-growth")?.result).toEqual(incomeResult);

    workspace = updateClaimDraft(workspace, "user-count-growth", {
      kind: "value",
      point: "newer",
      value: 60,
    });
    const userCountResult = evaluateGrowth(toClaimAuditSubmission(workspace, "user-count-growth")!);
    workspace = completeClaimReview(workspace, "user-count-growth", userCountResult);
    expect(userCountResult.status).toBe(expected[2].status);
    expect(userCountResult.calculatedGrowthPercent).toBe(expected[2].growthPercent);
    expect(workspace.claims.find(({ observation }) => observation.id === "revenue-growth")?.result).toEqual(incomeResult);
    expect(workspace.claims.find(({ observation }) => observation.id === "profit-growth")?.result).toEqual(profitResult);
  });
});
