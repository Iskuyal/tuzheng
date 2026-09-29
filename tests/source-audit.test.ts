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
  compareValues,
  basisMentionedInImage,
  evaluateApplicability,
  normalizeSourcePeriod,
  searchSourceLibrary,
  validateCitations,
  type CitationRole,
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
    expect(SOURCE_LIBRARY).toHaveLength(3);
    expect(SOURCE_LIBRARY.filter((document) => document.distractor).map(({ id }) => id)).toEqual([
      "stats-cpi-2026-08",
    ]);
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

  it("引用不存在的资料、错月份的材料或术语页都会降级并说明原因", () => {
    const citations: Array<{ sourceId: string; role: CitationRole; note: string | null }> = [
      { sourceId: "stats-not-in-library", role: "value-basis", note: null },
      { sourceId: "stats-cpi-2026-08", role: "value-basis", note: null },
      { sourceId: "stats-term-yoy-mom", role: "value-basis", note: null },
      { sourceId: "stats-term-yoy-mom", role: "term-explanation", note: null },
    ];
    const result = validateCitations(citations, hits);

    expect(result.accepted.map((citation) => citation.role)).toEqual(["term-explanation"]);
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected[0].reason).toContain("不在本次检索命中内");
    expect(result.rejected[1].reason).toContain("口径不一致");
    expect(result.rejected[2].reason).toContain("术语解释页");
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
