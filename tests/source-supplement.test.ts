import { describe, expect, it } from "vitest";
import {
  applySupplementToClaims,
  applySupplementToConclusion,
  auditClaimsAgainstSources,
  diffConclusions,
  parseClarificationAnswer,
  type ClaimSourceConclusion,
  type SourceClaim,
  type SourceHit,
} from "../shared/source-audit.js";
import { searchSourceLibrary } from "../shared/source-audit.js";

function claim(overrides: Partial<SourceClaim> = {}): SourceClaim {
  return {
    claimText: "12 月 CPI 上涨 0.8%",
    metric: "全国居民消费价格",
    scope: "全国",
    period: "2025-12",
    value: 0.8,
    basis: null,
    kind: "direct",
    direction: null,
    fromImage: false,
    imageExcerpt: null,
    ...overrides,
  };
}

const CAPTION = "12 月 CPI 上涨 0.8%";

function cpiHits(): SourceHit[] {
  return searchSourceLibrary({ metric: "全国居民消费价格", period: "2025-12", scope: "全国", terms: [] });
}

describe("追问回答的解析", () => {
  it("比较方式接受同比／环比的说法并归一到枚举", () => {
    expect(parseClarificationAnswer("basis", "同比")).toEqual({ ok: true, field: "basis", value: "year-on-year" });
    expect(parseClarificationAnswer("basis", "是环比（比上月）")).toEqual({ ok: true, field: "basis", value: "month-on-month" });
    // 同时出现两种口径时不能猜——猜错会把结论建立在猜测上。
    expect(parseClarificationAnswer("basis", "同比还是环比")).toMatchObject({ ok: false });
  });

  it("月份要能读出完整年月，数值取第一个数，范围与指标取原文", () => {
    expect(parseClarificationAnswer("period", "2026 年 5 月")).toEqual({ ok: true, field: "period", value: "2026-05" });
    expect(parseClarificationAnswer("period", "5 月")).toMatchObject({ ok: false });
    expect(parseClarificationAnswer("value", "0.2%")).toEqual({ ok: true, field: "value", value: "0.2" });
    expect(parseClarificationAnswer("value", "大概")).toMatchObject({ ok: false });
    expect(parseClarificationAnswer("scope", "全国")).toEqual({ ok: true, field: "scope", value: "全国" });
    expect(parseClarificationAnswer("basis", "  ")).toMatchObject({ ok: false });
  });
});

describe("补证按规则应用到主张", () => {
  it("目标主张缺比较方式时，不被另一句的同比阻止补入环比", () => {
    const target = claim({ claimText: "2025 年 12 月全国 CPI 上涨 0.2%", value: 0.2 });
    const other = claim({ claimText: "2026 年 8 月全国 CPI 同比上涨 0.8%", basis: "year-on-year", period: "2026-08" });
    const result = applySupplementToClaims({
      claims: [target, other], priorClaims: [target, other], field: "basis",
      rawAnswer: "环比", normalized: "month-on-month", targetClaimText: target.claimText,
      caption: `${target.claimText}。${other.claimText}。`,
    });
    expect(result.claims[0].basis).toBe("month-on-month");
    expect(result.infos[0]).toMatchObject({ applied: true, conflict: null });
    expect(result.claims[1]).toEqual(other);
    expect(result.infos[1]).toBeNull();
  });

  it("图文没写这个口径时填入，标为用户提供", () => {
    const result = applySupplementToClaims({
      claims: [claim({ basis: null })],
      priorClaims: [claim({ basis: null })],
      field: "basis",
      rawAnswer: "同比",
      normalized: "year-on-year",
      targetClaimText: CAPTION,
    });

    expect(result.claims[0].basis).toBe("year-on-year");
    expect(result.infos[0]).toMatchObject({ applied: true, normalized: "year-on-year", conflict: null });
    expect(result.appliedClaimTexts).toEqual([CAPTION]);
    expect(result.conflicts).toEqual([]);
  });

  it("图文已写且与回答一致时不改值，也不标为填入", () => {
    const result = applySupplementToClaims({
      claims: [claim({ basis: "month-on-month" })],
      priorClaims: [claim({ basis: "month-on-month" })],
      field: "basis",
      rawAnswer: "环比",
      normalized: "month-on-month",
      targetClaimText: CAPTION,
    });

    expect(result.claims[0].basis).toBe("month-on-month");
    expect(result.infos[0]).toMatchObject({ applied: false, conflict: null });
    expect(result.appliedClaimTexts).toEqual([]);
  });

  it("图文已写且与回答冲突时不覆盖，恢复图文值并保留双方", () => {
    const result = applySupplementToClaims({
      claims: [claim({ basis: "month-on-month" })],
      // 恢复段模型可能按回答重报了字段；冲突判定以补证前的读数为准。
      priorClaims: [claim({ basis: "month-on-month" })],
      field: "basis",
      rawAnswer: "同比",
      normalized: "year-on-year",
      targetClaimText: CAPTION,
    });

    expect(result.claims[0].basis).toBe("month-on-month");
    expect(result.infos[0]?.conflict).toEqual({ fromImage: "环比", fromUser: "同比" });
    expect(result.conflicts).toEqual([
      { claimText: CAPTION, field: "basis", fromImage: "环比", fromUser: "同比" },
    ]);
  });

  it("配文写「比上月」而模型没填 basis 时，回答同比也算冲突（依据是配文原文）", () => {
    const caption = "12 月 CPI 比上月上涨 0.2%。";
    const captionClaim = claim({ claimText: "12 月 CPI 比上月上涨 0.2%", basis: null });
    const result = applySupplementToClaims({
      claims: [captionClaim],
      priorClaims: [captionClaim],
      field: "basis",
      rawAnswer: "同比",
      normalized: "year-on-year",
      targetClaimText: captionClaim.claimText,
      caption,
    });

    expect(result.claims[0].basis).toBeNull();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].fromImage).toBe("环比");
  });

  it("追没指出主张、解析失败或匹配不到同一条主张时不应用", () => {
    const noTarget = applySupplementToClaims({
      claims: [claim()],
      priorClaims: [claim()],
      field: "basis",
      rawAnswer: "同比",
      normalized: null,
      targetClaimText: CAPTION,
    });
    expect(noTarget.infos[0]).toBeNull();

    const noClaimText = applySupplementToClaims({
      claims: [claim({ basis: null })],
      priorClaims: [claim({ basis: null })],
      field: "basis",
      rawAnswer: "同比",
      normalized: "year-on-year",
      targetClaimText: null,
    });
    expect(noClaimText.claims[0].basis).toBeNull();
    expect(noClaimText.appliedClaimTexts).toEqual([]);

    // 找不到补证前的同一条主张时无法判断图文写没写，不应用。
    const unmatched = applySupplementToClaims({
      claims: [claim({ claimText: "完全另一句话", basis: null })],
      priorClaims: [claim()],
      field: "basis",
      rawAnswer: "同比",
      normalized: "year-on-year",
      targetClaimText: CAPTION,
    });
    expect(unmatched.claims[0].basis).toBeNull();
  });

  it("补证前读数与回答指向不同月份时按冲突处理", () => {
    const result = applySupplementToClaims({
      claims: [claim({ period: "2026-05" })],
      priorClaims: [claim({ period: "2025-12" })],
      field: "period",
      rawAnswer: "2026 年 5 月",
      normalized: "2026-05",
      targetClaimText: CAPTION,
    });

    expect(result.claims[0].period).toBe("2025-12");
    expect(result.conflicts[0]).toMatchObject({ fromImage: "2025-12", fromUser: "2026-05" });
  });
});

describe("补证叠加到结论", () => {
  const base: ClaimSourceConclusion = {
    claimText: CAPTION,
    claimKind: "direct",
    fromImage: false,
    status: "source-match",
    summary: "与来源一致。",
    basisLabel: null,
    claimValue: 0.8,
    officialValue: 0.8,
    difference: 0,
    citedSourceIds: ["stats-cpi-2025-12"],
    reasons: ["依据原句：…"],
    unresolved: [],
    parts: [],
    origin: {
      fromImage: false,
      originText: CAPTION,
      traceable: true,
      coverage: 1,
      matchedRun: CAPTION,
      note: null,
    },
    periodNote: null,
    supplement: null,
  };

  it("填入口径时在依据里注明来源是用户补充，不改变结论状态", () => {
    const applied = applySupplementToConclusion(base, {
      field: "basis",
      raw: "同比",
      normalized: "year-on-year",
      applied: true,
      conflict: null,
    });

    expect(applied.status).toBe("source-match");
    expect(applied.supplement).toMatchObject({ applied: true });
    expect(applied.reasons.join("")).toContain("由用户补充确定");
    expect(applied.reasons.join("")).toContain("不是官方来源");
  });

  it("冲突时降为来源待核对，双方内容都保留并请求更正", () => {
    const conflicted = applySupplementToConclusion(base, {
      field: "basis",
      raw: "同比",
      normalized: "year-on-year",
      applied: false,
      conflict: { fromImage: "环比", fromUser: "同比" },
    });

    expect(conflicted.status).toBe("source-pending");
    expect(conflicted.summary).toContain("冲突");
    expect(conflicted.summary).toContain("更正");
    expect(conflicted.reasons.join("")).toContain("图上／配文写明：环比");
    expect(conflicted.reasons.join("")).toContain("用户补充：同比");
    expect(conflicted.unresolved.join("")).toContain("更正");
    // 冲突时不给出数值对照结论。
    expect(conflicted.officialValue).toBeNull();
  });

  it("观点不因补证获得真假判定", () => {
    const opinion: ClaimSourceConclusion = {
      ...base,
      claimKind: "opinion",
      status: "not-verifiable",
      summary: "不支持核验。",
      citedSourceIds: [],
    };
    const result = applySupplementToConclusion(opinion, {
      field: "value",
      raw: "0.5",
      normalized: "0.5",
      applied: false,
      conflict: { fromImage: "0.8", fromUser: "0.5" },
    });
    expect(result.status).toBe("not-verifiable");
    expect(result.supplement).not.toBeNull();
  });

  it("无补证的结论原样返回", () => {
    expect(applySupplementToConclusion(base, null)).toBe(base);
  });
});

describe("审计贯通补证", () => {
  it("冲突的主张保持待核对，未补证的主张不受影响", () => {
    const claims = [
      claim({ claimText: "12 月 CPI 比上月上涨 0.2%", basis: "month-on-month", value: 0.2 }),
      claim({ claimText: "12 月 CPI 同比上涨 0.8%", basis: "year-on-year" }),
    ];
    const outcome = auditClaimsAgainstSources({
      claims,
      citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
      hits: cpiHits(),
      caption: "12 月 CPI 比上月上涨 0.2%。12 月 CPI 同比上涨 0.8%。",
      supplements: [
        { field: "basis", raw: "同比", normalized: "year-on-year", applied: false, conflict: { fromImage: "环比", fromUser: "同比" } },
        null,
      ],
    });

    expect(outcome.conclusions[0].status).toBe("source-pending");
    expect(outcome.conclusions[0].summary).toContain("冲突");
    expect(outcome.conclusions[1].status).toBe("source-match");
    expect(outcome.conclusions[1].supplement).toBeNull();
  });
});

describe("补证前后结论对照", () => {
  function conclusion(overrides: Partial<ClaimSourceConclusion> = {}): ClaimSourceConclusion {
    return {
      claimText: "12 月 CPI 上涨 0.8%",
      claimKind: "direct",
      fromImage: false,
      status: "source-pending",
      summary: "",
      basisLabel: null,
      claimValue: 0.8,
      officialValue: null,
      difference: null,
      citedSourceIds: [],
      reasons: [],
      unresolved: [],
      parts: [],
      origin: { fromImage: false, originText: "", traceable: true, coverage: 1, matchedRun: "", note: null },
      periodNote: null,
      supplement: null,
      ...overrides,
    };
  }

  it("配对上的主张给出状态变化与原因", () => {
    const before = [conclusion({ status: "source-pending" })];
    const after = [conclusion({
      status: "source-match",
      supplement: { field: "basis", raw: "同比", normalized: "year-on-year", applied: true, conflict: null },
    })];
    expect(diffConclusions(before, after)).toEqual([
      expect.objectContaining({ before: "source-pending", after: "source-match", changed: true, reason: expect.stringContaining("比较方式") }),
    ]);
  });

  it("恢复后未再汇报的主张单列出行，不静默丢弃", () => {
    const before = [conclusion(), conclusion({ claimText: "另一条主张" })];
    const after = [conclusion()];
    const changes = diffConclusions(before, after);
    expect(changes).toHaveLength(2);
    expect(changes[1]).toMatchObject({
      claimText: "另一条主张",
      before: "source-pending",
      after: null,
      changed: true,
      reason: expect.stringContaining("没有再汇报"),
    });
  });

  it("补证后新增的主张也出行，标明补证前没有对照", () => {
    const before = [conclusion()];
    const after = [conclusion(), conclusion({ claimText: "补证后新拆出的主张" })];
    const changes = diffConclusions(before, after);
    expect(changes).toHaveLength(2);
    expect(changes[1]).toMatchObject({
      before: null,
      after: "source-pending",
      changed: true,
      reason: expect.stringContaining("补证前没有可对照"),
    });
  });
});
