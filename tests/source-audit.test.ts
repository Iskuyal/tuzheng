import { describe, expect, it } from "vitest";
import {
  SOURCE_LIBRARY,
  findSourceDocument,
  sourceFingerprint,
  verifySourceLibrary,
  type SourceDocument,
} from "../shared/source-library.js";
import {
  CLAIM_STATUS_LABELS,
  auditClaimsAgainstSources,
  captionClaimCoverage,
  compareValues,
  basisMentionedInImage,
  evaluateApplicability,
  fillClaimPeriodsFromImage,
  normalizeSourcePeriod,
  searchSourceLibrary,
  traceClaimOrigin,
  validateCitations,
  type CitationRole,
  type SourceClaim,
  type SourceHit,
} from "../shared/source-audit.js";

const CPI_QUERY = {
  metric: "全国居民消费价格",
  period: "2025-12",
  scope: "全国",
  terms: ["同比", "环比"],
};

function hitById(hits: SourceHit[], id: string): SourceHit {
  const hit = hits.find((candidate) => candidate.document.id === id);
  if (!hit) throw new Error(`缺少命中：${id}`);
  return hit;
}

describe("固定官方资料库", () => {
  it("指纹与元数据自洽，且含一条错口径干扰项", () => {
    expect(verifySourceLibrary()).toEqual([]);
    // 三条 CPI 材料（阶段四冻结）+ 两条社会消费品零售总额发布（阶段四 06 的版本修订对）。
    expect(SOURCE_LIBRARY).toHaveLength(5);
    expect(SOURCE_LIBRARY.filter((document) => document.distractor).map(({ id }) => id)).toEqual([
      "stats-cpi-2026-08",
    ]);
  });

  it("阶段四 06 的两条社零发布：逐行月份、修订声明与被修订的发布", () => {
    const earlier = findSourceDocument("stats-retail-2026-07");
    const later = findSourceDocument("stats-retail-2026-08");

    // 多月份发布：basis.period 为空，月份在逐行数值上。
    expect(earlier?.basis).toEqual({ metric: "社会消费品零售总额", period: null, scope: "全国" });
    expect(earlier?.measures.every((measure) => measure.period !== undefined)).toBe(true);
    expect(earlier?.measures.find((measure) => measure.period === "2026-06")).toMatchObject({
      basis: "month-on-month",
      value: 0.35,
    });
    expect(later?.measures.find((measure) => measure.period === "2026-06")).toMatchObject({
      basis: "month-on-month",
      value: 0.4,
    });

    // 修订声明逐字取自 2026-09-15 发布的附注 5，并指向被修订的那份发布。
    expect(later?.revision).toEqual({
      statement: "根据季节调整模型自动修正的结果，对2025年8月份以来的社会消费品零售总额环比增速进行修订。",
      revisedAt: "2026-09-15",
      supersedes: "stats-retail-2026-07",
    });
    expect(earlier?.revision).toBeUndefined();
  });

  it("记录原始链接、发布机构、发布日期与适用口径", () => {
    const release = findSourceDocument("stats-cpi-2025-12");
    expect(release).toMatchObject({
      kind: "data-release",
      publisher: "国家统计局",
      publishedAt: "2026-01-09",
      basis: { metric: "全国居民消费价格", period: "2025-12", scope: "全国" },
      url: "https://www.stats.gov.cn/sj/zxfb/202601/t20260109_1962273.html",
    });
    expect(release?.measures).toEqual([
      { basis: "year-on-year", value: 0.8, unit: "%", excerpt: "2025年12月份，全国居民消费价格同比上涨0.8%。" },
      { basis: "month-on-month", value: 0.2, unit: "%", excerpt: "12月份，全国居民消费价格环比上涨0.2%。" },
    ]);

    const term = findSourceDocument("stats-term-yoy-mom");
    expect(term?.kind).toBe("term-explanation");
    expect(term?.basis.period).toBeNull();
    expect(term?.measures).toEqual([]);

    const distractor = findSourceDocument("stats-cpi-2026-08");
    expect(distractor?.basis.period).toBe("2026-08");
    // 干扰项与适用发布的同比数值相同，只有月份和环比不同。
    expect(distractor?.measures[0].value).toBe(0.8);
    expect(distractor?.measures[1].value).toBe(0.4);
  });

  it("摘录被改动时指纹校验报出问题", () => {
    const tampered: SourceDocument = { ...SOURCE_LIBRARY[0], excerpt: "被改写的摘录" };
    expect(verifySourceLibrary([...SOURCE_LIBRARY.slice(1), tampered])).toContain(
      `资料指纹不匹配：${tampered.id}`,
    );
    expect(tampered.fingerprint).not.toBe(sourceFingerprint({ ...tampered }));
  });
});

describe("口径归一化与适配判定", () => {
  it.each([
    ["2025-12", "2025-12"],
    ["2025 年 12 月", "2025-12"],
    ["2025年12月份", "2025-12"],
    ["2025/12/01", "2025-12"],
    ["2026-08", "2026-08"],
    ["2025 年", null],
    ["2025", null],
    [null, null],
  ])("把 %s 归一为 %s", (input, expected) => {
    expect(normalizeSourcePeriod(input)).toBe(expected);
  });

  it("只有指标、月份与范围都对上的数据发布才能作为数值依据", () => {
    const release = findSourceDocument("stats-cpi-2025-12") as SourceDocument;
    expect(evaluateApplicability(CPI_QUERY, release)).toMatchObject({
      applicableForValue: true,
      applicableForTerm: false,
      mismatchFields: [],
    });

    const wrongMonth = findSourceDocument("stats-cpi-2026-08") as SourceDocument;
    expect(evaluateApplicability(CPI_QUERY, wrongMonth)).toMatchObject({
      applicableForValue: false,
      mismatchFields: ["period"],
    });

    const term = findSourceDocument("stats-term-yoy-mom") as SourceDocument;
    expect(evaluateApplicability(CPI_QUERY, term)).toMatchObject({
      applicableForValue: false,
      applicableForTerm: true,
    });
  });

  it("缺少月份时材料不能被当作数值依据，但术语页不会被排除", () => {
    const release = findSourceDocument("stats-cpi-2025-12") as SourceDocument;
    const term = findSourceDocument("stats-term-yoy-mom") as SourceDocument;
    const withoutPeriod = { ...CPI_QUERY, period: null };

    expect(evaluateApplicability(withoutPeriod, release)).toMatchObject({
      applicableForValue: false,
      missingFields: ["period"],
    });
    expect(evaluateApplicability(withoutPeriod, term).applicableForTerm).toBe(true);
  });
});

describe("固定资料库检索", () => {
  it("按指标与月份排序，月份不符的材料仍返回但排在后面", () => {
    const hits = searchSourceLibrary(CPI_QUERY);

    expect(hits.map((hit) => hit.document.id)).toEqual([
      "stats-cpi-2025-12",
      "stats-cpi-2026-08",
      "stats-term-yoy-mom",
    ]);
    expect(hitById(hits, "stats-cpi-2025-12").applicability.applicableForValue).toBe(true);
    expect(hitById(hits, "stats-cpi-2026-08").matchReasons).toContain("资料适用月份为 2026-08，与查询月份不同");
  });

  it("干扰项换成查询月份时排序随之反转，结果不按案例预先写死", () => {
    const hits = searchSourceLibrary({ ...CPI_QUERY, period: "2026-08" });
    expect(hits[0].document.id).toBe("stats-cpi-2026-08");
    expect(hits[0].applicability.applicableForValue).toBe(true);
    expect(hitById(hits, "stats-cpi-2025-12").applicability.mismatchFields).toEqual(["period"]);
  });

  it("不按主张数值或比较方式过滤纠错材料", () => {
    // 主张写环比 0.8%，材料记载环比 0.2%：必须仍然命中并可用于核验。
    const hits = searchSourceLibrary({ ...CPI_QUERY, terms: ["环比", "上涨"] });
    const release = hitById(hits, "stats-cpi-2025-12");
    expect(release.applicability.applicableForValue).toBe(true);
    expect(release.document.measures[1]).toMatchObject({ basis: "month-on-month", value: 0.2 });
  });

  it("资料库里没有的指标不会凭空命中", () => {
    expect(searchSourceLibrary({ metric: "营业收入", period: "2025-12", scope: "全国门店", terms: [] })).toEqual([]);
  });
});

describe("引用校验", () => {
  const hits = searchSourceLibrary(CPI_QUERY);

  it("口径适配的数据发布可以作为数值依据", () => {
    const result = validateCitations([{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }], hits);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it("引用不存在的资料或把术语页当数值依据都会被拒绝", () => {
    const citations: Array<{ sourceId: string; role: CitationRole; note: string | null }> = [
      { sourceId: "stats-not-in-library", role: "value-basis", note: null },
      { sourceId: "stats-cpi-2026-08", role: "value-basis", note: null },
      { sourceId: "stats-term-yoy-mom", role: "value-basis", note: null },
      { sourceId: "stats-term-yoy-mom", role: "term-explanation", note: null },
    ];
    const result = validateCitations(citations, hits);

    expect(result.accepted.map((citation) => [citation.sourceId, citation.role])).toEqual([
      ["stats-cpi-2026-08", "value-basis"],
      ["stats-term-yoy-mom", "term-explanation"],
    ]);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0].reason).toContain("不在本次检索命中内");
    expect(result.rejected[1].reason).toContain("术语解释页");
  });

  it("命中内的资料与主张口径不符时仍被拒绝并说明原因", () => {
    const outcome = auditClaimsAgainstSources({
      claims: [{
        claimText: "比上月上涨 0.8%",
        metric: "全国居民消费价格",
        scope: "全国",
        period: "2025-12",
        value: 0.8,
        basis: "month-on-month",
        kind: "direct",
        fromImage: false,
      }],
      citations: [{ sourceId: "stats-cpi-2026-08", role: "value-basis", note: null }],
      hits,
    });

    expect(outcome.acceptedCitations).toEqual([]);
    expect(outcome.conclusions[0].status).toBe("source-pending");
    expect(outcome.citationsRejected[0].reason).toContain("口径不一致");
    expect(outcome.citationsRejected[0].reason).toContain("月份");
  });

  it("数据发布不能当作术语解释引用", () => {
    const result = validateCitations(
      [{ sourceId: "stats-cpi-2025-12", role: "term-explanation", note: null }],
      hits,
    );
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].reason).toContain("术语定义");
  });
});

describe("主张的来源结论", () => {
  const hits = searchSourceLibrary(CPI_QUERY);
  const releaseCitation = [{ sourceId: "stats-cpi-2025-12", role: "value-basis" as const, note: null }];

  it("图上没有写比较方式时保持「来源待核对」，即使数值与来源相同", () => {
    const outcome = auditClaimsAgainstSources({
      claims: [{
        claimText: "2025 年 12 月全国 CPI 上涨 0.8%",
        metric: "全国居民消费价格",
        scope: "全国",
        period: "2025-12",
        value: 0.8,
        basis: null,
        kind: "direct",
        fromImage: true,
      }],
      citations: releaseCitation,
      hits,
    });

    const [conclusion] = outcome.conclusions;
    expect(conclusion.status).toBe("source-pending");
    expect(CLAIM_STATUS_LABELS[conclusion.status]).toBe("来源待核对");
    expect(conclusion.summary).toContain("没有写明比较方式");
    expect(conclusion.officialValue).toBeNull();
    expect(conclusion.unresolved.join("")).toContain("比较方式");
  });

  it("配文把 0.8% 说成环比时与官方发布的环比 0.2% 不一致", () => {
    const outcome = auditClaimsAgainstSources({
      claims: [{
        claimText: "比上月上涨 0.8%",
        metric: "全国居民消费价格",
        scope: "全国",
        period: "2025-12",
        value: 0.8,
        basis: "month-on-month",
        kind: "direct",
        fromImage: false,
      }],
      citations: releaseCitation,
      hits,
    });

    const [conclusion] = outcome.conclusions;
    expect(conclusion.status).toBe("source-mismatch");
    expect(conclusion.officialValue).toBe(0.2);
    expect(conclusion.difference).toBe(0.6);
    expect(conclusion.summary).toContain("与所引国家统计局发布");
    expect(conclusion.summary).toContain("不一致");
    // 措辞限定在与所引发布不一致，不宣称证明现实数据或作者动机。
    expect(conclusion.summary).not.toMatch(/造假|动机|虚假|假的/);
    expect(conclusion.reasons[0]).toContain("依据原句：12月份，全国居民消费价格环比上涨0.2%。");
  });

  it("数值与口径都相符时标为与来源一致", () => {
    const outcome = auditClaimsAgainstSources({
      claims: [{
        claimText: "比上月上涨 0.2%",
        metric: "全国居民消费价格",
        scope: "全国",
        period: "2025-12",
        value: 0.2,
        basis: "month-on-month",
        kind: "direct",
        fromImage: false,
      }],
      citations: releaseCitation,
      hits,
    });
    expect(outcome.conclusions[0].status).toBe("source-match");
    expect(outcome.conclusions[0].difference).toBe(0);
  });

  it("引用错月份材料时降级为「来源待核对」并给出排除原因", () => {
    const outcome = auditClaimsAgainstSources({
      claims: [{
        claimText: "比上月上涨 0.8%",
        metric: "全国居民消费价格",
        scope: "全国",
        period: "2025-12",
        value: 0.8,
        basis: "month-on-month",
        kind: "direct",
        fromImage: false,
      }],
      citations: [{ sourceId: "stats-cpi-2026-08", role: "value-basis", note: null }],
      hits,
    });

    expect(outcome.conclusions[0].status).toBe("source-pending");
    expect(outcome.citationsRejected[0].reason).toContain("口径不一致");
    expect(outcome.excluded.map((entry) => entry.sourceId)).toEqual(["stats-cpi-2026-08", "stats-term-yoy-mom"]);
    expect(outcome.excluded[0].reason).toContain("月份");
    expect(outcome.excluded[1].reason).toContain("术语解释页");
  });

  it("没有引用时保持待核对并采用模型给出的无适用来源原因", () => {
    const outcome = auditClaimsAgainstSources({
      claims: [{
        claimText: "比上月上涨 0.8%",
        metric: null,
        scope: null,
        period: null,
        value: 0.8,
        basis: "month-on-month",
        kind: "direct",
        fromImage: false,
      }],
      citations: [],
      hits: [],
      noApplicableSourceReason: "资料库没有覆盖该指标。",
    });
    expect(outcome.conclusions[0].status).toBe("source-pending");
    expect(outcome.conclusions[0].reasons).toEqual(["资料库没有覆盖该指标。"]);
  });

  it("引用与主张自己的月份不符时降级，而不是按检索查询的口径放行", () => {
    // 检索用的是图上写的 2025-12，主张写的是 2026-05：查询层面适配，主张层面不适配。
    const monthClaim = {
      claimText: "2026 年 5 月全国 CPI 比上月上涨 0.2%",
      metric: "全国居民消费价格",
      scope: "全国",
      period: "2026-05",
      value: 0.2,
      basis: "month-on-month" as const,
      kind: "direct" as const,
      fromImage: false,
    };
    const outcome = auditClaimsAgainstSources({
      claims: [monthClaim],
      citations: releaseCitation,
      hits,
    });

    expect(outcome.acceptedCitations).toEqual([]);
    expect(outcome.conclusions[0].status).toBe("source-pending");
    expect(outcome.conclusions[0].officialValue).toBeNull();
    expect(outcome.citationsRejected[0].reason).toContain("口径不一致");
    expect(outcome.citationsRejected[0].reason).toContain("月份");
  });

  it("同一份资料对一条主张成立、对另一条不成立时，只降级不成立的那条", () => {
    // 模型按图上月份检索到 2025-12 发布，同时汇报配文里写的 2026-08 主张并引用 2026-08 发布。
    const hitsForBoth = searchSourceLibrary({ metric: "全国居民消费价格", period: "2025-12", scope: "全国", terms: [] });
    const outcome = auditClaimsAgainstSources({
      claims: [
        {
          claimText: "2025 年 12 月全国 CPI 上涨 0.8%",
          metric: "全国居民消费价格",
          scope: "全国",
          period: "2025-12",
          value: 0.8,
          basis: null,
          kind: "direct",
          fromImage: true,
          imageExcerpt: "2025 年 12 月全国 CPI 上涨 0.8%",
        },
        {
          claimText: "2026 年 8 月全国 CPI 比上月上涨 0.8%",
          metric: "全国居民消费价格",
          scope: "全国",
          period: "2026-08",
          value: 0.8,
          basis: "month-on-month",
          kind: "direct",
          fromImage: false,
        },
      ],
      citations: [
        { sourceId: "stats-cpi-2025-12", role: "value-basis", note: null },
        { sourceId: "stats-cpi-2026-08", role: "value-basis", note: null },
      ],
      hits: hitsForBoth,
    });

    // 图内主张缺比较方式 → 待核对；配文主张按 2026-08 发布核对 → 与来源不一致（环比 0.4%）。
    expect(outcome.conclusions.map((conclusion) => conclusion.status)).toEqual([
      "source-pending",
      "source-mismatch",
    ]);
    expect(outcome.conclusions[1].officialValue).toBe(0.4);
    expect(outcome.citationsRejected).toEqual([]);
    expect(outcome.acceptedCitations.map((citation) => citation.sourceId).sort()).toEqual([
      "stats-cpi-2025-12",
      "stats-cpi-2026-08",
    ]);
  });

  it("主张漏填指标或范围时不会因此得到来源一致", () => {
    for (const claim of [
      { metric: null, scope: "全国" },
      { metric: "全国居民消费价格", scope: "全国城市" },
    ]) {
      const outcome = auditClaimsAgainstSources({
        claims: [{
          claimText: "比上月上涨 0.2%",
          period: "2025-12",
          value: 0.2,
          basis: "month-on-month",
          kind: "direct",
          fromImage: false,
          ...claim,
        }],
        citations: releaseCitation,
        hits,
      });
      expect(outcome.conclusions[0].status).toBe("source-pending");
      expect(outcome.conclusions[0].difference).toBeNull();
    }
  });
});

describe("图内比较方式的核对", () => {
  const hits = searchSourceLibrary(CPI_QUERY);
  const releaseCitation = [{ sourceId: "stats-cpi-2025-12", role: "value-basis" as const, note: null }];

  it.each([
    ["全国 CPI 同比上涨 0.8%", "year-on-year", true],
    ["CPI 比上年同期上涨 0.8%", "year-on-year", true],
    ["CPI 环比上涨 0.8%", "month-on-month", true],
    ["CPI 比上月上涨 0.8%", "month-on-month", true],
    ["2025 年 12 月全国 CPI 上涨 0.8%", "year-on-year", false],
    ["2025 年 12 月全国 CPI 上涨 0.8%", "month-on-month", false],
    [null, "year-on-year", false],
  ] as const)("抄录「%s」能否支持 %s：%s", (excerpt, basis, expected) => {
    expect(basisMentionedInImage(excerpt, basis)).toBe(expected);
  });

  it("图上抄录没有写比较方式时，不能给它补一个基准去和来源对照", () => {
    const outcome = auditClaimsAgainstSources({
      claims: [{
        claimText: "2025 年 12 月全国 CPI 上涨 0.8%",
        metric: "全国居民消费价格",
        scope: "全国",
        period: "2025-12",
        value: 0.8,
        basis: "year-on-year",
        kind: "direct",
        fromImage: true,
        imageExcerpt: "2025 年 12 月全国 CPI 上涨 0.8%",
      }],
      citations: releaseCitation,
      hits,
    });

    const [conclusion] = outcome.conclusions;
    // 官方同比也是 0.8%，如果直接采用就会给出不该有的「与来源一致」。
    expect(conclusion.status).toBe("source-pending");
    expect(conclusion.officialValue).toBeNull();
    expect(conclusion.summary).toContain("没有写出同比");
    expect(conclusion.reasons[0]).toContain("没有同比的说法");
    expect(conclusion.unresolved.join("")).toContain("需要确认");
  });

  it("图上抄录确实写了比较方式时按该口径对照", () => {
    const outcome = auditClaimsAgainstSources({
      claims: [{
        claimText: "全国 CPI 同比上涨 0.8%",
        metric: "全国居民消费价格",
        scope: "全国",
        period: "2025-12",
        value: 0.8,
        basis: "year-on-year",
        kind: "direct",
        fromImage: true,
        imageExcerpt: "全国 CPI 同比上涨 0.8%",
      }],
      citations: releaseCitation,
      hits,
    });
    expect(outcome.conclusions[0].status).toBe("source-match");
    expect(outcome.conclusions[0].officialValue).toBe(0.8);
  });

  it("来自图上却没有给出抄录时同样降级", () => {
    const outcome = auditClaimsAgainstSources({
      claims: [{
        claimText: "这里说环比 0.8%",
        metric: "全国居民消费价格",
        scope: "全国",
        period: "2025-12",
        value: 0.8,
        basis: "month-on-month",
        kind: "direct",
        fromImage: true,
        imageExcerpt: null,
      }],
      citations: releaseCitation,
      hits,
    });
    expect(outcome.conclusions[0].status).toBe("source-pending");
    expect(outcome.conclusions[0].reasons[0]).toContain("没有提供图上抄录");
  });
});

describe("确定性数值比较", () => {
  it("只做相等与差异计算", () => {
    expect(compareValues(0.8, 0.2, "%")).toEqual({
      equal: false,
      difference: 0.6,
      summary: "两个数值相差 0.6%（0.8% 与 0.2%）。",
    });
    expect(compareValues(0.8, 0.8, "%").equal).toBe(true);
  });
});

describe("主张原文的追溯", () => {
  const imageClaim: SourceClaim = {
    claimText: "2025 年 12 月全国 CPI 同比上涨 0.8%",
    metric: "全国居民消费价格",
    scope: "全国",
    period: "2025-12",
    value: 0.8,
    basis: "year-on-year",
    kind: "direct",
    fromImage: true,
    imageExcerpt: "2025 年 12 月全国 CPI 同比上涨 0.8%",
  };

  it("配文里逐字出现的主张可追溯，并给出对应的原文片段", () => {
    const trace = traceClaimOrigin(
      { claimText: "比上月上涨 0.8%", fromImage: false, imageExcerpt: null },
      { caption: "12 月 CPI 比上月上涨 0.8%。", imageClaims: [imageClaim] },
    );
    expect(trace.traceable).toBe(true);
    expect(trace.coverage).toBe(1);
    expect(trace.matchedRun).toContain("比上月上涨");
    expect(trace.note).toBeNull();
  });

  it("模型把检索到的官方原句当成配文主张时判为不可追溯", () => {
    const trace = traceClaimOrigin(
      { claimText: "2025年12月份，全国居民消费价格同比上涨0.8%。", fromImage: false, imageExcerpt: null },
      { caption: "比上月上涨 0.8%。", imageClaims: [imageClaim] },
    );
    expect(trace.traceable).toBe(false);
    expect(trace.note).toContain("不是配文里的句子");
  });

  it("配文主张换了数字时，即使文字重合也判为不可追溯", () => {
    const trace = traceClaimOrigin(
      { claimText: "12 月 CPI 环比上涨 0.2%。", fromImage: false, imageExcerpt: null },
      { caption: "12 月 CPI 同比上涨 0.8%。", imageClaims: [imageClaim] },
    );
    // 文字重合度够，但 0.2 既不在配文里也不在图上。
    expect(trace.coverage).toBeGreaterThanOrEqual(0.3);
    expect(trace.traceable).toBe(false);
    expect(trace.note).toContain("都没有的数字");
  });

  it("配文主张没有配文原文时判为不可追溯", () => {
    const trace = traceClaimOrigin({ claimText: "比上月上涨 0.8%", fromImage: false, imageExcerpt: null }, {});
    expect(trace.traceable).toBe(false);
    expect(trace.note).toContain("没有配文原文");
  });

  it("不可追溯的配文主张不给出来源结论，即使引用的是口径正确的发布", () => {
    const hits = searchSourceLibrary(CPI_QUERY);
    const outcome = auditClaimsAgainstSources({
      claims: [{
        claimText: "2025年12月份，全国居民消费价格同比上涨0.8%。",
        metric: "全国居民消费价格",
        scope: "全国",
        period: "2025-12",
        value: 0.8,
        basis: "year-on-year",
        kind: "direct",
        fromImage: false,
      }],
      citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
      hits,
      caption: "12 月 CPI 同比上涨 0.8%。",
    });

    expect(outcome.conclusions[0].status).toBe("source-pending");
    expect(outcome.conclusions[0].summary).toContain("配文原文里找不到");
    expect(outcome.conclusions[0].origin.traceable).toBe(false);
    expect(outcome.conclusions[0].difference).toBeNull();
  });
});

describe("配文月份按图补全", () => {
  const imageClaim = (period: string): SourceClaim => ({
    claimText: `图上写 ${period}`,
    metric: "全国居民消费价格",
    scope: "全国",
    period,
    value: 0.8,
    basis: "year-on-year",
    kind: "direct",
    fromImage: true,
    imageExcerpt: `图上写 ${period}`,
  });

  it("配文只写月份时按图上标注补全年份", () => {
    const result = fillClaimPeriodsFromImage([
      imageClaim("2025-12"),
      { claimText: "12 月 CPI 同比上涨 0.8%", metric: "全国居民消费价格", scope: "全国", period: "12 月", value: 0.8, basis: "year-on-year", kind: "direct", fromImage: false },
    ]);
    expect(result.claims[1].period).toBe("2025-12");
    expect(result.notes[0]).toBeNull();
    expect(result.notes[1]).toContain("按图上标注的 2025-12 补全");
  });

  it("图上没有年份或出现多个年份时不猜，并说明原因", () => {
    const noYear = fillClaimPeriodsFromImage([
      imageClaim("12 月"),
      { claimText: "12 月 CPI 上涨 0.8%", metric: null, scope: null, period: "12 月", value: 0.8, basis: null, kind: "direct", fromImage: false },
    ]);
    expect(noYear.claims[1].period).toBe("12 月");
    expect(noYear.notes[1]).toContain("图上没有可用的年份");

    const twoYears = fillClaimPeriodsFromImage([
      imageClaim("2025-12"),
      imageClaim("2026-12"),
      { claimText: "12 月 CPI 上涨 0.8%", metric: null, scope: null, period: "12 月", value: 0.8, basis: null, kind: "direct", fromImage: false },
    ]);
    expect(twoYears.claims[2].period).toBe("12 月");
    expect(twoYears.notes[2]).toContain("多个年份");
  });

  it("补全后的月份能让结论落到具体发布，而不是退回待核对", () => {
    const { claims, notes } = fillClaimPeriodsFromImage([
      imageClaim("2025-12"),
      { claimText: "比上月上涨 0.8%", metric: "全国居民消费价格", scope: "全国", period: "12 月", value: 0.8, basis: "month-on-month", kind: "direct", fromImage: false },
    ]);
    const outcome = auditClaimsAgainstSources({
      claims,
      citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
      hits: searchSourceLibrary(CPI_QUERY),
      caption: "比上月上涨 0.8%",
      periodNotes: notes,
    });
    expect(outcome.conclusions[1].status).toBe("source-mismatch");
    expect(outcome.conclusions[1].periodNote).toContain("年份按图上标注的 2025-12 补全");
  });
});

describe("推断缺口", () => {
  const hits = searchSourceLibrary(CPI_QUERY);
  const releaseCitation = [{ sourceId: "stats-cpi-2025-12", role: "value-basis" as const, note: null }];

  const inferenceClaim = (overrides: Partial<SourceClaim> = {}): SourceClaim => ({
    claimText: "12 月 CPI 比上月便宜",
    metric: "全国居民消费价格",
    scope: "全国",
    period: "2025-12",
    value: null,
    basis: "month-on-month",
    kind: "inference",
    direction: "down",
    fromImage: false,
    imageExcerpt: null,
    ...overrides,
  });

  it("有适用环比来源时按方向改判：与发布相反即为来源不一致", () => {
    const outcome = auditClaimsAgainstSources({
      claims: [inferenceClaim()],
      citations: releaseCitation,
      hits,
      caption: "12 月 CPI 比上月便宜",
    });

    const [conclusion] = outcome.conclusions;
    expect(conclusion.status).toBe("source-mismatch");
    expect(conclusion.parts.map((part) => [part.label, part.status])).toEqual([["推断结论", "contradicted"]]);
    expect(conclusion.officialValue).toBe(0.2);
    expect(conclusion.summary).toContain("环比 0.2%");
    expect(conclusion.summary).toContain("与这条推断断言的「下降」相反");
    // 数字对不上不等于造假，措辞不越界。
    expect(conclusion.summary).not.toMatch(/造假|动机|虚假/);
  });

  it("方向与发布一致时标为来源支持", () => {
    const outcome = auditClaimsAgainstSources({
      claims: [inferenceClaim({ claimText: "12 月 CPI 比上月上涨", direction: "up" })],
      citations: releaseCitation,
      hits,
      caption: "12 月 CPI 比上月上涨",
    });
    expect(outcome.conclusions[0].status).toBe("source-match");
    expect(outcome.conclusions[0].parts[0].status).toBe("supported");
    expect(outcome.conclusions[0].summary).toContain("支持这条推断");
  });

  it("没有适用环比来源时判为推断依据不足，并说明缺哪一项", () => {
    const outcome = auditClaimsAgainstSources({
      claims: [inferenceClaim({ period: "2026-07", claimText: "7 月 CPI 比上月便宜" })],
      citations: [],
      hits: searchSourceLibrary({ metric: "全国居民消费价格", period: "2026-07", scope: "全国", terms: [] }),
      caption: "7 月 CPI 比上月便宜",
      noApplicableSourceReason: "资料库没有 2026 年 7 月的发布。",
    });

    const [conclusion] = outcome.conclusions;
    expect(conclusion.status).toBe("inference-unsupported");
    expect(CLAIM_STATUS_LABELS[conclusion.status]).toBe("推断依据不足");
    expect(conclusion.parts).toEqual([
      { label: "推断结论", status: "insufficient", detail: expect.stringContaining("没有可用于这条推断的适用来源"), sourceId: null },
    ]);
    expect(conclusion.unresolved.join("")).toContain("2026-07");
    expect(conclusion.unresolved.join("")).toContain("环比");
    expect(conclusion.summary).toContain("不代表结论为假");
    expect(conclusion.officialValue).toBeNull();
  });

  it("数字正确但缺少推断所依赖的口径时，整句仍给依据不足", () => {
    const outcome = auditClaimsAgainstSources({
      claims: [inferenceClaim({
        claimText: "12 月 CPI 同比上涨 0.8%，所以比上月便宜",
        value: 0.8,
        basis: "month-on-month",
        direction: "down",
      })],
      citations: [{ sourceId: "stats-cpi-2026-08", role: "value-basis", note: null }],
      hits,
      caption: "12 月 CPI 同比上涨 0.8%，所以比上月便宜",
    });
    // 引用的发布月份与主张不符：数值无法核对，整句保持依据不足而不是「一致」。
    expect(outcome.conclusions[0].status).toBe("inference-unsupported");
    expect(outcome.conclusions[0].difference).toBeNull();
  });

  it("推断没有写明比较方式时不给猜测结论，但仍要求它给出数值或方向", () => {
    // 有方向、缺比较方式 → 依据不足，并说明缺的是比较方式。
    const noBasis = auditClaimsAgainstSources({
      claims: [inferenceClaim({ basis: null, claimText: "12 月 CPI 比上月便宜" })],
      citations: releaseCitation,
      hits,
      caption: "12 月 CPI 比上月便宜",
    });
    expect(noBasis.conclusions[0].status).toBe("inference-unsupported");
    expect(noBasis.conclusions[0].summary).toContain("没有写明它依赖的比较方式");

    // 既没有数值也没有方向（例如术语类主张）→ 不替它下「依据不足」，退回来源待核对。
    const noAnchor = auditClaimsAgainstSources({
      claims: [inferenceClaim({ basis: null, direction: null, claimText: "12 月 CPI 环比是跟上年同期比出来的" })],
      citations: releaseCitation,
      hits,
      caption: "12 月 CPI 环比是跟上年同期比出来的",
    });
    expect(noAnchor.conclusions[0].status).toBe("source-pending");
    expect(noAnchor.conclusions[0].summary).toContain("没有给出数值，也没有写明价格涨跌方向");
    expect(noAnchor.conclusions[0].parts[0].status).toBe("insufficient");
  });
});

describe("观点不做真假判定", () => {
  it("观点标为不支持核验，不套用数值结论也不判假", () => {
    const hits = searchSourceLibrary(CPI_QUERY);
    const outcome = auditClaimsAgainstSources({
      claims: [{
        claimText: "CPI 涨幅回落说明政策效果显现",
        metric: "全国居民消费价格",
        scope: "全国",
        period: "2025-12",
        value: null,
        basis: null,
        kind: "opinion",
        fromImage: false,
        imageExcerpt: null,
      }],
      citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
      hits,
      caption: "CPI 涨幅回落说明政策效果显现",
    });

    const [conclusion] = outcome.conclusions;
    expect(conclusion.status).toBe("not-verifiable");
    expect(CLAIM_STATUS_LABELS[conclusion.status]).toBe("不支持核验");
    expect(conclusion.summary).toContain("不对它做真假定论");
    expect(conclusion.officialValue).toBeNull();
    expect(conclusion.difference).toBeNull();
    expect(conclusion.summary).not.toMatch(/造假|动机|虚假|错误/);
    expect(conclusion.parts[0].label).toBe("可核验性");
  });
});

describe("配文覆盖度", () => {
  const caption = "8 月 CPI 同比上涨 0.8%，比上月上涨 0.4%。涨幅比 7 月回落。物价压力有所缓解。";
  const claim = (claimText: string): SourceClaim => ({
    claimText,
    metric: "全国居民消费价格",
    scope: "全国",
    period: "2026-08",
    value: null,
    basis: null,
    kind: "direct",
    fromImage: false,
    imageExcerpt: null,
  });

  it("主张覆盖了配文时给出高覆盖度", () => {
    const coverage = captionClaimCoverage([claim(caption)], caption);
    expect(coverage.coverage).toBeGreaterThan(0.9);
    expect(coverage.uncovered).toBeNull();
  });

  it("逐句展开的配文覆盖度按每句在配文里的位置累加，不误报漏项", () => {
    const splitCaption = "2026 年 8 月 CPI 同比上涨 0.8%。8 月 CPI 比上月上涨 0.4%。7 月 CPI 比上月便宜。物价压力缓解。";
    const coverage = captionClaimCoverage([
      claim("2026 年 8 月 CPI 同比上涨 0.8%。"),
      claim("8 月 CPI 比上月上涨 0.4%。"),
      claim("7 月 CPI 比上月便宜。"),
      claim("物价压力缓解。"),
    ], splitCaption);
    expect(coverage.coverage).toBeGreaterThan(0.9);
    expect(coverage.uncovered).toBeNull();
  });

  it("配文里没有被任何主张覆盖的一段会被指出", () => {
    const coverage = captionClaimCoverage([claim("8 月 CPI 同比上涨 0.8%")], caption);
    expect(coverage.coverage).toBeLessThan(0.6);
    expect(coverage.uncovered).toContain("物价压力");
  });

  it("没有任何配文主张时覆盖度为零", () => {
    const coverage = captionClaimCoverage([], caption);
    expect(coverage.coverage).toBe(0);
    // 未覆盖段是归一化后的配文全文（去空白与标点）。
    expect(coverage.uncovered).toContain("物价压力有所缓解");
    expect(coverage.uncovered?.length).toBeGreaterThan(20);
  });
});

describe("版本修订与版本替代（阶段四 06）", () => {
  const RETAIL_QUERY = {
    metric: "社会消费品零售总额",
    period: "2026-06",
    scope: "全国",
    terms: ["环比"],
  };

  function retailClaim(overrides: Partial<SourceClaim>): SourceClaim {
    return {
      claimText: "2026 年 6 月社会消费品零售总额环比增长 0.35%",
      metric: "社会消费品零售总额",
      scope: "全国",
      period: "2026-06",
      value: 0.35,
      basis: "month-on-month",
      kind: "direct",
      fromImage: false,
      ...overrides,
    };
  }

  it("多月份发布按逐行月份判定口径，模型可以检索到，且不会污染别的指标", () => {
    const hits = searchSourceLibrary(RETAIL_QUERY);
    expect(hits.map((hit) => hit.document.id)).toEqual([
      "stats-retail-2026-07",
      "stats-retail-2026-08",
      "stats-term-yoy-mom",
    ]);
    expect(hitById(hits, "stats-retail-2026-07").applicability.applicableForValue).toBe(true);
    expect(hitById(hits, "stats-retail-2026-07").matchReasons).toContain("资料在该月份有记载（2026-06）");

    // 阶段四已冻结的 CPI 检索结果不受新指标影响。
    expect(searchSourceLibrary(CPI_QUERY).map((hit) => hit.document.id)).toEqual([
      "stats-cpi-2025-12",
      "stats-cpi-2026-08",
      "stats-term-yoy-mom",
    ]);
    // 社零发布也不能给 CPI 主张当数值依据，反之亦然。
    expect(
      evaluateApplicability(CPI_QUERY, findSourceDocument("stats-retail-2026-07") as SourceDocument).applicableForValue,
    ).toBe(false);
    expect(
      evaluateApplicability(RETAIL_QUERY, findSourceDocument("stats-cpi-2025-12") as SourceDocument).applicableForValue,
    ).toBe(false);
  });

  it("引用被修订的发布时用修订后的值对照，并留下前后记录", () => {
    const hits = searchSourceLibrary(RETAIL_QUERY);
    const outcome = auditClaimsAgainstSources({
      claims: [retailClaim({})],
      citations: [{ sourceId: "stats-retail-2026-07", role: "value-basis", note: null }],
      hits,
    });

    const conclusion = outcome.conclusions[0];
    expect(conclusion.status).toBe("source-mismatch");
    expect(conclusion.officialValue).toBe(0.4);
    expect(conclusion.difference).toBe(0.05);
    expect(conclusion.revisionReview).toMatchObject({
      fromSourceId: "stats-retail-2026-07",
      fromValue: 0.35,
      toSourceId: "stats-retail-2026-08",
      toValue: 0.4,
      revisedAt: "2026-09-15",
    });
    expect(conclusion.revisionReview?.statement).toContain("季节调整模型自动修正");
    expect(conclusion.summary).toContain("版本复查");
    expect(conclusion.summary).toContain("修订为 0.4%");
    expect(conclusion.reasons.join(" ")).toContain("修订声明");
  });

  it("写修订后的值时判为一致，并说明按修订后值对照", () => {
    const hits = searchSourceLibrary(RETAIL_QUERY);
    const outcome = auditClaimsAgainstSources({
      claims: [retailClaim({ value: 0.4, claimText: "2026 年 6 月社会消费品零售总额环比增长 0.40%" })],
      citations: [{ sourceId: "stats-retail-2026-07", role: "value-basis", note: null }],
      hits,
    });

    const conclusion = outcome.conclusions[0];
    expect(conclusion.status).toBe("source-match");
    expect(conclusion.officialValue).toBe(0.4);
    expect(conclusion.revisionReview).toMatchObject({ fromValue: 0.35, toValue: 0.4 });
    expect(conclusion.summary).toContain("版本复查");
  });

  it("直接引用修订后的发布时没有可替代的旧值，不产生修订记录", () => {
    const hits = searchSourceLibrary(RETAIL_QUERY);
    const outcome = auditClaimsAgainstSources({
      claims: [retailClaim({ value: 0.4, claimText: "2026 年 6 月社会消费品零售总额环比增长 0.40%" })],
      citations: [{ sourceId: "stats-retail-2026-08", role: "value-basis", note: null }],
      hits,
    });

    const conclusion = outcome.conclusions[0];
    expect(conclusion.status).toBe("source-match");
    expect(conclusion.officialValue).toBe(0.4);
    expect(conclusion.revisionReview ?? null).toBeNull();
  });

  it("推断类主张也按修订后的值判方向：旧值 0.35 改成 0.40 后「下降」仍不成立", () => {
    const hits = searchSourceLibrary(RETAIL_QUERY);
    const outcome = auditClaimsAgainstSources({
      claims: [retailClaim({
        claimText: "2026 年 6 月社会消费品零售总额环比下降",
        kind: "inference",
        value: null,
        direction: "down",
      })],
      citations: [{ sourceId: "stats-retail-2026-07", role: "value-basis", note: null }],
      hits,
    });

    const conclusion = outcome.conclusions[0];
    expect(conclusion.status).toBe("source-mismatch");
    expect(conclusion.revisionReview).toMatchObject({ fromValue: 0.35, toValue: 0.4 });
    expect(conclusion.summary).toContain("版本复查");
  });
});

