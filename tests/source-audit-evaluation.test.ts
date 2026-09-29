import { describe, expect, it } from "vitest";
import {
  expectationsCatalog,
  judgeRun,
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
  options: { hits?: SourceHit[]; noApplicableSourceReason?: string | null } = {},
): SourceInvestigationResult {
  const hits = options.hits ?? cpiHits();
  const audit = auditClaimsAgainstSources({
    claims,
    citations,
    hits,
    noApplicableSourceReason: options.noApplicableSourceReason ?? null,
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
  };
}

const VALUE_CITATION: ModelCitation[] = [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }];

function expectationOf(id: string) {
  const expectation = expectationsCatalog.questions.find((entry) => entry.id === id);
  if (!expectation) throw new Error(`期望里没有 ${id}`);
  return expectation;
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
