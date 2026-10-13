/** 手写离线替身：包含故意错误、遗漏、上游失败；不是模型效果数据，也不读取独立期望。 */
import type { ModelInput, Output, Transports, RequestRecord } from "./holdout-evaluation.js";
import { type ModelRequestRecord, type ToolLoopReply } from "../server/source-investigation.js";
import { SEARCH_TOOL_NAME, REPORT_TOOL_NAME, CLARIFY_TOOL_NAME } from "../server/source-tools.js";
const R = "stats-retail-2026-08", OLD = "stats-retail-2026-07", CPI = "stats-cpi-2026-08";
// 第三方模型的位置由静态响应代替，任何字段都不来自评分文件。
const rows: Record<string, [string, string, string | null, "year-on-year" | "month-on-month" | null, number, number | null, Output["claims"][number]["status"], string[]]> = {
  h01: ["社会消费品零售总额", "2026-03", "全国", "month-on-month", 0.12, 0.12, "source-match", [R]],
  h02: ["全国居民消费价格", "2026-08", "全国", "month-on-month", 0.4, 0.4, "source-match", [CPI]],
  h03: ["社会消费品零售总额", "2026-08", "全国", "month-on-month", 0.13, -0.13, "source-mismatch", [R]],
  h04: ["社会消费品零售总额", "2026-04", "全国", "month-on-month", -0.32, -0.23, "source-mismatch", [R]],
  h05: ["社会消费品零售总额", "2026-01", "全国", null, 0.21, null, "source-pending", []],
  h06: ["社会消费品零售总额", "2026-02", null, "month-on-month", 0.27, null, "source-pending", []],
  h07: ["社会消费品零售总额", "2026-09", "全国", "month-on-month", 0.09, null, "source-pending", []],
  h08: ["社会消费品零售总额", "2026-05", "南京市", "month-on-month", -0.1, null, "source-pending", []],
  h09: ["社会消费品零售总额", "2026-08", "全国", "month-on-month", -0.13, -0.13, "source-match", [R]],
  h10: ["全国居民消费价格", "2026-05", "全国", "year-on-year", 0.9, null, "source-pending", []],
  h11: ["社会消费品零售总额", "2026-03", "全国", "month-on-month", 0.1, 0.12, "source-mismatch", [R]],
  h12: ["社会消费品零售总额", "2026-04", "全国", "month-on-month", -0.27, -0.23, "source-mismatch", [R]],
};
export function fixtureOutput(input: ModelInput): Output {
  const [metric, period, scope, basis, value, officialValue, status, sourceIds] = rows[input.questionId];
  const id = input.questionId;
  const imageBasisLabel = basis === "year-on-year" ? "同比" : basis === "month-on-month" ? "环比" : "比较方式未注明";
  const imageText = `${period} ${scope ?? "范围未注明"} ${metric} ${imageBasisLabel} ${value.toFixed(2)}%`;
  const image: Output["claims"][number] = { claimText: imageText, fromImage: true, kind: "direct", metric, period, scope, basis,
    value, direction: null, officialValue, status, sourceIds: [...sourceIds], revisionFrom: id === "h11" || id === "h12" ? OLD : null };
  const caption = { ...image, claimText: input.caption, fromImage: false };
  let captions = [caption];
  if (id === "h02") captions = [{ ...caption, claimText: "2026年8月全国CPI环比上涨0.4%" },
    { ...caption, claimText: "2026年8月全国CPI同比上涨0.8%", value: 0.8, officialValue: 0.8, basis: "year-on-year" }];
  if (id === "h09" || id === "h10") {
    caption.kind = "inference"; caption.direction = "down"; caption.value = null; caption.basis = "month-on-month";
    if (id === "h10") caption.status = "inference-unsupported";
  }
  if (id === "h12") { caption.value = -0.23; caption.status = "source-match"; caption.revisionFrom = null; }
  const missing = id === "h05" || id === "h06";
  if (input.phase === "after" && missing) Object.assign(caption, { scope: "全国", basis: "month-on-month", officialValue: value,
    status: "source-match", sourceIds: [R] });
  const corrected: Record<string, string> = {
    h03: "2026年8月全国社会消费品零售总额环比为-0.13%。",
    h04: "2026年4月全国社会消费品零售总额环比为-0.23%。",
    h11: "2026年3月全国社会消费品零售总额环比增长0.12%。",
  };
  return { claims: [...captions, image], clarification: missing && input.phase === "before"
    ? { field: id === "h05" ? "basis" : "scope", claimText: input.caption, question: id === "h05" ? "配文增长指同比还是环比？" : "配文的统计范围是什么？" } : null,
    stopReason: missing && input.phase === "before" ? "等待用户补一项口径。" : "冻结资料范围内汇总，缺来源不下结论。",
    rewrites: captions.map(c => ({ claimText: c.claimText, suggestedText: c.status === "source-match" ? c.claimText
      : c.status === "source-mismatch" ? corrected[id] : `${c.claimText}${c.kind === 'inference' ? '（现有证据不足以支持这项推断）' : '（暂未核实）'}` })) };
}

export function offlineTransports(): Transports {
  return {
    direct() {
      const requests: RequestRecord[] = [];
      return { requests, async send(input) {
        requests.push({ status: input.questionId === "h07" && input.arm === "A-direct" ? "failed" : "ok",
          inputTokens: null, outputTokens: null, durationMs: 0, parameters: { fixture: true } });
        if (input.questionId === "h07" && input.arm === "A-direct") throw new Error("替身503（故意保留失败）");
        const raw = fixtureOutput(input);
        // A给出与B相同的事实响应，记忆数字可事实答对，但不可伪造证据可见性。
        if (input.questionId === "h04" && input.arm === "B-full-context") raw.rewrites[0].suggestedText = "2026年4月全国社零强劲增长9%。";
        return { raw, model: "offline-fixture-only" };
      } };
    },
    tools(input) {
      const requestRecords: ModelRequestRecord[] = [];
      let replyIndex = 0;
      const model = "offline-fixture-only";
      const next = async (): Promise<ToolLoopReply> => {
        const startedAt = new Date().toISOString();
        const fail = input.questionId === "h06";
        requestRecords.push({ startedAt, completedAt: startedAt, parameters: { model, maxTokens: 4096, thinking: null, toolChoice: null },
          status: fail ? "failed" : "ok", responseModel: fail ? null : model, usage: null, httpStatus: fail ? 503 : null });
        if (fail) throw new Error("工作流替身503；恢复保持阻塞。");
        const resumed = replyIndex >= 2 && input.questionId === "h05";
        const output = fixtureOutput({ ...input, phase: resumed ? "after" : "before" });
        const query = { metric: rows[input.questionId][0], period: rows[input.questionId][1],
          scope: rows[input.questionId][2], terms: ["环比"] };
        const step = replyIndex++;
        let calls;
        if (step === 0) calls = [{ id: "search", name: SEARCH_TOOL_NAME, input: query }];
        else {
          const claims = output.claims.filter(c => !(input.questionId === "h02" && c.value === 0.8)
            && !(input.questionId === "h08" && !c.fromImage)); // 故意遗漏，检验退化保留。
          const report = { claims: claims.map(({ status: _status, officialValue: _official, sourceIds: _ids, revisionFrom: _revision, ...claim }) =>
            ({ ...claim, imageExcerpt: claim.fromImage ? claim.claimText : null })),
            citations: [...new Set(output.claims.flatMap(c => c.sourceIds))].map(sourceId => ({
              sourceId: input.questionId === "h11" || input.questionId === "h12" ? OLD : sourceId, role: "value-basis", note: null })),
            noApplicableSourceReason: "仅使用本次冻结资料，缺少所需条目时保持待核对。",
            unresolvedItems: [], omittedClaims: [], rewrites: output.rewrites.map(r => ({ ...r, reason: "离线替身提议" })) };
          calls = [ ...(output.clarification ? [{ id: "ask", name: CLARIFY_TOOL_NAME,
            input: { ...output.clarification, purpose: "确定配文主张口径后才能核对。" } }] : []),
            { id: "report", name: REPORT_TOOL_NAME, input: report } ];
        }
        return { model, usage: null, text: "离线脚本化响应，不代表模型决策。", calls, truncated: false };
      };
      return { model, requestRecords, start: next, continue: next, resume: next, finalize: next };
    },
  };
}
