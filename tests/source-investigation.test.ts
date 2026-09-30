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
import { CAPTION_COVERAGE_MIN, TOOL_CALLS_PER_INVESTIGATION, searchSourceLibrary, type SourceClaim, type SourceInvestigationResult } from "../shared/source-audit.js";

/** 替身驱动器：按脚本依次返回模型回复，并记录实际回传的工具结果与恢复消息。 */
function scriptedDriver(replies: ToolLoopReply[], finalizeReply?: ToolLoopReply): SourceInvestigationDriver & {
  continued: ToolResultPayload[][];
  finalizeReasons: string[];
  resumedWith: string[];
} {
  let index = 0;
  const state = {
    continued: [] as ToolResultPayload[][],
    finalizeReasons: [] as string[],
    resumedWith: [] as string[],
  };
  const next = (): ToolLoopReply => replies[index++] ?? { model: "stub-model", usage: null, text: null, calls: [], truncated: false };

  return {
    model: "stub-model",
    ...state,
    get continued() { return state.continued; },
    get finalizeReasons() { return state.finalizeReasons; },
    get resumedWith() { return state.resumedWith; },
    async start() { return next(); },
    async resume(message: string) {
      state.resumedWith.push(message);
      return next();
    },
    async continue(results: ToolResultPayload[]) {
      state.continued.push(results);
      return next();
    },
    async finalize(reason: string) {
      state.finalizeReasons.push(reason);
      return finalizeReply ?? next();
    },
  } as SourceInvestigationDriver & {
    continued: ToolResultPayload[][];
    finalizeReasons: string[];
    resumedWith: string[];
  };
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

  it("恢复前补齐未回应工具调用的 tool_result，避免 Anthropic 拒绝整段对话", async () => {
    const bodies: Array<{ messages: Array<{ role: string; content: Array<{ type: string; tool_use_id?: string }> }> }> = [];
    const driver = new AnthropicSourceInvestigationDriver(config, image, "配文", "提示词", async (body) => {
      bodies.push(body as unknown as { messages: Array<{ role: string; content: Array<{ type: string; tool_use_id?: string }> }> });
      if (bodies.length === 1) {
        // 初查：模型以汇总工具调用结束（编排层接收后不再回传结果）。
        return {
          content: [{ type: "tool_use", id: "call_report", name: "report_source_finding", input: {} }],
          stop_reason: "tool_use",
        };
      }
      return { content: [{ type: "text", text: "好的" }], stop_reason: "end_turn" };
    });

    await driver.start();
    await driver.resume("用户已回答：同比");

    const lastMessage = bodies[1].messages[bodies[1].messages.length - 1];
    const kinds = lastMessage.content.map((block) => block.type);
    // tool_use 后必须紧跟 tool_result，然后才是注入的用户文本。
    expect(kinds).toEqual(["tool_result", "text"]);
    expect(lastMessage.content[0].tool_use_id).toBe("call_report");
  });

  it("模型纯文本回复时不产生空 content 的 assistant 消息", async () => {
    const bodies: Array<{ messages: Array<{ role: string; content: Array<{ type: string }> }> }> = [];
    const driver = new AnthropicSourceInvestigationDriver(config, image, "配文", "提示词", async (body) => {
      bodies.push(body as unknown as { messages: Array<{ role: string; content: Array<{ type: string }> }> });
      if (bodies.length === 1) {
        // 模型只回文本、不调用工具：assistant 消息必须保留文本，不能是空 content。
        return { content: [{ type: "text", text: "先想一想。" }], stop_reason: "end_turn" };
      }
      return { content: [{ type: "text", text: "好的" }], stop_reason: "end_turn" };
    });

    await driver.start();
    await driver.continue([]);

    const assistantMessages = bodies[1].messages.filter((message) => message.role === "assistant");
    expect(assistantMessages.length).toBeGreaterThan(0);
    for (const message of assistantMessages) {
      expect(message.content.length).toBeGreaterThan(0);
    }
    expect(assistantMessages[0].content[0]).toMatchObject({ type: "text", text: "先想一想。" });
  });

  it("同一轮被丢弃的调用在 continue 时也补齐配对的 tool_result", async () => {
    const bodies: Array<{ messages: Array<{ role: string; content: Array<{ type: string; tool_use_id?: string }> }> }> = [];
    const driver = new AnthropicSourceInvestigationDriver(config, image, "配文", "提示词", async (body) => {
      bodies.push(body as unknown as { messages: Array<{ role: string; content: Array<{ type: string; tool_use_id?: string }> }> });
      if (bodies.length === 1) {
        // 首轮返回两个调用，但编排层只回传其中一个（另一个超限被丢）。
        return {
          content: [
            { type: "tool_use", id: "call_kept", name: "search_source_library", input: {} },
            { type: "tool_use", id: "call_dropped", name: "search_source_library", input: {} },
          ],
          stop_reason: "tool_use",
        };
      }
      return { content: [{ type: "text", text: "好的" }], stop_reason: "end_turn" };
    });

    await driver.start();
    await driver.continue([{ id: "call_kept", name: "search_source_library", output: "命中 1 条。", isError: false }]);

    const lastMessage = bodies[1].messages[bodies[1].messages.length - 1];
    const resultIds = lastMessage.content
      .filter((block) => block.type === "tool_result")
      .map((block) => block.tool_use_id);
    // 两个 tool_use 都必须有配对结果，否则下一次请求会被 Anthropic 拒绝。
    expect(resultIds).toContain("call_kept");
    expect(resultIds).toContain("call_dropped");
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
    expect(driver.finalizeReasons).toHaveLength(1);
    expect(driver.finalizeReasons[0]).toContain("上一次汇总结构不符合要求");
    expect(driver.finalizeReasons[0]).toContain("请修正后重新调用 report_source_finding 汇总");
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

describe("主张分类、推断缺口与未展开内容", () => {
  function claimOf(overrides: Partial<SourceClaim> = {}): SourceClaim {
    return {
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
      ...overrides,
    };
  }

  function reportOf(options: {
    claims: SourceClaim[];
    citations?: unknown[];
    omittedClaims?: string[];
    unresolvedItems?: string[];
    noApplicableSourceReason?: string | null;
  }): ToolLoopCall {
    return call(REPORT_TOOL_NAME, {
      claims: options.claims,
      citations: options.citations ?? [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
      noApplicableSourceReason: options.noApplicableSourceReason ?? null,
      unresolvedItems: options.unresolvedItems ?? [],
      omittedClaims: options.omittedClaims ?? [],
    });
  }

  it("观点类主张标为不支持核验，不因为与来源不同或缺依据而判假", async () => {
    const opinion = claimOf({
      claimText: "CPI 涨幅回落说明政策效果显现",
      value: null,
      basis: null,
      kind: "opinion",
    });
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH] }),
      reply({ calls: [reportOf({ claims: [opinion] })] }),
    ]);

    const result = await runSourceInvestigation(driver, { caption: "CPI 涨幅回落说明政策效果显现" });

    expect(result.conclusions[0].status).toBe("not-verifiable");
    expect(result.conclusions[0].summary).toContain("不对它做真假定论");
    expect(result.conclusions[0].summary).not.toMatch(/造假|错误|虚假/);
  });

  it("推断缺少适用环比来源时给「推断依据不足」，并说明缺哪一项依据", async () => {
    const inference = claimOf({
      claimText: "7 月 CPI 比上月便宜",
      period: "2026-07",
      value: null,
      kind: "inference",
      direction: "down",
    });
    const driver = scriptedDriver([
      reply({ calls: [call(SEARCH_TOOL_NAME, { metric: "全国居民消费价格", period: "2026-07", scope: "全国" }, "s1")] }),
      reply({ calls: [reportOf({
        claims: [inference],
        citations: [],
        noApplicableSourceReason: "资料库没有 2026 年 7 月的发布。",
      })] }),
    ]);

    const result = await runSourceInvestigation(driver, { caption: "7 月 CPI 比上月便宜" });

    expect(result.conclusions[0].status).toBe("inference-unsupported");
    expect(result.conclusions[0].parts).toEqual([
      expect.objectContaining({ label: "推断结论", status: "insufficient" }),
    ]);
    expect(result.conclusions[0].unresolved.join("")).toContain("2026-07");
    expect(result.conclusions[0].summary).toContain("不代表结论为假");
  });

  it("有适用环比来源时按方向改判为与来源不一致", async () => {
    const inference = claimOf({
      claimText: "12 月 CPI 比上月便宜",
      value: null,
      kind: "inference",
      direction: "down",
    });
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH] }),
      reply({ calls: [reportOf({ claims: [inference] })] }),
    ]);

    const result = await runSourceInvestigation(driver, { caption: "12 月 CPI 比上月便宜" });

    expect(result.conclusions[0].status).toBe("source-mismatch");
    expect(result.conclusions[0].officialValue).toBe(0.2);
    expect(result.conclusions[0].parts.map((part) => part.status)).toEqual(["contradicted"]);
  });

  it("模型汇报超过三条时不静默丢弃，多出的主张保留原文列进未展开项", async () => {
    const caption = "12 月 CPI 同比上涨 0.8%。12 月 CPI 环比上涨 0.2%。比上月上涨 0.2%。比上月便宜。";
    const claims = [
      claimOf({ claimText: "12 月 CPI 同比上涨 0.8%", basis: "year-on-year", value: 0.8 }),
      claimOf({ claimText: "12 月 CPI 环比上涨 0.2%", value: 0.2 }),
      claimOf({ claimText: "比上月上涨 0.2%", value: 0.2 }),
      claimOf({ claimText: "比上月便宜", value: null, kind: "inference", direction: "down" }),
    ];
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH] }),
      reply({ calls: [reportOf({ claims })] }),
    ]);

    const result = await runSourceInvestigation(driver, { caption });

    expect(result.claims).toHaveLength(3);
    expect(result.conclusions).toHaveLength(3);
    expect(result.omittedClaims).toEqual([
      {
        claimText: "比上月便宜",
        reason: expect.stringContaining("单次最多核验 3 条"),
        source: "caption",
      },
    ]);
    expect(result.captionCoverageNote).toContain("没有核验");
    expect(result.captionCoverageNote).toContain("比上月便宜");
  });

  it("配文里有主张没被展开时给出明确提示，并指名未覆盖的一段", async () => {
    const caption = "12 月 CPI 同比上涨 0.8%。比上月上涨 0.2%。涨幅比 11 月回落。";
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH] }),
      reply({ calls: [reportOf({
        claims: [
          claimOf({ claimText: "12 月 CPI 同比上涨 0.8%", basis: "year-on-year", value: 0.8 }),
          claimOf({ claimText: "比上月上涨 0.2%", value: 0.2 }),
        ],
      })] }),
    ]);

    const result = await runSourceInvestigation(driver, { caption });

    expect(result.omittedClaims).toEqual([]);
    expect(result.captionCoverage).toBeLessThan(CAPTION_COVERAGE_MIN);
    expect(result.captionCoverageNote).toContain("没有被已核验主张覆盖");
    expect(result.captionCoverageNote).toContain("涨幅比 11 月回落");
  });

  it("模型声明的未展开内容保留原文进入未展开项", async () => {
    const caption = "12 月 CPI 同比上涨 0.8%。涨幅比 11 月回落，物价压力有所缓解。";
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH] }),
      reply({ calls: [reportOf({
        claims: [claimOf({ claimText: "12 月 CPI 同比上涨 0.8%", basis: "year-on-year", value: 0.8 })],
        omittedClaims: ["涨幅比 11 月回落，物价压力有所缓解"],
      })] }),
    ]);

    const result = await runSourceInvestigation(driver, { caption });

    expect(result.omittedClaims).toEqual([
      { claimText: "涨幅比 11 月回落，物价压力有所缓解", reason: expect.stringContaining("模型说明"), source: "caption" },
    ]);
    // 模型自己声明了未展开内容，覆盖度提示仍然点名这段文字。
    expect(result.captionCoverageNote).toContain("涨幅比 11 月回落");
  });

  it("模型把图上说明写进声明时不算配文漏项，也不计入配文未核验提示", async () => {
    const caption = "8 月 CPI 比上月便宜。";
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH] }),
      reply({ calls: [reportOf({
        claims: [claimOf({ claimText: "8 月 CPI 比上月便宜", value: null, kind: "inference", direction: "down" })],
        omittedClaims: ["同比涨幅连续两个月回落", "全国 · 2026 年 7—8 月 · 同比"],
      })] }),
    ]);

    const result = await runSourceInvestigation(driver, { caption });

    expect(result.omittedClaims.map((claim) => claim.source)).toEqual(["other", "other"]);
    expect(result.omittedClaims[0].reason).toContain("不在配文里");
    expect(result.captionCoverage).toBe(1);
    expect(result.captionCoverageNote).toContain("图上说明");
    expect(result.captionCoverageNote).not.toContain("配文还有");
  });

  it("配文只写月份时按图上标注补全年份，结论落到具体发布", async () => {
    const imageClaim = claimOf({
      claimText: "2025 年 12 月全国 CPI 同比上涨 0.8%",
      value: 0.8,
      basis: "year-on-year",
      fromImage: true,
      imageExcerpt: "2025 年 12 月全国 CPI 同比上涨 0.8%",
    });
    const captionClaim = claimOf({ claimText: "12 月 CPI 比上月便宜", period: "12 月", value: null, kind: "inference", direction: "down" });
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH] }),
      reply({ calls: [reportOf({ claims: [imageClaim, captionClaim] })] }),
    ]);

    const result = await runSourceInvestigation(driver, { caption: "12 月 CPI 比上月便宜" });

    expect(result.claims[1].period).toBe("2025-12");
    expect(result.conclusions[1].periodNote).toContain("年份按图上标注的 2025-12 补全");
    expect(result.conclusions[1].status).toBe("source-mismatch");
  });

  it("一条主张的引用问题不会套到另一条主张上", async () => {
    const first = claimOf({ claimText: "12 月 CPI 比上月上涨 0.8%" });
    const second = claimOf({ claimText: "2026 年 8 月 CPI 比上月上涨 0.4%", period: "2026-08", value: 0.4 });
    const driver = scriptedDriver([
      reply({ calls: [call(SEARCH_TOOL_NAME, { metric: "全国居民消费价格", period: "2025-12", scope: "全国" }, "s1")] }),
      reply({ calls: [reportOf({ claims: [first, second], citations: [{ sourceId: "stats-cpi-2026-08", role: "value-basis", note: null }] })] }),
    ]);

    const result = await runSourceInvestigation(driver, {
      caption: "12 月 CPI 比上月上涨 0.8%。2026 年 8 月 CPI 比上月上涨 0.4%。",
    });

    expect(searchSourceLibrary({ metric: "全国居民消费价格", period: "2025-12", scope: "全国", terms: [] })
      .map((hit) => hit.document.id)).toContain("stats-cpi-2025-12");
    // 第一条与所引发布月份不符 → 待核对；第二条口径匹配 → 一致。互不套用。
    expect(result.conclusions.map((conclusion) => conclusion.status)).toEqual(["source-pending", "source-match"]);
    expect(result.conclusions[1].officialValue).toBe(0.4);
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


describe("补证恢复编排", () => {
  const CAPTION_NO_BASIS = "12 月 CPI 上涨 0.8%";

  function claimOf(overrides: Partial<SourceClaim> = {}): SourceClaim {
    return {
      claimText: CAPTION_NO_BASIS,
      metric: "全国居民消费价格",
      scope: "全国",
      period: "2025-12",
      value: 0.8,
      basis: "month-on-month",
      kind: "direct",
      direction: null,
      fromImage: false,
      imageExcerpt: null,
      ...overrides,
    };
  }

  const CLAIM_NO_BASIS = claimOf({ claimText: CAPTION_NO_BASIS, basis: null });
  const REPORT_NO_BASIS = call(REPORT_TOOL_NAME, {
    claims: [CLAIM_NO_BASIS],
    citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
    noApplicableSourceReason: null,
    unresolvedItems: ["需要确认比较方式才能继续核对。"],
    omittedClaims: [],
  });
  const CLARIFY_BASIS = call(CLARIFY_TOOL_NAME, {
    question: "配文没有写比较方式，0.8% 是同比还是环比？",
    purpose: "比较方式决定用发布里的同比 0.8% 还是环比 0.2% 核对，结论会不同。",
    field: "basis",
    claimText: CAPTION_NO_BASIS,
  }, "c1");

  /** 跑第一段：检索 + 追问 + 汇总（口径留空），得到带 clarification 的 prior 结果。 */
  async function firstPhase(caption = CAPTION_NO_BASIS): Promise<SourceInvestigationResult> {
    const driver = scriptedDriver([
      reply({ calls: [CPI_SEARCH, CLARIFY_BASIS] }),
      reply({ calls: [REPORT_NO_BASIS] }),
    ]);
    return await runSourceInvestigation(driver, { caption });
  }

  it("恢复段把用户回答注入同一段对话，图文没写口径时填入并标为用户提供", async () => {
    const prior = await firstPhase();
    expect(prior.clarification).toMatchObject({ field: "basis", claimText: CAPTION_NO_BASIS });
    expect(prior.conclusions[0].status).toBe("source-pending");

    const driver = scriptedDriver([reply({ calls: [REPORT_NO_BASIS] })]);
    const resumed = await runSourceInvestigation(driver, {
      caption: CAPTION_NO_BASIS,
      resume: { answer: "同比", prior },
    });

    // 用户回答确实注入了同一段对话，并标明「用户提供」不是官方来源。
    expect(driver.resumedWith).toHaveLength(1);
    expect(driver.resumedWith[0]).toContain("同比");
    expect(driver.resumedWith[0]).toContain("用户提供");
    expect(driver.resumedWith[0]).toContain("不是官方来源");

    // 图文没写比较方式 → 填入 year-on-year，结论从待核对变为与来源一致。
    expect(resumed.claims[0].basis).toBe("year-on-year");
    expect(resumed.conclusions[0].status).toBe("source-match");
    expect(resumed.conclusions[0].supplement).toMatchObject({ applied: true, conflict: null });
    expect(resumed.conclusions[0].reasons.join("")).toContain("由用户补充确定");
    expect(resumed.supplement).toMatchObject({ field: "basis", answer: "同比", applied: true, parseNote: null });

    // 前后逐条对照：能看出结论为什么变。
    expect(resumed.conclusionChanges).toEqual([
      expect.objectContaining({
        claimText: CAPTION_NO_BASIS,
        before: "source-pending",
        after: "source-match",
        changed: true,
        reason: expect.stringContaining("比较方式"),
      }),
    ]);
  });

  it("恢复段共享预算：调用数与轮次从补证前接续，追问次数也不清零", async () => {
    const prior = await firstPhase();
    expect(prior.toolCallsUsed).toBe(2); // 检索 + 追问
    expect(prior.rounds).toBe(2);

    const reportYoy = { id: "r2", name: REPORT_TOOL_NAME, input: {
      claims: [claimOf({ claimText: CAPTION_NO_BASIS, basis: "year-on-year" })],
      citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
      noApplicableSourceReason: null,
      unresolvedItems: [],
      omittedClaims: [],
    } };
    const driver = scriptedDriver([
      reply({ calls: [call(SEARCH_TOOL_NAME, { metric: "全国居民消费价格", period: "2025-12", scope: "全国" }, "s2")] }),
      reply({ calls: [call(COMPARE_TOOL_NAME, { left: 0.8, right: 0.2, unit: "%" }, "cmp")] }),
      reply({ calls: [] }),
    ], reply({ calls: [reportYoy] }));

    const resumed = await runSourceInvestigation(driver, {
      caption: CAPTION_NO_BASIS,
      resume: { answer: "同比", prior },
    });

    // 预算接续：prior 用了 2 次，恢复段又用 2 次，累计 4 —— 而不是从 0 重新算。
    expect(resumed.toolCallsUsed).toBe(4);
    // 轮次接续：prior 2 轮起步，恢复段再走 2 轮。
    expect(resumed.rounds).toBeGreaterThanOrEqual(4);

    // 追问次数共享：prior 已用掉唯一一次追问，恢复段再追问会被拒绝。
    const retryDriver = scriptedDriver([
      reply({ calls: [call(CLARIFY_TOOL_NAME, { question: "再问一次？", purpose: "重复追问。", field: "basis" }, "c2")] }),
      reply({ calls: [] }),
    ], reply({ calls: [reportYoy] }));
    const retry = await runSourceInvestigation(retryDriver, {
      caption: CAPTION_NO_BASIS,
      resume: { answer: "同比", prior },
    });
    // 只看恢复段的事件：prior 轨迹里带着第一段已执行的追问。
    const rejectedClarify = retry.trace.find(
      (event) => event.tool === CLARIFY_TOOL_NAME && event.round > prior.rounds,
    );
    expect(rejectedClarify?.status).toBe("rejected");
    expect(rejectedClarify?.resultSummary).toContain("已经提过一次追问");
    expect(retry.clarification).toBeNull();
  });

  it("轮次上限共享：补证前已用满轮次时恢复段不再执行工具，直接带补充强制汇总", async () => {
    const prior = await firstPhase();
    const exhausted = { ...prior, rounds: 4 };

    const reportYoy = { id: "r4", name: REPORT_TOOL_NAME, input: {
      claims: [claimOf({ claimText: CAPTION_NO_BASIS, basis: "year-on-year" })],
      citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
      noApplicableSourceReason: null,
      unresolvedItems: [],
      omittedClaims: [],
    } };
    const driver = scriptedDriver(
      [reply({ calls: [call(SEARCH_TOOL_NAME, { metric: "全国居民消费价格", period: "2025-12", scope: "全国" }, "s-late")] })],
      reply({ calls: [reportYoy] }),
    );

    const resumed = await runSourceInvestigation(driver, {
      caption: CAPTION_NO_BASIS,
      resume: { answer: "同比", prior: exhausted },
    });

    // 恢复段发起的检索没有执行（记为未执行），直接强制汇总。
    const lateSearch = resumed.trace.find((event) => event.tool === SEARCH_TOOL_NAME && event.round > exhausted.rounds);
    expect(lateSearch?.status).toBe("rejected");
    expect(lateSearch?.resultSummary).toContain("轮次上限");
    expect(resumed.stopReason).toContain("轮次达到上限");
    expect(driver.finalizeReasons.length).toBeGreaterThan(0);
    // 即便工具没执行，补证仍套用到主张上，结论照常组合。
    expect(resumed.conclusions[0].status).toBe("source-match");
    expect(resumed.supplement).toMatchObject({ applied: true });
  });

  it("用户补充与图文写明的口径冲突时不覆盖，降为待核对并保留双方", async () => {
    const captionMom = "12 月 CPI 比上月上涨 0.2%";
    const claimMom = claimOf({ claimText: captionMom, basis: "month-on-month", value: 0.2 });
    const reportMom = call(REPORT_TOOL_NAME, {
      claims: [claimMom],
      citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
      noApplicableSourceReason: null,
      unresolvedItems: [],
      omittedClaims: [],
    });
    const clarifyMom = call(CLARIFY_TOOL_NAME, {
      question: "配文这句的比较方式是什么？",
      purpose: "决定用哪个口径核对。",
      field: "basis",
      claimText: captionMom,
    }, "c1");
    const priorDriver = scriptedDriver([
      reply({ calls: [CPI_SEARCH, clarifyMom] }),
      reply({ calls: [reportMom] }),
    ]);
    const prior = await runSourceInvestigation(priorDriver, { caption: captionMom });
    expect(prior.conclusions[0].status).toBe("source-match");

    const resumeDriver = scriptedDriver([reply({ calls: [reportMom] })]);
    const resumed = await runSourceInvestigation(resumeDriver, {
      caption: captionMom,
      resume: { answer: "同比", prior },
    });

    // 图文明确写了环比，回答同比 → 不覆盖，降为待核对，双方都保留。
    expect(resumed.claims[0].basis).toBe("month-on-month");
    expect(resumed.conclusions[0].status).toBe("source-pending");
    expect(resumed.conclusions[0].summary).toContain("冲突");
    expect(resumed.conclusions[0].reasons.join("")).toContain("图上／配文写明：环比");
    expect(resumed.conclusions[0].reasons.join("")).toContain("用户补充：同比");
    expect(resumed.conclusions[0].unresolved.join("")).toContain("更正");
    expect(resumed.supplement?.conflicts).toEqual([
      { claimText: captionMom, field: "basis", fromImage: "环比", fromUser: "同比" },
    ]);
    expect(resumed.conclusionChanges?.[0]).toMatchObject({ before: "source-match", after: "source-pending", changed: true });
  });

  it("恢复段沿用补证前的检索命中，引用不必重新检索也能通过校验", async () => {
    const prior = await firstPhase();
    expect(prior.hits.map((hit) => hit.document.id)).toContain("stats-cpi-2025-12");

    let resumedSearches = 0;
    const driver = scriptedDriver([reply({ calls: [REPORT_NO_BASIS] })]);
    const resumed = await runSourceInvestigation(driver, {
      caption: CAPTION_NO_BASIS,
      resume: { answer: "同比", prior },
      search: () => { resumedSearches += 1; return []; },
    });

    // 没有重新检索，但引用仍命中带入的资料 → 结论成立，不被降级。
    expect(resumedSearches).toBe(0);
    expect(resumed.acceptedCitations).toEqual([
      { sourceId: "stats-cpi-2025-12", role: "value-basis", note: null },
    ]);
    expect(resumed.conclusions[0].status).toBe("source-match");
    // 恢复段的轨迹包含补证前的事件，同一记录可看到检索条件。
    expect(resumed.trace[0].tool).toBe(SEARCH_TOOL_NAME);
  });

  it("prior 没有待回答的追问时拒绝恢复，不静默开新调查", async () => {
    const prior = await firstPhase();
    const withoutClarification = { ...prior, clarification: null };
    const driver = scriptedDriver([reply({ calls: [] })]);

    await expect(runSourceInvestigation(driver, {
      caption: CAPTION_NO_BASIS,
      resume: { answer: "同比", prior: withoutClarification },
    })).rejects.toThrow("恢复调查需要补证前存在一次待回答的追问");
    expect(driver.resumedWith).toEqual([]);
  });

  it("回答无法解析为口径时不套用，补充记录写明原因", async () => {
    const prior = await firstPhase();
    const driver = scriptedDriver([reply({ calls: [REPORT_NO_BASIS] })]);

    const resumed = await runSourceInvestigation(driver, {
      caption: CAPTION_NO_BASIS,
      resume: { answer: "大概三月份吧", prior },
    });

    expect(resumed.claims[0].basis).toBeNull();
    expect(resumed.conclusions[0].status).toBe("source-pending");
    expect(resumed.supplement).toMatchObject({ applied: false, normalized: null });
    expect(resumed.supplement?.parseNote).toContain("同比还是环比");
    expect(resumed.supplement?.note).toContain("补充未被采用");
    expect(resumed.conclusionChanges?.[0]).toMatchObject({ before: "source-pending", after: "source-pending", changed: false });
  });
});

describe("汇总结构非法的修复", () => {
  function claimOf(overrides: Partial<SourceClaim> = {}): SourceClaim {
    return {
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
      ...overrides,
    };
  }

  it("重报指令带上具体错误，模型修正后被采用，不再盲目重报", async () => {
    const tooManyOmitted = Array.from({ length: 31 }, (_, index) => `图上说明第 ${index + 1} 行`);
    const reportInput = {
      claims: [claimOf()],
      citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
      noApplicableSourceReason: null,
      unresolvedItems: [],
      omittedClaims: tooManyOmitted,
    };
    const badReport = call(REPORT_TOOL_NAME, reportInput);
    const goodReport = call(REPORT_TOOL_NAME, { ...reportInput, omittedClaims: tooManyOmitted.slice(0, 3) }, "r-good");

    const driver = scriptedDriver([reply({ calls: [CPI_SEARCH] }), reply({ calls: [badReport] })], reply({ calls: [goodReport] }));

    const result = await runSourceInvestigation(driver, { caption: "12 月 CPI 比上月上涨 0.2%" });

    // 重报指令必须指出具体问题，否则模型只会重复同样的错误。
    expect(driver.finalizeReasons[0]).toContain("omittedClaims 超出条数上限（最多 30 条）");
    expect(driver.finalizeReasons[0]).toContain("请修正后重新调用 report_source_finding 汇总");
    expect(result.stopReason).toContain("重新汇总后采用");
    expect(result.conclusions.length).toBeGreaterThan(0);
    // 轨迹里保留被拒原因，供证据复查。
    const rejected = result.trace.find((event) => event.status === "rejected" && event.tool === REPORT_TOOL_NAME);
    expect(rejected?.resultSummary).toContain("最多 30 条");
  });

  it("重报仍不合法时如实停止，不用预置结果顶替", async () => {
    const badReport = call(REPORT_TOOL_NAME, {
      claims: [claimOf()],
      citations: [],
      noApplicableSourceReason: null,
      unresolvedItems: [],
      omittedClaims: Array.from({ length: 40 }, (_, index) => `第 ${index} 行`),
    });
    const driver = scriptedDriver(
      [reply({ calls: [CPI_SEARCH] }), reply({ calls: [badReport] })],
      reply({ calls: [badReport] }),
    );

    const result = await runSourceInvestigation(driver, { caption: "12 月 CPI 比上月上涨 0.2%" });

    expect(result.stopReason).toBe("模型给出的汇总结构无效，调查终止。");
    expect(result.claims).toEqual([]);
    expect(driver.finalizeReasons).toHaveLength(1);
  });
});
