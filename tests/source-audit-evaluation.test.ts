import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  checkBalance,
  expectationsCatalog,
  isDeepSeekEndpoint,
  judgeRun,
  plannedRequests,
  questionsCatalog,
  REQUIRED_CATEGORIES,
  runPairedEvaluation,
  summarizeEvaluation,
  verifyFrozenSetup,
  type Arm,
  type RunRecord,
  type SourceAuditExpectations,
} from "../scripts/evaluate-source-audit.js";
import { REPORT_TOOL_NAME, SEARCH_TOOL_NAME } from "../server/source-tools.js";
import type { SourceInvestigationDriver, ToolLoopCall, ToolLoopReply } from "../server/source-investigation.js";
import {
  auditClaimsAgainstSources,
  buildCaptionSuggestion,
  searchSourceLibrary,
  type ModelCitation,
  type SourceClaim,
  type SourceHit,
  type SourceInvestigationResult,
} from "../shared/source-audit.js";

function claim(overrides: Partial<SourceClaim> = {}): SourceClaim {
  return {
    claimText: "12 月 CPI 同比上涨 0.8%。",
    metric: "全国居民消费价格",
    scope: "全国",
    period: "2025-12",
    value: 0.8,
    basis: "year-on-year",
    kind: "direct",
    fromImage: false,
    imageExcerpt: null,
    ...overrides,
  };
}

function cpiHits(period = "2025-12"): SourceHit[] {
  return searchSourceLibrary({ metric: "全国居民消费价格", period, scope: "全国", terms: [] });
}

/** 用真实的结论组合逻辑造一次运行结果，避免手写结论与程序行为脱节。 */
function resultFor(
  claims: SourceClaim[],
  citations: ModelCitation[],
  options: { hits?: SourceHit[]; noApplicableSourceReason?: string | null; caption?: string | null } = {},
): SourceInvestigationResult {
  const hits = options.hits ?? cpiHits();
  const caption = options.caption ?? null;
  const audit = auditClaimsAgainstSources({
    claims,
    citations,
    hits,
    noApplicableSourceReason: options.noApplicableSourceReason ?? null,
    caption,
  });
  return {
    model: "stub-model",
    latencyMs: 10,
    rounds: 2,
    stopReason: "测试替身给出的汇总。",
    trace: [],
    claims,
    conclusions: audit.conclusions,
    citations,
    acceptedCitations: audit.acceptedCitations,
    citationsRejected: audit.citationsRejected,
    hits,
    excludedSources: audit.excluded,
    unresolvedItems: [],
    noApplicableSourceReason: options.noApplicableSourceReason ?? null,
    clarification: null,
    toolCallsUsed: 1,
    usage: null,
    omittedClaims: [],
    captionCoverage: null,
    captionCoverageNote: null,
    supplement: null,
    conclusionChanges: null,
    captionSuggestion: caption
      ? buildCaptionSuggestion({
        caption,
        claims,
        conclusions: audit.conclusions,
        hits,
        acceptedCitations: audit.acceptedCitations,
      })
      : null,
    investigationId: null,
    inputFingerprint: null,
  };
}

const VALUE_CITATION: ModelCitation[] = [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }];

function expectationOf(id: string) {
  const expectation = expectationsCatalog.questions.find((entry) => entry.id === id);
  if (!expectation) throw new Error(`期望里没有 ${id}`);
  return expectation;
}

/**
 * 追加式冻结的投影：任务 05 在既有题目的期望上追加了 suggestion 规则（不改动原有规则），
 * 冻结校验和按「去掉新增字段」比较，保证已验收的预期没有被改写。
 */
function withoutSuggestionRules(expectation: SourceAuditExpectations["questions"][number]): unknown {
  const clone = structuredClone(expectation) as SourceAuditExpectations["questions"][number] & { suggestion?: unknown };
  delete clone.suggestion;
  if (clone.resume) delete (clone.resume as { suggestion?: unknown }).suggestion;
  return clone;
}

describe("固定题集与独立期望", () => {
  it("题集不少于 10 题，输入与期望分别保存在两个文件里", () => {
    expect(questionsCatalog.questions.length).toBeGreaterThanOrEqual(10);
    expect(questionsCatalog.questions.length).toBe(expectationsCatalog.questions.length);
    // 输入文件里没有期望字段，期望文件里没有输入字段：两边不能互相顶替。
    const questionKeys = new Set(Object.keys(questionsCatalog.questions[0]));
    expect(questionKeys.has("expect")).toBe(false);
    expect(questionKeys.has("caption")).toBe(true);
    const expectationKeys = new Set(Object.keys(expectationsCatalog.questions[0]));
    expect(expectationKeys.has("caption")).toBe(false);
    expect(expectationKeys.has("expect")).toBe(true);
    // 期望是人预先写定的，不由模型生成。
    expect(expectationsCatalog.authoredBy).toContain("人工");
    expect(expectationsCatalog.rubric.length).toBeGreaterThan(3);
  });

  it("覆盖全部要求的问题类别", () => {
    const covered = new Set(questionsCatalog.questions.flatMap((question) => question.categories));
    for (const category of REQUIRED_CATEGORIES) expect(covered.has(category)).toBe(true);
  });

  it("图片、资料库指纹与预算都与冻结值一致", async () => {
    await expect(verifyFrozenSetup(questionsCatalog, expectationsCatalog)).resolves.toEqual([]);
  });

  it("图片、资料库或预算被改动时冻结检查报出问题", async () => {
    const tamperedQuestions = structuredClone(questionsCatalog);
    tamperedQuestions.images["cpi-2025-12"].pngSha256 = "0".repeat(64);
    tamperedQuestions.images["cpi-2025-12-yoy"].imageText = ["图上根本没有的标题"];
    const tamperedExpectations = structuredClone(expectationsCatalog);
    tamperedExpectations.frozen.libraryFingerprints["stats-cpi-2025-12"] = "0".repeat(16);
    tamperedExpectations.frozen.budget.toolCallsPerInvestigation = 99;

    const problems = await verifyFrozenSetup(tamperedQuestions, tamperedExpectations);
    expect(problems.join("\n")).toContain("PNG 与冻结指纹不符");
    expect(problems.join("\n")).toContain("图上没有声明文字");
    expect(problems.join("\n")).toContain("指纹与冻结值不符");
    expect(problems.join("\n")).toContain("预算 toolCallsPerInvestigation 与冻结值不符");
  });

  it("题集或期望缺项、少题时冻结检查报出问题", async () => {
    const missingExpectation = structuredClone(expectationsCatalog);
    missingExpectation.questions = missingExpectation.questions.filter((entry) => entry.id !== "q05-caption-wrong-month-distractor");
    expect((await verifyFrozenSetup(questionsCatalog, missingExpectation)).join("\n")).toContain("缺少独立期望");

    const extraExpectation = structuredClone(expectationsCatalog);
    extraExpectation.questions.push({ ...extraExpectation.questions[0], id: "q13-not-in-questions" });
    expect((await verifyFrozenSetup(questionsCatalog, extraExpectation)).join("\n")).toContain("没有对应题目");

    const shortQuestions = structuredClone(questionsCatalog);
    shortQuestions.questions = shortQuestions.questions.slice(0, 9);
    const shortExpectations = structuredClone(expectationsCatalog);
    shortExpectations.questions = shortExpectations.questions.slice(0, 9);
    expect((await verifyFrozenSetup(shortQuestions, shortExpectations)).join("\n")).toContain("至少需要 10 题");

    const uncoveredQuestions = structuredClone(questionsCatalog);
    for (const question of uncoveredQuestions.questions) {
      question.categories = question.categories.filter((category) => category !== "干扰来源命中");
    }
    expect((await verifyFrozenSetup(uncoveredQuestions, expectationsCatalog)).join("\n")).toContain("没有覆盖类别：干扰来源命中");
  });
});

describe("逐题判定", () => {
  it("口径与数值都对上时判为通过", () => {
    const judgment = judgeRun(expectationOf("q01-caption-yoy-match"), resultFor([claim()], VALUE_CITATION));
    expect(judgment.problems).toEqual([]);
    expect(judgment.ok).toBe(true);
    expect(judgment.conclusions[0]).toMatchObject({ status: "source-match", basis: "year-on-year", period: "2025-12" });
  });

  it("状态不对、条数不对或引用不是本次命中都会判为未通过", () => {
    // 主张与选择器相符，但没有可用的引用 → 待核对，与期望的「一致」不符。
    const wrongStatus = judgeRun(expectationOf("q01-caption-yoy-match"), resultFor([claim()], []));
    expect(wrongStatus.ok).toBe(false);
    expect(wrongStatus.problems.map((problem) => problem.kind)).toContain("wrong-status");
    expect(wrongStatus.problems.map((problem) => problem.kind)).toContain("missing-required-citation");

    const missing = judgeRun(expectationOf("q01-caption-yoy-match"), resultFor([claim({ basis: null })], []));
    expect(missing.problems.map((problem) => problem.kind)).toContain("no-matching-claim");

    const invented = judgeRun(
      expectationOf("q01-caption-yoy-match"),
      resultFor([claim()], [{ sourceId: "stats-made-up", role: "value-basis", note: null }]),
    );
    expect(invented.problems.map((problem) => problem.kind)).toContain("fabricated-citation");
    expect(invented.problems.map((problem) => problem.kind)).toContain("missing-required-citation");
  });

  it("无适用来源的题出现确定结论时判为越界，允许的状态仍可通过", () => {
    const overclaim = judgeRun(
      expectationOf("q07-caption-no-such-month"),
      resultFor([claim({ period: "2026-05", value: 0.8, basis: "month-on-month" })], VALUE_CITATION, { hits: [] }),
    );
    // 引用不在本次命中内 → 程序降级为待核对，不会越界。
    expect(overclaim.ok).toBe(true);
    expect(overclaim.conclusions[0].status).toBe("source-pending");

    const grounded = judgeRun(
      expectationOf("q07-caption-no-such-month"),
      resultFor([claim({ period: "2026-05", value: 0.8, basis: "month-on-month" })], VALUE_CITATION),
    );
    // 命中的是 2025-12 的材料，与主张月份不符 → 引用被拒，仍为待核对。
    expect(grounded.ok).toBe(true);

    const noClaims = judgeRun(expectationOf("q07-caption-no-such-month"), resultFor([], []));
    expect(noClaims.problems.map((problem) => problem.kind)).toContain("no-conclusions");
    expect(noClaims.problems.map((problem) => problem.kind)).toContain("no-matching-claim");
  });

  it("术语页不能以数值依据角色通过校验", () => {
    const citations: ModelCitation[] = [{ sourceId: "stats-term-yoy-mom", role: "value-basis", note: null }];
    const judgment = judgeRun(expectationOf("q12-caption-term-misuse"), resultFor([claim({ basis: null, value: null })], citations));
    // 程序已经拒绝该引用，因此不会出现 forbidden-value-basis-citation，但结论必须保持待核对。
    expect(judgment.conclusions[0].status).toBe("source-pending");
    expect(judgment.ok).toBe(true);
  });

  it("干扰来源题的引用必须落在正确月份的材料上", () => {
    const wrongDocument = judgeRun(
      expectationOf("q05-caption-wrong-month-distractor"),
      resultFor(
        [claim({ period: "2026-08", value: 0.8, basis: "month-on-month" })],
        VALUE_CITATION,
        { hits: cpiHits("2026-08") },
      ),
    );
    expect(wrongDocument.problems.map((problem) => problem.kind)).toContain("missing-required-citation");
  });
});

describe("任务 03 新增的推断与拆解题目", () => {
  it("02 的 12 道原题与 5 张原图保持原样，只在其后追加新题", () => {
    // 冻结校验和：任务 03／04 只允许追加，不允许改写 02 的题面、期望与图片指纹。
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    expect(questionsCatalog.questions.slice(0, 12).map((question) => question.id)).toEqual([
      "q01-caption-yoy-match",
      "q02-caption-mom-match",
      "q03-caption-mom-value-as-yoy",
      "q04-caption-yoy-value-as-mom",
      "q05-caption-wrong-month-distractor",
      "q06-caption-wrong-scope-city",
      "q07-caption-no-such-month",
      "q08-caption-image-basis-unclear",
      "q09-caption-distractor-same-yoy",
      "q10-caption-2026-08-match",
      "q11-caption-value-without-basis",
      "q12-caption-term-misuse",
    ]);
    expect(hash(questionsCatalog.questions.slice(0, 12))).toBe("b0ccf29ec0fcdf7e769c38a1d8553e25bbdd72df2f1847517612443c0d3dd2a6");
    expect(hash(expectationsCatalog.questions.slice(0, 12).map(withoutSuggestionRules)))
      .toBe("912cb87d7b6948d82626ebef108c5f2223394dd2caf6e644b6cbce52c773814a");
    expect(hash(["cpi-2025-12", "cpi-2025-12-yoy", "cpi-2025-12-mom", "cpi-2025-12-city", "cpi-2026-08-yoy"]
      .map((name) => questionsCatalog.images[name]))).toBe("f8c51b9aff8bd9ae8d0897aa962a8fd42daacefc2b80501b9ac9da5e26befe1f");
    expect(questionsCatalog.questions.length).toBe(22);
  });

  it("03 的 5 道推断与拆解题在任务 04 之后也保持原样", () => {
    // 追加式冻结：02+03 共 17 题的题面与期望整体哈希，04 只能在其后追加。
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    expect(questionsCatalog.questions.slice(12, 17).map((question) => question.id)).toEqual([
      "q13-inference-mom-contradicted",
      "q14-inference-mom-supported",
      "q15-opinion-not-verifiable",
      "q16-caption-over-three-claims",
      "q17-inference-no-mom-source",
    ]);
    expect(hash(questionsCatalog.questions.slice(0, 17)))
      .toBe("7ff1614f0be6ca444a7bbb5dc09328f277de53939ac8f6d4fa2e008beb451c2b");
    expect(hash(expectationsCatalog.questions.slice(0, 17).map(withoutSuggestionRules)))
      .toBe("bc434cc77696bcd5ca586bcf10aa45b27adb3223b665624dcb3ec6e5eb472cb2");
    expect(hash(questionsCatalog.questions.slice(12, 17)))
      .toBe("24365cdcdb47307a47a3f0a828ee7f847e185e8281eeb196d3bf01acd00f696e");
    expect(hash(expectationsCatalog.questions.slice(12, 17).map(withoutSuggestionRules)))
      .toBe("8eefe62405e2408036a8abed0ccf0fd110b006b8c7abf3895b17a1fdb4fd7dc3");
  });

  it("推断、观点与覆盖度的类别都有题目覆盖", () => {
    const covered = new Set(questionsCatalog.questions.flatMap((question) => question.categories));
    for (const category of ["推断缺口", "正确推断", "错误推断", "证据不足", "观点不支持核验", "主张拆解与覆盖"]) {
      expect(covered.has(category)).toBe(true);
    }
  });

  it("推断题在有适用环比来源时改判、无适用来源时给依据不足", () => {
    const inference = (overrides: Partial<SourceClaim> = {}): SourceClaim => ({
      claimText: "8 月 CPI 比上月便宜",
      metric: "全国居民消费价格",
      scope: "全国",
      period: "2026-08",
      value: null,
      basis: "month-on-month",
      kind: "inference",
      direction: "down",
      fromImage: false,
      imageExcerpt: null,
      ...overrides,
    });
    const hits = cpiHits("2026-08");
    const citation: ModelCitation[] = [{ sourceId: "stats-cpi-2026-08", role: "value-basis", note: null }];

    const contradicted = judgeRun(
      expectationOf("q13-inference-mom-contradicted"),
      resultFor([inference()], citation, { hits, caption: "8 月 CPI 比上月便宜。" }),
    );
    expect(contradicted.problems).toEqual([]);
    expect(contradicted.conclusions[0]).toMatchObject({ status: "source-mismatch", kind: "inference" });

    const supported = judgeRun(
      expectationOf("q14-inference-mom-supported"),
      resultFor([inference({ claimText: "8 月 CPI 比上月上涨", direction: "up" })], citation, { hits, caption: "8 月 CPI 比上月上涨。" }),
    );
    expect(supported.problems).toEqual([]);

    const missingSource = judgeRun(
      expectationOf("q17-inference-no-mom-source"),
      resultFor(
        [inference({ period: "2026-07", claimText: "7 月 CPI 比上月便宜" })],
        [],
        { hits: cpiHits("2026-07"), caption: "7 月 CPI 比上月便宜。" },
      ),
    );
    expect(missingSource.problems).toEqual([]);
    expect(missingSource.conclusions[0].status).toBe("inference-unsupported");
  });

  it("观点案例按分类挑选，判为不支持核验而不是判错", () => {
    const opinion: SourceClaim = {
      claimText: "物价压力已经缓解，政策效果显现",
      metric: "全国居民消费价格",
      scope: "全国",
      period: "2026-08",
      value: null,
      basis: null,
      kind: "opinion",
      fromImage: false,
      imageExcerpt: null,
    };
    const judgment = judgeRun(
      expectationOf("q15-opinion-not-verifiable"),
      resultFor([opinion], [], { caption: "物价压力已经缓解，政策效果显现。" }),
    );
    expect(judgment.problems).toEqual([]);
    expect(judgment.conclusions[0]).toMatchObject({ status: "not-verifiable", kind: "opinion" });

    // 分类错了（当成可核验的直接陈述）就判不出来，说明这条规则确实在核对分类。
    const misclassified = judgeRun(
      expectationOf("q15-opinion-not-verifiable"),
      resultFor([{ ...opinion, kind: "direct" }], [], { caption: "物价压力已经缓解，政策效果显现。" }),
    );
    expect(misclassified.problems.map((problem) => problem.kind)).toContain("no-matching-claim");
  });

  it("配文超过三条时缺少未展开提示会被记为未通过", () => {
    const claim = {
      claimText: "2026 年 8 月 CPI 同比上涨 0.8%",
      metric: "全国居民消费价格",
      scope: "全国",
      period: "2026-08",
      value: 0.8,
      basis: "year-on-year" as const,
      kind: "direct" as const,
      fromImage: false,
      imageExcerpt: null,
    };
    const noNotice = judgeRun(
      expectationOf("q16-caption-over-three-claims"),
      resultFor([claim], [{ sourceId: "stats-cpi-2026-08", role: "value-basis", note: null }], { hits: cpiHits("2026-08"), caption: "2026 年 8 月 CPI 同比上涨 0.8%。" }),
    );
    expect(noNotice.problems.map((problem) => problem.kind)).toContain("missing-incomplete-notice");

    const withNotice = judgeRun(
      expectationOf("q16-caption-over-three-claims"),
      {
        ...resultFor([claim], [{ sourceId: "stats-cpi-2026-08", role: "value-basis", note: null }], { hits: cpiHits("2026-08"), caption: "2026 年 8 月 CPI 同比上涨 0.8%。" }),
        omittedClaims: [{ claimText: "7 月 CPI 比上月便宜。", reason: "单次最多核验 3 条主张。", source: "caption" }],
        captionCoverageNote: "配文还有 1 处内容没有核验。",
      },
    );
    expect(withNotice.problems.map((problem) => problem.kind)).not.toContain("missing-incomplete-notice");
  });

  it("无适用来源的题里「推断依据不足」不算越界结论", () => {
    const overclaimStatuses = (
      status: "inference-unsupported" | "not-verifiable",
    ) => judgeRun(
      expectationOf("q08-caption-image-basis-unclear"),
      {
        ...resultFor([claim()], []),
        conclusions: resultFor([claim()], []).conclusions.map((conclusion) => ({ ...conclusion, status })),
      },
    ).problems.map((problem) => problem.kind);

    expect(overclaimStatuses("inference-unsupported")).not.toContain("no-applicable-source-overclaim");
    expect(overclaimStatuses("not-verifiable")).not.toContain("no-applicable-source-overclaim");
  });
});

describe("开跑前的花费预检", () => {
  it("按题数 × 臂数 × 次数算出本次要发出的请求数", () => {
    expect(plannedRequests(17, 2, 3)).toBe(102);
    expect(plannedRequests(1, 1, 1)).toBe(1);
  });

  it("只对 DeepSeek 官方端点做余额预检，其他端点直接跳过", async () => {
    expect(isDeepSeekEndpoint("https://api.deepseek.com/anthropic/v1")).toBe(true);
    expect(isDeepSeekEndpoint("https://api.anthropic.com/v1")).toBe(false);

    const skipped = await checkBalance("https://api.anthropic.com/v1", "sk-test", 1, async () => {
      throw new Error("跳过时不该发起请求");
    });
    expect(skipped).toMatchObject({ checked: false, blocked: false });
    expect(skipped.message).toContain("跳过余额预检");
  });

  it("余额低于下限时拦下运行，余额充足时不拦", async () => {
    const low = await checkBalance(
      "https://api.deepseek.com/anthropic/v1",
      "sk-test",
      1,
      async () => new Response(JSON.stringify({
        is_available: false,
        balance_infos: [{ currency: "CNY", total_balance: "-0.01", granted_balance: "0.00", topped_up_balance: "-0.01" }],
      }), { status: 200 }),
    );
    expect(low).toMatchObject({ checked: true, totalBalance: -0.01, blocked: true });
    expect(low.message).toContain("不可用");

    const enough = await checkBalance(
      "https://api.deepseek.com/anthropic/v1",
      "sk-test",
      1,
      async () => new Response(
        JSON.stringify({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "8.50" }] }),
        { status: 200 },
      ),
    );
    expect(enough).toMatchObject({ checked: true, totalBalance: 8.5, blocked: false });
  });

  it("余额接口不可用时只提示不拦截，不让预检本身挡住评测", async () => {
    const broken = await checkBalance(
      "https://api.deepseek.com/anthropic/v1",
      "sk-test",
      1,
      async () => new Response("boom", { status: 500 }),
    );
    expect(broken).toMatchObject({ checked: false, blocked: false });
    expect(broken.message).toContain("HTTP 500");
  });
});

/** 替身驱动器：按脚本返回工具调用，用于在不联网的情况下验证两臂的编排差异。 */
function scriptedDriver(claims: SourceClaim[], citations: ModelCitation[]): SourceInvestigationDriver {
  const searchCall: ToolLoopCall = {
    id: "s1",
    name: SEARCH_TOOL_NAME,
    input: { metric: "全国居民消费价格", period: "2025-12", scope: "全国" },
  };
  const reportCall: ToolLoopCall = {
    id: "r1",
    name: REPORT_TOOL_NAME,
    input: { claims, citations, noApplicableSourceReason: null, unresolvedItems: [] },
  };
  const replies: ToolLoopReply[] = [
    { model: "stub-model", usage: null, text: "先检索。", calls: [searchCall], truncated: false },
    { model: "stub-model", usage: null, text: "汇总。", calls: [reportCall], truncated: false },
  ];
  let index = 0;
  return {
    model: "stub-model",
    async start() { return replies[index++] ?? replies[replies.length - 1]; },
    async resume() { return replies[index++] ?? replies[replies.length - 1]; },
    async continue() { return replies[index++] ?? replies[replies.length - 1]; },
    async finalize() { return replies[replies.length - 1]; },
  };
}

function pairedRun(): Promise<Awaited<ReturnType<typeof runPairedEvaluation>>> {
  const questions = { ...questionsCatalog, questions: questionsCatalog.questions.filter((question) => question.id === "q01-caption-yoy-match") };
  const expectations: SourceAuditExpectations = {
    ...expectationsCatalog,
    questions: expectationsCatalog.questions.filter((entry) => entry.id === "q01-caption-yoy-match"),
  };
  return runPairedEvaluation(questions, expectations, {
    runs: 1,
    driverFactory: (): SourceInvestigationDriver => scriptedDriver([claim()], VALUE_CITATION),
  });
}

describe("有检索与无检索两臂的配对运行", () => {
  it("无检索臂里检索调用被拒绝且不回落命中，结论一律待核对", async () => {
    const report = await pairedRun();
    const retrieval = report.records.find((record) => record.arm === "retrieval");
    const noRetrieval = report.records.find((record) => record.arm === "no-retrieval");
    if (!retrieval || !noRetrieval) throw new Error("两臂都应各有一条记录");

    expect(retrieval.hitIds).toContain("stats-cpi-2025-12");
    expect(retrieval.conclusions[0].status).toBe("source-match");
    expect(retrieval.judgment.ok).toBe(true);

    expect(noRetrieval.hitIds).toEqual([]);
    expect(noRetrieval.conclusions[0].status).toBe("source-pending");
    expect(noRetrieval.toolSequence).toContain(`${SEARCH_TOOL_NAME}:rejected`);
    expect(noRetrieval.toolCallsUsed).toBe(0);
    // 无检索臂里凭记忆引用资料库 ID 会被记为「凭记忆复用」，不是虚构引用。
    expect(noRetrieval.recalledCitations).toEqual(["stats-cpi-2025-12"]);
    expect(noRetrieval.fabricatedCitations).toEqual([]);

    expect(report.summary.questions[0].verdict).toBe("仅检索臂正确");
  });

  it("上游失败的运行单列，不进入状态正确率的分母", async () => {
    const questions = { ...questionsCatalog, questions: questionsCatalog.questions.filter((question) => question.id === "q01-caption-yoy-match") };
    const expectations: SourceAuditExpectations = {
      ...expectationsCatalog,
      questions: expectationsCatalog.questions.filter((entry) => entry.id === "q01-caption-yoy-match"),
    };
    const report = await runPairedEvaluation(questions, expectations, {
      runs: 2,
      arms: ["retrieval"],
      driverFactory: () => scriptedDriver([claim()], VALUE_CITATION),
    });
    expect(report.records).toHaveLength(2);

    const failing: RunRecord[] = report.records.map((record, index) => index === 0
      ? { ...record, status: "failed" as const }
      : record);
    const summary = summarizeEvaluation(failing, expectations);
    const arm = summary.arms[0];
    expect(arm.attempts).toBe(2);
    expect(arm.validRuns).toBe(1);
    expect(arm.failedRuns).toBe(1);
    expect(arm.accuracy).toBe(1);
  });

  it("门槛按冻结配置计算并可复现", async () => {
    const report = await pairedRun();
    const gates = report.summary.gates;
    expect(gates.map((gate) => gate.id)).toEqual(["claim-status-accuracy", "fabricated-citations", "no-applicable-source"]);
    const accuracy = gates.find((gate) => gate.id === "claim-status-accuracy");
    expect(accuracy?.passed).toBe(true);
    expect(accuracy?.detail).toContain("100.0%");
    expect(report.summary.gateArm).toBe("retrieval");
    expect(report.summary.degradedQuestions).toEqual([]);
  });
});

describe("任务 04 新增的补证与追问题", () => {
  it("19 题：02+03 的 17 题不动，q18/q19 有独立输入与成对的期望", () => {
    // 任务 05 在其后追加了 q20、任务 06 追加了 q21/q22，这里只核对 04 定下的前 19 题仍在原位。
    expect(questionsCatalog.questions.slice(0, 19)).toHaveLength(19);
    expect(questionsCatalog.questions.length).toBe(22);
    expect(expectationsCatalog.questions.length).toBe(22);
    const q18 = questionsCatalog.questions.find((question) => question.id === "q18-clarify-basis-resume");
    const e18 = expectationOf("q18-clarify-basis-resume");
    expect(q18?.clarifyAnswer).toBe("同比");
    expect(e18.clarificationRequired).toBe(true);
    expect(e18.clarificationAfterSearch).toBe(true);
    expect(e18.resume?.supplementApplied).toBe(true);
    expect(e18.resume?.expect).toEqual([
      { select: { fromImage: false, basis: "year-on-year", value: 0.8 }, status: "source-match", min: 1 },
    ]);

    const q19 = questionsCatalog.questions.find((question) => question.id === "q19-covered-no-clarify");
    const e19 = expectationOf("q19-covered-no-clarify");
    expect(q19?.clarifyAnswer).toBeUndefined();
    expect(e19.clarificationForbidden).toBe(true);
    expect(e19.resume).toBeUndefined();
  });

  it("类别覆盖补证与恢复、无需追问两类", () => {
    const covered = new Set(questionsCatalog.questions.flatMap((question) => question.categories));
    for (const category of ["补证与恢复", "无需追问"]) expect(covered.has(category)).toBe(true);
  });

  it("题面与期望的补证配置成对冻结，缺一侧即报错", async () => {
    await expect(verifyFrozenSetup(questionsCatalog, expectationsCatalog)).resolves.toEqual([]);

    const missingResume = structuredClone(expectationsCatalog);
    const e18 = missingResume.questions.find((entry) => entry.id === "q18-clarify-basis-resume");
    if (e18) delete e18.resume;
    expect((await verifyFrozenSetup(questionsCatalog, missingResume)).join("\n"))
      .toContain("写了 clarifyAnswer 但期望没有 resume 规则");

    const missingAnswer = structuredClone(questionsCatalog);
    const q18 = missingAnswer.questions.find((question) => question.id === "q18-clarify-basis-resume");
    if (q18) delete q18.clarifyAnswer;
    expect((await verifyFrozenSetup(missingAnswer, expectationsCatalog)).join("\n"))
      .toContain("有 resume 规则但题面缺少 clarifyAnswer");

    const missingSupplement = structuredClone(expectationsCatalog);
    const e18b = missingSupplement.questions.find((entry) => entry.id === "q18-clarify-basis-resume");
    if (e18b?.resume) delete e18b.resume.supplementApplied;
    expect((await verifyFrozenSetup(questionsCatalog, missingSupplement)).join("\n"))
      .toContain("缺少 supplementApplied");
  });

  it("追问时机判定：缺追问、资料已覆盖仍追问、追问先于检索", () => {
    const base = resultFor([claim()], VALUE_CITATION);
    const withClarification = {
      ...base,
      clarification: { question: "是同比还是环比？", purpose: "决定口径。", field: "basis" as const, claimText: null },
      trace: [
        { round: 1, order: 1, detail: "", status: "ok" as const, tool: "search_source_library", inputSummary: "", resultSummary: "", durationMs: 1 },
        { round: 2, order: 1, detail: "", status: "ok" as const, tool: "request_clarification", inputSummary: "", resultSummary: "", durationMs: 1 },
      ],
    };

    // 缺追问：q18 要求必须追问。
    const missing = judgeRun(expectationOf("q18-clarify-basis-resume"), base, { arm: "retrieval" });
    expect(missing.problems.map((problem) => problem.kind)).toContain("missing-clarification");

    // 追问先于检索（检索臂）：必须先检索再追问。
    const beforeSearch = judgeRun(expectationOf("q18-clarify-basis-resume"), {
      ...withClarification,
      trace: [
        { round: 1, order: 1, detail: "", status: "ok" as const, tool: "request_clarification", inputSummary: "", resultSummary: "", durationMs: 1 },
        { round: 2, order: 1, detail: "", status: "ok" as const, tool: "search_source_library", inputSummary: "", resultSummary: "", durationMs: 1 },
      ],
    }, { arm: "retrieval" });
    expect(beforeSearch.problems.map((problem) => problem.kind)).toContain("clarification-before-search");

    // 同一轨迹在无检索臂不判顺序（没有可执行的检索）。
    const noSearchArm = judgeRun(expectationOf("q18-clarify-basis-resume"), {
      ...withClarification,
      trace: [{ round: 1, order: 1, detail: "", status: "ok" as const, tool: "request_clarification", inputSummary: "", resultSummary: "", durationMs: 1 }],
    }, { arm: "no-retrieval" });
    expect(noSearchArm.problems.map((problem) => problem.kind)).not.toContain("clarification-before-search");

    // 资料已覆盖的题不许追问。
    const forbidden = judgeRun(expectationOf("q19-covered-no-clarify"), withClarification, { arm: "retrieval" });
    expect(forbidden.problems.map((problem) => problem.kind)).toContain("unexpected-clarification");
  });

  it("补证后阶段用 resume 规则判定，并要求补充确实被套用", () => {
    const CAPTION = "12 月 CPI 同比上涨 0.8%。";
    const before = resultFor([claim({ basis: null })], VALUE_CITATION, { caption: CAPTION });
    const expectFn = expectationOf("q18-clarify-basis-resume");

    // 补证后：口径填入、状态改判、补充记录存在 → 通过。
    const supplemented = resultFor([claim({ basis: "year-on-year" })], VALUE_CITATION, { caption: CAPTION });
    supplemented.supplement = {
      question: "是同比还是环比？",
      purpose: "决定口径。",
      field: "basis",
      claimText: "12 月 CPI 同比上涨 0.8%。",
      answer: "同比",
      normalized: "year-on-year",
      applied: true,
      conflicts: [],
      parseNote: null,
      note: "比较方式由用户补充确定，标为用户提供（不是官方来源）。",
    };
    const after = judgeRun(expectFn, supplemented, { arm: "retrieval", phase: "after" });
    expect(after.problems).toEqual([]);

    // 没有套用补充 → missing-supplement-application。
    const notApplied = judgeRun(expectFn, before, { arm: "retrieval", phase: "after" });
    expect(notApplied.problems.map((problem) => problem.kind)).toContain("missing-supplement-application");

    // 补证后阶段仍按状态规则判定：口径没填上时 select 匹配不到期望的主张。
    const stillPending = judgeRun(expectFn, before, { arm: "retrieval", phase: "after" });
    expect(stillPending.problems.map((problem) => problem.kind)).toContain("no-matching-claim");
  });

  it("两阶段 runner：初查提出追问后沿同一段对话恢复，两段各自判定并落记录", async () => {
    const clarifyCall = {
      id: "c1",
      name: "request_clarification",
      input: {
        question: "配文没写比较方式，0.8% 是同比还是环比？",
        purpose: "决定用哪个口径核对。",
        field: "basis",
        claimText: "12 月 CPI 上涨 0.8%。",
      },
    };
    const searchCall = {
      id: "s1",
      name: "search_source_library",
      input: { metric: "全国居民消费价格", period: "2025-12", scope: "全国", terms: [] },
    };
    const claimNoBasis: SourceClaim = {
      claimText: "12 月 CPI 上涨 0.8%。",
      metric: "全国居民消费价格",
      scope: "全国",
      period: "2025-12",
      value: 0.8,
      basis: null,
      kind: "direct",
      direction: null,
      fromImage: false,
      imageExcerpt: null,
    };
    const reportCall = (basis: "month-on-month" | null) => ({
      id: "r1",
      name: "report_source_finding",
      input: {
        claims: [{ ...claimNoBasis, basis }],
        citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
        noApplicableSourceReason: null,
        unresolvedItems: [],
        omittedClaims: [],
      },
    });
    const replies: ToolLoopReply[] = [
      { model: "stub", usage: null, text: "先检索。", calls: [searchCall], truncated: false },
      { model: "stub", usage: null, text: "缺口径，追问。", calls: [clarifyCall], truncated: false },
      { model: "stub", usage: null, text: "汇总。", calls: [reportCall(null)], truncated: false },
      { model: "stub", usage: null, text: "补证后汇总。", calls: [reportCall("month-on-month")], truncated: false },
    ];
    let index = 0;
    const driver: SourceInvestigationDriver = {
      model: "stub",
      async start() { return replies[index++] ?? replies[replies.length - 1]; },
      async resume() { return replies[index++] ?? replies[replies.length - 1]; },
      async continue() { return replies[index++] ?? replies[replies.length - 1]; },
      async finalize() { return replies[replies.length - 1]; },
    };

    const questions = {
      ...questionsCatalog,
      questions: questionsCatalog.questions.filter((question) => question.id === "q18-clarify-basis-resume"),
    };
    const expectations: SourceAuditExpectations = {
      ...expectationsCatalog,
      questions: expectationsCatalog.questions.filter((entry) => entry.id === "q18-clarify-basis-resume"),
    };
    const report = await runPairedEvaluation(questions, expectations, {
      runs: 1,
      arms: ["retrieval"],
      driverFactory: () => driver,
    });

    const before = report.records.find((record) => record.phase === "before");
    const after = report.records.find((record) => record.phase === "after");
    expect(before).toBeDefined();
    expect(before?.clarification).toMatchObject({ field: "basis", claimText: "12 月 CPI 上涨 0.8%。" });
    expect(before?.conclusions[0].status).toBe("source-pending");
    expect(before?.judgment.ok).toBe(true);

    // 补证后：程序把「同比」套用到主张、状态改判、补充记录落档。
    expect(after).toBeDefined();
    expect(after?.supplement).toMatchObject({ answer: "同比", applied: true });
    expect(after?.conclusions[0].status).toBe("source-match");
    expect(after?.conclusionChanges).toEqual([
      expect.objectContaining({ before: "source-pending", after: "source-match", changed: true }),
    ]);
    expect(after?.judgment.ok).toBe(true);
    // 预算跨阶段接续：第二段工具调用累计而不是从零算。
    expect(after?.toolCallsUsed).toBeGreaterThanOrEqual(before?.toolCallsUsed ?? 0);
    expect(report.summary.arms[0].resumeRuns).toBe(1);
    expect(report.summary.arms[0].supplementAppliedRuns).toBe(1);
  });

  it("初查未追问时不跑补证后阶段，也不编造记录", async () => {
    const searchCall = {
      id: "s1",
      name: "search_source_library",
      input: { metric: "全国居民消费价格", period: "2025-12", scope: "全国", terms: [] },
    };
    const reportCall = {
      id: "r1",
      name: "report_source_finding",
      input: {
        claims: [{
          claimText: "12 月 CPI 上涨 0.8%。",
          metric: "全国居民消费价格",
          scope: "全国",
          period: "2025-12",
          value: 0.8,
          basis: null,
          kind: "direct",
          direction: null,
          fromImage: false,
          imageExcerpt: null,
        }],
        citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
        noApplicableSourceReason: null,
        unresolvedItems: [],
        omittedClaims: [],
      },
    };
    const replies: ToolLoopReply[] = [
      { model: "stub", usage: null, text: "检索。", calls: [searchCall], truncated: false },
      { model: "stub", usage: null, text: "汇总。", calls: [reportCall], truncated: false },
    ];
    let index = 0;
    const driver: SourceInvestigationDriver = {
      model: "stub",
      async start() { return replies[index++] ?? replies[replies.length - 1]; },
      async resume() { throw new Error("初查未追问，不应进入恢复段"); },
      async continue() { return replies[index++] ?? replies[replies.length - 1]; },
      async finalize() { return replies[replies.length - 1]; },
    };

    const questions = {
      ...questionsCatalog,
      questions: questionsCatalog.questions.filter((question) => question.id === "q18-clarify-basis-resume"),
    };
    const expectations: SourceAuditExpectations = {
      ...expectationsCatalog,
      questions: expectationsCatalog.questions.filter((entry) => entry.id === "q18-clarify-basis-resume"),
    };
    const report = await runPairedEvaluation(questions, expectations, {
      runs: 1,
      arms: ["retrieval"],
      driverFactory: () => driver,
    });

    // 只有一条补证前记录；未追问已由 missing-clarification 判为未通过。
    expect(report.records).toHaveLength(1);
    expect(report.records[0].phase).toBe("before");
    expect(report.records[0].judgment.problems.map((problem) => problem.kind)).toContain("missing-clarification");
    expect(report.records[0].judgment.ok).toBe(false);
    expect(report.summary.arms[0].resumeRuns).toBe(0);
  });

  it("带补证阶段的题把计划请求数翻倍计", () => {
    expect(plannedRequests(19, 2, 3, 1)).toBe(120); // 19 题 + q18 的恢复段
    expect(plannedRequests(19, 2, 3)).toBe(114);
  });
});

describe("任务 05 新增的改写期望题", () => {
  const CAPTION = "2025 年 12 月 CPI 同比上涨 0.2%，2026 年 5 月 CPI 比上月上涨 0.1%。";
  const WRONG_YOY: SourceClaim = {
    claimText: "2025 年 12 月 CPI 同比上涨 0.2%",
    metric: "全国居民消费价格",
    scope: "全国",
    period: "2025-12",
    value: 0.2,
    basis: "year-on-year",
    kind: "direct",
    direction: null,
    fromImage: false,
    imageExcerpt: null,
  };
  const NO_SOURCE_MOM: SourceClaim = {
    claimText: "2026 年 5 月 CPI 比上月上涨 0.1%",
    metric: "全国居民消费价格",
    scope: "全国",
    period: "2026-05",
    value: 0.1,
    basis: "month-on-month",
    kind: "direct",
    direction: null,
    fromImage: false,
    imageExcerpt: null,
  };

  function q20Result(): SourceInvestigationResult {
    return resultFor([WRONG_YOY, NO_SOURCE_MOM], VALUE_CITATION, { caption: CAPTION });
  }

  it("q20 有独立输入与成对的期望：替换错误值 + 保留未解决项", () => {
    const question = questionsCatalog.questions.find((entry) => entry.id === "q20-rewrite-replace-and-qualify");
    expect(question?.caption).toBe(CAPTION);
    expect(question?.categories).toContain("修改建议");
    const expectation = expectationOf("q20-rewrite-replace-and-qualify");
    expect(expectation.suggestion?.expectChanges).toEqual([
      { select: { fromImage: false, basis: "year-on-year", period: "2025-12" }, kinds: ["replace-value"], min: 1 },
      { select: { fromImage: false, basis: "month-on-month", period: "2026-05" }, kinds: ["keep-qualified", "suggest-delete"], min: 1 },
    ]);
    expect(expectation.suggestion?.requiredNumbers).toEqual([0.8]);
    expect(expectation.suggestion?.forbiddenNumbers).toEqual([0.2]);

    const judgment = judgeRun(expectation, q20Result(), { caption: CAPTION });
    expect(judgment.problems).toEqual([]);
    expect(q20Result().captionSuggestion?.suggestedCaption)
      .toBe("2025 年 12 月 CPI 同比上涨 0.8%，2026 年 5 月 CPI 比上月上涨 0.1%（暂未核实）。");
  });

  it("引入新数值或把未解决主张原样保留都会被独立复算抓住", () => {
    const result = q20Result();
    const suggestion = result.captionSuggestion;
    if (!suggestion) throw new Error("q20 应当生成建议配文");
    const tampered: SourceInvestigationResult = {
      ...result,
      captionSuggestion: {
        ...suggestion,
        suggestedCaption: suggestion.suggestedCaption.replace("0.8", "1.2"),
        changes: suggestion.changes.map((change) =>
          change.kind === "keep-qualified" ? { ...change, kind: "unchanged" as const } : change),
      },
    };
    const kinds = judgeRun(expectationOf("q20-rewrite-replace-and-qualify"), tampered, { caption: CAPTION })
      .problems.map((problem) => problem.kind);
    expect(kinds).toContain("suggestion-new-number");
    expect(kinds).toContain("suggestion-missing-number");
    expect(kinds).toContain("suggestion-unresolved-unqualified");
  });

  it("改写规则只追加在指定题目上，原有期望字段未被改写", () => {
    const withSuggestion = expectationsCatalog.questions
      .filter((entry) => entry.suggestion || entry.resume?.suggestion)
      .map((entry) => entry.id);
    expect(withSuggestion).toEqual([
      "q03-caption-mom-value-as-yoy",
      "q04-caption-yoy-value-as-mom",
      "q05-caption-wrong-month-distractor",
      "q08-caption-image-basis-unclear",
      "q13-inference-mom-contradicted",
      "q15-opinion-not-verifiable",
      "q17-inference-no-mom-source",
      "q18-clarify-basis-resume",
      "q19-covered-no-clarify",
      "q20-rewrite-replace-and-qualify",
      "q21-retail-value-superseded",
    ]);
    // 没有被追加改写规则的题保持原样（没有任何 suggestion 字段）。
    for (const id of ["q01-caption-yoy-match", "q16-caption-over-three-claims"]) {
      const expectation = expectationOf(id);
      expect(expectation.suggestion).toBeUndefined();
      expect(expectation.resume?.suggestion).toBeUndefined();
    }
  });
});
