import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import rawQuestions from "../samples/source-audit-questions.json" with { type: "json" };
import rawExpectations from "../samples/source-audit-expectations.json" with { type: "json" };
import {
  AnthropicSourceInvestigationDriver,
  SourceInvestigationError,
  runSourceInvestigation,
  type SourceInvestigationDriver,
} from "../server/source-investigation.js";
import { sourceInvestigationPrompt } from "../server/source-prompt.js";
import { activeProviderConfig, FileModelSettingsStore } from "../server/model-settings.js";
import {
  CLARIFICATIONS_PER_INVESTIGATION,
  INVESTIGATION_DEADLINE_MS,
  INVESTIGATION_ROUNDS,
  TOOL_CALLS_PER_INVESTIGATION,
  TOOL_CALLS_PER_ROUND,
  normalizeSourcePeriod,
  type ClaimSourceStatus,
  type SourceClaim,
  type SourceInvestigationResult,
} from "../shared/source-audit.js";
import { SOURCE_LIBRARY, findSourceDocument, verifySourceLibrary } from "../shared/source-library.js";

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
}

export interface RunRecord {
  questionId: string;
  arm: Arm;
  run: number;
  /** before = 补证前初查；after = 用题面 clarifyAnswer 恢复的补证后阶段。 */
  phase: "before" | "after";
  status: "ok" | "failed";
  failureKind: string | null;
  failureMessage: string | null;
  latencyMs: number | null;
  rounds: number | null;
  toolCallsUsed: number | null;
  toolSequence: string[];
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

/** 判定上下文：arm 决定追问顺序检查是否生效，phase 区分补证前后两段。 */
export interface JudgeContext {
  arm?: Arm;
  phase?: "before" | "after";
}

/**
 * 按人写的期望判定一次运行。判定只用程序可读的字段（fromImage／basis／value／period／状态／引用），
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
    }
    : expectation;
  const problems: JudgmentProblem[] = [];
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

  return { ok: problems.length === 0, problems, conclusions };
}

/** 上游失败的原因文本一并留档：只记分类无法解释失败率，也无法复现。 */
function failureCause(error: unknown): string {
  const cause = (error as { cause?: unknown }).cause;
  if (!cause) return "";
  if (cause instanceof Error) {
    const status = (cause as { status?: unknown }).status;
    return `${cause.name}${typeof status === "number" ? ` ${status}` : ""}: ${cause.message}`.slice(0, 240);
  }
  return String(cause).slice(0, 240);
}

function classifyFailure(error: unknown): { kind: string; message: string } {
  if (error instanceof SourceInvestigationError) {
    const cause = failureCause(error);
    return { kind: error.kind, message: cause ? `${error.message}（上游：${cause}）` : error.message };
  }
  return { kind: "harness", message: error instanceof Error ? error.message : String(error) };
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
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { checked: false, totalBalance: null, message: `余额预检没成功（${reason}），不拦截，继续运行。`, blocked: false };
  }
}

export interface EvaluationOptions {
  driverFactory: (question: SourceAuditQuestion, arm: Arm) => SourceInvestigationDriver;
  runs?: number;
  arms?: Arm[];
  log?: (line: string) => void;
}

export interface EvaluationReport {
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
  averageLatencyMs: number | null;
  averageToolCalls: number | null;
}

export interface QuestionPairSummary {
  questionId: string;
  categories: string[];
  perArm: Record<string, { attempts: number; validRuns: number; correctRuns: number; outcomes: string[] }>;
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
      attempts: armRecords.length,
      validRuns: valid.length,
      failedRuns: armRecords.length - valid.length,
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
        attempts: armRecords.length,
        validRuns: valid.length,
        correctRuns: valid.filter((record) => record.judgment.ok).length,
        outcomes: armRecords.map(describeRun),
      };
    }
    const retrieval = perArm.retrieval;
    const noRetrieval = perArm["no-retrieval"];
    let verdict: QuestionPairSummary["verdict"] = "两臂相同";
    if (retrieval && noRetrieval) {
      // 两臂都没有有效运行时单列，避免把「上游全失败」读成「模型全答错」。
      if (retrieval.validRuns === 0 && noRetrieval.validRuns === 0) verdict = "无有效运行";
      else if (retrieval.correctRuns === 0 && noRetrieval.correctRuns > 0) verdict = "仅无检索臂正确";
      else if (retrieval.correctRuns > 0 && noRetrieval.correctRuns === 0) verdict = "仅检索臂正确";
      else if (retrieval.correctRuns === 0 && noRetrieval.correctRuns === 0) verdict = "两臂均未通过";
    }
    return { questionId: expectation.id, categories: question?.categories ?? [], perArm, verdict };
  });

  const gateArm = expectations.frozen.gates.gateArm;
  const gateSummary = armSummaries.find((entry) => entry.arm === gateArm);
  const accuracy = gateSummary?.accuracy ?? null;
  const fabricatedTotal = armSummaries.reduce((total, entry) => total + entry.fabricatedCitations, 0);
  const overclaimTotal = armSummaries.reduce((total, entry) => total + entry.noApplicableSourceOverclaims, 0);
  const gates: GateResult[] = [
    {
      id: "claim-status-accuracy",
      label: `${gateArm} 臂主张状态正确率 ≥ ${(expectations.frozen.gates.claimStatusAccuracy * 100).toFixed(0)}%`,
      passed: accuracy !== null && accuracy >= expectations.frozen.gates.claimStatusAccuracy,
      detail: accuracy === null
        ? "没有有效运行，无法计算。"
        : `${(accuracy * 100).toFixed(1)}%（${gateSummary?.correctRuns ?? 0}/${gateSummary?.validRuns ?? 0} 次有效运行）`,
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

export async function runPairedEvaluation(
  questions: SourceAuditQuestions,
  expectations: SourceAuditExpectations,
  options: EvaluationOptions,
): Promise<EvaluationReport> {
  const arms = options.arms ?? expectations.frozen.arms;
  const runs = options.runs ?? expectations.frozen.runsPerArm;
  const log = options.log ?? (() => {});
  const records: RunRecord[] = [];

  /** 把一次成功的结果按阶段判定并落成记录。 */
  const recordSuccess = (
    base: { questionId: string; arm: Arm; run: number; phase: "before" | "after" },
    expectation: QuestionExpectation,
    result: SourceInvestigationResult,
  ): void => {
    const judgment = judgeRun(expectation, result, { arm: base.arm, phase: base.phase });
    const hitIds = new Set(result.hits.map((hit) => hit.document.id));
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
      judgment: { ok: judgment.ok, problems: judgment.problems },
    };
    records.push(record);
    log(
      `  ${base.questionId} [${base.arm}] #${base.run}${base.phase === "after" ? "（补证后）" : ""} `
      + `${judgment.ok ? "通过" : "未通过"} ${describeRun(record)}`
      + ` ${result.latencyMs} ms / ${result.rounds} 轮 / ${result.toolCallsUsed} 次调用`
      + `${judgment.ok ? "" : `：${judgment.problems.map((problem) => problem.kind).join("、")}`}`,
    );
  };

  const recordFailure = (
    base: { questionId: string; arm: Arm; run: number; phase: "before" | "after" },
    failure: { kind: string; message: string },
  ): void => {
    records.push({
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
      toolSequence: [],
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
      judgment: { ok: false, problems: [{ kind: "run-failed", detail: failure.message }] },
    });
    log(`  ${base.questionId} [${base.arm}] #${base.run}${base.phase === "after" ? "（补证后）" : ""} 失败（${failure.kind}）：${failure.message}`);
  };

  for (const arm of arms) {
    for (const question of questions.questions) {
      const expectation = expectations.questions.find((entry) => entry.id === question.id);
      if (!expectation) throw new Error(`题集与期望不一致：${question.id} 没有独立期望。`);
      for (let run = 1; run <= runs; run += 1) {
        const driver = options.driverFactory(question, arm);
        const before = { questionId: question.id, arm, run, phase: "before" as const };
        let result: SourceInvestigationResult | null = null;
        try {
          result = await runSourceInvestigation(driver, {
            allowSearch: arm === "retrieval",
            caption: question.caption,
          });
        } catch (error) {
          recordFailure(before, classifyFailure(error));
          continue;
        }
        recordSuccess(before, expectation, result);

        // 补证后阶段：题面写了人写定的回答且初查提出了追问时，沿同一段对话恢复。
        if (!question.clarifyAnswer || !expectation.resume) continue;
        if (!result.clarification) {
          log(`  ${question.id} [${arm}] #${run} 初查未提出追问，补证后阶段无法运行（已在补证前判定 missing-clarification）。`);
          continue;
        }
        const after = { questionId: question.id, arm, run, phase: "after" as const };
        try {
          const resumed = await runSourceInvestigation(driver, {
            allowSearch: arm === "retrieval",
            caption: question.caption,
            resume: { answer: question.clarifyAnswer, prior: result },
          });
          recordSuccess(after, expectation, resumed);
        } catch (error) {
          recordFailure(after, classifyFailure(error));
        }
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    arms,
    runsPerArm: runs,
    records,
    summary: summarizeEvaluation(records, expectations),
  };
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
    else throw new Error(`未知参数：${argument}`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 1) throw new Error(`--runs 必须是正整数，收到「${options.runs}」。`);
  if (options.arms.length === 0) throw new Error("--arms 只能取 retrieval 或 no-retrieval。");
  if (options.ids !== null && options.ids.length === 0) throw new Error("--ids 至少给一个题号。");
  if (Number.isNaN(options.minBalance) || options.minBalance < 0) throw new Error(`--min-balance 必须是非负数，收到「${options.minBalance}」。`);
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
      return `${entry.correctRuns}/${entry.validRuns} ${text}`;
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
      + `无来源说明 ${arm.noApplicableSourceReasons} 次；越界结论 ${arm.noApplicableSourceOverclaims} 次`,
    );
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

  const settings = await new FileModelSettingsStore().read();
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

  const report = await runPairedEvaluation(selected, expectations, {
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
  });

  printReport(report, expectations, config);

  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`完整记录：${options.out}`);
  if (options.record) {
    await mkdir(dirname(options.record), { recursive: true });
    await writeFile(options.record, `${JSON.stringify({
      generatedAt: report.generatedAt,
      arms: report.arms,
      runsPerArm: report.runsPerArm,
      provider: frozen.provider,
      model: frozen.model,
      baseUrl: frozen.baseUrl,
      questionCount: questions.questions.length,
      records: report.records,
    }, null, 2)}\n`, "utf8");
    console.log(`逐题记录：${options.record}`);
  }

  if (options.strict && report.summary.gates.some((gate) => !gate.passed)) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
