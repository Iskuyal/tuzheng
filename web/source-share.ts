import {
  CLAIM_STATUS_LABELS,
  TOOL_CALLS_PER_INVESTIGATION,
  type ClaimSourceConclusion,
  type ModelCitation,
  type SourceHit,
  type SourceInvestigationResult,
} from "../shared/source-audit.js";
import { fnv1a64 } from "../shared/source-library.js";

/**
 * 分享摘要：把当前这一次核验结果压成一段可粘贴的纯文本。
 *
 * 三条硬规则（改文案时不要破坏）：
 * 1. 每次都带上使用边界：结论只覆盖当前主张与适用的收录来源；
 * 2. 模型给出的修改建议只能标成「尚未采用」的参考，不能写成事实结论；
 * 3. 用户补充的口径标成「用户提供」，不与官方来源混在一起。
 *
 * 摘要完全由传入的结果确定性生成，不含时间戳与随机数：同一次结果永远得到同一段文字，
 * 末尾指纹才有意义（接收方可以用 `shareSummaryFingerprint` 校验文字有没有被改过）。
 */

/** 摘要固定使用的边界声明；与结果区 `.room-result-boundary` 保持同一句话。 */
export const SHARE_BOUNDARY = "仅核对当前主张与适用的收录来源；未确认整张图、原始数据或制作过程的真实性。";

/** 摘要首行标题。 */
export const SHARE_TITLE = "图证 · 来源核验摘要";

/** 模型建议在摘要里的一律标注，避免被当成已确认的结论。 */
const SUGGESTION_PREFIX = "修改建议（模型建议，尚未采用）";

function roleLabel(citation: ModelCitation | undefined): string {
  if (!citation) return "";
  return citation.role === "value-basis" ? "用作数值依据"
    : citation.role === "term-explanation" ? "只用于解释术语"
      : "仅作背景";
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function findDocument(hits: readonly SourceHit[], sourceId: string): SourceHit["document"] | null {
  return hits.find((hit) => hit.document.id === sourceId)?.document ?? null;
}

function citationLines(conclusion: ClaimSourceConclusion, hits: readonly SourceHit[], citations: readonly ModelCitation[]): string[] {
  return conclusion.citedSourceIds.map((sourceId) => {
    const citation = citations.find((entry) => entry.sourceId === sourceId);
    const document = findDocument(hits, sourceId);
    const title = document ? `《${document.title}》（${document.publisher}，${document.publishedAt}）` : sourceId;
    const role = roleLabel(citation);
    const note = citation?.note ? `：${citation.note}` : "";
    return `   引用：${title}${role ? ` · ${role}${note}` : ""}`;
  });
}

function conclusionLines(
  conclusion: ClaimSourceConclusion,
  index: number,
  hits: readonly SourceHit[],
  citations: readonly ModelCitation[],
): string[] {
  const lines: string[] = [];
  const kind = conclusion.fromImage ? "图内观察" : "配文";
  lines.push(`${index + 1}. 「${conclusion.claimText}」（${kind}）· ${CLAIM_STATUS_LABELS[conclusion.status]}`);
  if (conclusion.summary) lines.push(`   说明：${conclusion.summary}`);
  if (conclusion.officialValue !== null) {
    const basis = conclusion.basisLabel ? `，${conclusion.basisLabel}` : "";
    lines.push(`   数值对照：原文 ${percent(conclusion.claimValue)} → 适用来源 ${percent(conclusion.officialValue)}${basis}`);
  }
  if (conclusion.periodNote) lines.push(`   口径补全：${conclusion.periodNote}`);
  if (conclusion.supplement) {
    lines.push(`   用户补充（用户提供，不是官方来源）：${conclusion.supplement.normalized}（原话「${conclusion.supplement.raw}」）`);
  }
  if (conclusion.revisionReview) {
    const review = conclusion.revisionReview;
    lines.push(`   版本复查：所引《${review.fromTitle}》记载 ${review.fromValue}%，已被《${review.toTitle}》按官方修订声明修订为 ${review.toValue}%。`);
  }
  const reasons = conclusion.reasons.slice(0, 6).map((reason) => `   依据：${reason}`);
  lines.push(...reasons);
  lines.push(...citationLines(conclusion, hits, citations));
  for (const item of conclusion.unresolved) lines.push(`   未解决：${item}`);
  return lines;
}

function suggestionLines(result: SourceInvestigationResult): string[] {
  const suggestion = result.captionSuggestion;
  if (!suggestion) return [];
  const lines = ["", `${SUGGESTION_PREFIX}`];
  lines.push(`   建议配文：${suggestion.suggestedCaption}`);
  for (const change of suggestion.changes.filter((entry) => entry.applied).slice(0, 8)) {
    const from = change.original ?? "（原句未定位）";
    const to = change.suggested ? change.suggested : "（建议删除）";
    lines.push(`   · 「${from}」→「${to}」：${change.reason}`);
  }
  for (const note of suggestion.notes) lines.push(`   提醒：${note}`);
  return lines;
}

export interface ShareSummaryInput {
  result: SourceInvestigationResult;
  /** 当前配文（用户提供的原文），用于说明分享的是哪一段材料。 */
  caption: string;
}

/**
 * 生成分享摘要正文（不含末尾指纹行）。空材料也有完整结构，方便接收方判断「没有可用结论」。
 */
export function buildShareSummaryBody(input: ShareSummaryInput): string {
  const { result, caption } = input;
  const lines: string[] = [SHARE_TITLE, SHARE_BOUNDARY, ""];

  const trimmedCaption = caption.trim();
  lines.push(`配文原文：${trimmedCaption || "（未提供）"}`);
  const stats = [`模型 ${result.model}`, `${result.rounds} 轮`, `工具调用 ${result.toolCallsUsed} / ${TOOL_CALLS_PER_INVESTIGATION}`];
  lines.push(`本次核验：${stats.join(" · ")}`);
  lines.push(`停止原因：${result.stopReason}`);

  lines.push("", `结论（${result.conclusions.length} 条）`);
  if (!result.conclusions.length) {
    lines.push("本次没有形成可用结论。");
    if (result.noApplicableSourceReason) lines.push(`   原因：${result.noApplicableSourceReason}`);
  }
  result.conclusions.forEach((conclusion, index) => {
    lines.push(...conclusionLines(conclusion, index, result.hits, result.acceptedCitations));
  });

  if (result.clarification) {
    lines.push("", "待补充确认（尚未回答）");
    lines.push(`   问题：${result.clarification.question}`);
  }

  if (result.unresolvedItems.length) {
    lines.push("", "整体未解决项");
    for (const item of result.unresolvedItems) lines.push(`   · ${item}`);
  }

  if (result.omittedClaims.length) {
    lines.push("", "未展开核验的内容");
    for (const item of result.omittedClaims) lines.push(`   · 「${item.claimText}」：${item.reason}`);
  }

  if (result.captionCoverageNote) {
    lines.push("", `配文覆盖提示：${result.captionCoverageNote}`);
  }

  if (result.supplement) {
    const record = result.supplement;
    lines.push("", "补充回答（用户提供，不是官方来源）");
    lines.push(`   问题：${record.question}`);
    lines.push(`   回答：${record.answer}`);
    if (record.parseNote) lines.push(`   解析说明：${record.parseNote}`);
    for (const conflict of record.conflicts) {
      lines.push(`   冲突：${conflict.claimText}（图上「${conflict.fromImage}」／你补充「${conflict.fromUser}」）`);
    }
  }

  lines.push(...suggestionLines(result));
  return lines.join("\n");
}

/** 摘要指纹：FNV-1a 64 位，接收方与本页对同一段文字应得到同一个值。 */
export function shareSummaryFingerprint(body: string): string {
  return fnv1a64(body);
}

/** 生成可以整段复制的分享摘要（正文 + 指纹行）。 */
export function buildShareSummary(input: ShareSummaryInput): string {
  const body = buildShareSummaryBody(input);
  return `${body}\n\n摘要指纹：${shareSummaryFingerprint(body)}\n（指纹由摘要正文计算；文字被改动后指纹即不同。）`;
}
