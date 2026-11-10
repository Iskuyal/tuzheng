import { describe, expect, it } from "vitest";
import {
  SHARE_BOUNDARY,
  SHARE_TITLE,
  buildShareSummary,
  buildShareSummaryBody,
  shareSummaryFingerprint,
} from "../web/source-share.js";
import { fnv1a64 } from "../shared/source-library.js";
import type { SourceDocument } from "../shared/source-library.js";
import type { SourceInvestigationResult } from "../shared/source-audit.js";

// 分享摘要的纯逻辑单测：只测文本生成与指纹，不碰浏览器（剪贴板与弹层由 e2e 覆盖）。

const RELEASE: SourceDocument = {
  id: "stats-cpi-2025-12",
  kind: "data-release",
  title: "2025年12月份居民消费价格同比上涨0.8%",
  publisher: "国家统计局",
  url: "https://www.stats.gov.cn/sj/zxfb/202601/t20260109_1962273.html",
  publishedAt: "2026-01-09",
  basis: { metric: "全国居民消费价格", period: "2025-12", scope: "全国" },
  aliases: ["CPI"],
  excerpt: "2025年12月份，全国居民消费价格同比上涨0.8%。12月份，全国居民消费价格环比上涨0.2%。",
  measures: [
    { basis: "year-on-year", value: 0.8, unit: "%", excerpt: "2025年12月份，全国居民消费价格同比上涨0.8%。" },
    { basis: "month-on-month", value: 0.2, unit: "%", excerpt: "12月份，全国居民消费价格环比上涨0.2%。" },
  ],
  fingerprint: "8a7f3c1d2b9e4f60",
};

function originTrace(fromImage: boolean) {
  return {
    fromImage,
    originText: fromImage ? "2025 年 12 月全国 CPI 上涨 0.8%" : "比上月上涨 0.8%。",
    traceable: true,
    coverage: 1,
    matchedRun: fromImage ? "2025 年 12 月全国 CPI 上涨 0.8%" : "比上月上涨 0.8%",
    note: null,
  };
}

function baseResult(overrides: Partial<SourceInvestigationResult> = {}): SourceInvestigationResult {
  return {
    model: "stub-source-model",
    latencyMs: 6787,
    rounds: 3,
    stopReason: "模型在看完工具结果后给出汇总。",
    trace: [],
    claims: [],
    conclusions: [
      {
        claimText: "比上月上涨 0.8%",
        claimKind: "direct",
        fromImage: false,
        status: "source-mismatch",
        summary: "与所引发布不一致：该发布记载环比 0.2%，主张写 0.8%。",
        basisLabel: "环比",
        claimValue: 0.8,
        officialValue: 0.2,
        difference: 0.6,
        citedSourceIds: ["stats-cpi-2025-12"],
        reasons: ["依据原句：12月份，全国居民消费价格环比上涨0.2%。"],
        unresolved: [],
        parts: [],
        origin: originTrace(false),
        periodNote: null,
        supplement: null,
      },
    ],
    citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
    acceptedCitations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
    citationsRejected: [],
    hits: [{
      document: RELEASE,
      score: 11.75,
      matchReasons: ["指标与资料口径匹配"],
      applicability: { applicableForValue: true, applicableForTerm: false, mismatchFields: [], missingFields: [] },
    }],
    excludedSources: [],
    unresolvedItems: [],
    noApplicableSourceReason: null,
    clarification: null,
    toolCallsUsed: 2,
    usage: { inputTokens: 157, outputTokens: 584 },
    omittedClaims: [],
    captionCoverage: 1,
    captionCoverageNote: null,
    supplement: null,
    conclusionChanges: null,
    captionSuggestion: null,
    investigationId: "inv-1",
    inputFingerprint: "abc123",
    ...overrides,
  };
}

describe("分享摘要的文本生成", () => {
  it("首行是标题，并始终带上使用边界原文", () => {
    const summary = buildShareSummary({ result: baseResult(), caption: "比上月上涨 0.8%" });
    const lines = summary.split("\n");
    expect(lines[0]).toBe(SHARE_TITLE);
    expect(lines[1]).toBe(SHARE_BOUNDARY);
    // 边界与结果区那句话说同一件事，不能只留半边。
    expect(SHARE_BOUNDARY).toContain("仅核对当前主张与适用的收录来源");
    expect(SHARE_BOUNDARY).toContain("未确认整张图");
  });

  it("逐条结论带上状态、数值对照与引用来源", () => {
    const summary = buildShareSummary({ result: baseResult(), caption: "比上月上涨 0.8%" });
    expect(summary).toContain("「比上月上涨 0.8%」（配文）· 与来源不一致");
    expect(summary).toContain("数值对照：原文 0.8% → 适用来源 0.2%，环比");
    expect(summary).toContain("引用：《2025年12月份居民消费价格同比上涨0.8%》（国家统计局，2026-01-09） · 用作数值依据");
    expect(summary).toContain("停止原因：模型在看完工具结果后给出汇总。");
    expect(summary).toContain("配文原文：比上月上涨 0.8%");
  });

  it("引用角色分别标成数值依据、术语解释与仅作背景", () => {
    const result = baseResult({
      acceptedCitations: [
        { sourceId: "stats-cpi-2025-12", role: "value-basis", note: null },
        { sourceId: "stats-term", role: "term-explanation", note: null },
        { sourceId: "stats-context", role: "context", note: "仅说明背景" },
      ],
      conclusions: [{
        ...baseResult().conclusions[0],
        citedSourceIds: ["stats-cpi-2025-12", "stats-term", "stats-context"],
      }],
    });
    const summary = buildShareSummary({ result, caption: "比上月上涨 0.8%" });
    expect(summary).toContain("· 用作数值依据");
    expect(summary).toContain("· 只用于解释术语");
    expect(summary).toContain("· 仅作背景：仅说明背景");
  });

  it("模型修改建议只作「尚未采用」的参考，并保留未采用的原因说明", () => {
    const result = baseResult({
      captionSuggestion: {
        caption: "比上月上涨 0.8%",
        suggestedCaption: "比上月上涨 0.2%",
        changes: [{
          claimText: "比上月上涨 0.8%",
          original: "比上月上涨 0.8%",
          suggested: "比上月上涨 0.2%",
          kind: "replace-value",
          reason: "所引发布记载环比 0.2%。",
          sourceIds: ["stats-cpi-2025-12"],
          status: "source-mismatch",
          origin: "model",
          rejectedReason: null,
          applied: true,
        }],
        rejectedProposals: [],
        notes: ["配文还有 1 处内容没有核验：「物价压力缓解」。"],
        fingerprint: "3f9c1d2a5b7e4c60",
      },
    });
    const summary = buildShareSummary({ result, caption: "比上月上涨 0.8%" });
    expect(summary).toContain("修改建议（模型建议，尚未采用）");
    expect(summary).toContain("建议配文：比上月上涨 0.2%");
    expect(summary).toContain("「比上月上涨 0.8%」→「比上月上涨 0.2%」：所引发布记载环比 0.2%。");
    expect(summary).toContain("提醒：配文还有 1 处内容没有核验：「物价压力缓解」。");
    // 建议不能被写成已确认的结论。
    expect(summary).not.toContain("建议结论");
  });

  it("用户补充的口径标成「用户提供」，不与官方来源混写", () => {
    const result = baseResult({
      supplement: {
        question: "这句话是同比还是环比？",
        purpose: "确定比较方式",
        field: "basis",
        claimText: "比上月上涨 0.8%",
        answer: "环比",
        normalized: "month-on-month",
        applied: true,
        conflicts: [],
        parseNote: null,
        note: "已按用户补充确定比较方式。",
      },
    });
    const summary = buildShareSummary({ result, caption: "比上月上涨 0.8%" });
    expect(summary).toContain("补充回答（用户提供，不是官方来源）");
    expect(summary).toContain("回答：环比");
  });

  it("没有结论时说明原因，而不是留白", () => {
    const result = baseResult({
      conclusions: [],
      noApplicableSourceReason: "资料库里没有适配 2025-12 全国 CPI 的材料。",
      unresolvedItems: ["没有可适用来源。"],
      omittedClaims: [{ claimText: "物价压力缓解", reason: "超出单次核验条数上限。", source: "caption" }],
    });
    const summary = buildShareSummary({ result, caption: "比上月上涨 0.8%。物价压力缓解。" });
    expect(summary).toContain("结论（0 条）");
    expect(summary).toContain("本次没有形成可用结论。");
    expect(summary).toContain("原因：资料库里没有适配 2025-12 全国 CPI 的材料。");
    expect(summary).toContain("整体未解决项");
    expect(summary).toContain("「物价压力缓解」：超出单次核验条数上限。");
  });

  it("未回答的追问单列为待补充，不写成已核验", () => {
    const result = baseResult({
      conclusions: [],
      clarification: { question: "这句话是同比还是环比？", purpose: "确定比较方式", field: "basis", claimText: null },
    });
    const summary = buildShareSummary({ result, caption: "比上月上涨 0.8%" });
    expect(summary).toContain("待补充确认（尚未回答）");
    expect(summary).toContain("问题：这句话是同比还是环比？");
  });
});

describe("分享摘要的指纹", () => {
  it("同一次结果重复生成得到同一段文字与同一个指纹", () => {
    const first = buildShareSummary({ result: baseResult(), caption: "比上月上涨 0.8%" });
    const second = buildShareSummary({ result: baseResult(), caption: "比上月上涨 0.8%" });
    expect(second).toBe(first);
    const fingerprint = shareSummaryFingerprint(buildShareSummaryBody({ result: baseResult(), caption: "比上月上涨 0.8%" }));
    expect(fingerprint).toBe(fnv1a64(buildShareSummaryBody({ result: baseResult(), caption: "比上月上涨 0.8%" })));
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(first).toContain(`摘要指纹：${fingerprint}`);
  });

  it("正文改一个字，指纹就变", () => {
    const original = buildShareSummaryBody({ result: baseResult(), caption: "比上月上涨 0.8%" });
    const tampered = original.replace("0.8%", "0.9%");
    expect(tampered).not.toBe(original);
    expect(shareSummaryFingerprint(tampered)).not.toBe(shareSummaryFingerprint(original));
  });

  it("指纹说明写明它只用于发现文字被改动", () => {
    const summary = buildShareSummary({ result: baseResult(), caption: "比上月上涨 0.8%" });
    expect(summary).toContain("（指纹由摘要正文计算；文字被改动后指纹即不同。）");
  });
});
