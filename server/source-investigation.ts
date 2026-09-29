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
  type AnthropicToolDefinition,
  type AnthropicToolUseBlock,
  type AnthropicTurn,
  type AnthropicTurnBlock,
} from "./anthropic-messages.js";
import type { ProviderConfig } from "./model-settings.js";
import { sourceResumeMessage } from "./source-prompt.js";
import {
  AUDITED_CLAIMS_LIMIT,
  CAPTION_COVERAGE_MIN,
  CLAIM_TRACE_MIN_COVERAGE,
  CLARIFICATIONS_PER_INVESTIGATION,
  INVESTIGATION_DEADLINE_MS,
  INVESTIGATION_ROUNDS,
  TOOL_CALLS_PER_INVESTIGATION,
  TOOL_CALLS_PER_ROUND,
  applySupplementToClaims,
  auditClaimsAgainstSources,
  bigramCoverage,
  captionClaimCoverage,
  CLARIFICATION_FIELD_LABELS,
  compareValues,
  diffConclusions,
  fillClaimPeriodsFromImage,
  parseClarificationAnswer,
  resolveSupplementTarget,
  searchSourceLibrary,
  type ClaimSupplementInfo,
  type ClarificationRequest,
  type ModelCitation,
  type OmittedClaim,
  type SourceClaim,
  type SourceHit,
  type SourceInvestigationResult,
  type SupplementRecord,
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
  /** 补证恢复：把用户回答作为一条新的用户消息注入同一段对话，再要下一轮回复。 */
  resume(message: string): Promise<ToolLoopReply>;
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

/** 把 zod 校验问题压成一句可读的重报指令，让模型知道该改哪里。 */
function summarizeReportIssues(issues: z.ZodIssue[]): string {
  const parts = issues.slice(0, 3).map((issue) => {
    const path = issue.path.join(".") || "根";
    if (issue.code === "too_big" && "maximum" in issue) {
      return `${path} 超出条数上限（最多 ${issue.maximum} 条）`;
    }
    if (issue.code === "invalid_union") return `${path} 类型不对`;
    return `${path}: ${issue.message}`;
  });
  const suffix = issues.length > 3 ? `（另 ${issues.length - 3} 处）` : "";
  return `问题：${parts.join("；")}${suffix}。`;
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
 * 单次最多核验三条主张：多出来的（模型超额汇报或自己声明没展开的）一律保留原文列进未展开项。
 */
export async function runSourceInvestigation(
  driver: SourceInvestigationDriver,
  options: {
    /** 检索实现可替换，便于替身测试；默认按固定资料库真实检索。 */
    search?: (query: z.infer<typeof searchArgumentsSchema>) => SourceHit[];
    compare?: (left: number, right: number, unit: string) => { equal: boolean; difference: number; summary: string };
    /**
     * 无检索对照臂：为 false 时拒绝一切检索调用且不执行检索，
     * 命中集合保持为空，任何引用都会因「不在本次命中内」被降级。
     */
    allowSearch?: boolean;
    /** 配文原文；用于核对配文主张能否追溯到原文并计算配文覆盖度。 */
    caption?: string | null;
    /**
     * 补证恢复：用户已回答追问，沿同一段对话继续调查。
     * 预算、轮次与追问次数从 prior 接续（不通过恢复清零），检索命中随会话带入，
     * 引用与结论一律按本轮重新组合校验，不沿用 prior 的结论。
     */
    resume?: { answer: string; prior: SourceInvestigationResult };
  } = {},
): Promise<SourceInvestigationResult> {
  const allowSearch = options.allowSearch ?? true;
  const resume = options.resume ?? null;
  const resumeClarification = resume?.prior.clarification ?? null;
  if (resume && !resumeClarification) {
    throw new Error("恢复调查需要补证前存在一次待回答的追问。");
  }
  const startedAt = Date.now();
  const trace: ToolTraceEvent[] = resume ? [...resume.prior.trace] : [];
  const hitsById = new Map<string, SourceHit>();
  if (resume) {
    // 同图同配文同资料库：把上一段的检索命中带入本次，引用仍要按本轮主张口径重新校验。
    for (const hit of resume.prior.hits) hitsById.set(hit.document.id, hit);
  }
  // 共享预算：调用数、轮次与追问次数都从补证前的结果接续，恢复不能清零。
  let toolCallsUsed = resume ? resume.prior.toolCallsUsed : 0;
  let repairUsed = false;
  /** 最近一次汇总被拒的具体原因；重报指令要用它，否则模型只会重复同样的错误。 */
  let reportIssueNote = "";
  let clarifications = resumeClarification ? CLARIFICATIONS_PER_INVESTIGATION : 0;
  let clarification: ClarificationRequest | null = null;
  let finding: SourceClaim[] | null = null;
  let findingCitations: ModelCitation[] = [];
  let noApplicableSourceReason: string | null = null;
  let modelUnresolved: string[] = [];
  let modelOmittedClaims: string[] = [];
  let usage: SourceInvestigationResult["usage"] = resume ? resume.prior.usage : null;
  let truncated = false;
  let recognizedModel = driver.model;
  let stopReason = "模型没有给出汇总结果。";
  let round = resume ? resume.prior.rounds : 0;

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
        if (!allowSearch) {
          event("rejected", "本次为无检索对照，检索工具不可用，未执行检索。");
          return {
            id: call.id,
            name: call.name,
            isError: true,
            output: "本次调查不提供资料库检索工具，没有可用的检索结果。请在没有命中材料的情况下汇总，并在 noApplicableSourceReason 里说明缺少可用来源。",
          };
        }
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
          claimText: parsed.data.claimText ?? null,
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
      // 把具体问题记下来：重报指令与轨迹都要说明错在哪，否则模型只会重复同样的错误。
      reportIssueNote = summarizeReportIssues(parsed.error.issues);
      trace.push({
        round: currentRound,
        order,
        detail,
        status: "rejected",
        tool: REPORT_TOOL_NAME,
        inputSummary: summarizeArguments(input),
        resultSummary: `汇总结构不符合要求，未被采用。${reportIssueNote}`,
        durationMs: 0,
      });
      return false;
    }
    const parsedFinding = toModelFinding(parsed.data);
    finding = parsedFinding.claims;
    findingCitations = parsedFinding.citations;
    noApplicableSourceReason = parsedFinding.noApplicableSourceReason;
    modelUnresolved = parsedFinding.unresolvedItems;
    modelOmittedClaims = parsedFinding.omittedClaims;
    trace.push({
      round: currentRound,
      order,
      detail,
      status: "ok",
      tool: REPORT_TOOL_NAME,
      inputSummary: `${parsedFinding.claims.length} 条主张、${parsedFinding.citations.length} 条引用`
        + (parsedFinding.omittedClaims.length > 0 ? `、声明 ${parsedFinding.omittedClaims.length} 条未展开` : ""),
      resultSummary: "已接收汇总，准备由程序校验引用并组合结论。",
      durationMs: 0,
    });
    return true;
  };

  let reply: ToolLoopReply;
  if (resume && resumeClarification) {
    const parsed = parseClarificationAnswer(resumeClarification.field, resume.answer);
    reply = await driver.resume(sourceResumeMessage({
      question: resumeClarification.question,
      purpose: resumeClarification.purpose,
      field: resumeClarification.field,
      claimText: resumeClarification.claimText,
      answer: resume.answer,
      normalized: parsed.ok ? parsed.value : null,
      parseNote: parsed.ok ? null : parsed.reason,
    }));
  } else {
    reply = await driver.start();
  }

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

    // 补证前后共享轮次上限：工具轮最多 INVESTIGATION_ROUNDS 轮（与初查的 round >= INVESTIGATION_ROUNDS
    // 检查同一语义——第4轮仍可执行工具）；恢复段越过上限时不再执行工具，强制汇总轮不计入工具轮。
    if (round > INVESTIGATION_ROUNDS) {
      for (const call of reply.calls.filter((entry) => entry.name !== REPORT_TOOL_NAME)) {
        trace.push({
          round,
          order: reply.calls.indexOf(call) + 1,
          detail: summarizeDetail(reply.text),
          status: "rejected",
          tool: call.name,
          inputSummary: summarizeArguments(call.input),
          resultSummary: "调查轮次上限已到（含补证前的轮次），本次调用未执行。",
          durationMs: 0,
        });
      }
      reply = await driver.finalize("调查轮次上限已到（含补证前的轮次），请基于已有证据立即汇总。");
      round += 1;
      usage = reply.usage ?? usage;
      recognizedModel = reply.model || recognizedModel;
      const finalReport = reply.calls.find((call) => call.name === REPORT_TOOL_NAME);
      if (finalReport && acceptReport(finalReport.input, round, 1, "轮次用尽后按要求汇总。")) {
        stopReason = "轮次达到上限（含补证前的轮次）后汇总。";
      } else {
        stopReason = "轮次达到上限（含补证前的轮次），且模型未给出有效汇总。";
      }
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
      // 结构不合法时给一次恢复机会：带上具体错误重报，否则模型只会重复同样的错误。
      if (!repairUsed) {
        repairUsed = true;
        reply = await driver.finalize(`上一次汇总结构不符合要求。${reportIssueNote}请修正后重新调用 report_source_finding 汇总。`);
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

      if (round >= INVESTIGATION_ROUNDS) {
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
      if (round >= INVESTIGATION_ROUNDS || toolCallsUsed >= TOOL_CALLS_PER_INVESTIGATION) {
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

  // 配文只写月份时按图上标注补全年份，让口径能落到具体发布。
  const { claims: rawClaims, notes: rawPeriodNotes } = fillClaimPeriodsFromImage(finding ?? []);
  const caption = options.caption?.trim() || null;

  // 补证恢复：把用户回答按字段套用到追问指向的主张（图文没写才填入；冲突保留双方、不覆盖）。
  let filledClaims = rawClaims;
  const periodNotes = rawPeriodNotes;
  let supplementInfos: Array<ClaimSupplementInfo | null> = rawClaims.map(() => null);
  let supplement: SupplementRecord | null = null;
  if (resume && resumeClarification) {
    const parsed = parseClarificationAnswer(resumeClarification.field, resume.answer);
    const normalized = parsed.ok ? parsed.value : null;
    const target = resolveSupplementTarget(
      resume.prior.claims,
      resumeClarification.field,
      resumeClarification.claimText,
      caption,
    );
    const applied = applySupplementToClaims({
      claims: rawClaims,
      priorClaims: resume.prior.claims,
      field: resumeClarification.field,
      rawAnswer: resume.answer,
      normalized,
      targetClaimText: target,
      caption,
    });
    filledClaims = applied.claims;
    supplementInfos = applied.infos;
    const fieldText = CLARIFICATION_FIELD_LABELS[resumeClarification.field];
    const parseNote = parsed.ok ? null : parsed.reason;
    const note = parseNote
      ? `回答无法解析为${fieldText}，补充未被采用（${parseNote}）。`
      : applied.conflicts.length > 0
        ? `用户补充的${fieldText}与图文写明的内容冲突，已保留双方并请求更正，结论保持待核对。`
        : applied.appliedClaimTexts.length > 0
          ? `${fieldText}由用户补充确定，标为用户提供（不是官方来源）。`
          : `回答与图文写明的${fieldText}一致，未改动结论。`;
    supplement = {
      question: resumeClarification.question,
      purpose: resumeClarification.purpose,
      field: resumeClarification.field,
      claimText: resumeClarification.claimText,
      answer: resume.answer,
      normalized,
      applied: applied.appliedClaimTexts.length > 0,
      conflicts: applied.conflicts,
      parseNote,
      note,
    };
  }

  // 超过单次上限时优先保留配文主张（用户自己写的那句话），图上主张排在其后；
  // 保留的主张仍按模型给出的顺序排列，没进核验的每一条都保留原文列进未展开项，不静默丢弃。
  const keepIndexes = new Set<number>();
  for (const [index, claim] of filledClaims.entries()) {
    if (!claim.fromImage && keepIndexes.size < AUDITED_CLAIMS_LIMIT) keepIndexes.add(index);
  }
  for (const [index, claim] of filledClaims.entries()) {
    if (claim.fromImage && keepIndexes.size < AUDITED_CLAIMS_LIMIT) keepIndexes.add(index);
  }
  const claims = filledClaims.filter((_, index) => keepIndexes.has(index));
  const auditedPeriodNotes = periodNotes.filter((_, index) => keepIndexes.has(index));
  const auditedSupplementInfos = supplementInfos.filter((_, index) => keepIndexes.has(index));
  const overflowClaims = filledClaims.filter((_, index) => !keepIndexes.has(index));

  // 未展开的主张：模型超额汇报的与它自己声明没展开的都保留原文，不静默丢弃。
  // 声明里能追溯到配文原文的算「配文没展开」，其余的（多数是图上说明文字）另计，
  // 避免把图表页脚当成用户配文里没核验的内容。
  const omittedClaims: OmittedClaim[] = [
    ...overflowClaims.map((claim) => ({
      claimText: claim.claimText,
      reason: claim.fromImage
        ? `单次最多核验 ${AUDITED_CLAIMS_LIMIT} 条主张，这条图上主张没有展开，也没有参与结论。`
        : `单次最多核验 ${AUDITED_CLAIMS_LIMIT} 条主张，这条配文主张没有展开，也没有参与结论。`,
      source: claim.fromImage ? "other" as const : "caption" as const,
    })),
    ...modelOmittedClaims.map((claimText) => {
      const trace = caption ? bigramCoverage(claimText, caption) : { coverage: 0 };
      const inCaption = trace.coverage >= CLAIM_TRACE_MIN_COVERAGE;
      return {
        claimText,
        reason: inCaption
          ? "模型说明这段配文没有展开成主张，本次没有核验。"
          : "模型声明这段内容没有展开；它不在配文里（可能是图上说明），本次没有核验。",
        source: inCaption ? "caption" as const : "other" as const,
      };
    }),
  ];

  const coverage = caption ? captionClaimCoverage(claims, caption) : null;
  const captionOmissions = omittedClaims.filter((claim) => claim.source === "caption");
  const otherOmissions = omittedClaims.filter((claim) => claim.source === "other");
  const coverageNotes: string[] = [];
  if (captionOmissions.length > 0) {
    coverageNotes.push(
      `配文还有 ${captionOmissions.length} 处内容没有核验：${captionOmissions.map((claim) => `「${claim.claimText}」`).join("、")}。`
      + "缩小配文范围后可以重新核验。",
    );
  }
  if (otherOmissions.length > 0) {
    coverageNotes.push(
      `另有 ${otherOmissions.length} 处模型声明但没有展开的图上说明文字，一并保留原文，不计入配文覆盖。`,
    );
  }
  if (coverage && coverage.coverage < CAPTION_COVERAGE_MIN) {
    coverageNotes.push(
      `配文里有约 ${Math.round((1 - coverage.coverage) * 100)}% 的文字没有被已核验主张覆盖`
      + `${coverage.uncovered ? `，例如「${coverage.uncovered}」` : ""}；请缩小配文或补充主张后重试，避免漏掉内容。`,
    );
  }
  const captionCoverageNote = coverageNotes.length > 0 ? coverageNotes.join(" ") : null;

  const audit = auditClaimsAgainstSources({
    claims,
    citations: findingCitations,
    hits: [...hitsById.values()],
    noApplicableSourceReason,
    caption,
    periodNotes: auditedPeriodNotes,
    supplements: auditedSupplementInfos,
    imageClaimsContext: filledClaims.filter((claim) => claim.fromImage),
  });

  // 补证前后按主张原文配对，逐条给出状态变化与原因，供页面与记录展示「结论为什么变」。
  const conclusionChanges = resume ? diffConclusions(resume.prior.conclusions, audit.conclusions) : null;

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
    omittedClaims,
    captionCoverage: coverage ? coverage.coverage : null,
    captionCoverageNote,
    supplement,
    conclusionChanges,
    investigationId: null,
    inputFingerprint: null,
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
  /** 无检索对照臂从工具声明里去掉检索，模型看不到也就不会调用。 */
  private readonly toolDeclarations: AnthropicToolDefinition[];

  constructor(
    config: ProviderConfig,
    image: UploadedChartImage,
    caption: string,
    prompt: string,
    requester?: AnthropicMessagesRequester,
    options: { includeSearch?: boolean } = {},
  ) {
    this.model = config.model;
    this.send = requester ?? createAnthropicMessagesRequester(config, { timeoutMs: REQUEST_TIMEOUT_MS });
    this.toolDeclarations = options.includeSearch === false
      ? sourceToolDeclarations.filter((tool) => tool.name !== SEARCH_TOOL_NAME)
      : sourceToolDeclarations;
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
        tools: extra.tools ?? this.toolDeclarations,
        tool_choice: extra.toolChoice ?? variant.toolChoice,
        ...(variant.thinking ? { thinking: variant.thinking } : {}),
      }));
    } catch (error) {
      throw new SourceInvestigationError(isTimeout(error) ? "timeout" : "upstream", { cause: error });
    }
    const loopReply = toToolLoopReply(reply, this.model);
    // assistant 消息必须带非空 content：纯文本回复没有 tool_use，要保留文本本身，
    // 否则 Anthropic 会因空 content 拒绝整段对话（HTTP 400）。
    const assistantContent: AnthropicTurnBlock[] = [
      ...(loopReply.text ? [{ type: "text" as const, text: loopReply.text }] : []),
      ...loopReply.calls.map((call) => ({
        type: "tool_use" as const,
        id: call.id,
        name: call.name,
        input: call.input,
      })),
    ];
    if (assistantContent.length > 0) {
      this.turns.push({ role: "assistant", content: assistantContent });
    }
    return loopReply;
  }

  async start(): Promise<ToolLoopReply> {
    return await this.sendTurn({});
  }

  /**
   * 最后一条 assistant 消息里尚未回传结果的 tool_use：同轮被拒的汇总、超限被丢的调用、
   * 以及初查以汇总结束后的那次调用，都属于这一类。Anthropic 要求每个 tool_use 后紧跟
   * 配对的 tool_result，否则整段对话被 HTTP 400 拒绝——发任何新用户消息前先补齐。
   * `exclude` 是本次消息里已自带结果的调用 ID，避免重复回传。
   */
  private pendingToolResults(exclude: ReadonlySet<string> = new Set()): AnthropicTurnBlock[] {
    const last = this.turns[this.turns.length - 1];
    if (last?.role !== "assistant") return [];
    const answered = new Set<string>(exclude);
    for (const turn of this.turns) {
      if (turn.role !== "user") continue;
      for (const block of turn.content) {
        if (block.type === "tool_result") answered.add(block.tool_use_id);
      }
    }
    return last.content
      .filter((block): block is AnthropicToolUseBlock =>
        block.type === "tool_use" && Boolean(block.id) && !answered.has(block.id as string))
      .map((block) => ({
        type: "tool_result" as const,
        tool_use_id: block.id as string,
        content: "该工具调用的结果未被采用或调查已进入下一阶段；请基于已有信息继续。",
        is_error: true,
      }));
  }

  async resume(message: string): Promise<ToolLoopReply> {
    this.turns.push({
      role: "user",
      content: [...this.pendingToolResults(), { type: "text", text: message }],
    });
    return await this.sendTurn({});
  }

  async continue(results: ToolResultPayload[]): Promise<ToolLoopReply> {
    const paired = results.map((result) => ({
      type: "tool_result" as const,
      tool_use_id: result.id,
      content: result.output,
      ...(result.isError ? { is_error: true } : {}),
    }));
    const pairedIds = new Set(results.map((result) => result.id));
    if (results.length > 0) {
      this.turns.push({ role: "user", content: [...this.pendingToolResults(pairedIds), ...paired] });
    } else {
      this.turns.push({
        role: "user",
        content: [...this.pendingToolResults(), { type: "text", text: "请继续：调用工具，或调用 report_source_finding 汇总。" }],
      });
    }
    return await this.sendTurn({});
  }

  async finalize(reason: string): Promise<ToolLoopReply> {
    this.turns.push({
      role: "user",
      content: [
        ...this.pendingToolResults(),
        { type: "text", text: `${reason}${FINALIZE_SUFFIX}` },
      ],
    });
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

/** 无检索对照臂：声明里去掉检索工具，模型看不到也就不会调用。 */
function sourceFunctionToolsFor(includeSearch: boolean) {
  return includeSearch
    ? sourceFunctionTools
    : sourceFunctionTools.filter((tool) => tool.name !== SEARCH_TOOL_NAME);
}

/** Responses 协议的工具循环：累积 input 数组，逐轮回传 function_call 与其输出。 */
export class ResponsesSourceInvestigationDriver implements SourceInvestigationDriver {
  readonly model: string;
  private readonly input: ResponseInputItem[] = [];
  private readonly send: ResponsesRequester;
  private readonly functionTools: ReturnType<typeof sourceFunctionToolsFor>;

  constructor(
    config: ProviderConfig,
    image: UploadedChartImage,
    caption: string,
    prompt: string,
    requester?: ResponsesRequester,
    options: { includeSearch?: boolean } = {},
  ) {
    this.model = config.model;
    this.functionTools = sourceFunctionToolsFor(options.includeSearch !== false);
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
        tools: this.functionTools,
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

  /**
   * 尾部尚未回传输出的 function_call（同轮被拒的汇总、超限被丢的调用、初查以汇总结束的那次）。
   * Responses 同样要求 function_call 紧跟配对的 function_call_output；`exclude` 是本次消息
   * 已自带输出的调用 ID，避免重复回传。
   */
  private pendingFunctionOutputs(exclude: ReadonlySet<string> = new Set()): ResponseInputItem[] {
    const answered = new Set(exclude);
    for (const item of this.input) {
      if ((item as { type?: string }).type === "function_call_output") {
        answered.add((item as { call_id?: string }).call_id as string);
      }
    }
    const pending: Array<{ call_id?: string }> = [];
    for (const item of [...this.input].reverse()) {
      if ((item as { type?: string }).type !== "function_call") break;
      pending.push(item as { call_id?: string });
    }
    return pending.reverse()
      .filter((call) => call.call_id && !answered.has(call.call_id))
      .map((call) => ({
        type: "function_call_output",
        call_id: call.call_id as string,
        output: "该工具调用的结果未被采用或调查已进入下一阶段；请基于已有信息继续。",
      }) as ResponseInputItem);
  }

  async resume(message: string): Promise<ToolLoopReply> {
    this.input.push(...this.pendingFunctionOutputs());
    this.input.push({ role: "user", content: [{ type: "input_text", text: message }] });
    return await this.sendTurn({});
  }

  async continue(results: ToolResultPayload[]): Promise<ToolLoopReply> {
    // 先扫描尾部未配对调用（此时还没 push 本次结果），再回传本次结果与补齐项。
    const pending = this.pendingFunctionOutputs(new Set(results.map((result) => result.id)));
    if (results.length === 0) {
      this.input.push(...pending);
      this.input.push({ role: "user", content: [{ type: "input_text", text: "请继续：调用工具，或调用 report_source_finding 汇总。" }] });
      return await this.sendTurn({});
    }
    this.input.push(...pending);
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
    this.input.push(...this.pendingFunctionOutputs());
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
