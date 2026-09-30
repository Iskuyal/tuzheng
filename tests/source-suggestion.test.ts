import { describe, expect, it } from "vitest";
import {
  buildCaptionSuggestion,
  captionSuggestionFingerprint,
  locateCaptionSpan,
  searchSourceLibrary,
  validateCaptionChangeText,
  type CaptionChangeContext,
  type ClaimSourceConclusion,
  type ModelCitation,
  type SourceClaim,
  type SourceHit,
} from "../shared/source-audit.js";
import { auditClaimsAgainstSources } from "../shared/source-audit.js";
import { suggestionIndependenceProblems } from "../scripts/evaluate-source-audit.js";
import {
  runSourceInvestigation,
  type SourceInvestigationDriver,
  type ToolLoopCall,
  type ToolLoopReply,
  type ToolResultPayload,
} from "../server/source-investigation.js";
import {
  CLARIFY_TOOL_NAME,
  REPORT_TOOL_NAME,
  SEARCH_TOOL_NAME,
  reportArgumentsSchema,
  toModelFinding,
} from "../server/source-tools.js";

function claim(overrides: Partial<SourceClaim> = {}): SourceClaim {
  return {
    claimText: "12 月 CPI 同比上涨 0.8%。",
    metric: "全国居民消费价格",
    scope: "全国",
    period: "2025-12",
    value: 0.8,
    basis: "year-on-year",
    kind: "direct",
    direction: null,
    fromImage: false,
    imageExcerpt: null,
    ...overrides,
  };
}

const VALUE_CITATIONS: ModelCitation[] = [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }];

function cpiHits(period = "2025-12"): SourceHit[] {
  return searchSourceLibrary({ metric: "全国居民消费价格", period, scope: "全国", terms: [] });
}

/** 用真实的结论组合逻辑造出结论，避免手写结论与程序行为脱节。 */
function auditOf(input: {
  caption: string;
  claims: SourceClaim[];
  citations?: ModelCitation[];
  noApplicableSourceReason?: string | null;
  hits?: SourceHit[];
}) {
  const hits = input.hits ?? cpiHits();
  return auditClaimsAgainstSources({
    claims: input.claims,
    citations: input.citations ?? [],
    hits,
    caption: input.caption,
    noApplicableSourceReason: input.noApplicableSourceReason ?? null,
  });
}

function contextOf(
  caption: string,
  claims: SourceClaim[],
  conclusion: ClaimSourceConclusion,
  citations: ModelCitation[] = VALUE_CITATIONS,
): CaptionChangeContext {
  const hits = cpiHits();
  const audit = auditClaimsAgainstSources({ claims, citations, hits, caption });
  return { caption, claim: claims[0], conclusion, claims, hits, acceptedCitations: audit.acceptedCitations };
}

describe("建议配文的生成规则", () => {
  it("数字正确但推断方向相反时纠正方向，程序兜底也必须通过校验", () => {
    const caption = "2025 年 12 月全国 CPI 环比上涨 0.2%，所以物价比上月下降。";
    const claims = [claim({ claimText: caption, kind: "inference", basis: "month-on-month", value: 0.2, direction: "down" })];
    const audit = auditOf({ caption, claims, citations: VALUE_CITATIONS });
    expect(audit.conclusions[0].status).toBe("source-mismatch");
    const suggestion = buildCaptionSuggestion({ caption, claims, conclusions: audit.conclusions, hits: cpiHits(), acceptedCitations: audit.acceptedCitations });
    expect(suggestion.suggestedCaption).not.toContain("下降");
    expect(validateCaptionChangeText(suggestion.changes[0].suggested, {
      caption, claim: claims[0], conclusion: audit.conclusions[0], claims, hits: cpiHits(), acceptedCitations: audit.acceptedCitations,
    }).ok).toBe(true);
  });

  it("只检索到旧发布时，版本替代的引用、摘要与模型建议均使用修订发布", () => {
    const caption = "2026 年 6 月社会消费品零售总额环比增长 0.35%。";
    const claims = [claim({ claimText: caption, metric: "社会消费品零售总额", period: "2026-06", basis: "month-on-month", value: 0.35 })];
    const hits = searchSourceLibrary({ metric: claims[0].metric, period: claims[0].period, scope: "全国", terms: [] })
      .filter((hit) => hit.document.id === "stats-retail-2026-07");
    const audit = auditOf({ caption, claims, hits, citations: [{ sourceId: "stats-retail-2026-07", role: "value-basis", note: null }] });
    expect(audit.conclusions[0].citedSourceIds).toEqual(["stats-retail-2026-08"]);
    expect(audit.acceptedCitations).toContainEqual(expect.objectContaining({ sourceId: "stats-retail-2026-08", role: "value-basis" }));
    const corrected = caption.replace("0.35", "0.40");
    const suggestion = buildCaptionSuggestion({
      caption, claims, conclusions: audit.conclusions, hits: audit.hits,
      acceptedCitations: audit.acceptedCitations,
      proposals: [{ claimText: caption, suggestedText: corrected, reason: "按官方修订发布改正" }],
    });
    expect(suggestion.changes[0]).toMatchObject({ origin: "model", sourceIds: ["stats-retail-2026-08"] });
    expect(suggestion.rejectedProposals).toEqual([]);
    expect(suggestion.suggestedCaption).toBe(corrected);
  });

  it("与所引来源一致时保留原句，建议配文与原配文相同", () => {
    const caption = "12 月 CPI 同比上涨 0.8%。";
    const claims = [claim()];
    const audit = auditOf({ caption, claims, citations: VALUE_CITATIONS });
    expect(audit.conclusions[0].status).toBe("source-match");

    const suggestion = buildCaptionSuggestion({
      caption,
      claims,
      conclusions: audit.conclusions,
      hits: cpiHits(),
      acceptedCitations: audit.acceptedCitations,
      notes: ["配文还有 0 处内容没有核验。"],
    });

    expect(suggestion.suggestedCaption).toBe(caption);
    expect(suggestion.changes).toEqual([
      expect.objectContaining({
        claimText: claims[0].claimText,
        kind: "unchanged",
        suggested: claims[0].claimText,
        status: "source-match",
        origin: "program",
        sourceIds: ["stats-cpi-2025-12"],
        applied: true,
      }),
    ]);
    expect(suggestion.changes[0].reason).toContain("一致");
    expect(suggestion.notes).toEqual(["配文还有 0 处内容没有核验。"]);
  });

  it("不一致的直接陈述用所引发布的正确数值替换原文错误值", () => {
    const caption = "比上月上涨 0.8%。";
    const claims = [claim({ claimText: "比上月上涨 0.8%", value: 0.8, basis: "month-on-month", period: "2025-12" })];
    const audit = auditOf({ caption, claims, citations: VALUE_CITATIONS });
    expect(audit.conclusions[0].status).toBe("source-mismatch");

    const suggestion = buildCaptionSuggestion({
      caption,
      claims,
      conclusions: audit.conclusions,
      hits: cpiHits(),
      acceptedCitations: audit.acceptedCitations,
    });

    expect(suggestion.suggestedCaption).toBe("比上月上涨 0.2%。");
    const change = suggestion.changes[0];
    expect(change.kind).toBe("replace-value");
    expect(change.suggested).toBe("比上月上涨 0.2%");
    expect(change.reason).toContain("环比 0.2%");
    expect(change.reason).toContain("0.8%");
    expect(change.sourceIds).toEqual(["stats-cpi-2025-12"]);
  });

  it("不一致的推断按所引发布改正方向并写出正确数值", () => {
    const caption = "8 月 CPI 比上月便宜。";
    const claims = [claim({
      claimText: "8 月 CPI 比上月便宜。",
      value: null,
      basis: "month-on-month",
      period: "2026-08",
      kind: "inference",
      direction: "down",
    })];
    const audit = auditOf({ caption, claims, citations: [{ sourceId: "stats-cpi-2026-08", role: "value-basis", note: null }] });
    expect(audit.conclusions[0].status).toBe("source-mismatch");

    const suggestion = buildCaptionSuggestion({
      caption,
      claims,
      conclusions: audit.conclusions,
      hits: cpiHits("2026-08"),
      acceptedCitations: audit.acceptedCitations,
    });

    expect(suggestion.changes[0].kind).toBe("replace-value");
    expect(suggestion.changes[0].suggested).toBe("8 月 CPI 比上月上涨 0.4%。");
    expect(suggestion.changes[0].reason).toContain("相反");
  });

  it("未解决的主张保留限定，不写成确定表述", () => {
    const caption = "12 月 CPI 上涨 0.8%。";
    const claims = [claim({ claimText: "12 月 CPI 上涨 0.8%", basis: null, value: 0.8 })];
    const audit = auditOf({ caption, claims, citations: VALUE_CITATIONS });
    expect(audit.conclusions[0].status).toBe("source-pending");

    const suggestion = buildCaptionSuggestion({
      caption,
      claims,
      conclusions: audit.conclusions,
      hits: cpiHits(),
      acceptedCitations: audit.acceptedCitations,
    });

    expect(suggestion.changes[0].kind).toBe("keep-qualified");
    expect(suggestion.changes[0].suggested).toBe("12 月 CPI 上涨 0.8%（暂未核实）");
    expect(suggestion.suggestedCaption).toBe("12 月 CPI 上涨 0.8%（暂未核实）。");
    expect(suggestion.changes[0].reason).toContain("来源待核对");
    expect(suggestion.notes.join(" ")).toContain("没有可以据以改正配文的适用来源");
  });

  it("推断依据不足同样保留限定，并说明缺哪项依据", () => {
    const caption = "7 月 CPI 比上月便宜。";
    const claims = [claim({
      claimText: "7 月 CPI 比上月便宜。",
      value: null,
      basis: "month-on-month",
      period: "2026-07",
      kind: "inference",
      direction: "down",
    })];
    const audit = auditOf({ caption, claims, citations: [], noApplicableSourceReason: "资料库没有 2026 年 7 月的发布。" });
    expect(audit.conclusions[0].status).toBe("inference-unsupported");

    const suggestion = buildCaptionSuggestion({
      caption,
      claims,
      conclusions: audit.conclusions,
      hits: cpiHits(),
      acceptedCitations: audit.acceptedCitations,
    });

    expect(suggestion.changes[0].kind).toBe("keep-qualified");
    expect(suggestion.changes[0].suggested).toContain("（现有证据不足以支持这项推断）");
    expect(suggestion.changes[0].reason).toContain("推断依据不足");
  });

  it("观点保留原句，不做真假改写", () => {
    const caption = "物价压力已经缓解，政策效果显现。";
    const claims = [claim({ claimText: "物价压力已经缓解，政策效果显现。", value: null, basis: null, kind: "opinion" })];
    const audit = auditOf({ caption, claims, citations: [] });
    expect(audit.conclusions[0].status).toBe("not-verifiable");

    const suggestion = buildCaptionSuggestion({
      caption,
      claims,
      conclusions: audit.conclusions,
      hits: cpiHits(),
      acceptedCitations: audit.acceptedCitations,
    });

    expect(suggestion.changes[0].kind).toBe("unchanged");
    expect(suggestion.suggestedCaption).toBe(caption);
    expect(suggestion.changes[0].reason).toContain("不支持核验");
    expect(suggestion.notes.join(" ")).toContain("观点");
  });

  it("逐处改动并回配文，未核验的部分原样保留", () => {
    const caption = "12 月 CPI 同比上涨 0.2%。物价压力缓解。";
    const claims = [
      claim({ claimText: "12 月 CPI 同比上涨 0.2%。", value: 0.2 }),
      claim({ claimText: "物价压力缓解。", value: null, basis: null, kind: "opinion" }),
    ];
    const audit = auditOf({ caption, claims, citations: VALUE_CITATIONS });
    expect(audit.conclusions.map((conclusion) => conclusion.status)).toEqual(["source-mismatch", "not-verifiable"]);

    const suggestion = buildCaptionSuggestion({
      caption,
      claims,
      conclusions: audit.conclusions,
      hits: cpiHits(),
      acceptedCitations: audit.acceptedCitations,
    });

    expect(suggestion.suggestedCaption).toBe("12 月 CPI 同比上涨 0.8%。物价压力缓解。");
    expect(suggestion.changes.map((change) => change.kind)).toEqual(["replace-value", "unchanged"]);
    expect(suggestion.changes.every((change) => change.applied)).toBe(true);
  });

  it("定位不到原句的改动不并入建议配文，单列说明", () => {
    const caption = "12 月 CPI 表现平稳。"; // 配文本身没有这条主张的原文
    const claims = [claim({ claimText: "12 月 CPI 同比上涨 0.8%。" })];
    const audit = auditOf({ caption, claims, citations: VALUE_CITATIONS });
    expect(audit.conclusions[0].status).toBe("source-pending");

    const suggestion = buildCaptionSuggestion({
      caption,
      claims,
      conclusions: audit.conclusions,
      hits: cpiHits(),
      acceptedCitations: audit.acceptedCitations,
    });

    expect(suggestion.suggestedCaption).toBe(caption);
    expect(suggestion.changes[0].applied).toBe(false);
    expect(suggestion.notes.join(" ")).toContain("定位不到原句");
  });

  it("依据快照指纹随结论状态或引用变化", () => {
    const base = {
      caption: "12 月 CPI 同比上涨 0.8%。",
      conclusions: [] as ClaimSourceConclusion[],
      acceptedCitations: VALUE_CITATIONS,
    };
    const pending = captionSuggestionFingerprint({
      ...base,
      conclusions: [{
        claimText: "12 月 CPI 同比上涨 0.8%。",
        status: "source-pending",
        citedSourceIds: [],
      } as unknown as ClaimSourceConclusion],
    });
    const matched = captionSuggestionFingerprint({
      ...base,
      conclusions: [{
        claimText: "12 月 CPI 同比上涨 0.8%。",
        status: "source-match",
        citedSourceIds: ["stats-cpi-2025-12"],
      } as unknown as ClaimSourceConclusion],
    });
    expect(pending).not.toBe(matched);
    expect(captionSuggestionFingerprint({
      ...base,
      conclusions: [{
        claimText: "12 月 CPI 同比上涨 0.8%。",
        status: "source-match",
        citedSourceIds: ["stats-cpi-2025-12"],
      } as unknown as ClaimSourceConclusion],
    })).toBe(matched);
  });
});

describe("逐处改动的程序校验", () => {
  function contextFor(overrides: Partial<SourceClaim> = {}, citations: ModelCitation[] = VALUE_CITATIONS) {
    const caption = overrides.claimText ?? "12 月 CPI 同比上涨 0.8%。";
    const claims = [claim(overrides)];
    const audit = auditOf({ caption, claims, citations });
    return { context: contextOf(caption, claims, audit.conclusions[0], citations), conclusion: audit.conclusions[0] };
  }

  it("新增原文没有的范围、倍数或加强表述被拒", () => {
    const caption = "2025 年 12 月 CPI 同比上涨 0.2%。";
    const claims = [claim({ claimText: "2025 年 12 月 CPI 同比上涨 0.2%。", value: 0.2 })];
    const audit = auditOf({ caption, claims, citations: VALUE_CITATIONS });
    const context = contextOf(caption, claims, audit.conclusions[0]);

    const created = validateCaptionChangeText("2025 年 12 月 CPI 同比上涨 0.8%，创下近三年新高。", context);
    expect(created.ok).toBe(false);
    expect(created.violations.join(" ")).toContain("创下");
    expect(created.violations.join(" ")).toContain("三年");
  });

  it("引入证据未覆盖的数值被拒", () => {
    const { context } = contextFor();
    const result = validateCaptionChangeText("12 月 CPI 同比上涨 1.5%。", context);
    expect(result.ok).toBe(false);
    expect(result.violations.join(" ")).toContain("1.5");
    expect(result.violations.join(" ")).toContain("数值");
  });

  it("引入证据未覆盖的月份被拒，图上与引用里已有的月份可以写", () => {
    const caption = "2025 年 12 月 CPI 同比上涨 0.2%。";
    const claims = [claim({ claimText: "2025 年 12 月 CPI 同比上涨 0.2%。", value: 0.2 })];
    const audit = auditOf({ caption, claims, citations: VALUE_CITATIONS });
    expect(audit.conclusions[0].status).toBe("source-mismatch");
    const context = contextOf(caption, claims, audit.conclusions[0]);

    expect(validateCaptionChangeText("2025 年 12 月 CPI 同比上涨 0.8%。", context).ok).toBe(true);
    const wrongMonth = validateCaptionChangeText("2026 年 5 月 CPI 同比上涨 0.8%。", context);
    expect(wrongMonth.ok).toBe(false);
    expect(wrongMonth.violations.join(" ")).toContain("2026-05");
  });

  it("引入证据未覆盖的范围被拒", () => {
    const { context } = contextFor();
    const city = validateCaptionChangeText("12 月全国城市 CPI 同比上涨 0.8%。", context);
    expect(city.ok).toBe(false);
    expect(city.violations.join(" ")).toContain("全国城市");
  });

  it("新增原文没有的因果或加强表述被拒", () => {
    const { context } = contextFor();
    const causal = validateCaptionChangeText("12 月 CPI 同比上涨 0.8%，说明政策效果显现。", context);
    expect(causal.ok).toBe(false);
    expect(causal.violations.join(" ")).toContain("说明");
    // 原配文里本来就有的说法不算新增。
    const original = contextFor({ claimText: "12 月 CPI 同比上涨 0.8%，说明政策效果显现。" });
    expect(validateCaptionChangeText("12 月 CPI 同比上涨 0.8%，说明政策效果显现。", original.context).ok).toBe(true);
  });

  it("未解决的主张写成确定表述或原样保留都被拒", () => {
    const caption = "12 月 CPI 上涨 0.8%。";
    const claims = [claim({ claimText: "12 月 CPI 上涨 0.8%", basis: null })];
    const audit = auditOf({ caption, claims, citations: VALUE_CITATIONS });
    const context = contextOf(caption, claims, audit.conclusions[0]);
    expect(audit.conclusions[0].status).toBe("source-pending");

    const unhedged = validateCaptionChangeText("12 月 CPI 同比上涨 0.8%。", context);
    expect(unhedged.ok).toBe(false);
    const same = validateCaptionChangeText("12 月 CPI 上涨 0.8%", context);
    expect(same.ok).toBe(false);
    const hedged = validateCaptionChangeText("12 月 CPI 上涨 0.8%（暂未核实）。", context);
    expect(hedged.ok).toBe(true);
  });

  it("与所引发布不一致时：原样保留被拒，替换成正确数值通过", () => {
    const caption = "比上月上涨 0.8%。";
    const claims = [claim({ claimText: "比上月上涨 0.8%", value: 0.8, basis: "month-on-month" })];
    const audit = auditOf({ caption, claims, citations: VALUE_CITATIONS });
    expect(audit.conclusions[0].status).toBe("source-mismatch");
    const context = contextOf(caption, claims, audit.conclusions[0]);

    expect(validateCaptionChangeText("比上月上涨 0.8%。", context).ok).toBe(false);
    expect(validateCaptionChangeText("比上月上涨 0.2%。", context).ok).toBe(true);
    // 只换数值但漏掉正确值：仍保留错误值，被拒。
    expect(validateCaptionChangeText("比上月上涨 0.8%（与来源不一致）。", context).ok).toBe(false);
  });

  it("与来源一致时：改写或删除被拒，原句通过", () => {
    const { context } = contextFor();
    expect(validateCaptionChangeText("12 月 CPI 同比上涨 0.8%。", context).ok).toBe(true);
    expect(validateCaptionChangeText("12 月 CPI 同比上涨 0.8%（已核实）。", context).ok).toBe(false);
    expect(validateCaptionChangeText("", context).ok).toBe(false);
  });

  it("不接受把主张的比较方式改成原文没有的口径", () => {
    const { context } = contextFor();
    const switched = validateCaptionChangeText("12 月 CPI 环比上涨 0.8%。", context);
    expect(switched.ok).toBe(false);
    expect(switched.violations.join(" ")).toContain("比较方式");
  });

  it("观点允许建议删除，但不允许改成另一条断言", () => {
    const caption = "物价压力缓解。";
    const claims = [claim({ claimText: "物价压力缓解。", value: null, basis: null, kind: "opinion" })];
    const audit = auditOf({ caption, claims, citations: [] });
    const context = contextOf(caption, claims, audit.conclusions[0]);
    expect(validateCaptionChangeText("", context).ok).toBe(true);
    expect(validateCaptionChangeText("物价压力已经缓解，政策效果显现。", context).ok).toBe(false);
  });
});

describe("模型提议的程序把关", () => {
  function build(proposals: Array<{ claimText: string; suggestedText: string; reason: string }>) {
    const caption = "比上月上涨 0.8%。";
    const claims = [claim({ claimText: "比上月上涨 0.8%", value: 0.8, basis: "month-on-month" })];
    const audit = auditOf({ caption, claims, citations: VALUE_CITATIONS });
    const suggestion = buildCaptionSuggestion({
      caption,
      claims,
      conclusions: audit.conclusions,
      hits: cpiHits(),
      acceptedCitations: audit.acceptedCitations,
      proposals,
    });
    return suggestion;
  }

  it("通过校验的提议被采用，标明来自模型", () => {
    const suggestion = build([
      { claimText: "比上月上涨 0.8%", suggestedText: "比上月上涨 0.2%。", reason: "按官方发布改正环比数值。" },
    ]);
    expect(suggestion.changes[0]).toMatchObject({
      kind: "replace-value",
      suggested: "比上月上涨 0.2%。",
      origin: "model",
      rejectedReason: null,
    });
    expect(suggestion.rejectedProposals).toEqual([]);
    expect(suggestion.suggestedCaption).toBe("比上月上涨 0.2%。");
  });

  it("不合格的提议被拒绝并保留原因，程序兜底生成建议", () => {
    const suggestion = build([
      { claimText: "比上月上涨 0.8%", suggestedText: "比上月上涨 1.5%，创历史新高。", reason: "试图写得更有力。" },
    ]);
    expect(suggestion.changes[0]).toMatchObject({ origin: "program", kind: "replace-value" });
    expect(suggestion.changes[0].rejectedReason).toContain("1.5");
    expect(suggestion.rejectedProposals).toHaveLength(1);
    expect(suggestion.rejectedProposals[0].rejectedReason).toContain("1.5");
    expect(suggestion.suggestedCaption).toBe("比上月上涨 0.2%。");
    expect(suggestion.notes.join(" ")).toContain("没有通过逐处校验");
  });

  it("同一条主张的多条提议只采用第一条，其余与对不上主张的都记进拒绝列表", () => {
    const suggestion = build([
      { claimText: "比上月上涨 0.8%", suggestedText: "比上月上涨 0.2%。", reason: "改正数值。" },
      { claimText: "比上月上涨 0.8%", suggestedText: "比上月上涨 0.2%（供参考）。", reason: "另一种写法。" },
      { claimText: "配文里没有的主张", suggestedText: "随便写一句。", reason: "无关提议。" },
    ]);
    expect(suggestion.changes).toHaveLength(1);
    expect(suggestion.changes[0].origin).toBe("model");
    expect(suggestion.rejectedProposals).toHaveLength(2);
    const reasons = suggestion.rejectedProposals.map((entry) => entry.rejectedReason).join(" ");
    expect(reasons).toContain("多条改写提议");
    expect(reasons).toContain("没有对应的已核验配文主张");
  });

  it("缺主张原文或缺理由的提议逐条拒绝，不影响其他改动", () => {
    const suggestion = build([
      { claimText: "", suggestedText: "随意改写。", reason: "没写清改哪条。" },
      { claimText: "比上月上涨 0.8%", suggestedText: "比上月上涨 0.2%。", reason: "" },
    ]);
    expect(suggestion.changes[0].origin).toBe("program");
    expect(suggestion.rejectedProposals).toHaveLength(2);
    const reasons = suggestion.rejectedProposals.map((entry) => entry.rejectedReason).join(" ");
    expect(reasons).toContain("没有写清针对哪条主张");
    expect(reasons).toContain("没有写理由");
  });

  it("提议里把未解决主张写成确定表述时退回保留限定", () => {    const caption = "12 月 CPI 上涨 0.8%。";
    const claims = [claim({ claimText: "12 月 CPI 上涨 0.8%", basis: null })];
    const audit = auditOf({ caption, claims, citations: VALUE_CITATIONS });
    const suggestion = buildCaptionSuggestion({
      caption,
      claims,
      conclusions: audit.conclusions,
      hits: cpiHits(),
      acceptedCitations: audit.acceptedCitations,
      proposals: [{ claimText: "12 月 CPI 上涨 0.8%", suggestedText: "12 月 CPI 同比上涨 0.8%。", reason: "补上同比。" }],
    });
    expect(suggestion.changes[0].kind).toBe("keep-qualified");
    expect(suggestion.changes[0].suggested).toContain("暂未核实");
    expect(suggestion.rejectedProposals[0].rejectedReason).toContain("限定");
  });
});

describe("配文片段的定位", () => {
  it("能在配文里找到主张对应的片段，展示时带上句末标点", () => {
    const caption = "12 月 CPI 同比上涨 0.8%。物价压力缓解。";
    const span = locateCaptionSpan(caption, "12 月 CPI 同比上涨 0.8%。");
    expect(span).not.toBeNull();
    expect(span?.matchedRun).toBe("12 月 CPI 同比上涨 0.8%");

    const claims = [
      claim({ claimText: "12 月 CPI 同比上涨 0.8%。" }),
      claim({ claimText: "物价压力缓解。", value: null, basis: null, kind: "opinion" }),
    ];
    const audit = auditOf({ caption, claims, citations: VALUE_CITATIONS });
    const suggestion = buildCaptionSuggestion({
      caption,
      claims,
      conclusions: audit.conclusions,
      hits: cpiHits(),
      acceptedCitations: audit.acceptedCitations,
    });
    expect(suggestion.changes[0].original).toBe("12 月 CPI 同比上涨 0.8%。");
  });

  it("只有部分文字重合时不猜位置，避免替换出另一句话", () => {
    expect(locateCaptionSpan("12 月 CPI 表现平稳。", "8 月 CPI 比上月便宜。")).toBeNull();
  });
});

/** 替身驱动器：脚本化返回模型回复，用于验证编排层如何接住 report 里的改写提议。 */
function scriptedDriver(replies: ToolLoopReply[]): SourceInvestigationDriver & { resumedWith: string[] } {
  let index = 0;
  const state = { resumedWith: [] as string[] };
  const next = (): ToolLoopReply =>
    replies[index++] ?? { model: "stub-model", usage: null, text: null, calls: [], truncated: false };
  return {
    model: "stub-model",
    get resumedWith() { return state.resumedWith; },
    async start() { return next(); },
    async resume(message: string) {
      state.resumedWith.push(message);
      return next();
    },
    async continue(_results: ToolResultPayload[]) { return next(); },
    async finalize() { return next(); },
  } as SourceInvestigationDriver & { resumedWith: string[] };
}

function toolCall(name: string, input: unknown, id = `${name}-1`): ToolLoopCall {
  return { id, name, input };
}

function toolReply(calls: ToolLoopCall[], text: string | null = null): ToolLoopReply {
  return { model: "stub-model", usage: { inputTokens: 10, outputTokens: 5 }, text, calls, truncated: false };
}

const SEARCH_CALL = toolCall(SEARCH_TOOL_NAME, {
  metric: "全国居民消费价格",
  period: "2025-12",
  scope: "全国",
  terms: ["环比"],
});

const MOM_CLAIM = {
  claimText: "比上月上涨 0.8%",
  metric: "全国居民消费价格",
  scope: "全国",
  period: "2025-12",
  value: 0.8,
  basis: "month-on-month",
  kind: "direct",
  direction: null,
  fromImage: false,
  imageExcerpt: null,
};

function reportCall(extra: Record<string, unknown> = {}) {
  return toolCall(REPORT_TOOL_NAME, {
    claims: [MOM_CLAIM],
    citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
    noApplicableSourceReason: null,
    unresolvedItems: [],
    omittedClaims: [],
    ...extra,
  });
}

describe("改写提议字段的容错解析", () => {
  const baseReport = {
    claims: [MOM_CLAIM],
    citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
    noApplicableSourceReason: null,
    unresolvedItems: [],
    omittedClaims: [],
  };

  it("顶层不是数组时按空数组处理，整份汇总照常被采用", () => {
    const parsed = reportArgumentsSchema.safeParse({ ...baseReport, rewrites: "两句都要改" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && toModelFinding(parsed.data).rewrites).toEqual([]);
  });

  it("条目缺字段或不是对象时降级为可解析的空字段，交给建议生成器逐条拒绝", () => {
    const parsed = reportArgumentsSchema.safeParse({
      ...baseReport,
      rewrites: [
        { suggestedText: "改一下" },
        { claimText: "比上月上涨 0.8%", suggestedText: null, reason: null },
        "不是对象",
      ],
    });
    expect(parsed.success).toBe(true);
    const rewrites = parsed.success ? toModelFinding(parsed.data).rewrites : [];
    expect(rewrites).toEqual([
      { claimText: "", suggestedText: "改一下", reason: "" },
      { claimText: "比上月上涨 0.8%", suggestedText: "", reason: "" },
    ]);
  });

  it("超过条数上限时截断而不是拒绝整份汇总", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      claimText: `主张 ${index}`,
      suggestedText: "改",
      reason: "理由",
    }));
    const parsed = reportArgumentsSchema.safeParse({ ...baseReport, rewrites: many });
    expect(parsed.success).toBe(true);
    expect(parsed.success && toModelFinding(parsed.data).rewrites).toHaveLength(6);
  });
});

describe("编排层贯通建议配文", () => {
  it("从模型只检索旧发布到修订建议，完整结果通过评测侧独立复算", async () => {
    const caption = "2026 年 6 月社会消费品零售总额环比增长 0.35%";
    const retail = claim({ claimText: caption, metric: "社会消费品零售总额", period: "2026-06", value: 0.35, basis: "month-on-month" });
    const driver = scriptedDriver([
      toolReply([toolCall(SEARCH_TOOL_NAME, { metric: retail.metric, period: "2026-07", scope: "全国", terms: [] })]),
      toolReply([reportCall({ claims: [retail], citations: [{ sourceId: "stats-retail-2026-07", role: "value-basis", note: null }] })]),
    ]);
    const result = await runSourceInvestigation(driver, { caption });
    expect(result.captionSuggestion?.suggestedCaption).toContain("0.4%");
    expect(result.conclusions[0].citedSourceIds).toEqual(["stats-retail-2026-08"]);
    expect(result.acceptedCitations.find((entry) => entry.sourceId === "stats-retail-2026-08")?.note).toContain("程序版本复查");
    expect(result.toolCallsUsed).toBe(1);
    expect(suggestionIndependenceProblems(result, caption)).toEqual([]);
  });

  it("汇总里的改写提议通过校验时被采用，逐处带理由与当前有效引用", async () => {
    const driver = scriptedDriver([
      toolReply([SEARCH_CALL]),
      toolReply([reportCall({
        rewrites: [{
          claimText: "比上月上涨 0.8%",
          suggestedText: "比上月上涨 0.2%。",
          reason: "按所引发布把环比数值改成 0.2%。",
        }],
      })]),
    ]);

    const result = await runSourceInvestigation(driver, { caption: "比上月上涨 0.8%。" });
    const suggestion = result.captionSuggestion;
    expect(suggestion).not.toBeNull();
    expect(suggestion?.suggestedCaption).toBe("比上月上涨 0.2%。");
    expect(suggestion?.changes[0]).toMatchObject({
      claimText: "比上月上涨 0.8%",
      original: "比上月上涨 0.8%。",
      kind: "replace-value",
      origin: "model",
      status: "source-mismatch",
      sourceIds: ["stats-cpi-2025-12"],
      applied: true,
    });
    expect(result.trace.some((event) => event.inputSummary.includes("改写提议"))).toBe(true);
  });

  it("不合格的改写提议退回程序兜底，并保留拒绝原因", async () => {
    const driver = scriptedDriver([
      toolReply([SEARCH_CALL]),
      toolReply([reportCall({
        rewrites: [{
          claimText: "比上月上涨 0.8%",
          suggestedText: "比上月上涨 0.2%，创下近三年最大涨幅。",
          reason: "补充背景。",
        }],
      })]),
    ]);

    const result = await runSourceInvestigation(driver, { caption: "比上月上涨 0.8%。" });
    expect(result.captionSuggestion?.suggestedCaption).toBe("比上月上涨 0.2%。");
    expect(result.captionSuggestion?.changes[0]).toMatchObject({ origin: "program", kind: "replace-value" });
    expect(result.captionSuggestion?.changes[0].rejectedReason).toContain("三年");
    expect(result.captionSuggestion?.rejectedProposals).toHaveLength(1);
  });

  it("模型没有给改写提议时程序按结论生成建议", async () => {
    const driver = scriptedDriver([toolReply([SEARCH_CALL]), toolReply([reportCall()])]);
    const result = await runSourceInvestigation(driver, { caption: "比上月上涨 0.8%。" });
    expect(result.captionSuggestion?.changes[0].origin).toBe("program");
    expect(result.captionSuggestion?.suggestedCaption).toBe("比上月上涨 0.2%。");
    expect(result.captionSuggestion?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("补证恢复后按新结论重新生成建议，不再沿用补证前的写法", async () => {
    const pendingClaim = { ...MOM_CLAIM, claimText: "12 月 CPI 上涨 0.8%", basis: null };
    const clarify = toolCall(CLARIFY_TOOL_NAME, {
      question: "配文里的 0.8% 指的是同比还是环比？",
      purpose: "确定比较方式后才能与发布对照。",
      field: "basis",
      claimText: "12 月 CPI 上涨 0.8%",
    }, "c1");
    const driver = scriptedDriver([
      toolReply([SEARCH_CALL, clarify]),
      toolReply([toolCall(REPORT_TOOL_NAME, {
        claims: [pendingClaim],
        citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
        noApplicableSourceReason: null,
        unresolvedItems: [],
        omittedClaims: [],
      }, "r1")]),
      toolReply([toolCall(REPORT_TOOL_NAME, {
        claims: [pendingClaim],
        citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
        noApplicableSourceReason: null,
        unresolvedItems: [],
        omittedClaims: [],
        rewrites: [{ claimText: "12 月 CPI 上涨 0.8%", suggestedText: "12 月 CPI 同比上涨 0.8%。", reason: "用户已确认口径。" }],
      }, "r2")]),
    ]);

    const before = await runSourceInvestigation(driver, { caption: "12 月 CPI 上涨 0.8%。" });
    expect(before.conclusions[0].status).toBe("source-pending");
    expect(before.captionSuggestion?.changes[0].kind).toBe("keep-qualified");
    expect(before.captionSuggestion?.suggestedCaption).toContain("暂未核实");

    const after = await runSourceInvestigation(driver, {
      caption: "12 月 CPI 上涨 0.8%。",
      resume: { answer: "同比", prior: before },
    });
    expect(after.conclusions[0].status).toBe("source-match");
    // 恢复段用户确认了口径：主张已与来源一致，建议保留原句，不再带未核实限定。
    expect(after.captionSuggestion?.changes[0].kind).toBe("unchanged");
    expect(after.captionSuggestion?.suggestedCaption).toBe("12 月 CPI 上涨 0.8%。");
    expect(after.captionSuggestion?.fingerprint).not.toBe(before.captionSuggestion?.fingerprint);
  });
});
