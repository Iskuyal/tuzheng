import { describe, expect, it } from "vitest";
import {
  AnthropicSourceInvestigationDriver,
  ResponsesSourceInvestigationDriver,
  SourceInvestigationError,
  runSourceInvestigation,
  type SourceInvestigationDriver,
  type ToolLoopCall,
  type ToolLoopReply,
  type ToolResultPayload,
} from "../server/source-investigation.js";
import {
  CLARIFY_TOOL_NAME,
  COMPARE_TOOL_NAME,
  REPORT_TOOL_NAME,
  SEARCH_TOOL_NAME,
} from "../server/source-tools.js";
import { SOURCE_INVESTIGATION_PROMPT, SOURCE_NO_RETRIEVAL_NOTE, sourceInvestigationPrompt } from "../server/source-prompt.js";
import { TOOL_CALLS_PER_INVESTIGATION } from "../shared/source-audit.js";

/** 替身驱动器：按脚本依次返回模型回复，并记录实际回传的工具结果。 */
function scriptedDriver(replies: ToolLoopReply[], finalizeReply?: ToolLoopReply): SourceInvestigationDriver & {
  continued: ToolResultPayload[][];
  finalizeReasons: string[];
} {
  let index = 0;
  const state = {
    continued: [] as ToolResultPayload[][],
    finalizeReasons: [] as string[],
  };
  const next = (): ToolLoopReply => replies[index++] ?? { model: "stub-model", usage: null, text: null, calls: [], truncated: false };

  return {
    model: "stub-model",
    ...state,
    get continued() { return state.continued; },
    get finalizeReasons() { return state.finalizeReasons; },
    async start() { return next(); },
    async continue(results: ToolResultPayload[]) {
      state.continued.push(results);
      return next();
    },
    async finalize(reason: string) {
      state.finalizeReasons.push(reason);
      return finalizeReply ?? next();
    },
  } as SourceInvestigationDriver & { continued: ToolResultPayload[][]; finalizeReasons: string[] };
}

function reply(options: {
  calls?: ToolLoopCall[];
  text?: string | null;
  truncated?: boolean;
}): ToolLoopReply {
  return {
    model: "stub-model",
    usage: { inputTokens: 100, outputTokens: 50 },
    text: options.text ?? null,
    calls: options.calls ?? [],
    truncated: options.truncated ?? false,
  };
}

function call(name: string, input: unknown, id = `${name}-1`): ToolLoopCall {
  return { id, name, input };
}

const CPI_SEARCH = call(SEARCH_TOOL_NAME, {
  metric: "全国居民消费价格",
  period: "2025-12",
  scope: "全国",
  terms: ["同比", "环比"],
});

const CAPTION_CLAIM = {
  claimText: "比上月上涨 0.8%",
  metric: "全国居民消费价格",
  scope: "全国",
  period: "2025-12",
  value: 0.8,
  basis: "month-on-month",
  kind: "direct",
  fromImage: false,
  imageExcerpt: null,
};

const IMAGE_CLAIM = {
  claimText: "2025 年 12 月全国 CPI 上涨 0.8%",
  metric: "全国居民消费价格",
  scope: "全国",
  period: "2025-12",
  value: 0.8,
  basis: null,
  kind: "direct",
  fromImage: true,
  imageExcerpt: "2025 年 12 月全国 CPI 上涨 0.8%",
};

const REPORT = call(REPORT_TOOL_NAME, {
  claims: [IMAGE_CLAIM, CAPTION_CLAIM],
  citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: "环比数值核对" }],
  noApplicableSourceReason: null,
  unresolvedItems: ["图上未标注比较方式。"],
});

describe("请求失败的分类", () => {
  const config = { baseUrl: "https://api.example.com/v1", model: "stub-model", apiKey: "sk-test" };
  const image = { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimeType: "image/png" as const };

  function timeoutError(name: string): Error {
    const error = new Error("boom");
    error.name = name;
    return error;
  }

  it.each([
    ["TimeoutError", "timeout"],
    ["AbortError", "timeout"],
    ["APIConnectionTimeoutError", "timeout"],
    ["TypeError", "upstream"],
  ] as const)("Anthropic 驱动器把 %s 归类为 %s", async (name, kind) => {
    const driver = new AnthropicSourceInvestigationDriver(config, image, "配文", "提示词", async () => {
      throw timeoutError(name);
    });
    await expect(driver.start()).rejects.toMatchObject({ kind });
    await expect(driver.start()).rejects.toBeInstanceOf(SourceInvestigationError);
  });

  it("Responses 驱动器同样区分超时与上游失败", async () => {
    const driver = new ResponsesSourceInvestigationDriver(config, image, "配文", "提示词", async () => {
      throw timeoutError("APIConnectionTimeoutError");
    });
    await expect(driver.start()).rejects.toMatchObject({ kind: "timeout" });
  });

  it("Anthropic 驱动器在 max_tokens 截断时如实标记", async () => {
    const driver = new AnthropicSourceInvestigationDriver(config, image, "配文", "提示词", async () => ({
      content: [{ type: "text", text: "半句" }],
      stop_reason: "max_tokens",
    }));
    await expect(driver.start()).resolves.toMatchObject({ truncated: true, calls: [] });
  });
});

describe("来源调查编排", () => {
  it("执行模型自选的检索并据本次命中组合结论", async () => {
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH], text: "先检索 2025 年 12 月的全国 CPI 材料。" }),
      reply({ calls: [REPORT], text: "用现行命中汇总。" }),
    ]);

    const result = await runSourceInvestigation(driver);

    expect(result.toolCallsUsed).toBe(1);
    expect(result.rounds).toBe(2);
    expect(result.stopReason).toContain("看完工具结果后给出汇总");
    expect(result.trace.map((event) => [event.tool, event.status])).toEqual([
      [SEARCH_TOOL_NAME, "ok"],
      [REPORT_TOOL_NAME, "ok"],
    ]);
    expect(result.trace[0].detail).toBe("先检索 2025 年 12 月的全国 CPI 材料。");
    expect(result.hits.map((hit) => hit.document.id)).toContain("stats-cpi-2025-12");

    // 图上未标比较方式 → 待核对；配文说成环比 → 与发布记载的 0.2% 不一致。
    expect(result.conclusions.map((conclusion) => conclusion.status)).toEqual([
      "source-pending",
      "source-mismatch",
    ]);
    expect(result.conclusions[1].officialValue).toBe(0.2);
    expect(result.excludedSources.map((entry) => entry.sourceId)).toContain("stats-cpi-2026-08");
  });

  it("单轮超过三次调用时只执行前三次，其余记为未执行", async () => {
    const driver = scriptedDriver([
      reply({
        calls: [
          call(SEARCH_TOOL_NAME, { metric: "全国居民消费价格", period: "2025-12", scope: "全国" }, "s1"),
          call(SEARCH_TOOL_NAME, { metric: "全国居民消费价格", period: "2025-12", scope: "全国" }, "s2"),
          call(SEARCH_TOOL_NAME, { metric: "全国居民消费价格", period: "2025-12", scope: "全国" }, "s3"),
          call(SEARCH_TOOL_NAME, { metric: "全国居民消费价格", period: "2025-12", scope: "全国" }, "s4"),
          call(SEARCH_TOOL_NAME, { metric: "全国居民消费价格", period: "2025-12", scope: "全国" }, "s5"),
        ],
      }),
      reply({ calls: [REPORT] }),
    ]);

    const result = await runSourceInvestigation(driver);

    expect(result.toolCallsUsed).toBe(3);
    const rejected = result.trace.filter((event) => event.status === "rejected");
    expect(rejected).toHaveLength(2);
    expect(rejected[0].resultSummary).toContain("本轮超过 3 次工具调用上限");
    // 单轮内多出来的调用既不执行也不计入预算。
    expect(driver.continued[0]).toHaveLength(3);
  });

  it("单次调查累计达到六次后停止执行并触发汇总", async () => {
    const search = (id: string) => call(SEARCH_TOOL_NAME, { metric: "全国居民消费价格", period: "2025-12", scope: "全国" }, id);
    const driver = scriptedDriver(
      [
        reply({ calls: [search("r1a"), search("r1b"), search("r1c")] }),
        reply({ calls: [search("r2a")] }),
        // 这一轮三个调用里只有一个还在总预算内，其余两个被拒绝。
        reply({ calls: [search("r3a"), search("r3b"), search("r3c")] }),
      ],
      reply({ calls: [REPORT] }),
    );

    const result = await runSourceInvestigation(driver);

    expect(result.toolCallsUsed).toBe(TOOL_CALLS_PER_INVESTIGATION);
    expect(driver.finalizeReasons).toEqual(["工具调用预算用尽。"]);
    expect(result.stopReason).toContain("达到单次调查上限");
    expect(result.conclusions.map((conclusion) => conclusion.status)).toEqual([
      "source-pending",
      "source-mismatch",
    ]);
    const overBudget = result.trace.filter((event) => event.status === "rejected");
    expect(overBudget).toHaveLength(1);
    expect(overBudget[0].resultSummary).toContain("6 次工具调用上限");
  });

  it("预算刚好用尽时直接要求汇总，不再空跑一轮", async () => {
    const search = (id: string) => call(SEARCH_TOOL_NAME, { metric: "全国居民消费价格", period: "2025-12", scope: "全国" }, id);
    const driver = scriptedDriver(
      [
        reply({ calls: [search("r1a"), search("r1b"), search("r1c")] }),
        reply({ calls: [search("r2a"), search("r2b"), search("r2c")] }),
      ],
      reply({ calls: [REPORT] }),
    );

    const result = await runSourceInvestigation(driver);

    expect(result.rounds).toBe(3);
    expect(driver.continued).toHaveLength(1);
    expect(driver.finalizeReasons).toEqual(["工具调用预算用尽。"]);
    expect(result.conclusions[1].status).toBe("source-mismatch");
  });

  it("未知工具名与非法参数都不执行，并如实记录", async () => {
    const driver = scriptedDriver([
      reply({ calls: [
        call("run_shell", { command: "dir" }, "unknown"),
        call(SEARCH_TOOL_NAME, { metric: 42, period: [], scope: "全国" }, "bad-args"),
        call(COMPARE_TOOL_NAME, { left: "0.8", right: 0.2, unit: "%" }, "bad-compare"),
      ] }),
      reply({ calls: [REPORT] }),
    ]);

    const result = await runSourceInvestigation(driver);

    expect(result.toolCallsUsed).toBe(0);
    expect(result.hits).toEqual([]);
    const rejected = result.trace.filter((event) => event.status === "rejected");
    expect(rejected).toHaveLength(3);
    expect(rejected[0].resultSummary).toContain("未知工具 run_shell");
    expect(rejected[1].resultSummary).toContain("检索参数不符合要求");
    expect(rejected[2].resultSummary).toContain("比较参数不符合要求");
    // 没有命中任何材料时，引用一律降级。
    expect(result.conclusions[1].status).toBe("source-pending");
    expect(result.citationsRejected[0].reason).toContain("不在本次检索命中内");
  });

  it("追问只允许一次，第二次被拒绝", async () => {
    const driver = scriptedDriver([
      reply({ calls: [
        call(CLARIFY_TOOL_NAME, { question: "图上的 0.8% 是同比还是环比？", purpose: "决定用哪个口径核对。", field: "basis" }, "c1"),
        call(CLARIFY_TOOL_NAME, { question: "再问一次。", purpose: "重复追问。", field: "period" }, "c2"),
      ] }),
      reply({ calls: [REPORT] }),
    ]);

    const result = await runSourceInvestigation(driver);

    expect(result.clarification).toMatchObject({ field: "basis", question: "图上的 0.8% 是同比还是环比？" });
    expect(result.toolCallsUsed).toBe(1);
    expect(result.trace.filter((event) => event.status === "rejected")).toHaveLength(1);
  });

  it("汇总与工具调用同轮返回时先执行工具，汇总留到下一轮", async () => {
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH, REPORT], text: "先检索。" }),
      reply({ calls: [REPORT], text: "看完结果再汇总。" }),
    ]);

    const result = await runSourceInvestigation(driver);

    expect(result.toolCallsUsed).toBe(1);
    const premature = result.trace.find((event) => event.tool === REPORT_TOOL_NAME && event.status === "rejected");
    expect(premature?.resultSummary).toContain("未采用该汇总");
    expect(result.conclusions[1].status).toBe("source-mismatch");
  });

  it("引用不存在的资料 ID 时结论降级为来源待核对", async () => {
    const fabricated = call(REPORT_TOOL_NAME, {
      claims: [CAPTION_CLAIM],
      citations: [{ sourceId: "stats-invented", role: "value-basis", note: null }],
      noApplicableSourceReason: null,
      unresolvedItems: [],
    });
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH] }),
      reply({ calls: [fabricated] }),
    ]);

    const result = await runSourceInvestigation(driver);

    expect(result.conclusions[0].status).toBe("source-pending");
    expect(result.citationsRejected).toEqual([
      { sourceId: "stats-invented", reason: "引用 stats-invented 不在本次检索命中内，不作为依据。" },
    ]);
  });

  it("没有适用来源时采用模型给出的原因并保持待核对", async () => {
    const noSource = call(REPORT_TOOL_NAME, {
      claims: [CAPTION_CLAIM],
      citations: [],
      noApplicableSourceReason: "资料库未收录该月份的材料。",
      unresolvedItems: ["缺少适用月份的发布。"],
    });
    const driver = scriptedDriver([
      reply({ calls: [call(SEARCH_TOOL_NAME, { metric: "全国居民消费价格", period: "2027-01", scope: "全国" }, "miss")] }),
      reply({ calls: [noSource] }),
    ]);

    const result = await runSourceInvestigation(driver);

    expect(result.conclusions[0].status).toBe("source-pending");
    expect(result.noApplicableSourceReason).toBe("资料库未收录该月份的材料。");
    expect(result.unresolvedItems).toEqual(["缺少适用月份的发布。"]);
  });

  it("汇总结构非法时先重报一次，仍不合法才停止且不伪造结论", async () => {
    const driver = scriptedDriver(
      [
        reply({ calls: [CPI_SEARCH] }),
        reply({ calls: [call(REPORT_TOOL_NAME, { claims: "两条", citations: [] })] }),
        reply({ calls: [call(REPORT_TOOL_NAME, { claims: "还是不对" })] }),
      ],
      reply({ calls: [call(REPORT_TOOL_NAME, { claims: "仍然不是数组" })] }),
    );

    const result = await runSourceInvestigation(driver);

    expect(result.claims).toEqual([]);
    expect(result.stopReason).toContain("汇总结构无效");
    expect(driver.finalizeReasons).toEqual(["上一次汇总结构不符合要求，请重新汇总。"]);
    expect(result.trace.map((event) => event.status)).toContain("rejected");
  });

  it("汇总第一次被拒后重报成功，结论照常由程序组合", async () => {
    const driver = scriptedDriver(
      [
        reply({ calls: [CPI_SEARCH] }),
        reply({ calls: [call(REPORT_TOOL_NAME, { claims: "结构不对", citations: [] })] }),
      ],
      reply({ calls: [REPORT] }),
    );

    const result = await runSourceInvestigation(driver);

    expect(result.stopReason).toContain("重新汇总后采用");
    expect(result.conclusions.map((conclusion) => conclusion.status)).toEqual([
      "source-pending",
      "source-mismatch",
    ]);
  });

  it("模型漏填可选字段时按「没读到」处理，不会因此得到来源一致的结论", async () => {
    const sparse = call(REPORT_TOOL_NAME, {
      claims: [{ claimText: "比上月上涨 0.8%" }],
      citations: [{ sourceId: "stats-cpi-2025-12" }],
    });
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH] }),
      reply({ calls: [sparse] }),
    ]);

    const result = await runSourceInvestigation(driver);

    expect(result.claims[0]).toMatchObject({ metric: null, period: null, value: null, basis: null, fromImage: false });
    expect(result.claims[0].imageExcerpt).toBeNull();
    expect(result.conclusions[0].status).toBe("source-pending");
  });

  it("模型输出被截断时保留已发生的事件并停止", async () => {
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH] }),
      reply({ calls: [], truncated: true }),
    ]);

    const result = await runSourceInvestigation(driver);

    expect(result.stopReason).toContain("截断");
    expect(result.claims).toEqual([]);
    expect(result.toolCallsUsed).toBe(1);
  });

  it("模型一直不调用工具时走轮次上限并要求汇总；没有命中就不能给出确定来源结论", async () => {
    const driver = scriptedDriver(
      [reply({ calls: [] }), reply({ calls: [] }), reply({ calls: [] })],
      reply({ calls: [REPORT], text: "按要求汇总。" }),
    );

    const result = await runSourceInvestigation(driver);

    expect(driver.finalizeReasons.length).toBeGreaterThan(0);
    expect(result.hits).toEqual([]);
    expect(result.conclusions.map((conclusion) => conclusion.status)).toEqual([
      "source-pending",
      "source-pending",
    ]);
    expect(result.citationsRejected[0].reason).toContain("不在本次检索命中内");
  });
});

describe("无检索对照臂", () => {
  it("两臂的提示词只差一句必要说明", () => {
    const withRetrieval = sourceInvestigationPrompt({ retrieval: true });
    const withoutRetrieval = sourceInvestigationPrompt({ retrieval: false });

    expect(withRetrieval).toBe(SOURCE_INVESTIGATION_PROMPT);
    expect(withoutRetrieval.startsWith(withRetrieval)).toBe(true);
    expect(withoutRetrieval.slice(withRetrieval.length)).toBe(`\n${SOURCE_NO_RETRIEVAL_NOTE}`);
    expect(withoutRetrieval).toContain("noApplicableSourceReason");
    expect(withoutRetrieval).toContain("不要引用任何 sourceId");
  });

  it("检索调用被拒绝、不执行检索、命中集合保持为空", async () => {
    let searchCalls = 0;
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH], text: "先检索。" }),
      reply({ calls: [REPORT], text: "汇总。" }),
    ]);

    const result = await runSourceInvestigation(driver, {
      allowSearch: false,
      search: () => {
        searchCalls += 1;
        return [];
      },
    });

    expect(searchCalls).toBe(0);
    expect(result.toolCallsUsed).toBe(0);
    expect(result.hits).toEqual([]);
    const rejected = result.trace.find((event) => event.tool === SEARCH_TOOL_NAME);
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.resultSummary).toContain("无检索对照");
    // 引用只能来自本次命中：无检索臂里即使模型引用真实资料 ID 也必须降级。
    expect(result.conclusions.map((conclusion) => conclusion.status)).toEqual([
      "source-pending",
      "source-pending",
    ]);
    expect(result.citationsRejected[0].reason).toContain("不在本次检索命中内");
    expect(result.citations[0].sourceId).toBe("stats-cpi-2025-12");
  });

  it("无检索臂用同一份调用上限，比较与追问仍然可用", async () => {
    const compare = call(COMPARE_TOOL_NAME, { left: 0.8, right: 0.8, unit: "%" }, "c1");
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH, compare], text: "先比较。" }),
      reply({ calls: [REPORT], text: "汇总。" }),
    ]);

    const result = await runSourceInvestigation(driver, { allowSearch: false });

    expect(result.toolCallsUsed).toBe(1);
    expect(result.trace.map((event) => [event.tool, event.status])).toEqual([
      [SEARCH_TOOL_NAME, "rejected"],
      [COMPARE_TOOL_NAME, "ok"],
      [REPORT_TOOL_NAME, "ok"],
    ]);
  });

  it("Anthropic 驱动器在无检索臂里不声明检索工具", async () => {
    const bodies: Array<{ tools: Array<{ name: string }> }> = [];
    const driver = new AnthropicSourceInvestigationDriver(
      { baseUrl: "https://api.example.com/v1", model: "stub-model", apiKey: "sk-test" },
      { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimeType: "image/png" },
      "配文",
      "提示词",
      async (body) => {
        bodies.push(body as unknown as { tools: Array<{ name: string }> });
        return { content: [{ type: "text", text: "好的" }] };
      },
      { includeSearch: false },
    );

    await driver.start();

    expect(bodies[0].tools.map((tool) => tool.name)).not.toContain(SEARCH_TOOL_NAME);
    expect(bodies[0].tools.map((tool) => tool.name)).toEqual([COMPARE_TOOL_NAME, CLARIFY_TOOL_NAME, REPORT_TOOL_NAME]);
  });

  it("Responses 驱动器同样支持不声明检索工具", async () => {
    const bodies: Array<{ tools: Array<{ name: string }> }> = [];
    const driver = new ResponsesSourceInvestigationDriver(
      { baseUrl: "https://api.example.com/v1", model: "stub-model", apiKey: "sk-test" },
      { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimeType: "image/png" },
      "配文",
      "提示词",
      async (parameters) => {
        bodies.push(parameters as unknown as { tools: Array<{ name: string }> });
        return { output_text: "好的", output: [] };
      },
      { includeSearch: false },
    );

    await driver.start();

    expect(bodies[0].tools.map((tool) => tool.name)).toEqual([COMPARE_TOOL_NAME, CLARIFY_TOOL_NAME, REPORT_TOOL_NAME]);
  });
});
