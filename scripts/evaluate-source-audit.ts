import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import rawQuestions from "../samples/source-audit-questions.json" with { type: "json" };
import rawExpectations from "../samples/source-audit-expectations.json" with { type: "json" };
import {
  AnthropicSourceInvestigationDriver,
  SourceInvestigationError,
  runSourceInvestigation,
  MAX_OUTPUT_TOKENS,
  REQUEST_TIMEOUT_MS,
  type SourceInvestigationDriver,
  type ModelRequestRecord,
} from "../server/source-investigation.js";
import { sourceInvestigationPrompt } from "../server/source-prompt.js";
import "dotenv/config";
import { activeProviderConfig, createModelSettingsStore } from "../server/model-settings.js";
import {
  CLARIFICATIONS_PER_INVESTIGATION,
  INVESTIGATION_DEADLINE_MS,
  INVESTIGATION_ROUNDS,
  TOOL_CALLS_PER_INVESTIGATION,
  TOOL_CALLS_PER_ROUND,
  normalizeSourcePeriod,
  type ClaimSourceStatus,
  type RevisionReview,
  type SourceClaim,
  type SourceInvestigationResult,
} from "../shared/source-audit.js";
import { SOURCE_LIBRARY, findSourceDocument, verifySourceLibrary } from "../shared/source-library.js";
import { captureProvenance, createEvaluationWriter, sha256 } from "./source-audit-recording.js";

const armSchema = z.enum(["retrieval", "no-retrieval"]);
const statusSchema = z.enum([
  "source-match",
  "source-mismatch",
  "source-pending",
  "inference-unsupported",
  "not-verifiable",
]);
const basisSchema = z.enum(["year-on-year", "month-on-month"]);
const claimKindSchema = z.enum(["direct", "inference", "opinion"]);

export type Arm = z.infer<typeof armSchema>;

const imageSchema = z.object({
  svgSha256: z.string().length(64),
  pngSha256: z.string().length(64),
  imageText: z.array(z.string().min(1)).min(1),
  note: z.string().optional(),
}).strict();

const questionSchema = z.object({
  id: z.string().min(1),
  categories: z.array(z.string().min(1)).min(1),
  image: z.string().min(1),
  caption: z.string().min(1),
  /** 补证后阶段由人写定的用户回答：输入侧字段，不由模型生成。 */
  clarifyAnswer: z.string().min(1).max(400).optional(),
  note: z.string().optional(),
}).strict();

export const questionsCatalogSchema = z.object({
  version: z.number(),
  frozenAt: z.string(),
  description: z.string(),
  imageDirectory: z.string(),
  images: z.record(z.string(), imageSchema),
  questions: z.array(questionSchema).min(10),
}).strict();

const claimSelectSchema = z.object({
  fromImage: z.boolean(),
  kind: claimKindSchema.optional(),
  basis: basisSchema.nullable().optional(),
  value: z.number().optional(),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
}).strict();

const expectRuleSchema = z.object({
  select: claimSelectSchema,
  status: statusSchema,
  min: z.number().int().min(0).optional(),
}).strict();

const captionChangeKindSchema = z.enum(["replace-value", "keep-qualified", "suggest-delete", "unchanged"]);

/**
 * 修改建议的独立期望：逐处改动按主张 select 匹配，再按内容检查建议配文。
 * 只允许使用原配文、本次主张与所引来源里已有的数值／月份／范围（noNewFacts 侧由评测程序独立复算）。
 */
const suggestionRuleSchema = z.object({
  expectChanges: z.array(z.object({
    select: claimSelectSchema,
    /** 允许出现的改动类型；改写由程序按结论兜底，类型基本由状态决定。 */
    kinds: z.array(captionChangeKindSchema).min(1),
    min: z.number().int().min(0).optional(),
  }).strict()).optional(),
  /** 建议配文里必须出现的数值（按数值比较，0.80 与 0.8 相同）。 */
  requiredNumbers: z.array(z.number()).optional(),
  /** 建议配文里不得出现的数值。 */
  forbiddenNumbers: z.array(z.number()).optional(),
  /** 建议配文里不得出现的字面表述（例如已被来源否定的方向词）。 */
  forbiddenPhrases: z.array(z.string().min(1)).optional(),
  /** 本次每处改动都必须是「保留原句」，即没有任何改写。 */
  unchanged: z.boolean().optional(),
  expectationNote: z.string().optional(),
}).strict();

const expectationSchema = z.object({
  id: z.string().min(1),
  expect: z.array(expectRuleSchema).min(1),
  otherClaimStatuses: z.array(statusSchema).min(1),
  requiredAcceptedCitations: z.array(z.string().min(1)).optional(),
  forbiddenValueBasisCitations: z.array(z.string().min(1)).optional(),
  noApplicableSource: z.boolean().optional(),
  /** 配文超过三条或存在未覆盖内容时，本次运行必须给出明确提示。 */
  incompleteNotice: z.boolean().optional(),
  /** 补证前阶段必须提出一次追问。 */
  clarificationRequired: z.boolean().optional(),
  /** 有检索臂里追问必须发生在至少一次成功检索之后。 */
  clarificationAfterSearch: z.boolean().optional(),
  /** 任何一次运行都不允许提出追问（资料已覆盖的案例）。 */
  clarificationForbidden: z.boolean().optional(),
  /** 修改建议的期望；不写则不按逐题规则判定（新事实与覆盖仍做全量检查）。 */
  suggestion: suggestionRuleSchema.optional(),
  /** 同一题的补证后阶段：用题面 clarifyAnswer 恢复后按这套规则判定。 */
  resume: z.object({
    expect: z.array(expectRuleSchema).min(1),
    otherClaimStatuses: z.array(statusSchema).min(1),
    requiredAcceptedCitations: z.array(z.string().min(1)).optional(),
    forbiddenValueBasisCitations: z.array(z.string().min(1)).optional(),
    noApplicableSource: z.boolean().optional(),
    incompleteNotice: z.boolean().optional(),
    /** 恢复段必须记录已套用的用户补充。 */
    supplementApplied: z.boolean().optional(),
    suggestion: suggestionRuleSchema.optional(),
    expectationNote: z.string().optional(),
  }).strict().optional(),
  expectationNote: z.string().optional(),
}).strict();

export const expectationsCatalogSchema = z.object({
  version: z.number(),
  frozenAt: z.string(),
  authoredBy: z.string().min(1),
  rubric: z.array(z.string().min(1)).min(1),
  frozen: z.object({
    provider: z.string().min(1),
    baseUrl: z.string().url(),
    model: z.string().min(1),
    runsPerArm: z.number().int().min(1),
    arms: z.array(armSchema).length(2),
    noRetrievalMethod: z.string().min(1),
    budget: z.record(z.string(), z.number()),
    libraryFingerprints: z.record(z.string(), z.string()),
    gates: z.object({
      gateArm: armSchema,
      claimStatusAccuracy: z.number(),
      fabricatedCitations: z.number(),
      noApplicableSourceOverclaims: z.number(),
    }).strict(),
  }).strict(),
  questions: z.array(expectationSchema).min(10),
}).strict();

export type SourceAuditQuestions = z.infer<typeof questionsCatalogSchema>;
export type SourceAuditExpectations = z.infer<typeof expectationsCatalogSchema>;
export type SourceAuditQuestion = z.infer<typeof questionSchema>;
export type QuestionExpectation = z.infer<typeof expectationSchema>;
export type ExpectRule = z.infer<typeof expectRuleSchema>;
export type ClaimSelect = z.infer<typeof claimSelectSchema>;

export const questionsCatalog: SourceAuditQuestions = questionsCatalogSchema.parse(rawQuestions);
export const expectationsCatalog: SourceAuditExpectations = expectationsCatalogSchema.parse(rawExpectations);

/** 评测要求的覆盖面；缺任何一类都视为题集不合格。 */
export const REQUIRED_CATEGORIES = [
  "数值正确",
  "同比与环比错用",
  "错月份",
  "错范围与人群",
  "图上比较方式不明",
  "资料库无适用来源",
  "干扰来源命中",
  "推断缺口",
  "正确推断",
  "错误推断",
  "证据不足",
  "观点不支持核验",
  "主张拆解与覆盖",
  "补证与恢复",
  "无需追问",
  "修改建议",
] as const;

export interface JudgmentProblem {
  kind: string;
  detail: string;
}

export interface JudgedConclusion {
  claimText: string;
  kind: string;
  direction: string | null;
  fromImage: boolean;
  basis: string | null;
  period: string | null;
  scope: string | null;
  value: number | null;
  status: ClaimSourceStatus;
  parts: Array<{ label: string; status: string }>;
  /** 程序按图上标注补全配文月份时的说明；没有补全时为 null。 */
  periodNote: string | null;
  citedSourceIds: string[];
  summary: string;
  /** 版本复查：所引发布的值被官方修订声明改写时的前后记录；没有时为 null（阶段四 06）。 */
  revisionReview: RevisionReview | null;
}

export interface RunRecord {
  questionId: string;
  arm: Arm;
  run: number;
  /** before = 补证前初查；after = 用题面 clarifyAnswer 恢复的补证后阶段。 */
  phase: "before" | "after";
  status: "pending" | "running" | "ok" | "failed" | "blocked";
  attemptId?: string;
  pathId?: string;
  parentAttemptId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  trace?: SourceInvestigationResult["trace"];
  sourceRecordIndex?: number;
  requests?: ModelRequestRecord[];
  failureKind: string | null;
  failureMessage: string | null;
  latencyMs: number | null;
  rounds: number | null;
  toolCallsUsed: number | null;
  toolSequence: string[];
  /** 被程序拒绝的汇总结构及其原因（用于解释「没有结论」的运行）。 */
  reportRejections: string[];
  stopReason: string | null;
  clarification: { question: string; purpose: string; field: string; claimText?: string | null } | null;
  /** 补证后阶段的补充记录（问题、回答、解析与冲突）；补证前阶段为 null。 */
  supplement: SourceInvestigationResult["supplement"];
  /** 补证后阶段与补证前结论的逐条对照。 */
  conclusionChanges: SourceInvestigationResult["conclusionChanges"];
  noApplicableSourceReason: string | null;
  model: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
  conclusions: JudgedConclusion[];
  acceptedCitations: string[];
  rejectedCitations: Array<{ sourceId: string; reason: string }>;
  fabricatedCitations: string[];
  recalledCitations: string[];
  hitIds: string[];
  excludedIds: string[];
  omittedClaims: Array<{ claimText: string; source: string }>;
  captionCoverage: number | null;
  captionCoverageNote: string | null;
  /** 建议配文的逐处改动摘要（不含全文，全文在 suggestedCaption）。 */
  suggestion: {
    suggestedCaption: string;
    changes: Array<{ claimText: string; kind: string; suggested: string; status: string; origin: string; sourceIds: string[] }>;
    rejectedProposals: Array<{ claimText: string; rejectedReason: string }>;
    notes: string[];
  } | null;
  judgment: { ok: boolean; problems: JudgmentProblem[] };
}

export function selectMatches(
  claim: Pick<SourceClaim, "fromImage" | "kind" | "basis" | "value" | "period">,
  select: ClaimSelect,
): boolean {
  if (claim.fromImage !== select.fromImage) return false;
  if (select.kind !== undefined && claim.kind !== select.kind) return false;
  if ("basis" in select && (claim.basis ?? null) !== (select.basis ?? null)) return false;
  if (select.value !== undefined && (claim.value === null || Math.abs(claim.value - select.value) > 0.001)) return false;
  if (select.period !== undefined && normalizeSourcePeriod(claim.period) !== select.period) return false;
  return true;
}

const KIND_LABELS: Record<string, string> = {
  direct: "直接陈述",
  inference: "可检查推断",
  opinion: "观点",
};

function selectLabel(select: ClaimSelect): string {
  const parts = [select.fromImage ? "图内主张" : "配文主张"];
  if (select.kind !== undefined) parts.push(KIND_LABELS[select.kind] ?? select.kind);
  if ("basis" in select) parts.push(select.basis === null ? "无比较方式" : select.basis === "year-on-year" ? "同比" : "环比");
  if (select.value !== undefined) parts.push(`数值 ${select.value}`);
  if (select.period !== undefined) parts.push(`月份 ${select.period}`);
  return parts.join(" · ");
}

/** 判定上下文：arm 决定追问顺序检查是否生效，phase 区分补证前后两段；caption 是题面配文。 */
export interface JudgeContext {
  arm?: Arm;
  phase?: "before" | "after";
  caption?: string | null;
}

// —— 修改建议的独立复算：评测侧按原始载荷自己算一遍，不依赖服务端的校验实现 ——

/** 评测侧的加强／因果表述清单（与服务端实现分别维护，避免同源失效）。 */
const SUGGESTION_MARKERS = [
  "导致", "造成", "引发", "使得", "说明", "表明", "意味着", "因为", "由于", "因此", "所以", "证明", "证实", "必然", "势必",
  "创下", "新高", "新低", "最大", "最小", "最高", "最低", "首次", "史上", "明显", "大幅", "显著",
];

const SUGGESTION_SCOPE_CANDIDATES = ["全国城市", "全国农村", "农村", "城镇", "城市", "全国"];

function suggestionNumbersIn(text: string | null | undefined): number[] {
  return (text ?? "").match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
}

/** 完整月份写成 `YYYY-MM`，只写月份的写成 `M12` 这样的标记；两侧用同一函数保证可比。 */
function suggestionMonthTokens(text: string | null | undefined): string[] {
  const source = text ?? "";
  const tokens: string[] = [];
  for (const match of source.matchAll(/((?:19|20)\d{2})\s*(?:年\s*(0?[1-9]|1[0-2])\s*月|[-/.]\s*(0?[1-9]|1[0-2])?)/g)) {
    const month = match[2] ?? match[3];
    if (month) tokens.push(`${match[1]}-${month.padStart(2, "0")}`);
  }
  for (const match of source.matchAll(/(0?[1-9]|1[0-2])\s*月/g)) tokens.push(`M${match[1].padStart(2, "0")}`);
  return tokens;
}

function suggestionScopesIn(text: string | null | undefined): string[] {
  const normalized = (text ?? "").replace(/\s+/g, "");
  return SUGGESTION_SCOPE_CANDIDATES.filter((candidate) => normalized.includes(candidate));
}

/** 中文数字写出的时间／倍数范围，例如「近三年」「两个月」。 */
function suggestionChineseAmountsIn(text: string | null | undefined): string[] {
  return [...(text ?? "").matchAll(/[一二三四五六七八九十百千万亿几]{1,6}\s*(?:年|个月|月|周|天|倍|成|个百分点)/g)]
    .map((match) => match[0].trim());
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * 建议配文的全量不变量：逐处改动与拼好的建议文本都不得引入原配文、本次主张与所引来源之外的
 * 数值、月份、范围或加强表述；未解决的主张必须保留限定或建议删除；每条配文主张都要有一处说明。
 */
export function suggestionIndependenceProblems(
  result: SourceInvestigationResult,
  caption: string | null | undefined,
): JudgmentProblem[] {
  const suggestion = result.captionSuggestion;
  if (!suggestion) return [];
  const problems: JudgmentProblem[] = [];
  const expectedCaption = (caption ?? suggestion.caption ?? "").trim();
  if (caption && suggestion.caption.trim() !== caption.trim()) {
    problems.push({
      kind: "suggestion-caption-mismatch",
      detail: `建议配文依据的原文与题面配文不一致：期望「${caption}」，实际「${suggestion.caption}」。`,
    });
  }

  const citedIds = new Set(result.acceptedCitations.map((citation) => citation.sourceId));
  const citedDocuments = result.hits
    .filter((hit) => citedIds.has(hit.document.id))
    .map((hit) => hit.document);
  const allowedNumbers = new Set<number>(suggestionNumbersIn(expectedCaption));
  const allowedMonths = new Set<string>(suggestionMonthTokens(expectedCaption));
  const allowedScopes = new Set<string>(suggestionScopesIn(expectedCaption));
  for (const claim of result.claims) {
    if (claim.value !== null && claim.value !== undefined) allowedNumbers.add(claim.value);
    for (const text of [claim.claimText, claim.imageExcerpt, claim.period, claim.scope, claim.metric]) {
      for (const value of suggestionNumbersIn(text)) allowedNumbers.add(value);
      for (const token of suggestionMonthTokens(text)) allowedMonths.add(token);
      for (const scope of suggestionScopesIn(text)) allowedScopes.add(scope);
    }
  }
  for (const document of citedDocuments) {
    for (const measure of document.measures) allowedNumbers.add(measure.value);
    for (const text of [document.excerpt, document.title, document.basis.period, document.basis.scope]) {
      for (const value of suggestionNumbersIn(text)) allowedNumbers.add(value);
      for (const token of suggestionMonthTokens(text)) allowedMonths.add(token);
      for (const scope of suggestionScopesIn(text)) allowedScopes.add(scope);
    }
  }

  // 建议里的每个数字、月份、范围都必须在允许集合内；逐处文本与拼好的建议文本都查。
  const texts = unique([
    suggestion.suggestedCaption,
    ...suggestion.changes.map((change) => change.suggested),
  ]).filter((text) => text.trim().length > 0);
  for (const text of texts) {
    for (const value of unique(suggestionNumbersIn(text))) {
      if (!allowedNumbers.has(value)) {
        problems.push({ kind: "suggestion-new-number", detail: `建议里出现证据未覆盖的数值 ${value}：「${text}」` });
      }
    }
    for (const token of unique(suggestionMonthTokens(text))) {
      if (!allowedMonths.has(token)) {
        problems.push({ kind: "suggestion-new-month", detail: `建议里出现证据未覆盖的月份 ${token}：「${text}」` });
      }
    }
    for (const scope of suggestionScopesIn(text)) {
      if (!allowedScopes.has(scope)) {
        problems.push({ kind: "suggestion-new-scope", detail: `建议里出现证据未覆盖的范围「${scope}」：「${text}」` });
      }
    }
    for (const marker of SUGGESTION_MARKERS) {
      if (text.includes(marker) && !expectedCaption.includes(marker)) {
        problems.push({ kind: "suggestion-new-wording", detail: `建议里出现原配文没有的因果或加强表述「${marker}」：「${text}」` });
      }
    }
    for (const token of suggestionChineseAmountsIn(text)) {
      if (!expectedCaption.includes(token)) {
        problems.push({ kind: "suggestion-new-wording", detail: `建议里出现原配文没有的范围或倍数表述「${token}」：「${text}」` });
      }
    }
  }

  // 每条已核验的配文主张都要有一处改动说明；反过来，改动不能对应不存在的主张。
  for (const claim of result.claims.filter((entry) => !entry.fromImage)) {
    const matched = suggestion.changes.some((change) => change.claimText === claim.claimText);
    if (!matched) {
      problems.push({ kind: "suggestion-missing-change", detail: `配文主张「${claim.claimText}」没有对应的改动说明。` });
    }
  }
  for (const change of suggestion.changes) {
    const index = result.claims.findIndex((claim) => !claim.fromImage && claim.claimText === change.claimText);
    if (index < 0) {
      problems.push({ kind: "suggestion-orphan-change", detail: `改动「${change.claimText}」不对应本次核验的任何主张。` });
      continue;
    }
    const claim = result.claims[index];
    const conclusion = result.conclusions[index];
    if (!change.applied) {
      problems.push({ kind: "suggestion-unapplied-change", detail: `改动「${change.claimText}」未并入建议配文。` });
    }
    if (change.sourceIds.some((id) => !citedIds.has(id) || !conclusion.citedSourceIds.includes(id))) {
      problems.push({ kind: "suggestion-wrong-citation", detail: `改动「${change.claimText}」引用了不属于对应结论的资料。` });
    }
    if (conclusion.status === "source-mismatch" && change.kind !== "suggest-delete") {
      const measures = change.sourceIds.flatMap((id) => {
        const doc = findSourceDocument(id);
        if (!doc || !conclusion.citedSourceIds.includes(id)) return [];
        return doc.measures.filter((measure) => measure.basis === claim.basis
          && (measure.period ?? doc.basis.period) === normalizeSourcePeriod(claim.period));
      });
      if (!measures.length) {
        problems.push({ kind: "suggestion-no-value-source", detail: `改动「${change.claimText}」没有同月份／比较方式的数值引用。` });
      } else {
        const values = measures.map((measure) => measure.value);
        const percentages = [...change.suggested.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
        if (claim.value !== null && !values.includes(claim.value) && !percentages.some((value) => values.includes(value))) {
          problems.push({ kind: "suggestion-wrong-source-value", detail: `改动「${change.claimText}」未使用其适用引用里的百分比。` });
        }
        const up = /上涨|上升|增长|增加|更贵/.test(change.suggested);
        const down = /下降|下跌|减少|降低|便宜/.test(change.suggested);
        if ((values.every((value) => value > 0) && down) || (values.every((value) => value < 0) && up)) {
          problems.push({ kind: "suggestion-wrong-source-direction", detail: `改动「${change.claimText}」仍保留与适用来源相反的方向。` });
        }
      }
    }
  }

  // 未解决的主张必须保留限定或建议删除，不能原样当成确定表述。
  for (const [index, conclusion] of result.conclusions.entries()) {
    const claim = result.claims[index];
    if (!claim || claim.fromImage) continue;
    if (conclusion.status !== "source-pending" && conclusion.status !== "inference-unsupported") continue;
    const change = suggestion.changes.find((entry) => entry.claimText === claim.claimText);
    if (change && change.kind === "unchanged") {
      problems.push({
        kind: "suggestion-unresolved-unqualified",
        detail: `未解决的主张「${claim.claimText}」在建议里原样保留，没有保留限定或建议删除。`,
      });
    }
  }

  return problems;
}

/** 逐题写定的修改建议期望：改动类型、必须／不得出现的数值与表述。 */
function suggestionRuleProblems(
  result: SourceInvestigationResult,
  rules: z.infer<typeof suggestionRuleSchema>,
): JudgmentProblem[] {
  const problems: JudgmentProblem[] = [];
  const suggestion = result.captionSuggestion;
  if (!suggestion) {
    problems.push({ kind: "missing-suggestion", detail: "期望里有修改建议规则，但本次没有生成建议配文。" });
    return problems;
  }

  for (const rule of rules.expectChanges ?? []) {
    const min = rule.min ?? 1;
    const matched = result.claims
      .map((claim, index) => ({ claim, index }))
      .filter((entry) => selectMatches(entry.claim, rule.select))
      .map((entry) => ({
        claim: entry.claim,
        change: suggestion.changes.find((change) => change.claimText === entry.claim.claimText) ?? null,
      }))
      .filter((entry) => entry.change !== null);
    if (matched.length < min) {
      problems.push({
        kind: "no-matching-suggestion-change",
        detail: `缺少符合「${selectLabel(rule.select)}」的改动说明：需要 ${min} 条，实际 ${matched.length} 条。`,
      });
      continue;
    }
    for (const entry of matched) {
      const kind = entry.change?.kind ?? "";
      if (!rule.kinds.includes(kind as z.infer<typeof captionChangeKindSchema>)) {
        problems.push({
          kind: "suggestion-wrong-kind",
          detail: `「${entry.claim.claimText}」的改动类型是 ${kind}，期望 ${rule.kinds.join("／")}。`,
        });
      }
    }
  }

  const captionText = suggestion.suggestedCaption;
  for (const value of rules.requiredNumbers ?? []) {
    if (!suggestionNumbersIn(captionText).includes(value)) {
      problems.push({ kind: "suggestion-missing-number", detail: `建议配文里没有期望的正确数值 ${value}：「${captionText}」` });
    }
  }
  for (const value of rules.forbiddenNumbers ?? []) {
    if (suggestionNumbersIn(captionText).includes(value)) {
      problems.push({ kind: "suggestion-forbidden-number", detail: `建议配文里仍出现不应有的数值 ${value}：「${captionText}」` });
    }
  }
  for (const phrase of rules.forbiddenPhrases ?? []) {
    if (captionText.includes(phrase)) {
      problems.push({ kind: "suggestion-forbidden-phrase", detail: `建议配文里仍出现「${phrase}」：「${captionText}」` });
    }
  }
  if (rules.unchanged) {
    for (const change of suggestion.changes) {
      if (change.kind !== "unchanged") {
        problems.push({
          kind: "suggestion-unexpected-change",
          detail: `期望本次没有需要改写的内容，但「${change.claimText}」被改成了「${change.suggested}」（${change.kind}）。`,
        });
      }
    }
  }

  return problems;
}

/** 按人写的期望判定一次运行。判定只用程序可读的字段（fromImage／basis／value／period／状态／引用），
 * 不让生成答案的模型给自己评分。phase="after" 时改用 expectation.resume 里的规则。
 */
export function judgeRun(
  expectation: QuestionExpectation,
  result: SourceInvestigationResult,
  context: JudgeContext = {},
): { ok: boolean; problems: JudgmentProblem[]; conclusions: JudgedConclusion[] } {
  const phase = context.phase ?? "before";
  if (phase === "after" && !expectation.resume) {
    throw new Error(`期望 ${expectation.id} 缺少 resume 规则，无法判定补证后阶段。`);
  }
  const rules = phase === "after"
    ? {
      expect: expectation.resume!.expect,
      otherClaimStatuses: expectation.resume!.otherClaimStatuses,
      requiredAcceptedCitations: expectation.resume!.requiredAcceptedCitations,
      forbiddenValueBasisCitations: expectation.resume!.forbiddenValueBasisCitations,
      noApplicableSource: expectation.resume!.noApplicableSource,
      incompleteNotice: expectation.resume!.incompleteNotice,
      suggestion: expectation.resume!.suggestion,
    }
    : { ...expectation, suggestion: expectation.suggestion };
  const problems: JudgmentProblem[] = [...suggestionIndependenceProblems(result, context.caption)];
  const conclusions = result.conclusions.map((conclusion, index): JudgedConclusion => {
    const claim = result.claims[index];
    return {
      claimText: conclusion.claimText,
      kind: claim?.kind ?? "direct",
      direction: claim?.direction ?? null,
      fromImage: conclusion.fromImage,
      basis: claim?.basis ?? null,
      period: claim?.period ?? null,
      scope: claim?.scope ?? null,
      value: conclusion.claimValue,
      status: conclusion.status,
      parts: conclusion.parts.map((part) => ({ label: part.label, status: part.status })),
      periodNote: conclusion.periodNote,
      citedSourceIds: conclusion.citedSourceIds,
      summary: conclusion.summary,
      revisionReview: conclusion.revisionReview ?? null,
    };
  });

  if (conclusions.length === 0) {
    problems.push({ kind: "no-conclusions", detail: "本次运行没有给出任何主张结论。" });
  }

  const matchedIndexes = new Set<number>();
  for (const rule of rules.expect) {
    const min = rule.min ?? 1;
    const matched = result.claims
      .map((claim, index) => ({ claim, index }))
      .filter((entry) => selectMatches(entry.claim, rule.select));
    for (const entry of matched) matchedIndexes.add(entry.index);
    if (matched.length < min) {
      problems.push({
        kind: "no-matching-claim",
        detail: `缺少符合「${selectLabel(rule.select)}」的主张：需要 ${min} 条，实际 ${matched.length} 条。`,
      });
      continue;
    }
    for (const entry of matched) {
      const actual = conclusions[entry.index].status;
      if (actual !== rule.status) {
        problems.push({ kind: "wrong-status", detail: `「${entry.claim.claimText}」状态为 ${actual}，期望 ${rule.status}。` });
      }
    }
  }

  conclusions.forEach((conclusion, index) => {
    if (matchedIndexes.has(index)) return;
    if (!rules.otherClaimStatuses.includes(conclusion.status)) {
      problems.push({
        kind: "unexpected-status",
        detail: `未被期望规则覆盖的主张「${conclusion.claimText}」出现状态 ${conclusion.status}，允许的是 ${rules.otherClaimStatuses.join("／")}。`,
      });
    }
  });

  for (const required of rules.requiredAcceptedCitations ?? []) {
    if (!result.acceptedCitations.some((citation) => citation.sourceId === required)) {
      problems.push({
        kind: "missing-required-citation",
        detail: `本次被接受的引用里没有 ${required}（实际：${result.acceptedCitations.map((citation) => `${citation.sourceId}|${citation.role}`).join("、") || "无"}）。`,
      });
    }
  }

  for (const forbidden of rules.forbiddenValueBasisCitations ?? []) {
    if (result.acceptedCitations.some((citation) => citation.sourceId === forbidden && citation.role === "value-basis")) {
      problems.push({ kind: "forbidden-value-basis-citation", detail: `${forbidden} 不允许以数值依据角色通过校验。` });
    }
  }

  for (const rejected of result.citationsRejected) {
    if (!findSourceDocument(rejected.sourceId)) {
      problems.push({
        kind: "fabricated-citation",
        detail: `引用了资料库中不存在的 ${rejected.sourceId}：${rejected.reason}`,
      });
    }
  }

  if (rules.incompleteNotice) {
    // 单次最多核验三条：模型声明的配文漏项、程序按覆盖度发现的漏项都算明确提示。
    // 模型声明的图上说明文字另计，不当作配文内容。
    const noticed = result.omittedClaims.some((claim) => claim.source === "caption")
      || (result.captionCoverageNote ?? "").includes("配文里");
    if (!noticed) {
      problems.push({
        kind: "missing-incomplete-notice",
        detail: "配文还有内容没有核验，但本次既没有未展开的配文主张，也没有配文覆盖不足的提示。",
      });
    }
  }

  if (rules.noApplicableSource) {
    // 没有适用来源时允许的克制状态：待核对、推断依据不足、不支持核验都算没有下确定结论。
    const restrained: ClaimSourceStatus[] = ["source-pending", "inference-unsupported", "not-verifiable"];
    for (const conclusion of conclusions.filter((entry) => !restrained.includes(entry.status))) {
      problems.push({
        kind: "no-applicable-source-overclaim",
        detail: `没有适用来源的题却给出确定来源结论「${conclusion.claimText}」：${conclusion.status}。`,
      });
    }
  }

  // —— 追问时机（只在补证前阶段判）——
  if (phase === "before") {
    if (expectation.clarificationRequired && !result.clarification) {
      problems.push({
        kind: "missing-clarification",
        detail: "资料库回答不了这条口径缺口，模型必须提出一次追问，但本次没有追问。",
      });
    }
    if (expectation.clarificationForbidden && result.clarification) {
      problems.push({
        kind: "unexpected-clarification",
        detail: `资料已覆盖的问题不应追问用户，但模型提出了：${result.clarification.question}`,
      });
    }
    if (expectation.clarificationAfterSearch && result.clarification && context.arm === "retrieval") {
      // 有检索臂：第一次追问必须发生在至少一次成功检索之后（按轨迹顺序比较）。
      const searchIndex = result.trace.findIndex((event) => event.tool === "search_source_library" && event.status === "ok");
      const clarifyIndex = result.trace.findIndex(
        (event) => event.tool === "request_clarification" && event.status === "ok",
      );
      if (clarifyIndex >= 0 && (searchIndex < 0 || searchIndex > clarifyIndex)) {
        problems.push({
          kind: "clarification-before-search",
          detail: "追问发生在检索之前：资料已覆盖的部分应先自己检索核对，仍缺信息才追问用户。",
        });
      }
    }
  }

  // —— 补证后阶段：必须记录已套用的用户补充 ——
  if (phase === "after" && expectation.resume?.supplementApplied) {
    if (!result.supplement || !result.supplement.applied) {
      problems.push({
        kind: "missing-supplement-application",
        detail: `补证后应当把用户回答套用到受影响主张并标为用户提供，但本次补充记录为：${result.supplement ? result.supplement.note : "无"}`,
      });
    }
  }

  // —— 修改建议：逐题写定的内容期望（新事实与覆盖由上面的独立复算全量检查） ——
  if (rules.suggestion) {
    problems.push(...suggestionRuleProblems(result, rules.suggestion));
  }

  return { ok: problems.length === 0, problems, conclusions };
}

/** 上游异常可能含请求头与密钥，只留 HTTP 状态，不保存原始文本。 */
function failureCause(error: unknown): string {
  const cause = (error as { cause?: unknown }).cause;
  if (!cause) return "";
  if (cause instanceof Error) {
    const status = (cause as { status?: unknown }).status;
    return typeof status === "number" && Number.isFinite(status) ? `HTTP ${status}` : "上游请求失败";
  }
  return "上游请求失败";
}

function classifyFailure(error: unknown): { kind: string; message: string; trace?: SourceInvestigationResult["trace"] } {
  if (error instanceof SourceInvestigationError) {
    const cause = failureCause(error);
    return { kind: error.kind, message: cause ? `${error.message}（上游：${cause}）` : error.message, trace: error.trace };
  }
  return { kind: "harness", message: "评测执行失败（原始异常不留档）。" };
}

/** 这道题是否有补证后阶段（题面写了人写定的回答且期望带 resume 规则）。 */
export function hasResumePhase(
  question: SourceAuditQuestions["questions"][number],
  expectations: SourceAuditExpectations,
): boolean {
  const expectation = expectations.questions.find((entry) => entry.id === question.id);
  return Boolean(question.clarifyAnswer && expectation?.resume);
}

/** 本次将发出的请求数：（题数 + 带补证阶段的题数）× 臂数 × 每臂每题次数。 */
export function plannedRequests(questionCount: number, armCount: number, runsPerArm: number, resumeQuestionCount = 0): number {
  return (questionCount + resumeQuestionCount) * armCount * runsPerArm;
}

export function isDeepSeekEndpoint(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "api.deepseek.com";
  } catch {
    return false;
  }
}

export interface BalanceGuard {
  checked: boolean;
  totalBalance: number | null;
  message: string;
  /** 余额低于下限：默认停止运行，避免跑到一半因 402 白跑。 */
  blocked: boolean;
}

/**
 * 开跑前的余额预检（只在 DeepSeek 官方端点做；余额接口免费）。
 * 取不到余额时不拦，只提示——不能因为预检本身不可用就挡住评测。
 */
export async function checkBalance(
  baseUrl: string,
  apiKey: string,
  minBalanceYuan: number,
  fetchImpl: typeof fetch = fetch,
): Promise<BalanceGuard> {
  if (!isDeepSeekEndpoint(baseUrl)) {
    return { checked: false, totalBalance: null, message: "当前端点不是 DeepSeek 官方地址，跳过余额预检。", blocked: false };
  }
  try {
    const response = await fetchImpl("https://api.deepseek.com/user/balance", {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return {
      checked: false, totalBalance: null,
      message: `余额预检没成功（HTTP ${response.status}），不拦截，继续运行。`, blocked: false,
    };
    const body = await response.json() as {
      is_available?: boolean;
      balance_infos?: Array<{ currency?: string; total_balance?: string }>;
    };
    const info = body.balance_infos?.find((entry) => entry.currency === "CNY") ?? body.balance_infos?.[0];
    const total = info?.total_balance === undefined ? Number.NaN : Number(info.total_balance);
    if (Number.isNaN(total)) {
      return { checked: false, totalBalance: null, message: "余额接口没有返回可读数值，跳过预检。", blocked: false };
    }
    return {
      checked: true,
      totalBalance: total,
      message: `账户余额 ${total.toFixed(2)} 元（下限 ${minBalanceYuan.toFixed(2)} 元${body.is_available === false ? "，账户当前不可用" : ""}）。`,
      blocked: total < minBalanceYuan,
    };
  } catch {
    return { checked: false, totalBalance: null, message: "余额预检没成功，不拦截，继续运行。", blocked: false };
  }
}

export interface EvaluationOptions {
  driverFactory: (question: SourceAuditQuestion, arm: Arm) => SourceInvestigationDriver;
  runs?: number;
  arms?: Arm[];
  log?: (line: string) => void;
  /** 初始计划、每次开始与结果都写盘；写盘失败立即停止，不继续收费请求。 */
  onCheckpoint?: (report: EvaluationReport) => Promise<void>;
  runId?: string;
}

export interface EvaluationReport {
  runId?: string;
  state?: "running" | "completed";
  generatedAt: string;
  arms: Arm[];
  runsPerArm: number;
  records: RunRecord[];
  summary: EvaluationSummary;
}

export interface ArmSummary {
  arm: Arm;
  attempts: number;
  validRuns: number;
  failedRuns: number;
  failureKinds: Record<string, number>;
  correctRuns: number;
  accuracy: number | null;
  plannedStages: number;
  blockedStages: number;
  pendingStages: number;
  stagePass: PassRate;
  fullPathPass: PassRate;
  validRunPass: PassRate;
  allAttemptSuccess: PassRate;
  acceptedCitations: number;
  rejectedCitations: number;
  fabricatedCitations: number;
  recalledCitations: number;
  noApplicableSourceReasons: number;
  clarifications: number;
  /** 真实运行里模型主动提出的追问原文，逐条保留。 */
  clarificationQuestions: string[];
  /** 追问与检索时机问题数（缺追问、资料已覆盖仍追问、追问先于检索）。 */
  clarificationProblems: number;
  /** 成功运行的补证后阶段次数，以及其中把用户补充套用到主张的次数。 */
  resumeRuns: number;
  supplementAppliedRuns: number;
  noApplicableSourceOverclaims: number;
  inferenceUnsupported: number;
  notVerifiable: number;
  omittedClaims: number;
  otherOmittedText: number;
  /** 生成了建议配文的运行数、其中由模型提议被采用的改动数、被拒绝的提议数与建议相关问题数。 */
  suggestionRuns: number;
  suggestionModelChanges: number;
  suggestionRejectedProposals: number;
  suggestionProblems: number;
  /**
   * 版本复查（阶段四 06）：程序按官方修订声明把「旧发布的旧值」替换为「后续发布的修订后值」。
   * revisionAppliedRuns＝替代生效的运行数（等价于「修正数＋误改数」）；
   * revisionHelpedRuns＝其中判定通过的（修正数）；revisionHurtRuns＝其中判定未通过的（误改数）。
   * 替代是程序内同步完成的：不新增模型调用、不新增轮次，因此额外耗时为 0（见报告里的说明）。
   */
  revisionAppliedRuns: number;
  revisionHelpedRuns: number;
  revisionHurtRuns: number;
  averageLatencyMs: number | null;
  averageToolCalls: number | null;
}

export interface PassRate { passed: number; total: number; rate: number | null }
const passRate = (passed: number, total: number): PassRate => ({ passed, total, rate: total ? passed / total : null });

/** 完整路径要求初查及期望中的恢复段全部通过；缺追问不能让恢复段从分母消失。 */
export function reliabilityCounts(records: RunRecord[], expectations: SourceAuditExpectations) {
  const paths = new Map<string, RunRecord[]>();
  for (const record of records) {
    const key = record.pathId ?? `${record.arm}/${record.questionId}/${record.run}`;
    paths.set(key, [...(paths.get(key) ?? []), record]);
  }
  let plannedStages = 0;
  let implicitBlocked = 0;
  let fullPassed = 0;
  for (const path of paths.values()) {
    const expectedResume = Boolean(expectations.questions.find((q) => q.id === path[0].questionId)?.resume);
    plannedStages += expectedResume ? 2 : 1;
    const before = path.find((record) => record.phase === "before");
    const after = path.find((record) => record.phase === "after");
    if (expectedResume && !after && before && (before.status === "failed" || !before.clarification)) implicitBlocked++;
    if (before?.status === "ok" && before.judgment.ok
      && (!expectedResume || (after?.status === "ok" && after.judgment.ok))) fullPassed++;
  }
  const valid = records.filter((r) => r.status === "ok");
  const attempts = records.filter((r) => ["ok", "failed", "running"].includes(r.status));
  const passed = valid.filter((r) => r.judgment.ok).length;
  const blockedStages = implicitBlocked + records.filter((r) => r.status === "blocked").length;
  return {
    plannedStages, blockedStages,
    pendingStages: plannedStages - attempts.length - blockedStages,
    stagePass: passRate(passed, plannedStages),
    fullPathPass: passRate(fullPassed, paths.size),
    validRunPass: passRate(passed, valid.length),
    allAttemptSuccess: passRate(passed, attempts.length),
  };
}

export interface QuestionPairSummary {
  questionId: string;
  categories: string[];
  perArm: Record<string, { attempts: number; validRuns: number; correctRuns: number; passedPaths: number; totalPaths: number; outcomes: string[] }>;
  verdict: "仅检索臂正确" | "仅无检索臂正确" | "两臂相同" | "两臂均未通过" | "无有效运行";
}

export interface GateResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface EvaluationSummary {
  arms: ArmSummary[];
  questions: QuestionPairSummary[];
  gates: GateResult[];
  gateArm: Arm;
  degradedQuestions: string[];
}

const SHORT_STATUS: Record<ClaimSourceStatus, string> = {
  "source-match": "一致",
  "source-mismatch": "不一致",
  "source-pending": "待核对",
  "inference-unsupported": "依据不足",
  "not-verifiable": "不核验",
};

function describeRun(record: RunRecord): string {
  const prefix = record.phase === "after" ? "补证后 " : "";
  if (record.status === "failed") return `${prefix}失败(${record.failureKind})`;
  if (record.status !== "ok") return `${prefix}${record.status}(${record.failureKind ?? "未完成"})`;
  if (record.conclusions.length === 0) return `${prefix}无结论`;
  return prefix + record.conclusions.map((conclusion) => `${conclusion.fromImage ? "图" : "文"}${SHORT_STATUS[conclusion.status]}`).join(" ");
}

export function summarizeEvaluation(records: RunRecord[], expectations: SourceAuditExpectations): EvaluationSummary {
  const arms = [...new Set(records.map((record) => record.arm))];
  const armSummaries = arms.map((arm): ArmSummary => {
    const armRecords = records.filter((record) => record.arm === arm);
    const valid = armRecords.filter((record) => record.status === "ok");
    const failureKinds: Record<string, number> = {};
    for (const record of armRecords) {
      if (record.status !== "failed") continue;
      const kind = record.failureKind ?? "unknown";
      failureKinds[kind] = (failureKinds[kind] ?? 0) + 1;
    }
    const latencies = valid.map((record) => record.latencyMs ?? 0);
    const toolCalls = valid.map((record) => record.toolCallsUsed ?? 0);
    const correctRuns = valid.filter((record) => record.judgment.ok).length;
    return {
      arm,
      ...reliabilityCounts(armRecords, expectations),
      attempts: armRecords.filter((r) => ["ok", "failed", "running"].includes(r.status)).length,
      validRuns: valid.length,
      failedRuns: armRecords.filter((r) => r.status === "failed").length,
      failureKinds,
      correctRuns,
      accuracy: valid.length > 0 ? correctRuns / valid.length : null,
      acceptedCitations: valid.reduce((total, record) => total + record.acceptedCitations.length, 0),
      rejectedCitations: valid.reduce((total, record) => total + record.rejectedCitations.length, 0),
      fabricatedCitations: armRecords.reduce((total, record) => total + record.fabricatedCitations.length, 0),
      recalledCitations: armRecords.reduce((total, record) => total + record.recalledCitations.length, 0),
      noApplicableSourceReasons: valid.filter((record) => (record.noApplicableSourceReason ?? "").trim().length > 0).length,
      clarifications: valid.filter((record) => record.clarification !== null).length,
      clarificationQuestions: valid
        .flatMap((record) => (record.clarification ? [`${record.questionId}：${record.clarification.question}`] : [])),
      clarificationProblems: armRecords.reduce(
        (total, record) => total + record.judgment.problems.filter((problem) =>
          ["missing-clarification", "unexpected-clarification", "clarification-before-search"].includes(problem.kind)).length,
        0,
      ),
      resumeRuns: valid.filter((record) => record.phase === "after").length,
      supplementAppliedRuns: valid.filter((record) => record.phase === "after" && record.supplement?.applied).length,
      noApplicableSourceOverclaims: armRecords.reduce(
        (total, record) => total + record.judgment.problems.filter((problem) => problem.kind === "no-applicable-source-overclaim").length,
        0,
      ),
      inferenceUnsupported: valid.reduce(
        (total, record) => total + record.conclusions.filter((entry) => entry.status === "inference-unsupported").length,
        0,
      ),
      notVerifiable: valid.reduce(
        (total, record) => total + record.conclusions.filter((entry) => entry.status === "not-verifiable").length,
        0,
      ),
      omittedClaims: valid.reduce(
        (total, record) => total + record.omittedClaims.filter((claim) => claim.source === "caption").length,
        0,
      ),
      otherOmittedText: valid.reduce(
        (total, record) => total + record.omittedClaims.filter((claim) => claim.source !== "caption").length,
        0,
      ),
      suggestionRuns: valid.filter((record) => record.suggestion !== null).length,
      suggestionModelChanges: valid.reduce(
        (total, record) => total + (record.suggestion?.changes.filter((change) => change.origin === "model").length ?? 0),
        0,
      ),
      suggestionRejectedProposals: valid.reduce(
        (total, record) => total + (record.suggestion?.rejectedProposals.length ?? 0),
        0,
      ),
      suggestionProblems: armRecords.reduce(
        (total, record) => total + record.judgment.problems.filter((problem) => problem.kind.startsWith("suggestion-")).length,
        0,
      ),
      revisionAppliedRuns: valid.filter((record) =>
        record.conclusions.some((conclusion) => conclusion.revisionReview != null)).length,
      revisionHelpedRuns: valid.filter((record) =>
        record.judgment.ok && record.conclusions.some((conclusion) => conclusion.revisionReview != null)).length,
      revisionHurtRuns: valid.filter((record) =>
        !record.judgment.ok && record.conclusions.some((conclusion) => conclusion.revisionReview != null)).length,
      averageLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length) : null,
      averageToolCalls: toolCalls.length > 0
        ? Number((toolCalls.reduce((total, value) => total + value, 0) / toolCalls.length).toFixed(2))
        : null,
    };
  });

  const questions = expectations.questions.map((expectation): QuestionPairSummary => {
    const question = questionsCatalog.questions.find((entry) => entry.id === expectation.id);
    const questionRecords = records.filter((record) => record.questionId === expectation.id);
    const perArm: QuestionPairSummary["perArm"] = {};
    for (const arm of arms) {
      const armRecords = questionRecords.filter((record) => record.arm === arm);
      const valid = armRecords.filter((record) => record.status === "ok");
      perArm[arm] = {
        attempts: armRecords.filter((r) => ["ok", "failed", "running"].includes(r.status)).length,
        validRuns: valid.length,
        correctRuns: valid.filter((record) => record.judgment.ok).length,
        passedPaths: reliabilityCounts(armRecords, expectations).fullPathPass.passed,
        totalPaths: reliabilityCounts(armRecords, expectations).fullPathPass.total,
        outcomes: armRecords.map(describeRun),
      };
    }
    const retrieval = perArm.retrieval;
    const noRetrieval = perArm["no-retrieval"];
    let verdict: QuestionPairSummary["verdict"] = "两臂相同";
    if (retrieval && noRetrieval) {
      // 两臂都没有有效运行时单列，避免把「上游全失败」读成「模型全答错」。
      if (retrieval.validRuns === 0 && noRetrieval.validRuns === 0) verdict = "无有效运行";
      else if (retrieval.passedPaths === 0 && noRetrieval.passedPaths > 0) verdict = "仅无检索臂正确";
      else if (retrieval.passedPaths > 0 && noRetrieval.passedPaths === 0) verdict = "仅检索臂正确";
      else if (retrieval.passedPaths === 0 && noRetrieval.passedPaths === 0) verdict = "两臂均未通过";
    }
    return { questionId: expectation.id, categories: question?.categories ?? [], perArm, verdict };
  });

  const gateArm = expectations.frozen.gates.gateArm;
  const gateSummary = armSummaries.find((entry) => entry.arm === gateArm);
  const accuracy = gateSummary?.allAttemptSuccess.rate ?? null;
  const fabricatedTotal = armSummaries.reduce((total, entry) => total + entry.fabricatedCitations, 0);
  const overclaimTotal = armSummaries.reduce((total, entry) => total + entry.noApplicableSourceOverclaims, 0);
  const gates: GateResult[] = [
    {
      id: "claim-status-accuracy",
      label: `${gateArm} 臂全部尝试成功率 ≥ ${(expectations.frozen.gates.claimStatusAccuracy * 100).toFixed(0)}%（含运行失败）`,
      passed: accuracy !== null && accuracy >= expectations.frozen.gates.claimStatusAccuracy,
      detail: accuracy === null
        ? "没有有效运行，无法计算。"
        : `${(accuracy * 100).toFixed(1)}%（${gateSummary?.correctRuns ?? 0}/${gateSummary?.attempts ?? 0} 次尝试）`,
    },
    {
      id: "fabricated-citations",
      label: "虚构引用为零（两臂合计）",
      passed: fabricatedTotal === expectations.frozen.gates.fabricatedCitations,
      detail: `${fabricatedTotal} 条`,
    },
    {
      id: "no-applicable-source",
      label: "无适用来源案例不下确定来源结论（两臂合计）",
      passed: overclaimTotal === expectations.frozen.gates.noApplicableSourceOverclaims,
      detail: `${overclaimTotal} 次越界`,
    },
  ];

  return {
    arms: armSummaries,
    questions,
    gates,
    gateArm,
    degradedQuestions: questions.filter((question) => question.verdict === "仅无检索臂正确").map((question) => question.questionId),
  };
}

export function emptyRunRecord(base: Pick<RunRecord, "questionId" | "arm" | "run" | "phase">): RunRecord {
  return {
    ...base, status: "pending", failureKind: null, failureMessage: null,
    latencyMs: null, rounds: null, toolCallsUsed: null, toolSequence: [], trace: [],
    reportRejections: [], stopReason: null, clarification: null, supplement: null, conclusionChanges: null,
    noApplicableSourceReason: null, model: null, usage: null, conclusions: [], acceptedCitations: [],
    rejectedCitations: [], fabricatedCitations: [], recalledCitations: [], hitIds: [], excludedIds: [],
    omittedClaims: [], captionCoverage: null, captionCoverageNote: null, suggestion: null,
    judgment: { ok: false, problems: [{ kind: "not-completed", detail: "阶段尚未完成。" }] },
  };
}

/** JSONL 最后一行若中断未写完，只恢复前面已 fsync 的完整快照；中间损坏明确失败。 */
export function readEvaluationSnapshot(text: string, jsonl = false): EvaluationReport {
  if (!jsonl) return JSON.parse(text) as EvaluationReport;
  const lines = text.split("\n");
  let latest: EvaluationReport | null = null;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as EvaluationReport & { type?: string; updates?: RunRecord[] };
      if (event.type === "checkpoint") {
        if (!latest || event.runId !== latest.runId) throw new Error("逐次日志缺少初始快照或运行 ID 不一致。");
        for (const update of event.updates ?? []) {
          const recordIndex = latest.records.findIndex((record) => record.attemptId === update.attemptId);
          if (recordIndex < 0) throw new Error("逐次日志含不在计划内的阶段。");
          latest.records[recordIndex] = update;
        }
        latest.state = event.state; latest.summary = event.summary;
      } else { latest = event; }
    }
    catch (error) { if (!(error instanceof SyntaxError) || index !== lines.length - 1) throw error; }
  }
  if (!latest) throw new Error("逐次日志没有可恢复的完整快照。");
  return latest;
}

export async function runPairedEvaluation(
  questions: SourceAuditQuestions,
  expectations: SourceAuditExpectations,
  options: EvaluationOptions,
): Promise<EvaluationReport> {
  const arms = options.arms ?? expectations.frozen.arms;
  const runs = options.runs ?? expectations.frozen.runsPerArm;
  const log = options.log ?? (() => {});
  const records: RunRecord[] = [];
  const runId = options.runId ?? randomUUID();
  const generatedAt = new Date().toISOString();
  for (const arm of arms) for (const question of questions.questions) for (let run = 1; run <= runs; run++) {
    const pathId = `${runId}/${arm}/${question.id}/${run}`;
    for (const phase of hasResumePhase(question, expectations) ? ["before", "after"] as const : ["before"] as const) {
      records.push({ ...emptyRunRecord({ questionId: question.id, arm, run, phase }),
        pathId, attemptId: `${pathId}/${phase}`, parentAttemptId: phase === "after" ? `${pathId}/before` : null,
        startedAt: null, completedAt: null });
    }
  }
  const snapshot = (state: "running" | "completed" = "running"): EvaluationReport => ({
    runId, state, generatedAt, arms, runsPerArm: runs, records: structuredClone(records),
    summary: summarizeEvaluation(records, expectations),
  });
  const checkpoint = async () => { await options.onCheckpoint?.(snapshot()); };
  const findRecord = (base: Pick<RunRecord, "questionId" | "arm" | "run" | "phase">) => {
    const index = records.findIndex((r) => r.questionId === base.questionId && r.arm === base.arm && r.run === base.run && r.phase === base.phase);
    if (index < 0) throw new Error("阶段不在评测计划内。");
    return index;
  };
  const startRecord = (base: Pick<RunRecord, "questionId" | "arm" | "run" | "phase">) => {
    const record = records[findRecord(base)];
    record.status = "running";
    record.startedAt = new Date().toISOString();
  };
  const saveRecord = (record: RunRecord) => {
    const index = findRecord(record);
    records[index] = { ...records[index], ...record, completedAt: new Date().toISOString() };
  };
  const blockResume = (before: Pick<RunRecord, "questionId" | "arm" | "run" | "phase">, kind: string) => {
    if (!records.some((r) => r.questionId === before.questionId && r.arm === before.arm && r.run === before.run && r.phase === "after")) return;
    saveRecord({ ...emptyRunRecord({ ...before, phase: "after" }), status: "blocked", failureKind: kind,
      failureMessage: "初查失败或未追问，恢复未执行。", judgment: { ok: false, problems: [{ kind, detail: "恢复路径未完成。" }] } });
  };
  await checkpoint();

  /** 把一次成功的结果按阶段判定并落成记录。 */
  const recordSuccess = (
    base: { questionId: string; arm: Arm; run: number; phase: "before" | "after"; caption: string },
    expectation: QuestionExpectation,
    result: SourceInvestigationResult,
    driver?: SourceInvestigationDriver,
    requestOffset = 0,
  ): void => {
    const judgment = judgeRun(expectation, result, { arm: base.arm, phase: base.phase, caption: base.caption });
    const hitIds = new Set(result.hits.map((hit) => hit.document.id));
    const suggestion = result.captionSuggestion;
    const record: RunRecord = {
      questionId: base.questionId,
      arm: base.arm,
      run: base.run,
      phase: base.phase,
      status: "ok",
      failureKind: null,
      failureMessage: null,
      latencyMs: result.latencyMs,
      rounds: result.rounds,
      toolCallsUsed: result.toolCallsUsed,
      toolSequence: result.trace.map((event) => `${event.tool}:${event.status}`),
      trace: result.trace,
      requests: structuredClone(driver?.requestRecords?.slice(requestOffset) ?? []),
      reportRejections: result.trace
        .filter((event) => event.tool === "report_source_finding" && event.status === "rejected")
        .map((event) => event.resultSummary),
      stopReason: result.stopReason,
      clarification: result.clarification,
      supplement: result.supplement,
      conclusionChanges: result.conclusionChanges,
      noApplicableSourceReason: result.noApplicableSourceReason,
      model: result.model,
      usage: result.usage,
      conclusions: judgment.conclusions,
      acceptedCitations: result.acceptedCitations.map((citation) => `${citation.sourceId}|${citation.role}`),
      rejectedCitations: result.citationsRejected,
      fabricatedCitations: result.citationsRejected
        .filter((rejected) => !findSourceDocument(rejected.sourceId))
        .map((rejected) => rejected.sourceId),
      recalledCitations: result.citationsRejected
        .filter((rejected) => !hitIds.has(rejected.sourceId) && Boolean(findSourceDocument(rejected.sourceId)))
        .map((rejected) => rejected.sourceId),
      hitIds: [...hitIds],
      excludedIds: result.excludedSources.map((entry) => entry.sourceId),
      omittedClaims: result.omittedClaims.map((entry) => ({ claimText: entry.claimText, source: entry.source })),
      captionCoverage: result.captionCoverage,
      captionCoverageNote: result.captionCoverageNote,
      suggestion: suggestion
        ? {
          suggestedCaption: suggestion.suggestedCaption,
          changes: suggestion.changes.map((change) => ({
            claimText: change.claimText,
            kind: change.kind,
            suggested: change.suggested,
            status: change.status,
            origin: change.origin,
            sourceIds: change.sourceIds,
          })),
          rejectedProposals: suggestion.rejectedProposals.map((entry) => ({
            claimText: entry.claimText,
            rejectedReason: entry.rejectedReason,
          })),
          notes: suggestion.notes,
        }
        : null,
      judgment: { ok: judgment.ok, problems: judgment.problems },
    };
    saveRecord(record);
    log(
      `  ${base.questionId} [${base.arm}] #${base.run}${base.phase === "after" ? "（补证后）" : ""} `
      + `${judgment.ok ? "通过" : "未通过"} ${describeRun(record)}`
      + ` ${result.latencyMs} ms / ${result.rounds} 轮 / ${result.toolCallsUsed} 次调用`
      + `${judgment.ok ? "" : `：${judgment.problems.map((problem) => problem.kind).join("、")}`}`,
    );
  };

  const recordFailure = (
    base: { questionId: string; arm: Arm; run: number; phase: "before" | "after" },
    failure: { kind: string; message: string; trace?: SourceInvestigationResult["trace"] },
    driver?: SourceInvestigationDriver,
    requestOffset = 0,
  ): void => {
    saveRecord({
      questionId: base.questionId,
      arm: base.arm,
      run: base.run,
      phase: base.phase,
      status: "failed",
      failureKind: failure.kind,
      failureMessage: failure.message,
      latencyMs: null,
      rounds: null,
      toolCallsUsed: null,
      trace: failure.trace ?? [],
      requests: structuredClone(driver?.requestRecords?.slice(requestOffset) ?? []),
      toolSequence: (failure.trace ?? []).map((event) => `${event.tool}:${event.status}`),
      reportRejections: [],
      stopReason: null,
      clarification: null,
      supplement: null,
      conclusionChanges: null,
      noApplicableSourceReason: null,
      model: null,
      usage: null,
      conclusions: [],
      acceptedCitations: [],
      rejectedCitations: [],
      fabricatedCitations: [],
      recalledCitations: [],
      hitIds: [],
      excludedIds: [],
      omittedClaims: [],
      captionCoverage: null,
      captionCoverageNote: null,
      suggestion: null,
      judgment: { ok: false, problems: [{ kind: "run-failed", detail: failure.message }] },
    });
    log(`  ${base.questionId} [${base.arm}] #${base.run}${base.phase === "after" ? "（补证后）" : ""} 失败（${failure.kind}）：${failure.message}`);
  };

  for (const arm of arms) {
    for (const question of questions.questions) {
      const expectation = expectations.questions.find((entry) => entry.id === question.id);
      if (!expectation) throw new Error(`题集与期望不一致：${question.id} 没有独立期望。`);
      for (let run = 1; run <= runs; run += 1) {
        let driver: SourceInvestigationDriver | undefined;
        const before = { questionId: question.id, arm, run, phase: "before" as const, caption: question.caption };
        let result: SourceInvestigationResult | null = null;
        startRecord(before);
        await checkpoint();
        try {
          driver = options.driverFactory(question, arm);
          result = await runSourceInvestigation(driver, {
            allowSearch: arm === "retrieval",
            caption: question.caption,
          });
        } catch (error) {
          recordFailure(before, classifyFailure(error), driver);
          blockResume(before, "initial-failed");
          await checkpoint();
          continue;
        }
        recordSuccess(before, expectation, result, driver);
        await checkpoint();

        // 补证后阶段：题面写了人写定的回答且初查提出了追问时，沿同一段对话恢复。
        if (!question.clarifyAnswer || !expectation.resume) continue;
        if (!result.clarification) {
          blockResume(before, "missing-clarification");
          await checkpoint();
          log(`  ${question.id} [${arm}] #${run} 初查未提出追问，补证后阶段无法运行（已在补证前判定 missing-clarification）。`);
          continue;
        }
        const after = { questionId: question.id, arm, run, phase: "after" as const, caption: question.caption };
        const requestOffset = driver?.requestRecords?.length ?? 0;
        startRecord(after);
        await checkpoint();
        let resumed: SourceInvestigationResult;
        try {
          resumed = await runSourceInvestigation(driver!, {
            allowSearch: arm === "retrieval",
            caption: question.caption,
            resume: { answer: question.clarifyAnswer, prior: result },
          });
        } catch (error) {
          recordFailure(after, classifyFailure(error), driver, requestOffset);
          await checkpoint();
          continue;
        }
        recordSuccess(after, expectation, resumed, driver, requestOffset);
        await checkpoint();
      }
    }
  }

  const report = snapshot("completed");
  await options.onCheckpoint?.(report);
  return report;
}

/** 运行前的冻结检查：题集、期望、图片、资料库与预算都必须与预先锁定的版本一致。 */
export async function verifyFrozenSetup(
  questions: SourceAuditQuestions,
  expectations: SourceAuditExpectations,
  root = process.cwd(),
): Promise<string[]> {
  const problems: string[] = [];

  const questionIds = questions.questions.map((question) => question.id);
  const expectationIds = expectations.questions.map((expectation) => expectation.id);
  if (questions.questions.length < 10) problems.push(`题集只有 ${questions.questions.length} 题，至少需要 10 题。`);
  if (new Set(questionIds).size !== questionIds.length) problems.push("题集里有重复的题号。");
  for (const id of questionIds) {
    if (!expectationIds.includes(id)) problems.push(`题目 ${id} 缺少独立期望。`);
  }
  for (const id of expectationIds) {
    if (!questionIds.includes(id)) problems.push(`期望 ${id} 在题集里没有对应题目。`);
  }

  const covered = new Set(questions.questions.flatMap((question) => question.categories));
  for (const category of REQUIRED_CATEGORIES) {
    if (!covered.has(category)) problems.push(`题集没有覆盖类别：${category}。`);
  }

  // 补证阶段的输入与期望必须成对冻结：有 clarifyAnswer 才有 resume 判定，反之亦然。
  for (const question of questions.questions) {
    const expectation = expectations.questions.find((entry) => entry.id === question.id);
    if (question.clarifyAnswer && !expectation?.resume) {
      problems.push(`题目 ${question.id} 写了 clarifyAnswer 但期望没有 resume 规则。`);
    }
    if (expectation?.resume && !question.clarifyAnswer) {
      problems.push(`期望 ${expectation.id} 有 resume 规则但题面缺少 clarifyAnswer。`);
    }
    if (expectation?.resume && !expectation.resume.supplementApplied) {
      problems.push(`期望 ${expectation.id} 的 resume 规则缺少 supplementApplied，无法验证补充确实被套用。`);
    }
  }

  for (const question of questions.questions) {
    const frozenImage = questions.images[question.image];
    if (!frozenImage) {
      problems.push(`题目 ${question.id} 使用的图片 ${question.image} 没有冻结指纹。`);
      continue;
    }
    try {
      const svg = (await readFile(join(root, questions.imageDirectory, `${question.image}.svg`), "utf8")).replace(/\r\n/g, "\n");
      const png = await readFile(join(root, questions.imageDirectory, `${question.image}.png`));
      if (createHash("sha256").update(svg, "utf8").digest("hex") !== frozenImage.svgSha256) {
        problems.push(`${question.image} 的 SVG 与冻结指纹不符。`);
      }
      if (createHash("sha256").update(png).digest("hex") !== frozenImage.pngSha256) {
        problems.push(`${question.image} 的 PNG 与冻结指纹不符。`);
      }
      if (png.readUInt32BE(16) !== 960 || png.readUInt32BE(20) !== 640) problems.push(`${question.image} 不是 960×640。`);
      for (const text of frozenImage.imageText) {
        if (!svg.includes(text)) problems.push(`${question.image} 的图上没有声明文字：${text}`);
      }
      if (!svg.includes("团队自制")) problems.push(`${question.image} 没有标明团队自制。`);
    } catch {
      problems.push(`题目 ${question.id} 的图片文件缺失或无法读取：${question.image}`);
    }
  }

  for (const problem of verifySourceLibrary(SOURCE_LIBRARY)) problems.push(`资料库自检：${problem}`);
  for (const [id, fingerprint] of Object.entries(expectations.frozen.libraryFingerprints)) {
    const document = findSourceDocument(id);
    if (!document) {
      problems.push(`冻结的资料 ${id} 不在资料库里。`);
      continue;
    }
    if (document.fingerprint !== fingerprint) {
      problems.push(`资料 ${id} 的指纹与冻结值不符（期望 ${fingerprint}，实际 ${document.fingerprint}）。`);
    }
  }

  const budgetChecks: Array<[string, number, number]> = [
    ["toolCallsPerRound", expectations.frozen.budget.toolCallsPerRound, TOOL_CALLS_PER_ROUND],
    ["toolCallsPerInvestigation", expectations.frozen.budget.toolCallsPerInvestigation, TOOL_CALLS_PER_INVESTIGATION],
    ["clarificationsPerInvestigation", expectations.frozen.budget.clarificationsPerInvestigation, CLARIFICATIONS_PER_INVESTIGATION],
    ["rounds", expectations.frozen.budget.rounds, INVESTIGATION_ROUNDS],
    ["deadlineMs", expectations.frozen.budget.deadlineMs, INVESTIGATION_DEADLINE_MS],
  ];
  for (const [label, frozen, actual] of budgetChecks) {
    if (frozen !== actual) problems.push(`预算 ${label} 与冻结值不符（期望 ${frozen}，实际 ${actual}）。`);
  }

  if (!expectations.authoredBy.trim()) problems.push("期望文件没有写明由人预先写定。");
  return problems;
}

interface CliOptions {
  runs: number;
  arms: Arm[];
  out: string;
  record: string | null;
  strict: boolean;
  ids: string[] | null;
  minBalance: number;
  allowLowBalance: boolean;
  replay: string | null;
  checkOnly: boolean;
}

function parseCli(argv: string[]): CliOptions {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const options: CliOptions = {
    runs: expectationsCatalog.frozen.runsPerArm,
    arms: ["retrieval", "no-retrieval"],
    out: join(".cache", `source-audit-eval-${stamp}.json`),
    record: null,
    strict: false,
    ids: null,
    minBalance: 1,
    allowLowBalance: false,
    replay: null,
    checkOnly: false,
  };
  for (const argument of argv) {
    const [key, value = ""] = argument.split("=");
    if (key === "--runs") options.runs = Number.parseInt(value, 10);
    else if (key === "--arms") options.arms = value.split(",").filter((arm): arm is Arm => arm === "retrieval" || arm === "no-retrieval");
    else if (key === "--out") options.out = value;
    else if (key === "--record") options.record = value;
    else if (key === "--ids") options.ids = value.split(",").map((id) => id.trim()).filter(Boolean);
    else if (key === "--strict") options.strict = true;
    else if (key === "--min-balance") options.minBalance = Number.parseFloat(value);
    else if (key === "--allow-low-balance") options.allowLowBalance = true;
    else if (key === "--replay") options.replay = value;
    else if (key === "--check-only") options.checkOnly = true;
    else throw new Error(`未知参数：${argument}`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 1) throw new Error(`--runs 必须是正整数，收到「${options.runs}」。`);
  if (options.arms.length === 0) throw new Error("--arms 只能取 retrieval 或 no-retrieval。");
  if (new Set(options.arms).size !== options.arms.length) throw new Error("--arms 不能重复，避免重复阶段覆盖记录。");
  if (options.ids !== null && options.ids.length === 0) throw new Error("--ids 至少给一个题号。");
  if (Number.isNaN(options.minBalance) || options.minBalance < 0) throw new Error(`--min-balance 必须是非负数，收到「${options.minBalance}」。`);
  if (options.replay === "") throw new Error("--replay 必须提供历史原始记录路径。");
  if (options.checkOnly && options.replay) throw new Error("--check-only 与 --replay 请分别运行。");
  return options;
}

export function printReport(
  report: EvaluationReport,
  expectations: SourceAuditExpectations,
  runtime: { model: string; baseUrl: string },
): void {
  console.log("\n== 逐题结果 ==");
  console.log("题目".padEnd(38) + "有检索".padEnd(34) + "无检索".padEnd(34) + "配对");
  for (const question of report.summary.questions) {
    const cell = (arm: Arm): string => {
      const entry = question.perArm[arm];
      if (!entry) return "-";
      const outcomes = [...new Set(entry.outcomes)];
      const text = outcomes.length > 1 ? outcomes.join(" | ") : (outcomes[0] ?? "");
      return `阶段 ${entry.correctRuns}/${entry.validRuns}；路径 ${entry.passedPaths}/${entry.totalPaths} ${text}`;
    };
    console.log(question.questionId.padEnd(38) + cell("retrieval").padEnd(34) + cell("no-retrieval").padEnd(34) + question.verdict);
  }

  console.log("\n== 分臂统计 ==");
  for (const arm of report.summary.arms) {
    console.log(
      `${arm.arm}：尝试 ${arm.attempts} 次，有效 ${arm.validRuns} 次，失败 ${arm.failedRuns} 次`
      + `（${Object.entries(arm.failureKinds).map(([kind, count]) => `${kind}×${count}`).join("、") || "无"}）；`
      + `状态正确 ${arm.correctRuns}/${arm.validRuns}（${arm.accuracy === null ? "—" : `${(arm.accuracy * 100).toFixed(1)}%`}）；`
      + `接受引用 ${arm.acceptedCitations} 条，被拒绝引用 ${arm.rejectedCitations} 条，虚构 ${arm.fabricatedCitations} 条，凭记忆复用 ${arm.recalledCitations} 条；`
      + `推断依据不足 ${arm.inferenceUnsupported} 条，不支持核验 ${arm.notVerifiable} 条，未展开配文内容 ${arm.omittedClaims} 条，模型声明的图上说明文字 ${arm.otherOmittedText} 条；`
      + `平均 ${arm.averageLatencyMs ?? "—"} ms，平均调用 ${arm.averageToolCalls ?? "—"} 次；`
      + `追问 ${arm.clarifications} 次（时机问题 ${arm.clarificationProblems} 次）；补证后运行 ${arm.resumeRuns} 次、补充套用 ${arm.supplementAppliedRuns} 次；`
      + `建议配文 ${arm.suggestionRuns} 次（模型提议被采用 ${arm.suggestionModelChanges} 处、被拒 ${arm.suggestionRejectedProposals} 处、建议问题 ${arm.suggestionProblems} 次）；`
      + `版本复查替代生效 ${arm.revisionAppliedRuns} 次（修正 ${arm.revisionHelpedRuns}／误改 ${arm.revisionHurtRuns}；额外模型调用 0 次、额外轮次 0 轮）；`
      + `无来源说明 ${arm.noApplicableSourceReasons} 次；越界结论 ${arm.noApplicableSourceOverclaims} 次`,
    );
    const show = (rate: PassRate) => `${rate.passed}/${rate.total}（${rate.rate === null ? "—" : `${(rate.rate * 100).toFixed(1)}%`}）`;
    console.log(`  阶段通过 ${show(arm.stagePass)}；完整路径通过 ${show(arm.fullPathPass)}；有效运行通过 ${show(arm.validRunPass)}；全部尝试成功 ${show(arm.allAttemptSuccess)}；阻塞 ${arm.blockedStages}、未完成 ${arm.pendingStages}。`);
  }

  console.log("\n== 门槛 ==");
  for (const gate of report.summary.gates) {
    console.log(`${gate.passed ? "PASS" : "FAIL"} ${gate.label}：${gate.detail}`);
  }
  console.log(
    report.summary.degradedQuestions.length > 0
      ? `检索臂退化题（保留，不删）：${report.summary.degradedQuestions.join("、")}`
      : "检索臂退化题：无",
  );

  const retrieval = report.summary.arms.find((arm) => arm.arm === "retrieval");
  const baseline = report.summary.arms.find((arm) => arm.arm === "no-retrieval");
  if (retrieval?.accuracy != null && baseline?.accuracy != null) {
    console.log(
      `配对差（有检索 − 无检索）：${((retrieval.accuracy - baseline.accuracy) * 100).toFixed(1)} 个百分点`
      + `（${(retrieval.accuracy * 100).toFixed(1)}% 对 ${(baseline.accuracy * 100).toFixed(1)}%）；`
      + `仅检索臂正确 ${report.summary.questions.filter((question) => question.verdict === "仅检索臂正确").length} 题，`
      + `仅无检索臂正确 ${report.summary.questions.filter((question) => question.verdict === "仅无检索臂正确").length} 题，`
      + `两臂均未通过 ${report.summary.questions.filter((question) => question.verdict === "两臂均未通过").length} 题。`,
    );
  }
  console.log(`记录模型 ${runtime.model} @ ${runtime.baseUrl}；期望冻结于 ${expectations.frozenAt}。`);
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const questions = questionsCatalog;
  const expectations = expectationsCatalog;
  const frozen = expectations.frozen;

  const problems = await verifyFrozenSetup(questions, expectations);
  if (problems.length > 0) {
    console.error("冻结检查未通过，已停止评测：");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`题集：${questions.questions.length} 题（冻结于 ${questions.frozenAt}），期望独立保存于 samples/source-audit-expectations.json。`);
  if (options.checkOnly) {
    console.log("冻结检查通过；未读取密钥，真实模型调用 0 次。");
    return;
  }
  if (options.replay) {
    const bytes = await readFile(options.replay);
    const historical = readEvaluationSnapshot(bytes.toString("utf8"), options.replay.endsWith(".jsonl")) as EvaluationReport & {
      model?: string; baseUrl?: string; questionCount?: number; provenance?: Awaited<ReturnType<typeof captureProvenance>>;
    };
    if (!Array.isArray(historical.records) || !historical.records.length) throw new Error("历史文件没有逐次记录。");
    const seen = new Set<string>();
    for (const record of historical.records) {
      const identity = `${record.arm}/${record.questionId}/${record.run}/${record.phase}`;
      if (seen.has(identity)) throw new Error(`历史阶段重复：${identity}。`);
      seen.add(identity);
      if (!expectations.questions.some((entry) => entry.id === record.questionId)) throw new Error(`历史题号 ${record.questionId} 不在当前期望里。`);
      if (!["before", "after"].includes(record.phase) || !["ok", "failed", "blocked", "pending", "running"].includes(record.status)) throw new Error("历史阶段或状态无效。");
    }
    // 仅重新统计已保存的独立判定，不把旧模型输出重构成新代码的在线验收。
    const recountId = randomUUID();
    const report: EvaluationReport = {
      generatedAt: new Date().toISOString(), runId: recountId, state: "completed",
      arms: historical.arms, runsPerArm: historical.runsPerArm,
      records: historical.records.map((record, sourceRecordIndex) => {
        const pathId = `${recountId}/${record.arm}/${record.questionId}/${record.run}`;
        return { ...record, sourceRecordIndex, pathId, attemptId: `${pathId}/${record.phase}`,
          parentAttemptId: record.phase === "after" ? `${pathId}/before` : null };
      }), summary: summarizeEvaluation(historical.records, expectations),
    };
    const writer = await createEvaluationWriter([options.out, ...(options.record ? [options.record] : [])],
      await captureProvenance(questions), {
        mode: "historical-recount", realModelCalls: 0,
        historical: { path: resolve(options.replay), sha256: sha256(bytes), generatedAt: historical.generatedAt,
          provenance: historical.provenance ?? null,
          note: "当前 provenance 仅属于重统计工具与输入；原记录未保存的代码／输入指纹无法追补。sourceRecordIndex 与阶段关联为派生字段，未重新判定模型表现。" },
      });
    try { await writer.save(report); } finally { await writer.close(); }
    printReport(report, expectations, { model: historical.model ?? historical.provenance?.runtime?.requestedModel ?? "历史未知",
      baseUrl: historical.baseUrl ?? historical.provenance?.runtime?.baseUrl ?? "历史未知" });
    console.log(`离线重统计已保存：${options.out}；真实模型调用 0 次。`);
    if (options.strict && report.summary.gates.some((gate) => !gate.passed)) process.exitCode = 1;
    return;
  }

  const settings = await createModelSettingsStore().read();
  const { provider, config } = activeProviderConfig(settings);
  if (provider !== frozen.provider) {
    console.error(`当前启用协议是 ${provider}，冻结配置要求 ${frozen.provider} 并已在线验证工具调用。请在设置页切换后重试。`);
    process.exitCode = 1;
    return;
  }
  if (config.model !== frozen.model) {
    console.error(`当前模型是 ${config.model}，冻结配置要求 ${frozen.model}。`);
    process.exitCode = 1;
    return;
  }
  if (config.baseUrl.replace(/\/$/, "") !== frozen.baseUrl.replace(/\/$/, "")) {
    console.error(`当前地址是 ${config.baseUrl}，冻结配置要求 ${frozen.baseUrl}。`);
    process.exitCode = 1;
    return;
  }
  if (!config.apiKey.trim()) {
    console.error("本机没有保存 API Key，请先在设置页填写并保存。");
    process.exitCode = 1;
    return;
  }
  console.log(`模型：${provider} / ${config.model} / ${config.baseUrl}（密钥不回显）`);
  console.log(`臂：${options.arms.join("、")}；每臂每题 ${options.runs} 次`);
  console.log(`无检索臂做法：${frozen.noRetrievalMethod}`);

  const imageBuffers = new Map<string, Buffer>();
  for (const question of questions.questions) {
    if (imageBuffers.has(question.image)) continue;
    imageBuffers.set(question.image, await readFile(join(questions.imageDirectory, `${question.image}.png`)));
  }

  const selected: SourceAuditQuestions = options.ids
    ? { ...questions, questions: questions.questions.filter((question) => options.ids?.includes(question.id)) }
    : questions;
  if (!selected.questions.length || options.ids?.some((id) => !questions.questions.some((question) => question.id === id))) {
    throw new Error("--ids 含未知题号或选择结果为空，已停止。");
  }

  // 花钱预检：先说清这次要发多少请求、账户还剩多少，余额不够就直接停，
  // 避免跑到一半因 402／400 白跑（阶段四任务 03 踩过一次）。
  // 带补证阶段的题每次运行会发出两次请求（补证前 + 补证后），按上限计入计划。
  const resumeQuestions = selected.questions.filter((question) => hasResumePhase(question, expectations)).length;
  const planned = plannedRequests(selected.questions.length, options.arms.length, options.runs, resumeQuestions);
  console.log(
    `本次计划发出 ${planned} 次请求（${selected.questions.length} 题 × ${options.arms.length} 臂 × ${options.runs} 次`
    + `${resumeQuestions > 0 ? ` + ${resumeQuestions} 道补证题的恢复段` : ""}）；`
    + "每次调查通常再拆成 2—4 轮模型调用，因此实际调用次数约为请求数的 2—3 倍。",
  );
  const fullResumeQuestions = questions.questions.filter((question) => hasResumePhase(question, expectations)).length;
  const fullGroup = plannedRequests(
    questions.questions.length,
    expectations.frozen.arms.length,
    expectations.frozen.runsPerArm,
    fullResumeQuestions,
  );
  if (planned < fullGroup) {
    console.log("（少于整组：使用了 --ids／--arms／--runs 限定，花的是整组的一部分。）");
  }
  const balance = await checkBalance(config.baseUrl, config.apiKey, options.minBalance);
  console.log(`余额预检：${balance.message}`);
  if (balance.blocked && !options.allowLowBalance) {
    console.error(
      `账户余额低于 ${options.minBalance.toFixed(2)} 元，已停止以避免中途失败白跑。`
      + "充值后重试；确认要继续时加 --allow-low-balance。",
    );
    process.exitCode = 1;
    return;
  }

  const provenance = await captureProvenance(questions, {
    provider, requestedModel: config.model, baseUrl: config.baseUrl,
    parameters: { maxOutputTokens: MAX_OUTPUT_TOKENS, requestTimeoutMs: REQUEST_TIMEOUT_MS,
      temperature: null, topP: null, seed: null, thinking: "首选 disabled，400 时省略字段重试",
      toolChoice: "auto；汇总为强制 report_source_finding（兼容回退为 auto）",
      note: "null 表示未显式发送；提供方默认值未知。实际响应模型逐阶段保存。" },
  }, process.cwd(), imageBuffers);
  const writer = await createEvaluationWriter([options.out, ...(options.record ? [options.record] : [])], provenance,
    { mode: "live", questionCount: selected.questions.length, catalogQuestionCount: questions.questions.length,
      selectedQuestionIds: selected.questions.map((q) => q.id), traceScope: "调查累计（恢复段含初查轨迹）；requests 仅含本阶段请求，兼容重试逐个保存。" });
  let report: EvaluationReport;
  try {
    report = await runPairedEvaluation(selected, expectations, {
    runs: options.runs,
    arms: options.arms,
    driverFactory: (question, arm) => new AnthropicSourceInvestigationDriver(
      config,
      { buffer: imageBuffers.get(question.image) as Buffer, mimeType: "image/png" },
      question.caption,
      sourceInvestigationPrompt({ retrieval: arm === "retrieval" }),
      undefined,
      { includeSearch: arm === "retrieval" },
    ),
    log: (line) => console.log(line),
    onCheckpoint: (snapshot) => writer.save(snapshot),
    });
  } finally { await writer.close(); }

  printReport(report, expectations, config);

  console.log(`完整记录：${options.out}`);
  if (options.record) {
    console.log(`逐题记录：${options.record}`);
  }

  if (options.strict && report.summary.gates.some((gate) => !gate.passed)) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
