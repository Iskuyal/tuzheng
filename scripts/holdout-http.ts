/** 评测专用传输；不读取配置，不修改冻结包或生产driver。fetch只有这一处调用。 */
import { zodTextFormat } from "openai/helpers/zod";
import { isSafeModelBaseUrl } from "../server/model-base-url.js";
import type { ProviderConfig, ModelProvider } from "../server/model-settings.js";
import { ANTHROPIC_API_VERSION, AnthropicRequestError, type AnthropicReply, type AnthropicTurn } from "../server/anthropic-messages.js";
import { AnthropicSourceInvestigationDriver, ResponsesSourceInvestigationDriver, type ModelRequestRecord, type ResponsesRequester } from "../server/source-investigation.js";
import { outputSchema, sha256, type Arm, type ModelInput, type RequestRecord, type Transports } from "./holdout-evaluation.js";

export interface HttpContext { arm: Arm; questionId: string; phase: "before" | "after" }
export interface HttpRecord extends HttpContext {
  sequence: number; startedAt: string; completedAt: string | null; status: "running" | "ok" | "failed";
  httpStatus: number | null; provider: ModelProvider; endpoint: string; requestedModel: string;
  responseModel: string | null; bodyHash: string; parameters: unknown; response: unknown;
  inputTokens: number | null; outputTokens: number | null; error: string | null; attempted: boolean;
}
export class HttpStoppedError extends Error {}
const safeValue = (value: unknown, key: string): unknown => {
  if (typeof value === "string") return value.split(key).join("[REDACTED]");
  if (Array.isArray(value)) return value.map(v => safeValue(v, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safeValue(v, key)]));
  return value;
};
const token = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** 请求数是可执行的硬上限；金额保持未知，不能称金额封顶。所有臂共享同一个实例。 */
export class HttpBudget {
  readonly records: HttpRecord[] = [];
  stopReason: string | null = null;
  private consecutiveFailures = 0;
  constructor(readonly options: { maxRequests: number; fetchImpl?: typeof fetch;
    persist?: (record: HttpRecord) => Promise<void>; timeoutMs?: number }) {
    if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1 || options.maxRequests > 360) throw new Error("HTTP请求上限必须是1—360的整数。");
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60000)) throw new Error("请求超时必须是1—60000毫秒。");
  }
  halt(reason: string) { this.stopReason ??= reason; }
  async send(config: ProviderConfig, provider: ModelProvider, body: unknown, context: HttpContext): Promise<unknown> {
    if (this.stopReason) throw new HttpStoppedError(this.stopReason);
    if (this.records.length >= this.options.maxRequests) { this.halt("达到实际HTTP请求上限。"); throw new HttpStoppedError(this.stopReason!); }
    if (!isSafeModelBaseUrl(config.baseUrl) || !config.apiKey || !config.model) throw new Error("模型配置不完整或地址不安全。");
    const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/${provider === "anthropic" ? "messages" : "responses"}`;
    // 同步预占；await落盘之前即占用预算，避免并发越过上限。
    const record: HttpRecord = { ...context, sequence: this.records.length + 1, startedAt: new Date().toISOString(), completedAt: null,
      status: "running", httpStatus: null, provider, endpoint, requestedModel: config.model, responseModel: null,
      bodyHash: sha256(JSON.stringify(body)), parameters: safeValue(body, config.apiKey), response: null,
      inputTokens: null, outputTokens: null, error: null, attempted: false };
    this.records.push(record);
    try { await this.options.persist?.(structuredClone(record)); }
    catch { this.halt("HTTP发送前记录写入失败，已停止。"); throw new HttpStoppedError(this.stopReason!); }
    try {
      record.attempted = true;
      const reply = await (this.options.fetchImpl ?? fetch)(endpoint, {
        method: "POST", redirect: "error", headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}`,
          ...(provider === "anthropic" ? { "x-api-key": config.apiKey, "anthropic-version": ANTHROPIC_API_VERSION } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(this.options.timeoutMs ?? 60000),
      });
      record.httpStatus = reply.status;
      const text = await reply.text();
      try { record.response = safeValue(JSON.parse(text), config.apiKey); } catch { record.response = safeValue(text, config.apiKey); }
      const payload = object(record.response); const usage = object(payload.usage);
      record.responseModel = typeof payload.model === "string" ? payload.model : null;
      record.inputTokens = token(usage.input_tokens); record.outputTokens = token(usage.output_tokens);
      if (!reply.ok) {
        if ([401, 403, 429].includes(reply.status)) this.halt(`上游HTTP ${reply.status}，需处理权限、配额或服务限流。`);
        if (provider === "anthropic") throw new AnthropicRequestError(reply.status, "详见脱敏HTTP记录");
        throw new Error(`模型HTTP ${reply.status}，详见脱敏HTTP记录。`);
      }
      if (record.inputTokens === null || record.outputTokens === null) {
        this.halt("成功HTTP响应的usage未知或无效，停止后续请求并保留原响应。");
        throw new HttpStoppedError(this.stopReason!);
      }
      record.status = "ok"; this.consecutiveFailures = 0;
      return record.response;
    } catch (error) {
      record.status = "failed"; record.error = String(safeValue(error instanceof Error ? error.message : String(error), config.apiKey));
      if (++this.consecutiveFailures >= 3) this.halt("连续三次HTTP失败，停止后续请求。");
      // 给driver保留400类型，兼容回退必须再次经过共享计数器。
      if (error instanceof AnthropicRequestError) throw error;
      const failure = new Error(record.error);
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) failure.name = error.name;
      throw failure;
    } finally {
      record.completedAt = new Date().toISOString();
      try { await this.options.persist?.(structuredClone(record)); }
      catch { this.halt("HTTP响应记录写入失败，已停止。"); throw new HttpStoppedError(this.stopReason!); }
    }
  }
}

function requestRecord(record: HttpRecord): RequestRecord {
  return { status: record.status === "ok" ? "ok" : "failed", inputTokens: record.inputTokens, outputTokens: record.outputTokens,
    durationMs: record.completedAt ? Date.parse(record.completedAt) - Date.parse(record.startedAt) : 0,
    parameters: record.parameters };
}
function responseText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (Array.isArray(payload.output) ? payload.output : []).flatMap(item => {
    const content = object(item).content;
    return (Array.isArray(content) ? content : []).filter(c => object(c).type === "output_text").map(c => object(c).text);
  }).join("");
}

export function createHttpTransports(provider: ModelProvider, config: ProviderConfig, budget: HttpBudget): Transports {
  const format = zodTextFormat(outputSchema, "holdout_result");
  return {
    direct(first) {
      const context: HttpContext = { arm: first.arm, questionId: first.questionId, phase: first.phase };
      const history: unknown[] = []; const messages: AnthropicTurn[] = [];
      let calls = 0;
      const owned: HttpRecord[] = [];
      return {
        get requests() { return owned.filter(r => r.attempted).map(requestRecord); },
        async send(input) {
          if (++calls > 2 || input.arm !== first.arm || input.questionId !== first.questionId) throw new Error("直接响应会话最多初查和一次补证，不能混入其他路径。");
          context.phase = input.phase;
          const text = input.phase === "before"
            ? `${input.prompt}\n\n用户配文：${input.caption}${input.documents.length ? `\n\n允许引用的资料全集：${JSON.stringify(input.documents)}` : ""}`
            : `用户针对追问的补充：${input.answer}`;
          const offset = budget.records.length;
          try {
            let payload: Record<string, unknown>; let raw: unknown;
            if (provider === "openai-responses") {
              history.push({ role: "user", content: [ { type: "input_text", text },
                ...(input.phase === "before" ? [{ type: "input_image", image_url: `data:${input.mimeType};base64,${input.image.toString("base64")}`, detail: "high" }] : []) ] });
              payload = object(await budget.send(config, provider, { model: config.model, store: false, max_output_tokens: 4096,
                input: structuredClone(history), text: { format } }, context));
              if (payload.status === "incomplete" || payload.incomplete_details) throw new Error("直接响应被截断。");
              const textOutput = responseText(payload); if (!textOutput) throw new Error("直接响应为空或拒答。");
              history.push({ role: "assistant", content: [{ type: "output_text", text: textOutput }] });
              raw = JSON.parse(textOutput);
            } else {
              messages.push({ role: "user", content: [{ type: "text", text }, ...(input.phase === "before" ? [{ type: "image" as const,
                source: { type: "base64" as const, media_type: input.mimeType, data: input.image.toString("base64") } }] : [])] });
              payload = object(await budget.send(config, provider, { model: config.model, max_tokens: 4096, thinking: { type: "disabled" },
                messages: structuredClone(messages), tools: [{ name: "report_holdout_result", description: "返回图文核验结构。", input_schema: format.schema }],
                tool_choice: { type: "tool", name: "report_holdout_result" } }, context));
              if (payload.stop_reason === "max_tokens") throw new Error("直接响应被截断。");
              const content = Array.isArray(payload.content) ? payload.content : [];
              const reports = content.filter(c => object(c).type === "tool_use" && object(c).name === "report_holdout_result");
              if (reports.length !== 1 || typeof object(reports[0]).id !== "string") throw new Error("结构工具输出缺失或重复。");
              raw = object(reports[0]).input;
              messages.push({ role: "assistant", content: content as AnthropicTurn["content"] });
              // 汇总工具也必须配对，再追加用户补充。
              messages.push({ role: "user", content: content.filter(c => object(c).type === "tool_use").map(c => ({ type: "tool_result",
                tool_use_id: String(object(c).id), content: "结果已记录。" })) });
            }
            return { raw: outputSchema.parse(raw), model: typeof payload.model === "string" ? payload.model : config.model };
          } finally { owned.push(...budget.records.slice(offset)); }
        },
      };
    },
    tools(input) {
      const context: HttpContext = { arm: input.arm, questionId: input.questionId, phase: input.phase };
      const owned: HttpRecord[] = [];
      const send = async (body: unknown) => {
        const offset = budget.records.length;
        try { return await budget.send(config, provider, body, context); }
        finally { owned.push(...budget.records.slice(offset)); }
      };
      const image = { buffer: input.image, mimeType: input.mimeType, originalName: "holdout.png" };
      const driver = provider === "anthropic"
        ? new AnthropicSourceInvestigationDriver(config, image, input.caption, input.prompt, async body => await send(body) as AnthropicReply)
        : new ResponsesSourceInvestigationDriver(config, image, input.caption, input.prompt, async body => {
          const payload = object(await send({ ...body, max_output_tokens: 4096 }));
          return { ...payload, output_text: responseText(payload) } as Awaited<ReturnType<ResponsesRequester>>;
        });
      return { model: driver.model,
        get requestRecords(): ModelRequestRecord[] { return owned.filter(r => r.attempted).map(record => ({ startedAt: record.startedAt, completedAt: record.completedAt,
          status: record.status, responseModel: record.responseModel, usage: record.inputTokens === null || record.outputTokens === null ? null
            : { input_tokens: record.inputTokens, output_tokens: record.outputTokens }, httpStatus: record.httpStatus,
          parameters: { model: config.model, maxTokens: 4096, thinking: object(record.parameters).thinking ?? null,
            toolChoice: object(record.parameters).tool_choice ?? null } })); },
        start: () => driver.start(), continue: results => driver.continue(results), finalize: reason => driver.finalize(reason),
        resume: message => { context.phase = "after"; return driver.resume(message); },
      };
    },
  };
}
