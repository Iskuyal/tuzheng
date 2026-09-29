import {
  SOURCE_LIBRARY,
  type ComparisonBasis,
  type SourceDocument,
  type SourceMeasure,
} from "./source-library.js";

/** 每轮允许的工具调用次数。 */
export const TOOL_CALLS_PER_ROUND = 3;
/** 含恢复与可选复查在内的单次调查工具调用总上限。 */
export const TOOL_CALLS_PER_INVESTIGATION = 6;
/** 单次调查最多一次补证追问。 */
export const CLARIFICATIONS_PER_INVESTIGATION = 1;
/** 模型对话轮数上限，避免无限循环。 */
export const INVESTIGATION_ROUNDS = 4;
/** 单次调查的整体时限；超过后停止并保留已获得的证据，不再发起新的模型请求。 */
export const INVESTIGATION_DEADLINE_MS = 150_000;

/** 单次调查最多核验的主张数；超出的部分必须显式列为未展开项，不能静默丢弃。 */
export const AUDITED_CLAIMS_LIMIT = 3;
/** 汇总结构允许的主张条数上限；多出来的由程序移到未展开项里并保留原文。 */
export const MAX_CLAIMS_PER_REPORT = 6;
/** 配文主张原文与配文的文字重合度下限；低于它说明这条主张可能不是配文里的句子。 */
export const CLAIM_TRACE_MIN_COVERAGE = 0.3;
/** 已展开主张覆盖配文的比例下限；低于它给出「配文还有内容没被展开」的提示。 */
export const CAPTION_COVERAGE_MIN = 0.8;

export const BASIS_LABELS: Record<ComparisonBasis, string> = {
  "year-on-year": "同比",
  "month-on-month": "环比",
};

/** 1 个百分点以内的方向差异按持平处理。 */
const DIRECTION_EPSILON = 0.005;

/**
 * 主张分类：直接陈述来自原文；可检查推断需要推出来；观点与超出数据范围的判断不做真假判定。
 */
export type SourceClaimKind = "direct" | "inference" | "opinion";

export const CLAIM_KIND_LABELS: Record<SourceClaimKind, string> = {
  direct: "直接陈述",
  inference: "可检查推断",
  opinion: "观点（不支持核验）",
};

/** 推断类主张断言的涨跌方向。 */
export type ClaimDirection = "up" | "down";

export const DIRECTION_LABELS: Record<ClaimDirection, string> = {
  up: "上涨",
  down: "下降",
};

export interface SourceClaim {
  claimText: string;
  metric: string | null;
  scope: string | null;
  period: string | null;
  value: number | null;
  basis: ComparisonBasis | null;
  kind: SourceClaimKind;
  /** 推断类主张断言的涨跌方向；没有方向时填 null。 */
  direction?: ClaimDirection | null;
  /** 只有模型明确说明来源是图内文字时才算图上可见。 */
  fromImage: boolean;
  /** 图上对应这条主张的逐字文字；图上没有可比文字时为 null。 */
  imageExcerpt?: string | null;
}

export interface SourceQuery {
  metric: string | null;
  period: string | null;
  scope: string | null;
  terms: string[];
}

export interface SourceApplicability {
  /** 可以作为该口径的数值依据。 */
  applicableForValue: boolean;
  /** 可以作为术语或口径解释引用。 */
  applicableForTerm: boolean;
  mismatchFields: string[];
  missingFields: string[];
}

export interface SourceHit {
  document: SourceDocument;
  score: number;
  matchReasons: string[];
  applicability: SourceApplicability;
}

export function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toLocaleLowerCase();
}

/**
 * 「2025 年 12 月」「2025年12月份」「2025-12」「2025/12/01」统一成 `2025-12`；
 * 只有年份、季度或读不到月份时返回 null。
 */
export function normalizeSourcePeriod(value: string | null | undefined): string | null {
  if (!value) return null;
  const year = value.match(/(?:19|20|21)\d{2}/);
  if (!year) return null;
  const remainder = value.slice(value.indexOf(year[0]) + year[0].length);
  const month = remainder.match(/(0?[1-9]|1[0-2])\s*月/)
    ?? remainder.match(/^\s*[-/.]\s*(0?[1-9]|1[0-2])(?:\s*[-/.]\s*\d{1,2})?\s*$/);
  if (!month) return null;
  return `${year[0]}-${month[1].padStart(2, "0")}`;
}

/** 核对原文重合度时去掉空白与常见标点，避免「0.8%。」与「0.8%」被判成不同。 */
export function normalizeClaimText(value: string | null | undefined): string {
  return normalizeClaimTextWithMap(value).text;
}

/** 归一化同时保留每个字符在原文里的位置，用于把命中片段还原成原文展示。 */
function normalizeClaimTextWithMap(value: string | null | undefined): { text: string; map: number[] } {
  const text: string[] = [];
  const map: number[] = [];
  const source = value ?? "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (/\s/.test(character) || "，。、；：！？,.;:!?（）()【】「」“”\"'".includes(character)) continue;
    text.push(character.toLocaleLowerCase());
    map.push(index);
  }
  return { text: text.join(""), map };
}

/** 最长公共子串，返回它以及它在左侧字符串里的位置，用于展示「哪一段原文对应这条主张」。 */
export function longestCommonRun(left: string, right: string): { text: string; start: number; length: number } {
  if (!left || !right) return { text: "", start: 0, length: 0 };
  let best = { text: "", start: 0, length: 0 };
  let previous = new Uint16Array(right.length + 1);
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Uint16Array(right.length + 1);
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] !== right[j - 1]) continue;
      const length = previous[j - 1] + 1;
      current[j] = length;
      if (length > best.length) best = { text: left.slice(i - length, i), start: i - length, length };
    }
    previous = current;
  }
  return best;
}

/** 二元组覆盖率：主张里的相邻两字有多少能在出处文本里找到。 */
export function bigramCoverage(claimText: string, originText: string): { coverage: number; matchedRun: string } {
  const claim = normalizeClaimText(claimText);
  const origin = normalizeClaimText(originText);
  const run = longestCommonRun(claim, origin);
  if (claim.length < 2) return { coverage: claim.length > 0 && origin.includes(claim) ? 1 : 0, matchedRun: run.text };
  let matched = 0;
  const total = claim.length - 1;
  for (let index = 0; index < total; index += 1) {
    if (origin.includes(claim.slice(index, index + 2))) matched += 1;
  }
  return { coverage: Number((matched / total).toFixed(3)), matchedRun: run.text };
}

/** 文本里出现的数值（按数值比较，`0.80` 与 `0.8` 算同一个）。 */
function numberValuesOf(value: string | null | undefined): number[] {
  return (value ?? "").match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
}

export interface ClaimOriginTrace {
  /** 这条主张声称的出处是图上文字还是配文。 */
  fromImage: boolean;
  /** 用来核对的原文：图上抄录或配文原文。 */
  originText: string | null;
  /** 主张原文能否追溯到它自己的出处。 */
  traceable: boolean;
  /** 主张与出处的文字重合度。 */
  coverage: number;
  /** 出处里与主张对应的那一段原文。 */
  matchedRun: string;
  /** 不可追溯或需要说明时的原因；可追溯时为 null。 */
  note: string | null;
}

function percentText(coverage: number): string {
  return `${(coverage * 100).toFixed(0)}%`;
}

/**
 * 主张原文必须能追溯到它声称的出处：配文主张要能在配文里找到，图内主张要能在图上抄录里找到。
 * 这条规则拦的是「模型把检索到的官方原句当成配文主张」这类归属错误——数字对得上也不代表
 * 这句话是配文说的。
 */
export function traceClaimOrigin(
  claim: Pick<SourceClaim, "claimText" | "fromImage" | "imageExcerpt">,
  options: { caption?: string | null; imageClaims?: readonly SourceClaim[] } = {},
): ClaimOriginTrace {
  const originText = claim.fromImage ? (claim.imageExcerpt?.trim() || null) : (options.caption?.trim() || null);
  const label = claim.fromImage ? "图上抄录" : "配文原文";
  if (!originText) {
    return {
      fromImage: claim.fromImage,
      originText: null,
      traceable: false,
      coverage: 0,
      matchedRun: "",
      note: claim.fromImage ? "这条图内主张没有提供图上抄录，无法核对原文。" : "没有配文原文可供核对。",
    };
  }

  const { coverage, matchedRun } = bigramCoverage(claim.claimText, originText);
  // 配文主张里出现的数字必须能在配文或图上找到：防止模型换个数字后仍被当成配文说的。
  const missingNumbers: number[] = [];
  if (!claim.fromImage) {
    const allowed = new Set([
      ...numberValuesOf(originText),
      ...(options.imageClaims ?? []).flatMap((imageClaim) => [
        ...numberValuesOf(imageClaim.claimText),
        ...numberValuesOf(imageClaim.imageExcerpt),
        ...numberValuesOf(imageClaim.period),
        ...(imageClaim.value === null || imageClaim.value === undefined ? [] : [imageClaim.value]),
      ]),
    ]);
    for (const value of numberValuesOf(claim.claimText)) {
      if (!allowed.has(value)) missingNumbers.push(value);
    }
  }

  const traceable = coverage >= CLAIM_TRACE_MIN_COVERAGE && missingNumbers.length === 0;
  const note = traceable ? null : [
    `这条主张与${label}只有 ${percentText(coverage)} 的文字重合`,
    missingNumbers.length > 0 ? `，还出现了${label}和图上都没有的数字（${missingNumbers.join("、")}）` : "",
    claim.fromImage
      ? "；它可能不是图上原话，不能作为图内主张核对。"
      : "；它可能不是配文里的句子（例如把检索到的来源句子当成配文主张），不能按配文主张核对。",
  ].join("");

  return {
    fromImage: claim.fromImage,
    originText,
    traceable,
    coverage,
    matchedRun: matchedRun.trim(),
    note,
  };
}

export interface PeriodFillResult {
  claims: SourceClaim[];
  /** 与 claims 一一对应的补全说明；没有补全或无法补全时为 null。 */
  notes: Array<string | null>;
}

/**
 * 配文只写月份时（「12 月」），按图上标注的月份补全年份，让口径能落到 `YYYY-MM`。
 * 只能有一个图上年份候选时才补；有多个候选或图上没有年份时保持原样并说明原因。
 */
export function fillClaimPeriodsFromImage(claims: readonly SourceClaim[]): PeriodFillResult {
  const imagePeriods = [...new Set(
    claims
      .filter((claim) => claim.fromImage)
      .map((claim) => normalizeSourcePeriod(claim.period))
      .filter((period): period is string => Boolean(period)),
  )];

  const notes: Array<string | null> = [];
  const filled = claims.map((claim, index) => {
    const raw = claim.period?.trim() || null;
    if (!raw) {
      notes[index] = null;
      return claim;
    }
    if (normalizeSourcePeriod(raw)) {
      notes[index] = null;
      return claim;
    }
    const monthMatch = raw.match(/(?:^|\D)(0?[1-9]|1[0-2])\s*月/);
    if (!monthMatch) {
      notes[index] = null;
      return claim;
    }
    const month = monthMatch[1].padStart(2, "0");
    const candidates = [...new Set(
      imagePeriods.filter((period) => period.endsWith(`-${month}`)).map((period) => period.slice(0, 4)),
    )];
    const what = claim.fromImage ? "图上抄录" : "配文";
    if (candidates.length === 1) {
      const period = `${candidates[0]}-${month}`;
      notes[index] = `只写了「${raw}」，年份按图上标注的 ${period} 补全。`;
      return { ...claim, period };
    }
    notes[index] = candidates.length === 0
      ? `${what}只写了「${raw}」，图上没有可用的年份，月份无法补全。`
      : `${what}只写了「${raw}」，图上出现多个年份（${candidates.join("、")}），无法确定属于哪一年。`;
    return claim;
  });

  return { claims: filled, notes };
}

export interface CaptionCoverage {
  coverage: number;
  /** 配文里没有被任何主张覆盖的那一段。 */
  uncovered: string | null;
}

/** 已展开的配文主张在配文里覆盖了多少；没被覆盖的部分要显式提示，不能静默丢弃。 */
export function captionClaimCoverage(claims: readonly SourceClaim[], caption: string | null | undefined): CaptionCoverage {
  const { text: normalized, map } = normalizeClaimTextWithMap(caption);
  if (!normalized) return { coverage: 0, uncovered: null };
  const covered = new Array<boolean>(normalized.length).fill(false);
  for (const claim of claims.filter((entry) => !entry.fromImage)) {
    // 左参数是配文：返回的 start 才是配文里的位置，不能拿主张自己算偏移。
    const { start, length } = longestCommonRun(normalized, normalizeClaimText(claim.claimText));
    for (let index = start; index < start + length; index += 1) covered[index] = true;
  }
  const coveredCount = covered.filter(Boolean).length;
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let index = 0; index <= covered.length; index += 1) {
    if (index < covered.length && !covered[index]) {
      if (runStart < 0) runStart = index;
      continue;
    }
    if (runStart >= 0) {
      const length = index - runStart;
      if (length > bestLength) {
        bestLength = length;
        bestStart = runStart;
      }
      runStart = -1;
    }
  }
  // 还原成配文原文里的那一段，提示里展示的仍是用户写的文字。
  const uncovered = bestLength >= 2 && bestStart >= 0
    ? (caption ?? "").slice(map[bestStart], map[bestStart + bestLength - 1] + 1).trim()
    : null;
  return {
    coverage: Number((coveredCount / normalized.length).toFixed(3)),
    uncovered,
  };
}

function metricMatches(metric: string | null, document: SourceDocument): boolean {
  if (!metric) return false;
  const normalized = normalizeText(metric);
  if (!normalized) return false;
  const candidates = [document.basis.metric, ...document.aliases].map(normalizeText);
  return candidates.some((candidate) => candidate.includes(normalized) || normalized.includes(candidate));
}

function termMatches(terms: string[], document: SourceDocument): string[] {
  const haystack = normalizeText([
    document.title,
    document.excerpt,
    document.basis.metric,
    ...document.aliases,
  ].join(" "));
  return terms.filter((term) => {
    const normalized = normalizeText(term);
    return normalized.length > 0 && haystack.includes(normalized);
  });
}

/**
 * 口径适配判定：只有指标、月份、范围都对上的数据发布才能作为数值依据；
 * 术语解释页永远不能充当具体月份的数值来源，缺月份的查询也不会因此排除它。
 */
export function evaluateApplicability(query: SourceQuery, document: SourceDocument): SourceApplicability {
  const mismatchFields: string[] = [];
  const missingFields: string[] = [];

  if (!metricMatches(query.metric, document)) {
    mismatchFields.push("metric");
  }

  const queryPeriod = normalizeSourcePeriod(query.period);
  if (document.kind === "term-explanation") {
    return {
      applicableForValue: false,
      applicableForTerm: true,
      mismatchFields,
      missingFields,
    };
  }

  if (!queryPeriod) {
    missingFields.push("period");
  } else if (document.basis.period !== queryPeriod) {
    mismatchFields.push("period");
  }

  if (query.scope && document.basis.scope && normalizeText(query.scope) !== normalizeText(document.basis.scope)) {
    mismatchFields.push("scope");
  } else if (query.scope && !document.basis.scope) {
    missingFields.push("scope");
  }

  return {
    applicableForValue: mismatchFields.length === 0 && missingFields.length === 0,
    applicableForTerm: false,
    mismatchFields,
    missingFields,
  };
}

/**
 * 真实检索与排序：先按指标、月份、范围找候选，再按自由词补充；
 * 不按主张中的数值或比较方式过滤，纠错材料和干扰材料都要能被命中。
 */
export function searchSourceLibrary(
  query: SourceQuery,
  library: readonly SourceDocument[] = SOURCE_LIBRARY,
  limit = 5,
): SourceHit[] {
  const queryPeriod = normalizeSourcePeriod(query.period);

  const hits = library.map((document) => {
    const matchReasons: string[] = [];
    let score = 0;
    const metricOk = metricMatches(query.metric, document);
    const matchedTerms = termMatches(query.terms, document);
    const relatedToQuery = metricOk || matchedTerms.length > 0;

    if (metricOk) {
      score += 4;
      matchReasons.push("指标与资料口径匹配");
    }

    if (document.kind === "term-explanation") {
      // 术语页本就不绑定具体月份；只有在与查询相关时才作为候选，避免无关指标也把它拉进来。
      if (relatedToQuery) {
        score += 1.5;
        matchReasons.push("术语解释材料，可用于比较方式说明");
      }
    } else if (metricOk && queryPeriod && document.basis.period === queryPeriod) {
      score += 4;
      matchReasons.push(`资料适用月份为 ${document.basis.period}`);
    } else if (metricOk && queryPeriod && document.basis.period !== queryPeriod) {
      // 月份不同的官方材料仍返回，交由调用方看到并排除，不在这里隐藏。
      score += 0.5;
      matchReasons.push(`资料适用月份为 ${document.basis.period}，与查询月份不同`);
    }

    if (metricOk && query.scope && document.basis.scope) {
      if (normalizeText(query.scope) === normalizeText(document.basis.scope)) {
        score += 1.5;
        matchReasons.push(`范围与资料一致（${document.basis.scope}）`);
      } else {
        matchReasons.push(`资料范围为 ${document.basis.scope}，与查询不同`);
      }
    }

    if (matchedTerms.length > 0) {
      score += Math.min(matchedTerms.length, 3) * 0.75;
      matchReasons.push(`命中关键词：${matchedTerms.join("、")}`);
    }

    return {
      document,
      score: Number(score.toFixed(2)),
      matchReasons,
      applicability: evaluateApplicability(query, document),
    };
  });

  return hits
    .filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score || left.document.id.localeCompare(right.document.id))
    .slice(0, limit);
}

export type CitationRole = "value-basis" | "term-explanation" | "context";

export interface ModelCitation {
  sourceId: string;
  role: CitationRole;
  note: string | null;
}

export interface CitationValidation {
  accepted: ModelCitation[];
  rejected: Array<{ citation: ModelCitation; reason: string }>;
}

/**
 * 结构校验：引用必须来自本次命中，且角色与资料类型相符。
 * 口径是否适配不在这里一刀切——同一次调查可能按好几个口径检索，命中里同一份资料的
 * 适用性是按某次查询算的，不能代表它对某条主张是否适用；按主张判断见
 * `fitsClaimAsValueBasis` 与 `auditClaimsAgainstSources`。
 */
export function validateCitations(
  citations: ModelCitation[],
  hits: SourceHit[],
): CitationValidation {
  const accepted: ModelCitation[] = [];
  const rejected: Array<{ citation: ModelCitation; reason: string }> = [];
  const byId = new Map(hits.map((hit) => [hit.document.id, hit]));

  for (const citation of citations) {
    const hit = byId.get(citation.sourceId);
    if (!hit) {
      rejected.push({ citation, reason: `引用 ${citation.sourceId} 不在本次检索命中内，不作为依据。` });
      continue;
    }
    if (citation.role === "value-basis" && hit.document.kind === "term-explanation") {
      rejected.push({
        citation,
        reason: `${hit.document.title} 是术语解释页，只用于说明同比与环比的差别，不能作为数值依据。`,
      });
      continue;
    }
    if (citation.role === "term-explanation" && hit.document.kind !== "term-explanation") {
      rejected.push({
        citation,
        reason: `${hit.document.title} 是具体发布，不能用来说明术语定义。`,
      });
      continue;
    }
    accepted.push(citation);
  }

  return { accepted, rejected };
}

export function claimQueryOf(claim: Pick<SourceClaim, "metric" | "period" | "scope">): SourceQuery {
  return { metric: claim.metric, period: claim.period, scope: claim.scope, terms: [] };
}

/** 这份材料能不能作为这批主张里某一条的数值依据（指标、月份、范围都要对上）。 */
export function fitsClaimAsValueBasis(document: SourceDocument, claims: readonly SourceClaim[]): boolean {
  return claims.some((claim) => evaluateApplicability(claimQueryOf(claim), document).applicableForValue);
}

function claimApplicabilityFields(
  document: SourceDocument,
  claims: readonly SourceClaim[],
): { mismatch: string[]; missing: string[] } {
  const mismatch = new Set<string>();
  const missing = new Set<string>();
  for (const claim of claims) {
    const applicability = evaluateApplicability(claimQueryOf(claim), document);
    for (const field of applicability.mismatchFields) mismatch.add(field);
    for (const field of applicability.missingFields) missing.add(field);
  }
  return { mismatch: [...mismatch], missing: [...missing] };
}

export function describeInapplicableSource(document: SourceDocument, claims: readonly SourceClaim[]): string {
  if (document.kind === "term-explanation") {
    return `${document.title} 是术语解释页，只用于说明同比与环比的差别，不能作为数值依据。`;
  }
  const { mismatch, missing } = claimApplicabilityFields(document, claims);
  if (mismatch.length > 0) {
    return `所引资料与主张口径不一致（${mismatch.map(fieldLabel).join("、")}），不作为数值依据。`;
  }
  if (missing.length > 0) {
    return `无法确认所引资料与主张口径是否一致（${missing.map(fieldLabel).join("、")}），不作为数值依据。`;
  }
  return "所引资料与主张口径不匹配，不作为数值依据。";
}

export type ClaimSourceStatus =
  | "source-match"
  | "source-mismatch"
  | "source-pending"
  | "inference-unsupported"
  | "not-verifiable";

/** 结论里单个部位的证据状态。 */
export type ClaimPartStatus = "supported" | "contradicted" | "insufficient";

export const CLAIM_PART_STATUS_LABELS: Record<ClaimPartStatus, string> = {
  supported: "来源支持",
  contradicted: "来源矛盾",
  insufficient: "推断依据不足",
};

export interface ClaimEvidencePart {
  /** 这句配文里的哪一部分。 */
  label: string;
  status: ClaimPartStatus;
  detail: string;
  sourceId: string | null;
}

export interface ClaimSourceConclusion {
  claimText: string;
  claimKind: SourceClaimKind;
  fromImage: boolean;
  status: ClaimSourceStatus;
  /** 结论只针对本次引用的发布与口径，不扩大到现实事实。 */
  summary: string;
  basisLabel: string | null;
  claimValue: number | null;
  officialValue: number | null;
  difference: number | null;
  citedSourceIds: string[];
  reasons: string[];
  unresolved: string[];
  /** 推断类主张逐部位的结果（来源支持／来源矛盾／推断依据不足）；直接陈述为空。 */
  parts: ClaimEvidencePart[];
  /** 主张原文与它声称的出处（图上抄录或配文原文）的核对结果。 */
  origin: ClaimOriginTrace;
  /** 配文只写月份、程序按图上标注补全年份时的说明。 */
  periodNote: string | null;
}

export interface ClaimConclusionInput {
  claim: SourceClaim;
  citations: ModelCitation[];
  hits: SourceHit[];
  /** 模型给出的「本次没有适用来源」说明，用于降级原因。 */
  noApplicableSourceReason?: string | null;
  /** 配文原文；用于核对配文主张能否追溯到原文。 */
  caption?: string | null;
  /** 本次的图上主张；配文主张里出现的年份可以来自图上。 */
  imageClaims?: readonly SourceClaim[];
  /** 编排层补全月份时的说明。 */
  periodNote?: string | null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function measureFor(document: SourceDocument, basis: ComparisonBasis): SourceMeasure | undefined {
  return document.measures.find((measure) => measure.basis === basis);
}

/** 各比较方式在图上可能出现的写法。 */
const BASIS_MARKERS: Record<ComparisonBasis, string[]> = {
  "year-on-year": ["同比", "比上年", "上年同期", "去年同期", "year-on-year"],
  "month-on-month": ["环比", "比上月", "与上月", "较上月", "month-on-month"],
};

/**
 * 图上摘录是否真的写出了这个比较方式。图内主张的比较方式必须能在抄录的图上文字里看到，
 * 否则就是给图上数值补了一个图上没有的基准，不能拿去和来源对照。
 */
export function basisMentionedInImage(excerpt: string | null | undefined, basis: ComparisonBasis): boolean {
  const normalized = normalizeText(excerpt);
  if (!normalized) return false;
  return BASIS_MARKERS[basis].some((marker) => normalized.includes(normalizeText(marker)));
}

/** 引用只能落在本次命中的资料上；找不到就是没有这份材料可用。 */
function resolveCitedDocument(citation: ModelCitation, hits: SourceHit[]): SourceDocument | null {
  return hits.find((candidate) => candidate.document.id === citation.sourceId)?.document ?? null;
}

/** 方向断言与官方数值的符号比对；持平既不算上涨也不算下降。 */
function directionComparison(
  measure: SourceMeasure,
  direction: ClaimDirection,
  basisLabel: string,
): { status: ClaimPartStatus; detail: string } {
  const asserted = DIRECTION_LABELS[direction];
  if (Math.abs(measure.value) <= DIRECTION_EPSILON) {
    return {
      status: "contradicted",
      detail: `该发布记载${basisLabel} 0%，即价格水平基本持平，与「${asserted}」的断言不一致`,
    };
  }
  const actual: ClaimDirection = measure.value > 0 ? "up" : "down";
  return actual === direction
    ? {
      status: "supported",
      detail: `该发布记载${basisLabel} ${formatNumber(measure.value)}%，方向为${DIRECTION_LABELS[actual]}，支持这条推断`,
    }
    : {
      status: "contradicted",
      detail: `该发布记载${basisLabel} ${formatNumber(measure.value)}%，方向为${DIRECTION_LABELS[actual]}，与这条推断断言的「${asserted}」相反`,
    };
}

/** 整体状态：有部位矛盾就取矛盾，其次依据不足，全部支持才是一致。 */
function overallStatusOf(parts: readonly ClaimEvidencePart[]): ClaimSourceStatus {
  if (parts.some((part) => part.status === "contradicted")) return "source-mismatch";
  if (parts.some((part) => part.status === "insufficient")) return "inference-unsupported";
  return "source-match";
}

function joinPartDetails(parts: readonly ClaimEvidencePart[]): string {
  return parts.map((part) => part.detail).join("；");
}

/**
 * 结论由程序按「引用是否有效 + 口径是否匹配 + 数值与方向比对」组合，模型只提供引用与解释。
 * 引用缺失、不存在或口径不适配，一律降级为「来源待核对」（推断类降级为「推断依据不足」）。
 * 口径按**这条主张自己**的指标／月份／范围判定，而不是按检索时用的查询判定：
 * 检索查询错了（例如用图的月份去查配文写的另一个月）不能让结论跟着错。
 * 数字对得上不等于整句成立：推断类主张按部位分别给出支持、矛盾或依据不足。
 */
export function concludeClaimSource(input: ClaimConclusionInput): ClaimSourceConclusion {
  const { claim, citations, hits } = input;
  const basisLabel = claim.basis ? BASIS_LABELS[claim.basis] : null;
  const origin = traceClaimOrigin(claim, { caption: input.caption, imageClaims: input.imageClaims });
  const base = {
    claimText: claim.claimText,
    claimKind: claim.kind,
    fromImage: claim.fromImage,
    basisLabel,
    claimValue: claim.value,
    citedSourceIds: [] as string[],
    parts: [] as ClaimEvidencePart[],
    origin,
    periodNote: input.periodNote ?? null,
  };
  const missingBasis = claim.basis
    ? `需要 ${claim.period ?? "与该主张一致的月份"}的${BASIS_LABELS[claim.basis]}数据`
    : "需要先写明这条结论依赖的比较方式（同比／环比）";
  /** 依据不足的推断：说清缺哪一项，并明确不等于结论为假。 */
  const unsupportedInference = (detail: string, reasons: string[]): ClaimSourceConclusion => ({
    ...base,
    status: "inference-unsupported",
    summary: `推断依据不足：${detail}；这不代表结论为假，只是现有证据还不能推出它。`,
    officialValue: null,
    difference: null,
    parts: [{ label: "推断结论", status: "insufficient", detail, sourceId: null }],
    reasons,
    unresolved: [`${missingBasis}才能继续核对这条推断。`],
  });

  // 观点与超出数据范围的判断不做真假判定，也不套用数值结论。
  if (claim.kind === "opinion") {
    return {
      ...base,
      status: "not-verifiable",
      summary: "不支持核验：这条是观点或超出数据范围的判断，来源核验不对它做真假定论。",
      officialValue: null,
      difference: null,
      parts: [{
        label: "可核验性",
        status: "insufficient",
        detail: "观点、原因、动机与超出数据的判断不在来源核验范围内，系统只核对可追溯的数据主张。",
        sourceId: null,
      }],
      reasons: [],
      unresolved: [],
    };
  }

  // 配文主张必须能追溯到配文原文：防止把检索到的来源句子当成本次配文说的。
  // 调用方没有提供配文原文时不做这项判断（缺输入不等于主张不可追溯）。
  const captionProvided = typeof input.caption === "string" && input.caption.trim().length > 0;
  if (!claim.fromImage && captionProvided && !origin.traceable) {
    return {
      ...base,
      status: "source-pending",
      summary: "来源待核对：这条主张在配文原文里找不到对应说法，不能作为配文主张核对。",
      officialValue: null,
      difference: null,
      reasons: [origin.note ?? "这条主张与配文原文不一致。"],
      unresolved: ["需要模型给出与配文原文一致的逐字主张。"],
    };
  }

  // 推断要对某项价格变化做断言：既没有数值也没有方向的推断，程序判断不出缺的是哪一项依据，
  // 退回「来源待核对」而不是替它下「推断依据不足」的结论（术语类主张常落在这里）。
  if (claim.kind === "inference" && claim.value === null && !claim.direction) {
    return {
      ...base,
      status: "source-pending",
      summary: "来源待核对：这条推断既没有给出数值，也没有写明价格涨跌方向，无法与来源对照。",
      officialValue: null,
      difference: null,
      parts: [{
        label: "推断结论",
        status: "insufficient",
        detail: "这条主张没有给出可核对的数值或涨跌方向。",
        sourceId: null,
      }],
      reasons: ["推断类主张要写清数值或涨跌方向（以及依赖的比较方式）才能与来源核对。"],
      unresolved: ["需要明确这条主张断言的是哪一项变化（数值或涨跌方向）。"],
    };
  }

  const valueCitations = citations.filter((citation) => citation.role === "value-basis");
  if (valueCitations.length === 0) {
    const reason = input.noApplicableSourceReason?.trim()
      || "模型没有引用可用于数值核对的适用来源。";
    if (claim.kind === "inference") {
      return unsupportedInference(`本次没有可用于这条推断的适用来源（${reason}）`, [reason]);
    }
    return {
      ...base,
      status: "source-pending",
      summary: "来源待核对：没有可用的适用来源支持这条主张的数值。",
      officialValue: null,
      difference: null,
      reasons: [reason],
      unresolved: claim.value === null ? ["主张数值尚未确认。"] : [],
    };
  }

  const claimQuery = claimQueryOf(claim);
  const resolvedValueCitations = valueCitations
    .map((citation) => ({ citation, document: resolveCitedDocument(citation, hits) }))
    .filter((entry): entry is { citation: ModelCitation; document: SourceDocument } => entry.document !== null);
  const resolvedValueCitation = resolvedValueCitations
    .find((entry) => evaluateApplicability(claimQuery, entry.document).applicableForValue);

  if (!resolvedValueCitation) {
    const details = resolvedValueCitations.map((entry) => {
      const applicability = evaluateApplicability(claimQuery, entry.document);
      const fields = [...applicability.mismatchFields, ...applicability.missingFields].map(fieldLabel).join("、");
      return `《${entry.document.title}》${fields ? `（${fields}）` : ""}`;
    });
    const reason = details.length > 0
      ? `引用资料的口径与主张不一致，未能用于数值核对：${details.join("；")}。`
      : "引用资料的口径与主张不一致，未能用于数值核对。";
    if (claim.kind === "inference") {
      return unsupportedInference("所引材料的口径与这条推断对不上，本次没有可用于核对它的适用来源", [reason]);
    }
    return {
      ...base,
      status: "source-pending",
      summary: "来源待核对：所引来源与主张口径不一致，不能作为数值依据。",
      officialValue: null,
      difference: null,
      reasons: [reason],
      unresolved: [],
    };
  }

  const { document } = resolvedValueCitation;

  if (!claim.basis) {
    if (claim.kind === "inference") {
      return unsupportedInference("这条推断没有写明它依赖的比较方式（同比还是环比），无法确定缺哪一项依据", [
        `所引《${document.title}》分别记载了不同比较方式，不能确定对应哪一个。`,
      ]);
    }
    return {
      ...base,
      status: "source-pending",
      summary: "来源待核对：主张没有写明比较方式，无法与具体数值对照。",
      officialValue: null,
      difference: null,
      citedSourceIds: [document.id],
      reasons: [`主张未说明同比或环比；所引《${document.title}》分别记载了不同比较方式，不能确定对应哪一个。`],
      unresolved: ["需要补充比较方式（同比／环比）才能继续核对。"],
    };
  }

  // 图内主张的比较方式必须能在抄录的图上文字里看到，否则不能拿它和来源数值对照。
  if (claim.fromImage && !basisMentionedInImage(claim.imageExcerpt, claim.basis)) {
    return {
      ...base,
      status: "source-pending",
      summary: `来源待核对：图内摘录没有写出${BASIS_LABELS[claim.basis]}，这条比较方式是额外补上的。`,
      officialValue: null,
      difference: null,
      citedSourceIds: [document.id],
      reasons: [claim.imageExcerpt?.trim()
        ? `图上抄录的文字是「${claim.imageExcerpt.trim()}」，其中没有${BASIS_LABELS[claim.basis]}的说法，不能据此认定图上说的是${BASIS_LABELS[claim.basis]}。`
        : "这条主张来自图上文字，但没有提供图上抄录，无法确认比较方式确实写在图上。"],
      unresolved: [`需要确认图上的 ${claim.value === null ? "数值" : formatNumber(claim.value) + "%"} 是否为${BASIS_LABELS[claim.basis]}。`],
    };
  }

  // 推断类主张：数字与口径、推断结论分别核对，分别给出支持、矛盾或依据不足。
  if (claim.kind === "inference") {
    const measure = measureFor(document, claim.basis);
    const cite = `所引国家统计局发布《${document.title}》（${document.publishedAt}）`;
    if (!measure) {
      return unsupportedInference(`所引《${document.title}》没有记载${BASIS_LABELS[claim.basis]}数值，无法核对这条推断`, [
        `所引发布未记载${BASIS_LABELS[claim.basis]}口径的数值。`,
      ]);
    }
    const parts: ClaimEvidencePart[] = [];
    if (claim.value !== null) {
      const difference = Number(Math.abs(claim.value - measure.value).toFixed(2));
      parts.push({
        label: "数字与口径",
        status: difference === 0 ? "supported" : "contradicted",
        detail: difference === 0
          ? `该发布记载${BASIS_LABELS[claim.basis]} ${formatNumber(measure.value)}%，与主张中的数字一致`
          : `该发布记载${BASIS_LABELS[claim.basis]} ${formatNumber(measure.value)}%，主张写 ${formatNumber(claim.value)}%，相差 ${formatNumber(difference)} 个百分点`,
        sourceId: document.id,
      });
    }
    const direction = claim.direction ?? null;
    if (direction) {
      parts.push({
        label: "推断结论",
        ...directionComparison(measure, direction, BASIS_LABELS[claim.basis]),
        sourceId: document.id,
      });
    }
    const status = overallStatusOf(parts);
    return {
      ...base,
      status,
      summary: status === "source-match"
        ? `与${cite}一致：${joinPartDetails(parts)}。`
        : status === "source-mismatch"
          ? `与${cite}不一致：${joinPartDetails(parts)}。`
          : `推断依据不足：${joinPartDetails(parts)}；这不代表结论为假，只是现有证据还不能推出它。`,
      officialValue: measure.value,
      difference: claim.value === null ? null : Number(Math.abs(claim.value - measure.value).toFixed(2)),
      citedSourceIds: [document.id],
      parts,
      reasons: [`依据原句：${measure.excerpt}`],
      unresolved: status === "source-mismatch"
        ? ["这条推断与所引发布的方向或数字不一致，需要复核配文使用的口径（同比／环比）与数值。"]
        : status === "inference-unsupported"
          ? [`${missingBasis}才能继续核对这条推断。`]
          : [],
    };
  }

  // 直接陈述：有数字就比对数字；只写了涨跌方向就按方向比对；两者都没有时保持待核对。
  const measure = measureFor(document, claim.basis);
  if (!measure) {
    return {
      ...base,
      status: "source-pending",
      summary: `来源待核对：所引《${document.title}》没有记载${BASIS_LABELS[claim.basis]}数值。`,
      officialValue: null,
      difference: null,
      citedSourceIds: [document.id],
      reasons: [`所引发布未记载${BASIS_LABELS[claim.basis]}口径的数值。`],
      unresolved: [],
    };
  }

  if (claim.value === null && claim.direction) {
    const comparison = directionComparison(measure, claim.direction, BASIS_LABELS[claim.basis]);
    return {
      ...base,
      status: comparison.status === "contradicted" ? "source-mismatch" : "source-match",
      summary: comparison.status === "contradicted"
        ? `与所引国家统计局发布《${document.title}》（${document.publishedAt}）不一致：${comparison.detail}。`
        : `与所引国家统计局发布《${document.title}》（${document.publishedAt}）一致：${comparison.detail}。`,
      officialValue: measure.value,
      difference: null,
      citedSourceIds: [document.id],
      reasons: [`依据原句：${measure.excerpt}`],
      unresolved: comparison.status === "contradicted" ? ["需要复核配文使用的口径（同比／环比）与涨跌方向。"] : [],
    };
  }

  if (claim.value === null) {
    return {
      ...base,
      status: "source-pending",
      summary: "来源待核对：主张数值尚未确认，无法与来源比对。",
      officialValue: null,
      difference: null,
      citedSourceIds: [document.id],
      reasons: ["主张数值缺失。"],
      unresolved: ["需要补充主张中的数值。"],
    };
  }

  const difference = Number(Math.abs(claim.value - measure.value).toFixed(2));
  const agrees = difference === 0;
  const comparison = agrees
    ? `与所引国家统计局发布《${document.title}》（${document.publishedAt}）记载的${BASIS_LABELS[claim.basis]} ${formatNumber(measure.value)}% 一致。`
    : `与所引国家统计局发布《${document.title}》（${document.publishedAt}）不一致：该发布记载${BASIS_LABELS[claim.basis]} ${formatNumber(measure.value)}%，主张写 ${formatNumber(claim.value)}%，相差 ${formatNumber(difference)} 个百分点。`;

  return {
    ...base,
    status: agrees ? "source-match" : "source-mismatch",
    summary: comparison,
    officialValue: measure.value,
    difference,
    citedSourceIds: [document.id],
    reasons: [`依据原句：${measure.excerpt}`],
    unresolved: [],
  };
}

export interface SourceAuditInput {
  claims: SourceClaim[];
  citations: ModelCitation[];
  hits: SourceHit[];
  noApplicableSourceReason?: string | null;
  /** 配文原文；用于核对配文主张能否追溯到原文。 */
  caption?: string | null;
  /** 与 claims 一一对应的月份补全说明。 */
  periodNotes?: readonly (string | null)[];
  /** 图上主张的完整集合（含因条数上限没有进入核验的那些），只用于配文主张的年份核对。 */
  imageClaimsContext?: readonly SourceClaim[];
}

export interface SourceAuditOutcome {
  conclusions: ClaimSourceConclusion[];
  /** 通过校验、实际可作为依据的引用，按资料 ID 与角色去重。 */
  acceptedCitations: ModelCitation[];
  /** 检索命中里口径不适配的材料，逐条给出排除原因。 */
  excluded: Array<{ sourceId: string; title: string; reason: string }>;
  citationsRejected: Array<{ sourceId: string; reason: string }>;
}

export function auditClaimsAgainstSources(input: SourceAuditInput): SourceAuditOutcome {
  const validation = validateCitations(input.citations, input.hits);

  // 口径按主张判定：同一次调查可能按好几个口径检索过，同一份命中资料对不同主张的适用性也不同。
  const usableCitations: ModelCitation[] = [];
  const inapplicableCitations: Array<{ citation: ModelCitation; reason: string }> = [];
  for (const citation of validation.accepted) {
    if (citation.role !== "value-basis") {
      usableCitations.push(citation);
      continue;
    }
    const document = input.hits.find((hit) => hit.document.id === citation.sourceId)?.document;
    if (!document || fitsClaimAsValueBasis(document, input.claims)) usableCitations.push(citation);
    else inapplicableCitations.push({ citation, reason: describeInapplicableSource(document, input.claims) });
  }

  const conclusions = input.claims.map((claim, index) => concludeClaimSource({
    claim,
    citations: usableCitations,
    hits: input.hits,
    noApplicableSourceReason: input.noApplicableSourceReason,
    caption: input.caption,
    imageClaims: input.imageClaimsContext ?? input.claims.filter((entry) => entry.fromImage),
    periodNote: input.periodNotes?.[index] ?? null,
  }));

  const excluded = input.hits
    .filter((hit) => !fitsClaimAsValueBasis(hit.document, input.claims))
    .map((hit) => ({
      sourceId: hit.document.id,
      title: hit.document.title,
      reason: describeInapplicableSource(hit.document, input.claims),
    }));

  const seen = new Set<string>();
  const acceptedCitations = usableCitations.filter((citation) => {
    const key = `${citation.sourceId}|${citation.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    conclusions,
    acceptedCitations,
    excluded,
    citationsRejected: [...validation.rejected, ...inapplicableCitations].map((entry) => ({
      sourceId: entry.citation.sourceId,
      reason: entry.reason,
    })),
  };
}

function fieldLabel(field: string): string {
  return { metric: "指标", period: "月份", scope: "范围" }[field] ?? field;
}

/** 确定性数值比较：只做相等与差异计算，不做现实数据判断。 */
export function compareValues(
  left: number,
  right: number,
  unit: string,
): { equal: boolean; difference: number; summary: string } {
  const difference = Number(Math.abs(left - right).toFixed(2));
  return {
    equal: difference === 0,
    difference,
    summary: difference === 0
      ? `两个数值相等，均为 ${formatNumber(left)}${unit}。`
      : `两个数值相差 ${formatNumber(difference)}${unit}（${formatNumber(left)}${unit} 与 ${formatNumber(right)}${unit}）。`,
  };
}

/** 工具轨迹里的一条事件：展示实际发生的调用与简短理由，不展示模型内部思维。 */
export interface ToolTraceEvent {
  round: number;
  order: number;
  /** 模型给出的简短行动理由，或程序给出的说明。 */
  detail: string;
  status: "ok" | "rejected" | "failed";
  tool: string;
  inputSummary: string;
  resultSummary: string;
  durationMs: number;
}

export interface ClarificationRequest {
  question: string;
  purpose: string;
  field: string;
}

export interface ExcludedSource {
  sourceId: string;
  title: string;
  reason: string;
}

export interface RejectedCitation {
  sourceId: string;
  reason: string;
}

/** 没有展开成主张的内容；单次最多核验三条，其余必须留下原文。 */
export interface OmittedClaim {
  claimText: string;
  reason: string;
  /** caption 为配文里没展开的内容，other 为模型声明但不在配文里的文字（例如图上说明）。 */
  source: "caption" | "other";
}

export interface SourceInvestigationResult {
  model: string;
  latencyMs: number;
  rounds: number;
  /** 停止原因，界面与记录都按它展示。 */
  stopReason: string;
  trace: ToolTraceEvent[];
  claims: SourceClaim[];
  /** 由程序按引用有效性与口径适配组合出来的结论。 */
  conclusions: ClaimSourceConclusion[];
  citations: ModelCitation[];
  acceptedCitations: ModelCitation[];
  citationsRejected: RejectedCitation[];
  hits: SourceHit[];
  excludedSources: ExcludedSource[];
  unresolvedItems: string[];
  noApplicableSourceReason: string | null;
  clarification: ClarificationRequest | null;
  toolCallsUsed: number;
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
  /** 未展开的主张：超过三条的部分与模型声明的部分都保留原文。 */
  omittedClaims: OmittedClaim[];
  /** 已展开的配文主张覆盖了配文的多少内容（0—1）；没有配文时为 null。 */
  captionCoverage: number | null;
  /** 配文覆盖不足或存在未展开内容时的提示；没有问题时为 null。 */
  captionCoverageNote: string | null;
}

export interface PublicSourceLibraryEntry {
  id: string;
  kind: "data-release" | "term-explanation";
  title: string;
  publisher: string;
  url: string;
  publishedAt: string;
  basis: { metric: string; period: string | null; scope: string | null };
  excerpt: string;
  fingerprint: string;
  distractor?: boolean;
  note?: string;
  measureCount: number;
  aliasCount: number;
}

export const TOOL_LABELS: Record<string, string> = {
  search_source_library: "检索资料库",
  compare_values: "比较数值",
  request_clarification: "请求确认",
  report_source_finding: "汇总结论",
};

export const CLAIM_STATUS_LABELS: Record<ClaimSourceStatus, string> = {
  "source-match": "与来源一致",
  "source-mismatch": "与来源不一致",
  "source-pending": "来源待核对",
  "inference-unsupported": "推断依据不足",
  "not-verifiable": "不支持核验",
};
