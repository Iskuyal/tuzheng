import { describe, expect, it } from "vitest";
import expectations from "../samples/expectations.json" with { type: "json" };
import { evaluateGrowth } from "../shared/audit.js";
import {
  completeClaimReview,
  createClaimWorkspace,
  previousResultStatus,
  resetClaimWorkspace,
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

describe("会话审计记录与整份重置", () => {
  const at = (minute: number) => `2026-09-26T10:${String(minute).padStart(2, "0")}:00.000Z`;
  const calculate = (workspace: ReturnType<typeof createClaimWorkspace>, claimId: string) =>
    evaluateGrowth(toClaimAuditSubmission(workspace, claimId)!);

  it("按发生顺序记录确认与重算，并归属到各自的主张", () => {
    let workspace = createClaimWorkspace(sample.observation);
    expect(workspace.events).toEqual([]);

    workspace = updateClaimDraft(
      workspace,
      "profit-growth",
      { kind: "value", point: "newer", value: 100 },
      at(1),
    );
    workspace = completeClaimReview(workspace, "revenue-growth", calculate(workspace, "revenue-growth"), at(2));
    workspace = completeClaimReview(workspace, "profit-growth", calculate(workspace, "profit-growth"), at(3));
    workspace = completeClaimReview(workspace, "profit-growth", calculate(workspace, "profit-growth"), at(4));

    expect(workspace.events.map(({ id, at: time, claimId, action }) => [id, time, claimId, action])).toEqual([
      [1, at(1), "profit-growth", "correct"],
      [2, at(2), "revenue-growth", "confirm"],
      [3, at(3), "profit-growth", "confirm"],
      [4, at(4), "profit-growth", "recompute"],
    ]);
    expect(workspace.events[2].claimText).toBe("利润增长 40%");
  });

  it("更正记录变化前后的值，原始观察和已确认值不被覆盖", () => {
    let workspace = createClaimWorkspace(sample.observation);
    workspace = completeClaimReview(workspace, "profit-growth", calculate(workspace, "profit-growth"), at(1));
    const confirmedBeforeEdit = workspace.claims[1].confirmedValues;
    workspace = updateClaimDraft(
      workspace,
      "profit-growth",
      { kind: "value", point: "newer", value: 100 },
      at(2),
    );

    const [confirmEvent, correctEvent] = workspace.events;
    expect(confirmEvent.result?.status).toBe("consistent");
    expect(correctEvent).toMatchObject({
      claimId: "profit-growth",
      action: "correct",
      changes: [{ field: "newer.value", from: 70, to: 100 }],
      result: null,
    });
    expect(workspace.claims[1].observation.newer.value).toBe(70);
    expect(confirmedBeforeEdit).toMatchObject({ newer: { value: 70 } });
    expect(workspace.claims[1].confirmedValues).toBeNull();
    expect(workspace.claims[1].result).toBeNull();
  });

  it("连续输入同一字段合并成一条更正，其他字段和主张分别记录", () => {
    let workspace = createClaimWorkspace(sample.observation);
    workspace = updateClaimDraft(workspace, "profit-growth", { kind: "value", point: "newer", value: 1 }, at(1));
    workspace = updateClaimDraft(workspace, "profit-growth", { kind: "value", point: "newer", value: 10 }, at(2));
    workspace = updateClaimDraft(workspace, "profit-growth", { kind: "value", point: "newer", value: 100 }, at(3));

    expect(workspace.events).toHaveLength(1);
    expect(workspace.events[0]).toMatchObject({ id: 1, at: at(3), changes: [{ field: "newer.value", from: 70, to: 100 }] });

    workspace = updateClaimDraft(workspace, "profit-growth", { kind: "growth-percent", value: 45 }, at(4));
    workspace = updateClaimDraft(workspace, "revenue-growth", { kind: "value", point: "newer", value: 130 }, at(5));
    expect(workspace.events.map(({ claimId, changes }) => [claimId, changes[0].field])).toEqual([
      ["profit-growth", "newer.value"],
      ["profit-growth", "claimedGrowthPercent"],
      ["revenue-growth", "newer.value"],
    ]);

    workspace = completeClaimReview(workspace, "revenue-growth", calculate(workspace, "revenue-growth"), at(6));
    workspace = updateClaimDraft(workspace, "revenue-growth", { kind: "value", point: "newer", value: 120 }, at(7));
    expect(workspace.events.map(({ action }) => action)).toEqual(["correct", "correct", "correct", "confirm", "correct"]);
  });

  it("记录里能看到结论随更正变化，重置后回到最初载入的观察值", () => {
    let workspace = createClaimWorkspace(sample.observation);
    workspace = completeClaimReview(workspace, "revenue-growth", calculate(workspace, "revenue-growth"), at(1));
    workspace = updateClaimDraft(workspace, "revenue-growth", { kind: "growth-percent", value: 30 }, at(2));
    workspace = completeClaimReview(workspace, "revenue-growth", calculate(workspace, "revenue-growth"), at(3));

    expect(workspace.events.map(({ action, result }) => [action, result?.status ?? null])).toEqual([
      ["confirm", "consistent"],
      ["correct", null],
      ["confirm", "contradictory"],
    ]);

    const profitBefore = workspace.claims[1];
    workspace = resetClaimWorkspace(workspace);

    expect(workspace.events).toEqual([]);
    const [revenue, profit] = workspace.claims;
    expect(revenue.draftValues.claimedGrowthPercent).toBe(25);
    expect(revenue.draftValues.older).toMatchObject({ value: 80, unit: "万元", valueSource: "preset" });
    expect(revenue.draftValues.newer).toMatchObject({ value: 100, unit: "万元", valueSource: "preset" });
    expect(revenue.confirmationState).toBe("pending");
    expect(revenue.confirmedValues).toBeNull();
    expect(revenue.result).toBeNull();
    expect(revenue.observation.claimText).toBe("营业收入增长 25%");
    expect(profit).toEqual(profitBefore);
    expect(profit.draftValues.newer.value).toBe(70);
  });

  it("输入没有真正改变数值时不记录，也不清掉已有结论", () => {
    let workspace = createClaimWorkspace(sample.observation);
    workspace = completeClaimReview(workspace, "revenue-growth", calculate(workspace, "revenue-growth"), at(1));
    const confirmed = workspace.claims[0];

    workspace = updateClaimDraft(workspace, "revenue-growth", { kind: "value", point: "older", value: 80 }, at(2));
    workspace = updateClaimDraft(workspace, "revenue-growth", { kind: "growth-percent", value: 25 }, at(3));
    workspace = updateClaimDraft(workspace, "revenue-growth", { kind: "unit", point: "older", value: "万元" }, at(4));
    workspace = updateClaimDraft(workspace, "revenue-growth", { kind: "period", point: "newer", value: "2025 年" }, at(5));

    expect(workspace.claims[0]).toEqual(confirmed);
    expect(workspace.claims[0].draftValues.older.valueSource).toBe("preset");
    expect(workspace.events).toHaveLength(1);
  });

  it("逐字输入又回到原值时不留下没有实际变化的记录", () => {
    let workspace = createClaimWorkspace(sample.observation);
    workspace = updateClaimDraft(workspace, "profit-growth", { kind: "value", point: "newer", value: 8 }, at(1));
    expect(workspace.events).toHaveLength(1);

    workspace = updateClaimDraft(workspace, "profit-growth", { kind: "value", point: "newer", value: 70 }, at(2));
    expect(workspace.events).toEqual([]);
    expect(workspace.claims[1].draftValues.newer.value).toBe(70);
  });

  it("只在结论真的变化时标出此前状态", () => {
    let workspace = createClaimWorkspace(sample.observation);
    workspace = completeClaimReview(workspace, "revenue-growth", calculate(workspace, "revenue-growth"), at(1));
    workspace = updateClaimDraft(workspace, "revenue-growth", { kind: "growth-percent", value: 30 }, at(2));
    workspace = completeClaimReview(workspace, "revenue-growth", calculate(workspace, "revenue-growth"), at(3));

    expect(previousResultStatus(workspace.events, 0)).toBeNull();
    expect(previousResultStatus(workspace.events, 1)).toBeNull();
    expect(previousResultStatus(workspace.events, 2)).toBe("consistent");

    workspace = completeClaimReview(workspace, "revenue-growth", calculate(workspace, "revenue-growth"), at(4));
    expect(workspace.events[3].action).toBe("recompute");
    expect(previousResultStatus(workspace.events, 3)).toBeNull();
  });

  it("比对此前结论时不跨越主张", () => {
    let workspace = createClaimWorkspace(sample.observation);
    workspace = completeClaimReview(workspace, "revenue-growth", calculate(workspace, "revenue-growth"), at(1));
    workspace = updateClaimDraft(workspace, "profit-growth", { kind: "value", point: "newer", value: 100 }, at(2));
    workspace = completeClaimReview(workspace, "profit-growth", calculate(workspace, "profit-growth"), at(3));
    workspace = completeClaimReview(workspace, "revenue-growth", calculate(workspace, "revenue-growth"), at(4));

    expect(workspace.events.map(({ claimId, result }) => [claimId, result?.status ?? null])).toEqual([
      ["revenue-growth", "consistent"],
      ["profit-growth", null],
      ["profit-growth", "contradictory"],
      ["revenue-growth", "consistent"],
    ]);
    expect(previousResultStatus(workspace.events, 3)).toBeNull();
  });
});
