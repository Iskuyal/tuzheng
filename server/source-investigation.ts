import { z } from "zod";
import OpenAI from "openai";
import type {
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputItem,
} from "openai/resources/responses/responses.js";
import type { UploadedChartImage } from "./app.js";
import {
  createAnthropicMessagesRequester,
  requestAnthropicTurn,
  type AnthropicMessagesRequester,
  type AnthropicReply,
  type AnthropicToolUseBlock,
  type AnthropicTurn,
} from "./anthropic-messages.js";
import type { ProviderConfig } from "./model-settings.js";
import {
  CLARIFICATIONS_PER_INVESTIGATION,
  INVESTIGATION_DEADLINE_MS,
  TOOL_CALLS_PER_INVESTIGATION,
  TOOL_CALLS_PER_ROUND,
  auditClaimsAgainstSources,
  compareValues,
  searchSourceLibrary,
  type ClarificationRequest,
  type ModelCitation,
  type SourceClaim,
  type SourceHit,
  type SourceInvestigationResult,
  type ToolTraceEvent,
} from "../shared/source-audit.js";
import {
  BUDGETED_TOOL_NAMES,
  CLARIFY_TOOL_NAME,
  COMPARE_TOOL_NAME,
  REPORT_TOOL_NAME,
  SEARCH_TOOL_NAME,
  compareArgumentsSchema,
  clarifyArgumentsSchema,
  reportArgumentsSchema,
  reportToolSchema,
  searchArgumentsSchema,
  searchResultPayload,
  sourceToolDeclarations,
  toModelFinding,
} from "./source-tools.js";

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 4096;

export interface ToolLoopCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolLoopReply {
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
  /** 模型在调用工具前写的简短说明，作为轨迹里的行动理由。 */
  text: string | null;
  calls: ToolLoopCall[];
  /** 提供方以 max_tokens 截断时标记，编排层据此降级。 */
  truncated: boolean;
}

export interface ToolResultPayload {
  id: string;
  name: string;
  output: string;
  isError: boolean;
}

export interface SourceInvestigationDriver {
  readonly model: string;
  start(): Promise<ToolLoopReply>;
  continue(results: ToolResultPayload[]): Promise<ToolLoopReply>;
  finalize(reason: string): Promise<ToolLoopReply>;
}

export class SourceInvestigationError extends Error {
  constructor(readonly kind: "timeout" | "upstream" | "invalid-output", options?: ErrorOptions) {
    super(
      kind === "timeout"
        ? "来源调查超时。"
        : kind === "invalid-output"
          ? "模型返回的调查结果无法安全使用。"
          : "来源调查请求失败。",
      options,
    );
    this.name = "SourceInvestigationError";
  }
}

function summarizeArguments(input: unknown, maxLength = 160): string {
  if (input === null || input === undefined) return "（无参数）";
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** 轨迹只保留简短行动理由，不展示模型内部思维全文。 */
function summarizeDetail(text: string | null | undefined, maxLength = 80): string {
  const trimmed = text?.replace(/\s+/g, " ").trim() ?? "";
  if (!trimmed) return "模型调用工具。";
  // 只取第一句，避免把整段推理搬进轨迹。
  const firstSentence = trimmed.split(/(?<=[。！？.!?])\s*/)[0] || trimmed;
  const concise = firstSentence.length > 0 ? firstSentence : trimmed;
  return concise.length > maxLength ? `${concise.slice(0, maxLength)}…` : concise;
}

function fieldLabel(field: string): string {
  return { period: "月份", scope: "范围", metric: "指标", basis: "比较方式", value: "数值" }[field] ?? field;
}

/**
 * 编排模型自选工具的多轮调查：逐个校验工具名与参数，累计命中资料，
 * 按轮与总计双重限制调用次数，最后由程序组合结论。
 */
export async function runSourceInvestigation(
  driver: SourceInvestigationDriver,
  options: {
    /** 检索实现可替换，便于替身测试；默认按固定资料库真实检索。 */
    search?: (query: z.infer<typeof searchArgumentsSchema>) => SourceHit[];
    compare?: (left: number, right: number, unit: string) => { equal: boolean; difference: number; summary: string };
  } = {},
): Promise<SourceInvestigationResult> {
  const startedAt = Date.now();
  const trace: ToolTraceEvent[] = [];
  const hitsById = new Map<string, SourceHit>();
  let toolCallsUsed = 0;
  let repairUsed = false;
  let clarifications = 0;
  let clarification: ClarificationRequest | null = null;
  let finding: SourceClaim[] | null = null;
  let findingCitations: ModelCitation[] = [];
  let noApplicableSourceReason: string | null = null;
  let modelUnresolved: string[] = [];
  let usage: SourceInvestigationResult["usage"] = null;
  let truncated = false;
  let recognizedModel = driver.model;
  let stopReason = "模型没有给出汇总结果。";
  let round = 0;

  const runTool = async (
    call: ToolLoopCall,
    detail: string,
    currentRound: number,
    order: number,
  ): Promise<ToolResultPayload> => {
    const toolStartedAt = Date.now();
    const event = (status: ToolTraceEvent["status"], resultSummary: string, inputSummary = summarizeArguments(call.input)) => {
      trace.push({
        round: currentRound,
        order,
        detail,
        status,
        tool: call.name,
        inputSummary,
        resultSummary,
        durationMs: Date.now() - toolStartedAt,
      });
    };

    const budgeted = (BUDGETED_TOOL_NAMES as readonly string[]).includes(call.name);
    if (budgeted && toolCallsUsed >= TOOL_CALLS_PER_INVESTIGATION) {
      event("rejected", "已达到单次调查 6 次工具调用上限，本次调用未执行。");
      return { id: call.id, name: call.name, isError: true, output: "工具调用预算已用尽，请立刻汇总。" };
    }

    switch (call.name) {
      case SEARCH_TOOL_NAME: {
        const parsed = searchArgumentsSchema.safeParse(call.input);
        if (!parsed.success) {
          event("rejected", "检索参数不符合要求，未执行。");
          return { id: call.id, name: call.name, isError: true, output: "检索参数不符合要求：metric／period／scope 必须是字符串或 null。" };
        }
        toolCallsUsed += 1;
        const query = {
          metric: parsed.data.metric,
          period: parsed.data.period,
          scope: parsed.data.scope,
          terms: parsed.data.terms ?? [],
        };
        const results = (options.search ?? defaultSearch)(query);
        for (const hit of results) {
          if (!hitsById.has(hit.document.id)) hitsById.set(hit.document.id, hit);
        }
        const summary = results.length === 0
          ? "没有命中任何资料。"
          : `命中 ${results.length} 条：${results.map((hit) => `${hit.document.title}（${hit.applicability.applicableForValue ? "口径匹配" : "口径不适配"}）`).join("；")}`;
        event("ok", summary);
        return { id: call.id, name: call.name, isError: false, output: searchResultPayload(results) };
      }
      case COMPARE_TOOL_NAME: {
        const parsed = compareArgumentsSchema.safeParse(call.input);
        if (!parsed.success) {
          event("rejected", "比较参数不符合要求，未执行。");
          return { id: call.id, name: call.name, isError: true, output: "比较参数不符合要求：left／right 必须是有限数值。" };
        }
        toolCallsUsed += 1;
        const comparison = (options.compare ?? defaultCompare)(parsed.data.left, parsed.data.right, parsed.data.unit);
        event("ok", comparison.summary);
        return { id: call.id, name: call.name, isError: false, output: JSON.stringify(comparison) };
      }
      case CLARIFY_TOOL_NAME: {
        const parsed = clarifyArgumentsSchema.safeParse(call.input);
        if (!parsed.success) {
          event("rejected", "追问参数不符合要求，未执行。");
          return { id: call.id, name: call.name, isError: true, output: "追问参数不符合要求：question／purpose／field 都必须填写。" };
        }
        if (clarifications >= CLARIFICATIONS_PER_INVESTIGATION) {
          event("rejected", "本次调查已经提过一次追问，不再重复追问。");
          return { id: call.id, name: call.name, isError: true, output: "本次调查已经提过一次追问，请用现有证据汇总。" };
        }
        toolCallsUsed += 1;
        clarifications += 1;
        clarification = {
          question: parsed.data.question,
          purpose: parsed.data.purpose,
          field: parsed.data.field,
        };
        event("ok", `已记录追问（${fieldLabel(parsed.data.field)}）：${parsed.data.question}`);
        return {
          id: call.id,
          name: call.name,
          isError: false,
          output: JSON.stringify({ recorded: true, note: "问题已记录并展示给用户，请继续用现有证据汇总。" }),
        };
      }
      default:
        event("rejected", `未知工具 ${call.name}，未执行。`);
        return {
          id: call.id,
          name: call.name,
          isError: true,
          output: `没有名为 ${call.name} 的工具。可用的工具是 ${[...BUDGETED_TOOL_NAMES, REPORT_TOOL_NAME].join("、")}。`,
        };
    }
  };

  const acceptReport = (input: unknown, currentRound: number, order: number, detail: string): boolean => {
    const parsed = reportArgumentsSchema.safeParse(input);
    if (!parsed.success) {
      trace.push({
        round: currentRound,
        order,
        detail,
        status: "rejected",
        tool: REPORT_TOOL_NAME,
        inputSummary: summarizeArguments(input),
        resultSummary: "汇总结构不符合要求，未被采用。",
        durationMs: 0,
      });
      return false;
    }
    const parsedFinding = toModelFinding(parsed.data);
    finding = parsedFinding.claims;
    findingCitations = parsedFinding.citations;
    noApplicableSourceReason = parsedFinding.noApplicableSourceReason;
    modelUnresolved = parsedFinding.unresolvedItems;
    trace.push({
      round: currentRound,
      order,
      detail,
      status: "ok",
      tool: REPORT_TOOL_NAME,
      inputSummary: `${parsedFinding.claims.length} 条主张、${parsedFinding.citations.length} 条引用`,
      resultSummary: "已接收汇总，准备由程序校验引用并组合结论。",
      durationMs: 0,
    });
    return true;
  };

  let reply = await driver.start();

  while (true) {
    if (Date.now() - startedAt > INVESTIGATION_DEADLINE_MS) {
      stopReason = `单次调查超过整体时限（${Math.round(INVESTIGATION_DEADLINE_MS / 1000)} 秒），已停止并保留已有证据。`;
      break;
    }
    round += 1;
    usage = reply.usage ?? usage;
    truncated = reply.truncated;
    recognizedModel = reply.model || recognizedModel;

    if (reply.truncated) {
      stopReason = "模型输出被截断，已保留可用部分并停止调查。";
      break;
    }

    const reportCalls = reply.calls.filter((call) => call.name === REPORT_TOOL_NAME);
    const actionCalls = reply.calls.filter((call) => call.name !== REPORT_TOOL_NAME);

    // 汇总与工具调用同时返回，说明模型还没看结果就下结论：先执行工具，等下一轮的汇总。
    if (reportCalls.length > 0 && actionCalls.length === 0) {
      if (acceptReport(reportCalls[0].input, round, 1, summarizeDetail(reply.text ?? "模型给出汇总。"))) {
        stopReason = "模型在看完工具结果后给出汇总。";
        break;
      }
      // 结构不合法时给一次恢复机会：只保留汇总工具并强制重报，仍不合法就如实停止。
      if (!repairUsed) {
        repairUsed = true;
        reply = await driver.finalize("上一次汇总结构不符合要求，请重新汇总。");
        round += 1;
        usage = reply.usage ?? usage;
        recognizedModel = reply.model || recognizedModel;
        const repaired = reply.calls.find((call) => call.name === REPORT_TOOL_NAME);
        if (repaired && acceptReport(repaired.input, round, 1, "重新汇总后被采用。")) {
          stopReason = "模型第一次汇总结构不符合要求，重新汇总后采用。";
          break;
        }
      }
      stopReason = "模型给出的汇总结构无效，调查终止。";
      break;
    }

    if (actionCalls.length > 0) {
      const processed = actionCalls.slice(0, TOOL_CALLS_PER_ROUND);
      const dropped = actionCalls.slice(TOOL_CALLS_PER_ROUND);
      const results: ToolResultPayload[] = [];
      const detail = summarizeDetail(reply.text);
      for (const [index, call] of processed.entries()) {
        results.push(await runTool(call, detail, round, index + 1));
      }
      for (const [index, call] of dropped.entries()) {
        trace.push({
          round,
          order: processed.length + index + 1,
          detail,
          status: "rejected",
          tool: call.name,
          inputSummary: summarizeArguments(call.input),
          resultSummary: `本轮超过 ${TOOL_CALLS_PER_ROUND} 次工具调用上限，本次调用未执行。`,
          durationMs: 0,
        });
      }

      if (reportCalls.length > 0) {
        trace.push({
          round,
          order: processed.length + dropped.length + 1,
          detail: summarizeDetail(reply.text),
          status: "rejected",
          tool: REPORT_TOOL_NAME,
          inputSummary: summarizeArguments(reportCalls[0].input),
          resultSummary: "同一轮里先调用工具又给出汇总，未采用该汇总；等看完工具结果后再汇总。",
          durationMs: 0,
        });
      }

      if (toolCallsUsed >= TOOL_CALLS_PER_INVESTIGATION) {
        reply = await driver.finalize("工具调用预算用尽。");
        const finalizeRound = round + 1;
        round = finalizeRound;
        usage = reply.usage ?? usage;
        recognizedModel = reply.model || recognizedModel;
        const finalReport = reply.calls.find((call) => call.name === REPORT_TOOL_NAME);
        if (finalReport && acceptReport(finalReport.input, round, 1, "预算用尽后按要求汇总。")) {
          stopReason = `工具调用达到单次调查上限（${TOOL_CALLS_PER_INVESTIGATION} 次）后汇总。`;
        } else {
          stopReason = `工具调用达到单次调查上限（${TOOL_CALLS_PER_INVESTIGATION} 次），且模型未给出有效汇总。`;
        }
        break;
      }

      if (round >= 4) {
        reply = await driver.finalize("轮次上限。");
        round += 1;
        const finalReport = reply.calls.find((call) => call.name === REPORT_TOOL_NAME);
        if (finalReport && acceptReport(finalReport.input, round, 1, "轮次用尽后按要求汇总。")) {
          stopReason = "轮次达到上限后汇总。";
        } else {
          stopReason = "轮次达到上限，且模型未给出有效汇总。";
        }
        usage = reply.usage ?? usage;
        recognizedModel = reply.model || recognizedModel;
        break;
      }

      reply = await driver.continue(results);
      continue;
    }

    if (actionCalls.length === 0 && reportCalls.length === 0) {
      if (round >= 4 || toolCallsUsed >= TOOL_CALLS_PER_INVESTIGATION) {
        reply = await driver.finalize("模型没有继续调用工具。");
        round += 1;
        const finalReport = reply.calls.find((call) => call.name === REPORT_TOOL_NAME);
        if (finalReport && acceptReport(finalReport.input, round, 1, "按要求汇总。")) {
          stopReason = "模型停止调用工具后按要求汇总。";
        } else {
          stopReason = "模型没有调用工具也没有给出汇总。";
        }
        usage = reply.usage ?? usage;
        recognizedModel = reply.model || recognizedModel;
        break;
      }
      reply = await driver.continue([]);
      continue;
    }
  }

  const claims = finding ?? [];
  const audit = auditClaimsAgainstSources({
    claims,
    citations: findingCitations,
    hits: [...hitsById.values()],
    noApplicableSourceReason,
  });

  return {
    model: recognizedModel,
    latencyMs: Date.now() - startedAt,
    rounds: round,
    stopReason,
    trace,
    claims,
    conclusions: audit.conclusions,
    citations: findingCitations,
    acceptedCitations: audit.acceptedCitations,
    citationsRejected: audit.citationsRejected,
    hits: [...hitsById.values()],
    excludedSources: audit.excluded,
    unresolvedItems: modelUnresolved,
    noApplicableSourceReason,
    clarification,
    toolCallsUsed,
    usage,
  };
}

function defaultSearch(query: z.infer<typeof searchArgumentsSchema>): SourceHit[] {
  return searchSourceLibrary({
    metric: query.metric,
    period: query.period,
    scope: query.scope,
    terms: query.terms ?? [],
  });
}

function defaultCompare(left: number, right: number, unit: string) {
  return compareValues(left, right, unit);
}

function extractText(blocks: Array<{ type: string; text?: string }>): string | null {
  const text = blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n")
    .trim();
  return text || null;
}

function toToolLoopReply(reply: AnthropicReply, fallbackModel: string): ToolLoopReply {
  if (!Array.isArray(reply.content)) {
    throw new SourceInvestigationError("invalid-output");
  }
  const calls = reply.content
    .filter((block): block is AnthropicToolUseBlock => block.type === "tool_use")
    .map((block, index) => ({
      id: block.id?.trim() || `tool-${index + 1}`,
      name: block.name,
      input: block.input,
    }));

  return {
    model: reply.model?.trim() || fallbackModel,
    usage: reply.usage
      ? { inputTokens: reply.usage.input_tokens ?? null, outputTokens: reply.usage.output_tokens ?? null }
      : null,
    text: extractText(reply.content),
    calls,
    truncated: reply.stop_reason === "max_tokens",
  };
}

/** Anthropic Messages 协议的工具循环：多轮工具结果回传，只有汇总工具用强制调用。 */
export class AnthropicSourceInvestigationDriver implements SourceInvestigationDriver {
  private readonly turns: AnthropicTurn[] = [];
  private readonly send: AnthropicMessagesRequester;

  constructor(
    config: ProviderConfig,
    image: UploadedChartImage,
    caption: string,
    prompt: string,
    requester?: AnthropicMessagesRequester,
  ) {
    this.model = config.model;
    this.send = requester ?? createAnthropicMessagesRequester(config, { timeoutMs: REQUEST_TIMEOUT_MS });
    this.turns.push({
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.buffer.toString("base64") } },
        { type: "text", text: `${prompt}\n\n配文（由用户提供，可能是错的）：${caption}` },
      ],
    });
  }

  readonly model: string;

  private async sendTurn(extra: Partial<AnthropicRequestBodyPatch>): Promise<ToolLoopReply> {
    let reply: AnthropicReply;
    try {
      reply = await requestAnthropicTurn(this.send, (variant) => ({
        model: this.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [...this.turns],
        tools: extra.tools ?? sourceToolDeclarations,
        tool_choice: extra.toolChoice ?? variant.toolChoice,
        ...(variant.thinking ? { thinking: variant.thinking } : {}),
      }));
    } catch (error) {
      throw new SourceInvestigationError(isTimeout(error) ? "timeout" : "upstream", { cause: error });
    }
    const loopReply = toToolLoopReply(reply, this.model);
    this.turns.push({
      role: "assistant",
      content: loopReply.calls.map((call) => ({ type: "tool_use" as const, id: call.id, name: call.name, input: call.input })),
    });
    return loopReply;
  }

  async start(): Promise<ToolLoopReply> {
    return await this.sendTurn({});
  }

  async continue(results: ToolResultPayload[]): Promise<ToolLoopReply> {
    if (results.length > 0) {
      this.turns.push({
        role: "user",
        content: results.map((result) => ({
          type: "tool_result" as const,
          tool_use_id: result.id,
          content: result.output,
          ...(result.isError ? { is_error: true } : {}),
        })),
      });
    } else {
      this.turns.push({
        role: "user",
        content: [{ type: "text", text: "请继续：调用工具，或调用 report_source_finding 汇总。" }],
      });
    }
    return await this.sendTurn({});
  }

  async finalize(reason: string): Promise<ToolLoopReply> {
    this.turns.push({ role: "user", content: [{ type: "text", text: `${reason}${FINALIZE_SUFFIX}` }] });
    return await this.sendTurn({
      tools: sourceToolDeclarations.filter((tool) => tool.name === REPORT_TOOL_NAME),
      toolChoice: { type: "tool", name: REPORT_TOOL_NAME },
    });
  }
}

interface AnthropicRequestBodyPatch {
  tools: typeof sourceToolDeclarations;
  toolChoice: { type: "tool"; name: string } | { type: "auto" };
}

const FINALIZE_SUFFIX = "请立刻调用 report_source_finding 汇总已经拿到的证据，不要调用其他工具。";

export type ResponsesRequester = (parameters: ResponseCreateParamsNonStreaming) => Promise<{
  output_text: string;
  output?: ResponseOutputItem[];
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  status?: string | null;
  incomplete_details?: { reason?: string | null } | null;
}>;

const reportFunctionTool = {
  type: "function" as const,
  name: REPORT_TOOL_NAME,
  description: sourceToolDeclarations.find((tool) => tool.name === REPORT_TOOL_NAME)?.description ?? "",
  parameters: reportToolSchema as Record<string, unknown>,
  strict: true,
};

const sourceFunctionTools = sourceToolDeclarations.map((tool) => ({
  type: "function" as const,
  name: tool.name,
  description: tool.description ?? "",
  parameters: tool.input_schema as Record<string, unknown>,
  strict: true,
}));

/** Responses 协议的工具循环：累积 input 数组，逐轮回传 function_call 与其输出。 */
export class ResponsesSourceInvestigationDriver implements SourceInvestigationDriver {
  readonly model: string;
  private readonly input: ResponseInputItem[] = [];
  private readonly send: ResponsesRequester;

  constructor(config: ProviderConfig, image: UploadedChartImage, caption: string, prompt: string, requester?: ResponsesRequester) {
    this.model = config.model;
    if (requester) {
      this.send = requester;
    } else {
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: REQUEST_TIMEOUT_MS,
        maxRetries: 0,
      });
      this.send = (parameters) => client.responses.create(parameters);
    }
    this.input.push({
      role: "user",
      content: [
        { type: "input_text", text: `${prompt}\n\n配文（由用户提供，可能是错的）：${caption}` },
        { type: "input_image", image_url: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`, detail: "high" },
      ],
    });
  }

  private async sendTurn(parameters: Partial<ResponseCreateParamsNonStreaming>): Promise<ToolLoopReply> {
    let reply;
    try {
      reply = await this.send({
        model: this.model,
        store: false,
        input: [...this.input],
        tools: sourceFunctionTools,
        tool_choice: "auto",
        ...parameters,
      });
    } catch (error) {
      throw new SourceInvestigationError(isTimeout(error) ? "timeout" : "upstream", { cause: error });
    }

    const output: ResponseOutputItem[] = Array.isArray(reply.output) ? reply.output : [];
    const calls = output
      .filter((item): item is ResponseFunctionToolCall => item.type === "function_call")
      .map((item) => ({
        id: item.call_id,
        name: item.name,
        input: parseToolArguments(item.arguments),
      }));

    for (const item of output) {
      if (item.type === "function_call") this.input.push(item);
    }

    return {
      model: reply.model?.trim() || this.model,
      usage: reply.usage
        ? { inputTokens: reply.usage.input_tokens ?? null, outputTokens: reply.usage.output_tokens ?? null }
        : null,
      text: reply.output_text?.trim() || null,
      calls,
      truncated: reply.status === "incomplete" || reply.incomplete_details?.reason === "max_output_tokens",
    };
  }

  async start(): Promise<ToolLoopReply> {
    return await this.sendTurn({});
  }

  async continue(results: ToolResultPayload[]): Promise<ToolLoopReply> {
    if (results.length === 0) {
      this.input.push({ role: "user", content: [{ type: "input_text", text: "请继续：调用工具，或调用 report_source_finding 汇总。" }] });
    }
    for (const result of results) {
      this.input.push({
        type: "function_call_output",
        call_id: result.id,
        output: result.isError ? `ERROR: ${result.output}` : result.output,
      });
    }
    return await this.sendTurn({});
  }

  async finalize(reason: string): Promise<ToolLoopReply> {
    this.input.push({ role: "user", content: [{ type: "input_text", text: `${reason}${FINALIZE_SUFFIX}` }] });
    return await this.sendTurn({
      tools: [reportFunctionTool],
      tool_choice: { type: "function", name: REPORT_TOOL_NAME },
    });
  }
}

/** fetch 的 AbortSignal.timeout 抛 TimeoutError，OpenAI SDK 抛 APIConnectionTimeoutError。 */
function isTimeout(error: unknown): boolean {
  return error instanceof Error
    && (error.name === "TimeoutError" || error.name === "AbortError" || error.name === "APIConnectionTimeoutError");
}

function parseToolArguments(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { __unparsed: raw };
  }
}
