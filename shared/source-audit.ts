import {
  SOURCE_LIBRARY,
  findSupersedingDocument,
  fnv1a64,
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

/**
 * 这份材料覆盖的月份：多月份发布（`measures[].period`）逐行给出，其它材料用 `basis.period`。
 * 口径判定与检索排序共用它，避免「同一份发布里逐月数值」被当成没有月份的材料。
 */
function documentPeriods(document: SourceDocument): string[] {
  const rowPeriods = document.measures
    .map((measure) => normalizeSourcePeriod(measure.period))
    .filter((period): period is string => period !== null);
  if (rowPeriods.length > 0) return rowPeriods;
  const basisPeriod = normalizeSourcePeriod(document.basis.period);
  return basisPeriod ? [basisPeriod] : [];
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
  } else if (!documentPeriods(document).includes(queryPeriod)) {
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
    const periods = documentPeriods(document);

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
    } else if (metricOk && queryPeriod && periods.includes(queryPeriod)) {
      score += 4;
      matchReasons.push(
        document.basis.period === queryPeriod
          ? `资料适用月份为 ${document.basis.period}`
          : `资料在该月份有记载（${queryPeriod}）`,
      );
    } else if (metricOk && queryPeriod && periods.length > 0) {
      // 月份不同的官方材料仍返回，交由调用方看到并排除，不在这里隐藏。
      score += 0.5;
      matchReasons.push(`资料适用月份为 ${document.basis.period ?? periods.join("／")}，与查询月份不同`);
    }

    if (metricOk && query.scope && document.basis.scope) {
      if (normalizeText(query.scope) === normalizeText(document.basis.scope)) {
        score += 1.5;
        matchReasons.push(`范围与资料一致（${document.basis.scope}）`);
      } else {
        matchReasons.push(`资料范围为 ${document.basis.scope}，与查询不同`);
      }
    }

    // 数据发布只有在指标对得上（或查询根本没给指标）时才靠自由词加分：
    // 「口径对齐才可比」——否则别的指标的材料会因为一个通用词混进结果。
    if (matchedTerms.length > 0 && (metricOk || document.kind === "term-explanation" || !query.metric)) {
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

/**
 * 「版本复查」记录：主张所引发布的值被同系列后续发布按**官方修订声明**改写时，
 * 程序用修订后的值对照，并把前后值、官方声明原句与两份发布一并留下。
 * 这不是新的结论状态——结论仍然是五类之一，只是多了一条前后留痕。
 */
export interface RevisionReview {
  /** 主张所引的、被修订的那份发布。 */
  fromSourceId: string;
  fromTitle: string;
  fromUrl: string;
  fromPublishedAt: string;
  fromValue: number;
  /** 带修订声明、提供修订后值的后续发布。 */
  toSourceId: string;
  toTitle: string;
  toUrl: string;
  toPublishedAt: string;
  toValue: number;
  /** 官方修订声明的逐字原句。 */
  statement: string;
  /** 本次修订的发布日期。 */
  revisedAt: string;
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
  /**
   * 版本复查：所引发布的值被官方修订声明改写时，这里记修订前后值与声明原句。
   * 没有修订关系时为 null（或省略）。
   */
  revisionReview?: RevisionReview | null;
  /** 配文只写月份、程序按图上标注补全年份时的说明。 */
  periodNote: string | null;
  /** 这条主张的口径由用户补充确定时的记录；没有补充时为 null。展示时标为「用户提供」。 */
  supplement: ClaimSupplementInfo | null;
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
  /** 这条主张的用户补证记录（编排层在审计前已按规则应用到 claim 上）。 */
  supplement?: ClaimSupplementInfo | null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function measureFor(
  document: SourceDocument,
  basis: ComparisonBasis,
  period?: string | null,
): SourceMeasure | undefined {
  const candidates = document.measures.filter((measure) => measure.basis === basis);
  if (candidates.length === 0) return undefined;
  const normalizedPeriod = normalizeSourcePeriod(period ?? null);
  // 多月份发布：逐行月份必须对上，否则不能拿别月的值来核这一条。
  if (normalizedPeriod && candidates.some((measure) => measure.period !== undefined)) {
    return candidates.find((measure) => normalizeSourcePeriod(measure.period) === normalizedPeriod);
  }
  return candidates.find((measure) => measure.period === undefined) ?? candidates[0];
}

interface RevisionApplication {
  /** 提供修订后值的发布。 */
  document: SourceDocument;
  measure: SourceMeasure;
  review: RevisionReview;
}

/** 修订前后各值的一句话，用在结论摘要里。 */
function revisionSentence(review: RevisionReview): string {
  return `所引《${review.fromTitle}》（${review.fromPublishedAt}）记载的 ${formatNumber(review.fromValue)}% `
    + `已被《${review.toTitle}》（${review.toPublishedAt}）按官方修订声明修订为 ${formatNumber(review.toValue)}%`;
}

/**
 * 版本复查：所引发布若有同系列后续发布带官方修订声明，且真的改过这条主张口径上的数值，
 * 就用修订后的值对照，并留下前后记录。没有修订关系或该月份没被改动时返回 null。
 * 修订关系只依据资料里的官方声明字段，不由模型判断（与「模型提议、程序把关」同一条规则）。
 */
function applyRevision(
  cited: SourceDocument,
  citedMeasure: SourceMeasure,
  claim: SourceClaim,
): RevisionApplication | null {
  if (!claim.basis) return null;
  const superseding = findSupersedingDocument(cited.id);
  if (!superseding?.revision) return null;
  if (!evaluateApplicability(claimQueryOf(claim), superseding).applicableForValue) return null;
  const revised = measureFor(superseding, claim.basis, claim.period);
  if (!revised || revised.value === citedMeasure.value) return null;
  return {
    document: superseding,
    measure: revised,
    review: {
      fromSourceId: cited.id,
      fromTitle: cited.title,
      fromUrl: cited.url,
      fromPublishedAt: cited.publishedAt,
      fromValue: citedMeasure.value,
      toSourceId: superseding.id,
      toTitle: superseding.title,
      toUrl: superseding.url,
      toPublishedAt: superseding.publishedAt,
      toValue: revised.value,
      statement: superseding.revision.statement,
      revisedAt: superseding.revision.revisedAt,
    },
  };
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
    supplement: input.supplement ?? null,
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
    const citedMeasure = measureFor(document, claim.basis, claim.period);
    const cite = `所引国家统计局发布《${document.title}》（${document.publishedAt}）`;
    if (!citedMeasure) {
      return unsupportedInference(`所引《${document.title}》没有记载${BASIS_LABELS[claim.basis]}数值，无法核对这条推断`, [
        `所引发布未记载${BASIS_LABELS[claim.basis]}口径的数值。`,
      ]);
    }
    const revision = applyRevision(document, citedMeasure, claim);
    const measure = revision?.measure ?? citedMeasure;
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
      summary: (status === "source-match"
        ? `与${cite}一致：${joinPartDetails(parts)}。`
        : status === "source-mismatch"
          ? `与${cite}不一致：${joinPartDetails(parts)}。`
          : `推断依据不足：${joinPartDetails(parts)}；这不代表结论为假，只是现有证据还不能推出它。`)
        + (revision ? `版本复查：${revisionSentence(revision.review)}，本条按修订后值对照。` : ""),
      officialValue: measure.value,
      difference: claim.value === null ? null : Number(Math.abs(claim.value - measure.value).toFixed(2)),
      citedSourceIds: [document.id],
      parts,
      reasons: revision
        ? [`依据原句：${measure.excerpt}`, `修订声明：${revision.review.statement}（《${revision.review.toTitle}》，${revision.review.revisedAt}）`]
        : [`依据原句：${measure.excerpt}`],
      ...(revision ? { revisionReview: revision.review } : {}),
      unresolved: status === "source-mismatch"
        ? ["这条推断与所引发布的方向或数字不一致，需要复核配文使用的口径（同比／环比）与数值。"]
        : status === "inference-unsupported"
          ? [`${missingBasis}才能继续核对这条推断。`]
          : [],
    };
  }

  // 直接陈述：有数字就比对数字；只写了涨跌方向就按方向比对；两者都没有时保持待核对。
  const citedMeasure = measureFor(document, claim.basis, claim.period);
  if (!citedMeasure) {
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
  const revision = applyRevision(document, citedMeasure, claim);
  const measure = revision?.measure ?? citedMeasure;
  const revisionSuffix = revision ? `（版本复查：${revisionSentence(revision.review)}，本条按修订后值对照）` : "";
  const measureReasons = revision
    ? [`依据原句：${measure.excerpt}`, `修订声明：${revision.review.statement}（《${revision.review.toTitle}》，${revision.review.revisedAt}）`]
    : [`依据原句：${measure.excerpt}`];

  if (claim.value === null && claim.direction) {
    const comparison = directionComparison(measure, claim.direction, BASIS_LABELS[claim.basis]);
    return {
      ...base,
      status: comparison.status === "contradicted" ? "source-mismatch" : "source-match",
      summary: (comparison.status === "contradicted"
        ? `与所引国家统计局发布《${document.title}》（${document.publishedAt}）不一致：${comparison.detail}。`
        : `与所引国家统计局发布《${document.title}》（${document.publishedAt}）一致：${comparison.detail}。`) + revisionSuffix,
      officialValue: measure.value,
      difference: null,
      citedSourceIds: [document.id],
      reasons: measureReasons,
      ...(revision ? { revisionReview: revision.review } : {}),
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
    ? `与所引国家统计局发布《${document.title}》（${document.publishedAt}）记载的${BASIS_LABELS[claim.basis]} ${formatNumber(measure.value)}% 一致。${revisionSuffix}`
    : `与所引国家统计局发布《${document.title}》（${document.publishedAt}）不一致：该发布记载${BASIS_LABELS[claim.basis]} ${formatNumber(measure.value)}%，主张写 ${formatNumber(claim.value)}%，相差 ${formatNumber(difference)} 个百分点。${revisionSuffix}`;

  return {
    ...base,
    status: agrees ? "source-match" : "source-mismatch",
    summary: comparison,
    officialValue: measure.value,
    difference,
    citedSourceIds: [document.id],
    reasons: measureReasons,
    ...(revision ? { revisionReview: revision.review } : {}),
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
  /** 与 claims 一一对应的用户补证记录；没有补证的主张为 null。 */
  supplements?: readonly (ClaimSupplementInfo | null)[];
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

  const conclusions = input.claims.map((claim, index) => applySupplementToConclusion(
    concludeClaimSource({
      claim,
      citations: usableCitations,
      hits: input.hits,
      noApplicableSourceReason: input.noApplicableSourceReason,
      caption: input.caption,
      imageClaims: input.imageClaimsContext ?? input.claims.filter((entry) => entry.fromImage),
      periodNote: input.periodNotes?.[index] ?? null,
      supplement: input.supplements?.[index] ?? null,
    }),
    input.supplements?.[index] ?? null,
  ));

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

/** 补证前后同一条主张的状态变化；claimText 与状态原样保留，供页面与记录展示「为什么变」。 */
export interface ConclusionChange {
  claimText: string;
  /** 配不上对的一侧为 null；两侧都 null 不会出现。 */
  before: ClaimSourceStatus | null;
  after: ClaimSourceStatus | null;
  /** 状态未变时为 false。 */
  changed: boolean;
  /** 变化原因的简短说明：补证套用、冲突降级、重新检索改判，或主张未再汇报／补证前没有对照。 */
  reason: string;
}

/**
 * 按主张原文配对补证前后的结论，逐条给出状态变化。
 * 配不上对的主张也出行（一侧为 null 并说明原因）——对照表缺行本身就是信息，
 * 不能把「模型换了个说法」或「新增/消失的主张」静默丢掉。
 */
export function diffConclusions(
  before: readonly ClaimSourceConclusion[],
  after: readonly ClaimSourceConclusion[],
): ConclusionChange[] {
  const changes: ConclusionChange[] = [];
  const matchedAfter = new Set<number>();
  for (const prior of before) {
    const index = matchClaimIndex(after, prior.claimText);
    if (index === null) {
      changes.push({
        claimText: prior.claimText,
        before: prior.status,
        after: null,
        changed: true,
        reason: "恢复后没有再汇报这条主张，无法给出对照后的状态。",
      });
      continue;
    }
    matchedAfter.add(index);
    const current = after[index];
    const changed = prior.status !== current.status;
    let reason = "补证后重新检索并核对，状态未变。";
    if (changed) {
      if (current.supplement?.conflict) {
        reason = `用户补充与图文写明的${CLARIFICATION_FIELD_LABELS[current.supplement.field]}冲突，降为待核对。`;
      } else if (current.supplement?.applied) {
        reason = `用户补充确定了${CLARIFICATION_FIELD_LABELS[current.supplement.field]}，据此重新核对。`;
      } else {
        reason = "补证后重新检索，命中材料变化导致状态改变。";
      }
    }
    changes.push({
      claimText: current.claimText,
      before: prior.status,
      after: current.status,
      changed,
      reason,
    });
  }
  for (const [index, current] of after.entries()) {
    if (matchedAfter.has(index)) continue;
    changes.push({
      claimText: current.claimText,
      before: null,
      after: current.status,
      changed: true,
      reason: "补证后新增的主张，补证前没有可对照的状态。",
    });
  }
  return changes;
}

/**
 * 把用户补证叠加到程序已组合出的结论上：
 * 冲突时降为「来源待核对」并同时保留图上／配文侧与用户侧内容、请求更正；
 * 填入口径时在依据里注明该口径来自用户补充，不改变其余结论逻辑。
 * 观点类不受影响——补证不给观点引入真假判定。
 */
export function applySupplementToConclusion(
  conclusion: ClaimSourceConclusion,
  supplement: ClaimSupplementInfo | null,
): ClaimSourceConclusion {
  if (!supplement) return conclusion;
  const fieldLabelText = CLARIFICATION_FIELD_LABELS[supplement.field];

  if (supplement.conflict) {
    const conflict = supplement.conflict;
    if (conclusion.claimKind === "opinion") return { ...conclusion, supplement };
    return {
      ...conclusion,
      supplement,
      status: "source-pending",
      summary: `来源待核对：用户补充的${fieldLabelText}与图上／配文写明的内容冲突，双方内容都已保留；请更正补充输入或确认以原文为准后再核验。`,
      officialValue: null,
      difference: null,
      reasons: [
        `图上／配文写明：${conflict.fromImage}`,
        `用户补充：${conflict.fromUser}（用户提供，仅用于确定口径，不是官方来源）`,
      ],
      unresolved: [
        ...conclusion.unresolved,
        `用户补充的${fieldLabelText}与图文内容不一致，请更正补充输入或确认以原文为准。`,
      ],
    };
  }

  if (supplement.applied) {
    return {
      ...conclusion,
      supplement,
      reasons: [
        ...conclusion.reasons,
        `${fieldLabelText}「${displayFieldValue(supplement.field, supplement.normalized)}」由用户补充确定`
        + "（用户提供，仅用于确定口径，不是官方来源）。",
      ],
    };
  }

  return { ...conclusion, supplement };
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

/** 追问针对的口径字段；补证回答也按同一字段解析。 */
export type ClarificationField = "period" | "scope" | "metric" | "basis" | "value";

export const CLARIFICATION_FIELD_LABELS: Record<ClarificationField, string> = {
  period: "月份",
  scope: "范围",
  metric: "指标",
  basis: "比较方式",
  value: "数值",
};

export interface ClarificationRequest {
  question: string;
  purpose: string;
  field: ClarificationField;
  /** 这个问题影响哪条主张（配文或图上的原文）；模型没给出时为 null。 */
  claimText: string | null;
}

/**
 * 解析用户对追问的回答，得到可写入口径的规范值。
 * 解析失败只意味着这次补充用不上，不能靠模糊匹配猜出一个口径。
 */
export type ParsedClarificationAnswer =
  | { ok: true; field: ClarificationField; value: string }
  | { ok: false; reason: string };

export function parseClarificationAnswer(field: ClarificationField, raw: string): ParsedClarificationAnswer {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "回答不能为空。" };
  switch (field) {
    case "period": {
      const period = normalizeSourcePeriod(text);
      if (!period) return { ok: false, reason: "无法从回答里读出完整的年月（需要形如 2026 年 5 月）。" };
      return { ok: true, field, value: period };
    }
    case "basis": {
      const normalized = normalizeText(text);
      const isYoy = normalized.includes("同比") || normalized.includes("year-on-year");
      const isMom = normalized.includes("环比") || normalized.includes("month-on-month") || normalized.includes("比上月");
      // 同时出现两种口径时无法确定，猜一个会把结论建立在猜测上。
      if (isYoy === isMom) return { ok: false, reason: "无法从回答里确定是比较同比还是环比。" };
      return { ok: true, field, value: isYoy ? "year-on-year" : "month-on-month" };
    }
    case "value": {
      const matched = text.match(/-?\d+(?:\.\d+)?/);
      if (!matched) return { ok: false, reason: "无法从回答里读出数值。" };
      return { ok: true, field, value: String(Number(matched[0])) };
    }
    case "scope":
    case "metric":
      if (text.length > 80) return { ok: false, reason: "回答过长，范围或指标请控制在 80 字以内。" };
      return { ok: true, field, value: text };
  }
}

/** 补证在单条主张上的落点：填入、无冲突一致，或与图文明确内容冲突。 */
export interface ClaimSupplementInfo {
  field: ClarificationField;
  /** 用户回答的原话。 */
  raw: string;
  /** 解析后的口径值。 */
  normalized: string;
  /** true 表示图文没写这个口径、由用户补充填进了这条主张。 */
  applied: boolean;
  /** 与图上／配文明确写出的内容冲突时保留的双方取值；无冲突为 null。 */
  conflict: { fromImage: string; fromUser: string } | null;
}

export interface SupplementConflict {
  claimText: string;
  field: ClarificationField;
  fromImage: string;
  fromUser: string;
}

/** 一次补证恢复的完整记录；随恢复段结果返回并展示。 */
export interface SupplementRecord {
  question: string;
  purpose: string;
  field: ClarificationField;
  /** 追问指向的主张原文；模型没给出时为 null。 */
  claimText: string | null;
  /** 用户回答原话，展示时标为「用户提供」。 */
  answer: string;
  /** 解析后的口径值；无法解析时为 null（此时不应用到任何主张）。 */
  normalized: string | null;
  /** 至少有一条主张的口径由这次补充填入。 */
  applied: boolean;
  conflicts: SupplementConflict[];
  /** 回答无法解析为该字段规范值时的原因；成功解析为 null。 */
  parseNote: string | null;
  /** 面向展示的一句说明。 */
  note: string;
}

function displayFieldValue(field: ClarificationField, value: string): string {
  if (field === "basis") return BASIS_LABELS[value as ComparisonBasis] ?? value;
  return value;
}

function valuesEqual(field: ClarificationField, left: string | number | null | undefined, right: string): boolean {
  if (left === null || left === undefined) return false;
  if (field === "value") return Number(left) === Number(right);
  if (field === "basis") return String(left) === right;
  if (field === "period") {
    const leftPeriod = normalizeSourcePeriod(String(left));
    return leftPeriod ? leftPeriod === right : normalizeText(String(left)) === normalizeText(right);
  }
  return normalizeText(String(left)) === normalizeText(right);
}

/** 在主张列表里按原文找目标：先精确归一匹配，再退到较高的文字重合度。 */
function matchClaimIndex(claims: readonly { claimText: string }[], text: string | null | undefined): number | null {
  if (!text?.trim()) return null;
  const target = normalizeClaimText(text);
  if (!target) return null;
  for (const [index, claim] of claims.entries()) {
    if (normalizeClaimText(claim.claimText) === target) return index;
  }
  let bestIndex: number | null = null;
  let bestCoverage = 0;
  for (const [index, claim] of claims.entries()) {
    const { coverage } = bigramCoverage(claim.claimText, text);
    if (coverage > bestCoverage) {
      bestCoverage = coverage;
      bestIndex = index;
    }
  }
  return bestCoverage >= 0.6 ? bestIndex : null;
}

/** 某条主张在该口径字段上是否有缺口（没写、或 basis 在原文里也没写明）。 */
function hasFieldGap(claim: SourceClaim, field: ClarificationField, caption: string | null | undefined): boolean {
  const value = claim[field as keyof SourceClaim];
  if (value !== null && value !== undefined) return false;
  if (field === "basis") {
    const originText = claim.fromImage ? claim.imageExcerpt : caption;
    return statedBasisIn(originText) === null;
  }
  return true;
}

/**
 * 追问没带 claimText 时的目标回退：只在补证前的主张里恰好有一条存在该口径缺口时采用它；
 * 多条缺口或没有缺口都不猜——猜错会把口径填到别的主张上。
 */
export function resolveSupplementTarget(
  priorClaims: readonly SourceClaim[],
  field: ClarificationField,
  claimText: string | null | undefined,
  caption?: string | null,
): string | null {
  if (claimText?.trim()) return claimText;
  const gaps = priorClaims.filter((claim) => hasFieldGap(claim, field, caption));
  return gaps.length === 1 ? gaps[0].claimText : null;
}

export interface ApplySupplementResult {
  claims: SourceClaim[];
  /** 与返回的 claims 一一对应；未受补证影响的主张为 null。 */
  infos: Array<ClaimSupplementInfo | null>;
  appliedClaimTexts: string[];
  conflicts: SupplementConflict[];
}

export interface ApplySupplementOptions {
  claims: readonly SourceClaim[];
  /** 补证前那次调查读到的主张：它是「图文明确写没写这个口径」的依据。 */
  priorClaims: readonly SourceClaim[];
  field: ClarificationField;
  rawAnswer: string;
  /** parseClarificationAnswer 的结果；解析失败时不应用到任何主张。 */
  normalized: string | null;
  targetClaimText: string | null;
  /** 配文原文；模型没填 basis 时用于识别配文明写的比较方式。 */
  caption?: string | null;
}

/** 文本里明写的比较方式；同时出现两种或都没写时返回 null。 */
function statedBasisIn(text: string | null | undefined): ComparisonBasis | null {
  const isYoy = basisMentionedInImage(text, "year-on-year");
  const isMom = basisMentionedInImage(text, "month-on-month");
  return isYoy === isMom ? null : isYoy ? "year-on-year" : "month-on-month";
}

/**
 * 把用户补充按字段应用到追问指向的那条主张：
 * 图文没写 → 填入并标为用户提供；已写且一致 → 不改；已写但不同 → 不覆盖图文，保留双方并记为冲突。
 * 「图文写没写」以补证前的读数为准；basis 还会回看配文／图上原文（模型可能漏填）。
 * 拿不到补证前读数（无法匹配同一条主张）时不应用——没有依据判断哪边是图文内容。
 */
export function applySupplementToClaims(options: ApplySupplementOptions): ApplySupplementResult {
  const infos: Array<ClaimSupplementInfo | null> = options.claims.map(() => null);
  const claims = options.claims.map((claim) => ({ ...claim }));
  if (!options.normalized) {
    return { claims, infos, appliedClaimTexts: [], conflicts: [] };
  }

  const currentIndex = matchClaimIndex(claims, options.targetClaimText);
  const priorIndex = matchClaimIndex(options.priorClaims, options.targetClaimText);
  if (currentIndex === null || priorIndex === null) {
    return { claims, infos, appliedClaimTexts: [], conflicts: [] };
  }

  const fieldKey = options.field as keyof SourceClaim;
  const priorClaim = options.priorClaims[priorIndex];
  const rawPriorValue = priorClaim[fieldKey] as string | number | null | undefined;
  let priorValue = rawPriorValue;
  if ((priorValue === null || priorValue === undefined) && options.field === "basis") {
    // 模型可能没填 basis，但配文或图上抄录里明写了比较方式——那也算图文内容。
    const originText = priorClaim.fromImage ? priorClaim.imageExcerpt : options.caption;
    priorValue = statedBasisIn(originText);
  }
  const info: ClaimSupplementInfo = {
    field: options.field,
    raw: options.rawAnswer.trim(),
    normalized: options.normalized,
    applied: false,
    conflict: null,
  };

  if (priorValue === null || priorValue === undefined) {
    const claim = claims[currentIndex];
    (claim as Record<string, unknown>)[fieldKey] = options.field === "value"
      ? Number(options.normalized)
      : options.normalized;
    info.applied = true;
    infos[currentIndex] = info;
    return { claims, infos, appliedClaimTexts: [claim.claimText], conflicts: [] };
  }

  if (valuesEqual(options.field, priorValue, options.normalized)) {
    infos[currentIndex] = info;
    return { claims, infos, appliedClaimTexts: [], conflicts: [] };
  }

  // 冲突：不覆盖图文明确写出的值，把它恢复为补证前模型的读数，并保留双方。
  claims[currentIndex][fieldKey] = rawPriorValue as never;
  info.conflict = {
    fromImage: displayFieldValue(options.field, String(priorValue)),
    fromUser: displayFieldValue(options.field, options.normalized),
  };
  infos[currentIndex] = info;
  return {
    claims,
    infos,
    appliedClaimTexts: [],
    conflicts: [{
      claimText: claims[currentIndex].claimText,
      field: options.field,
      ...info.conflict,
    }],
  };
}

// —— 修改建议：只基于当前有效主张与已采用的证据，逐处关联原句、修改内容、理由与引用 ——

/** 建议配文里一处改动的类型。 */
export type CaptionChangeKind = "replace-value" | "keep-qualified" | "suggest-delete" | "unchanged";

export const CAPTION_CHANGE_LABELS: Record<CaptionChangeKind, string> = {
  "replace-value": "替换数值",
  "keep-qualified": "保留并限定",
  "suggest-delete": "建议删除",
  unchanged: "保留原句",
};

/** 未解决主张在建议里保留限定时追加的限定语。 */
export const CAPTION_QUALIFIERS: Partial<Record<ClaimSourceStatus, string>> = {
  "source-pending": "（暂未核实）",
  "inference-unsupported": "（现有证据不足以支持这项推断）",
};

/** 与所引发布不一致、又无法机械改正时给出的限定语。 */
export const CAPTION_MISMATCH_QUALIFIER = "（与所引发布不一致，需核对）";

/** 出现这些词说明建议仍在做因果或加强断言；原配文里没有就不允许新增。 */
const CAUSAL_MARKERS = [
  "导致", "造成", "引发", "使得", "说明", "表明", "意味着", "因为", "由于", "因此", "所以", "证明", "证实", "必然", "势必",
];

/** 程度或规模的加强表述；原文没有就不允许新增（例如「创下新高」）。 */
const STRENGTHENING_MARKERS = [
  "创下", "新高", "新低", "最大", "最小", "最高", "最低", "首次", "史上", "明显", "大幅", "显著",
];

/** 中文数字写出的时间或倍数范围（例如「近三年」「两个月」「两倍」）；原配文里没有就不许引入。 */
function introducedChineseAmounts(text: string, caption: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/[一二三四五六七八九十百千万亿几]{1,6}\s*(?:年|个月|月|周|天|倍|成|个百分点)/g)) {
    const token = match[0].trim();
    if (!caption.includes(token)) found.add(token);
  }
  return [...found];
}

/** 保留限定时的限定词；未解决主张的改写必须带上其中之一。 */
const HEDGE_MARKERS = [
  "未核实", "待核实", "暂无法", "尚无", "不确定", "据图", "未注明", "无法核对", "仅供参考", "存疑", "未证实", "证据不足",
];

/** 断言方向在文本里的常见写法；用于检查建议没有保留与来源相反的方向。 */
const DIRECTION_MARKERS: Record<ClaimDirection, string[]> = {
  up: ["上涨", "上升", "走高", "变贵", "涨价", "增加", "更高"],
  down: ["下降", "下跌", "走低", "便宜", "降价", "减少", "更低"],
};

/** 范围词的候选词表；按长度从长到短匹配，避免「全国城市」被拆成「全国」。 */
const SCOPE_CANDIDATES = ["全国城市", "全国农村", "农村", "城镇", "城市", "全国"];

/** 文本里的完整月份与只写月份的写法，用于检查建议没有引入未覆盖的月份。 */
function monthTokensOf(text: string | null | undefined): { periods: Set<string>; months: Set<string> } {
  const source = text ?? "";
  const periods = new Set<string>();
  const months = new Set<string>();
  const covered: Array<[number, number]> = [];
  const full = /((?:19|20)\d{2})\s*(?:年\s*(0?[1-9]|1[0-2])\s*月|[-/.]\s*(0?[1-9]|1[0-2])(?:\s*[-/.]\s*\d{1,2})?)/g;
  for (const match of source.matchAll(full)) {
    const month = (match[2] ?? match[3] ?? "").padStart(2, "0");
    periods.add(`${match[1]}-${month}`);
    months.add(month);
    covered.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }
  for (const match of source.matchAll(/(0?[1-9]|1[0-2])\s*月/g)) {
    const index = match.index ?? 0;
    if (covered.some(([start, end]) => index >= start && index < end)) continue;
    months.add(match[1].padStart(2, "0"));
  }
  return { periods, months };
}

/** 文本里出现的范围词；按候选表从长到短返回。 */
function scopeTokensOf(text: string | null | undefined): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return SCOPE_CANDIDATES.filter((candidate) => normalized.includes(normalizeText(candidate)));
}

/** 允许出现的范围词：原配文、本次主张与所引来源里写过的都算，其余视为新引入。 */
function allowedScopesOf(caption: string, claims: readonly SourceClaim[], documents: readonly SourceDocument[]): string[] {
  const allowed = new Set<string>();
  const add = (text: string | null | undefined) => {
    for (const scope of scopeTokensOf(text)) allowed.add(scope);
  };
  add(caption);
  for (const claim of claims) {
    add(claim.claimText);
    add(claim.imageExcerpt);
    add(claim.scope);
    add(`${claim.metric ?? ""} ${claim.period ?? ""}`);
  }
  for (const document of documents) {
    add(document.basis.scope);
    add(document.title);
    add(document.excerpt);
  }
  return [...allowed];
}

/** 建议里出现的、不在允许集合内的范围词。 */
function introducedScopes(text: string, allowed: string[]): string[] {
  const matched: string[] = [];
  const introduced: string[] = [];
  for (const scope of scopeTokensOf(text)) {
    if (matched.some((entry) => entry.includes(scope))) continue;
    matched.push(scope);
    if (!allowed.includes(scope)) introduced.push(scope);
  }
  return introduced;
}

/** 该主张断言的涨跌方向在文本里对应哪些写法。 */
function assertedDirectionMarkers(text: string, direction: ClaimDirection): string[] {
  return DIRECTION_MARKERS[direction].filter((marker) => text.includes(marker));
}

/** 所引发布的方向：只在主张自己断言了方向、且所引发布有数值时给出。 */
function sourceDirectionFor(claim: SourceClaim, conclusion: ClaimSourceConclusion): ClaimDirection | null {
  if (!claim.direction || conclusion.officialValue === null) return null;
  if (Math.abs(conclusion.officialValue) <= DIRECTION_EPSILON) return null;
  return conclusion.officialValue > 0 ? "up" : "down";
}

/** 这条改动的校验上下文：当前主张、它的结论、配文与本次已采用的证据。 */
export interface CaptionChangeContext {
  caption: string;
  claim: SourceClaim;
  conclusion: ClaimSourceConclusion;
  /** 本次核验的全部主张（图内主张的数值也属于已有内容）。 */
  claims: readonly SourceClaim[];
  hits: readonly SourceHit[];
  acceptedCitations: readonly ModelCitation[];
}

function citedDocumentsOf(context: CaptionChangeContext): SourceDocument[] {
  const acceptedIds = new Set(context.acceptedCitations.map((citation) => citation.sourceId));
  return context.hits
    .filter((hit) => acceptedIds.has(hit.document.id))
    .map((hit) => hit.document);
}

/** 允许出现的数值：原配文、本次主张与所引来源里写过的值；其余都是未覆盖的新数值。 */
function allowedNumbersOf(context: CaptionChangeContext): Set<number> {
  const allowed = new Set<number>();
  for (const value of numberValuesOf(context.caption)) allowed.add(value);
  for (const claim of context.claims) {
    for (const text of [claim.claimText, claim.imageExcerpt, claim.period, claim.scope, claim.metric]) {
      for (const value of numberValuesOf(text)) allowed.add(value);
    }
    if (claim.value !== null && claim.value !== undefined) allowed.add(claim.value);
  }
  for (const document of citedDocumentsOf(context)) {
    for (const measure of document.measures) allowed.add(measure.value);
    for (const text of [document.excerpt, document.basis.period, document.title]) {
      for (const value of numberValuesOf(text)) allowed.add(value);
    }
  }
  return allowed;
}

export interface CaptionChangeValidation {
  ok: boolean;
  violations: string[];
}

/**
 * 逐处校验一条改写：只允许使用原配文、本次主张与所引来源里已有的数值、月份与范围，
 * 不允许新增因果或加强表述，也不允许把未解决的主张写成确定表述、把不一致的内容原样保留。
 * 模型只提议，这里是程序把关；不通过就退回程序按结论生成的兜底建议。
 */
export function validateCaptionChangeText(text: string, context: CaptionChangeContext): CaptionChangeValidation {
  const violations: string[] = [];
  const { claim, conclusion, caption } = context;
  const trimmed = text.trim();
  const isDelete = trimmed.length === 0;
  const sameAsClaim = !isDelete && normalizeClaimText(trimmed) === normalizeClaimText(claim.claimText);

  if (!isDelete) {
    const allowedNumbers = allowedNumbersOf(context);
    const introducedNumbers = [...new Set(numberValuesOf(trimmed))].filter((value) => !allowedNumbers.has(value));
    for (const value of introducedNumbers) {
      violations.push(`建议里的数值 ${formatNumber(value)} 不在原配文、本次主张或所引来源里，不能引入证据未覆盖的数值。`);
    }

    const allowedMonths = monthTokensOf([
      caption,
      ...context.claims.map((entry) => [entry.claimText, entry.period, entry.imageExcerpt].join(" ")),
      ...citedDocumentsOf(context).map((document) => [document.basis.period, document.title, document.excerpt].join(" ")),
    ].join(" "));
    const usedMonths = monthTokensOf(trimmed);
    for (const period of usedMonths.periods) {
      if (!allowedMonths.periods.has(period)) {
        violations.push(`建议里的月份 ${period} 不在原配文、本次主张或所引来源里，不能引入证据未覆盖的月份。`);
      }
    }
    for (const month of usedMonths.months) {
      if (!allowedMonths.months.has(month)) {
        violations.push(`建议里的「${Number(month)} 月」不在原配文、本次主张或所引来源里，不能引入证据未覆盖的月份。`);
      }
    }

    for (const scope of introducedScopes(trimmed, allowedScopesOf(caption, context.claims, citedDocumentsOf(context)))) {
      violations.push(`建议里的范围「${scope}」不在原配文、本次主张或所引来源里，不能引入证据未覆盖的范围。`);
    }

    for (const marker of CAUSAL_MARKERS) {
      if (trimmed.includes(marker) && !caption.includes(marker)) {
        violations.push(`建议新增了原配文没有的因果或加强表述「${marker}」。`);
      }
    }
    for (const marker of STRENGTHENING_MARKERS) {
      if (trimmed.includes(marker) && !caption.includes(marker)) {
        violations.push(`建议新增了原配文没有的程度加强表述「${marker}」。`);
      }
    }
    for (const token of introducedChineseAmounts(trimmed, caption)) {
      violations.push(`建议新增了原配文没有的范围或倍数表述「${token}」。`);
    }

    const proposalBasis = statedBasisIn(trimmed);
    if (proposalBasis && proposalBasis !== claim.basis) {
      violations.push(claim.basis
        ? `建议把比较方式改成了${BASIS_LABELS[proposalBasis]}，与原文的${BASIS_LABELS[claim.basis]}不同；改正错误值应保持在原口径内。`
        : "原文没有写明比较方式，建议不替它补一个口径（这正是需要用户确认的部分）。");
    }
  }

  if (conclusion.status === "source-match") {
    if (!sameAsClaim) violations.push("这条主张与所引来源一致，建议保留原句；不采用改写提议。");
  } else if (conclusion.status === "not-verifiable") {
    if (!isDelete && !sameAsClaim) {
      violations.push("观点或超出数据的判断不做真假改写，只能保留原句或建议删除。");
    }
  } else if (conclusion.status === "source-mismatch") {
    if (!isDelete) {
      if (sameAsClaim) {
        violations.push("与所引发布不一致的内容不能原样保留，必须改正为所引来源的数值／方向，或建议删除。");
      }
      const official = conclusion.officialValue;
      if (claim.value !== null && official !== null) {
        if (numberValuesOf(trimmed).includes(claim.value)) {
          violations.push(`建议仍保留了与来源不一致的数值 ${formatNumber(claim.value)}%。`);
        }
        if (!numberValuesOf(trimmed).includes(official)) {
          violations.push(`建议没有用所引发布的正确数值 ${formatNumber(official)}% 替换原文错误值。`);
        }
      }
      const sourceDirection = sourceDirectionFor(claim, conclusion);
      if (sourceDirection) {
        const wrongMarker = assertedDirectionMarkers(trimmed, sourceDirection === "up" ? "down" : "up")
          .find((marker) => trimmed.includes(marker));
        if (wrongMarker) {
          violations.push(`建议仍保留了与所引发布相反的方向表述「${wrongMarker}」。`);
        }
        if (claim.value === null && official !== null) {
          const hasCorrectDirection = assertedDirectionMarkers(trimmed, sourceDirection).length > 0;
          if (!hasCorrectDirection && !numberValuesOf(trimmed).includes(official)) {
            violations.push(`建议没有写出所引发布记载的方向或数值（${formatNumber(official)}%）。`);
          }
        }
      }
    }
  } else if (!isDelete) {
    // 未解决（来源待核对／推断依据不足）：必须保留限定或建议删除，不能原样当成确定表述。
    const hedged = HEDGE_MARKERS.some((marker) => trimmed.includes(marker));
    const alreadyHedged = HEDGE_MARKERS.some((marker) => claim.claimText.includes(marker));
    if (!hedged && !(sameAsClaim && alreadyHedged)) {
      violations.push("这条主张还没有得到适用来源支持：改写必须保留限定（例如「暂未核实」）或建议删除。");
    }
  }

  return { ok: violations.length === 0, violations };
}

/** 模型在汇总里提出的一条改写提议；程序会逐条校验，不合格的不被采用。 */
export interface CaptionRewriteProposal {
  claimText: string;
  suggestedText: string;
  reason: string;
}

/** 建议配文里的一处改动：原句、建议、理由、当前有效引用与处理方式。 */
export interface CaptionSuggestionChange {
  /** 关联的主张原文。 */
  claimText: string;
  /** 原句在配文里的片段；定位不到时为 null。 */
  original: string | null;
  /** 建议文本；建议删除时为空字符串。 */
  suggested: string;
  kind: CaptionChangeKind;
  reason: string;
  /** 这条改动依据的当前有效引用（程序校验通过的 sourceId）。 */
  sourceIds: string[];
  status: ClaimSourceStatus;
  /** 改动由模型提议还是程序按结论生成。 */
  origin: "model" | "program";
  /** 模型提议未通过校验时的原因；通过或由程序生成时为 null。 */
  rejectedReason: string | null;
  /** 是否已并入建议配文（定位不到或与别处重叠时不并入）。 */
  applied: boolean;
}

export interface CaptionSuggestion {
  /** 生成这条建议时的原配文快照。 */
  caption: string;
  suggestedCaption: string;
  changes: CaptionSuggestionChange[];
  /** 模型提出但未通过程序校验的改写提议，逐条保留原因。 */
  rejectedProposals: Array<{ claimText: string; suggestedText: string; reason: string; rejectedReason: string }>;
  /** 未改动但需要提醒的内容：未展开、覆盖不足、观点、定位失败等。 */
  notes: string[];
  /** 生成依据的快照指纹：配文、结论状态与有效引用一变即不同。 */
  fingerprint: string;
}

export interface BuildCaptionSuggestionInput {
  caption: string;
  claims: readonly SourceClaim[];
  /** 与 claims 一一对应的结论。 */
  conclusions: readonly ClaimSourceConclusion[];
  hits: readonly SourceHit[];
  acceptedCitations: readonly ModelCitation[];
  proposals?: readonly CaptionRewriteProposal[];
  /** 编排层已有的边界提示（未展开内容、覆盖不足），原样并入建议说明。 */
  notes?: readonly string[];
}

/** 建议依据的快照指纹；页面据此标明新旧，上游一变旧建议不再代表当前结果。 */
export function captionSuggestionFingerprint(input: {
  caption: string;
  conclusions: readonly ClaimSourceConclusion[];
  acceptedCitations: readonly ModelCitation[];
}): string {
  return fnv1a64(JSON.stringify([
    input.caption,
    input.conclusions.map((conclusion) => [conclusion.claimText, conclusion.status, conclusion.citedSourceIds]),
    input.acceptedCitations.map((citation) => [citation.sourceId, citation.role]),
  ]));
}

/** 替换原文片段时要求的位置匹配下限：只有几乎整句都能在配文里找到才敢替换。 */
const CAPTION_SPAN_MIN_COVERAGE = 0.9;

/**
 * 在配文原文里定位一条主张对应的片段；定位不到时不猜位置。
 * 这里是替换原文用的位置，匹配要求比「主张能否追溯」更严：部分重合（例如只共用一个「月 CPI」）
 * 替换下去会把配文改成另一句话。
 */
export function locateCaptionSpan(caption: string, claimText: string): { start: number; end: number; matchedRun: string } | null {
  const { text: normalized, map } = normalizeClaimTextWithMap(caption);
  const claimNormalized = normalizeClaimText(claimText);
  if (!normalized || !claimNormalized) return null;
  const run = longestCommonRun(normalized, claimNormalized);
  if (run.length === 0 || run.length / claimNormalized.length < CAPTION_SPAN_MIN_COVERAGE) return null;
  const start = map[run.start];
  const end = map[run.start + run.length - 1] + 1;
  return { start, end, matchedRun: caption.slice(start, end) };
}

/** 片段后面紧跟的句末标点；替换时用它处理句号重复或删除整句。 */
function sentenceTerminatorAfter(caption: string, end: number): string {
  const character = caption.slice(end, end + 1);
  return /[。！？]/.test(character) ? character : "";
}

/** 替换文本本身是否已经以句末标点收尾。 */
function endsWithTerminator(text: string): boolean {
  return /[。！？]$/.test(text.trim());
}

/** 程序按结论为一条主张生成的兜底改动。 */
function programChangeFor(
  claim: SourceClaim,
  conclusion: ClaimSourceConclusion,
): { text: string; kind: CaptionChangeKind; reason: string } {
  const basisLabel = claim.basis ? BASIS_LABELS[claim.basis] : null;
  const cited = conclusion.citedSourceIds.length > 0 ? conclusion.citedSourceIds.join("、") : null;

  if (conclusion.status === "source-match") {
    return {
      text: claim.claimText,
      kind: "unchanged",
      reason: `所引来源与这条主张的口径和数值一致${cited ? `（引用：${cited}）` : ""}，保留原句。`,
    };
  }

  if (conclusion.status === "not-verifiable") {
    return {
      text: claim.claimText,
      kind: "unchanged",
      reason: "观点或超出数据的判断不支持核验，保留原句，不做真假改写。",
    };
  }

  if (conclusion.status === "source-mismatch") {
    const official = conclusion.officialValue;
    if (claim.value !== null && official !== null) {
      // 用所引发布的同口径正确数值替换原文错误值；只替换第一个出现的该数值。
      let replaced = false;
      const text = claim.claimText.replace(/\d+(?:\.\d+)?/g, (token) => {
        if (!replaced && Number(token) === claim.value) {
          replaced = true;
          return formatNumber(official);
        }
        return token;
      });
      if (replaced) {
        return {
          text,
          kind: "replace-value",
          reason: `所引发布记载${basisLabel ?? "该口径"} ${formatNumber(official)}%，原文写 ${formatNumber(claim.value)}%，建议改为 ${formatNumber(official)}%。`,
        };
      }
    }
    const sourceDirection = sourceDirectionFor(claim, conclusion);
    if (claim.direction && sourceDirection && official !== null) {
      const marker = assertedDirectionMarkers(claim.claimText, claim.direction)[0];
      if (marker) {
        return {
          text: claim.claimText.replace(
            marker,
            `${DIRECTION_LABELS[sourceDirection]} ${formatNumber(official)}%`,
          ),
          kind: "replace-value",
          reason: `所引发布记载${basisLabel ?? "该口径"} ${formatNumber(official)}%（${DIRECTION_LABELS[sourceDirection]}），与原文断言的「${DIRECTION_LABELS[claim.direction]}」相反，建议改为「${DIRECTION_LABELS[sourceDirection]} ${formatNumber(official)}%」。`,
        };
      }
    }
    return {
      text: `${claim.claimText}${CAPTION_MISMATCH_QUALIFIER}`,
      kind: "keep-qualified",
      reason: "这条主张与所引发布不一致，但没有可以机械替换的数值或方向，建议核对后改写或删除。",
    };
  }

  // source-pending / inference-unsupported：保留限定或建议删除，不能写成确定表述。
  const qualifier = CAPTION_QUALIFIERS[conclusion.status] ?? "（暂未核实）";
  const alreadyHedged = HEDGE_MARKERS.some((marker) => claim.claimText.includes(marker));
  const detail = conclusion.unresolved[0] ?? conclusion.summary;
  return {
    text: alreadyHedged ? claim.claimText : `${claim.claimText}${qualifier}`,
    kind: "keep-qualified",
    reason: `${CLAIM_STATUS_LABELS[conclusion.status]}：${detail}建议保留限定或删除，不要按确定表述发布。`,
  };
}

/** 改动类型：删除、原样保留、按来源改正，或保留并限定。 */
function deriveChangeKind(text: string, claim: SourceClaim, conclusion: ClaimSourceConclusion): CaptionChangeKind {
  const trimmed = text.trim();
  if (!trimmed) return "suggest-delete";
  if (normalizeClaimText(trimmed) === normalizeClaimText(claim.claimText)) {
    // 未解决的主张即使原样保留也按「保留并限定」计，避免被读成确定表述。
    return conclusion.status === "source-match" || conclusion.status === "not-verifiable"
      ? "unchanged"
      : "keep-qualified";
  }
  return conclusion.status === "source-mismatch" ? "replace-value" : "keep-qualified";
}

/**
 * 生成一条建议配文：只处理本次已核验的配文主张，逐处关联原句、建议、理由与当前有效引用。
 * 模型提议先过逐处校验，不合格的退回程序兜底并保留拒绝原因；
 * 未解决的主张保留限定或建议删除；无法定位原句的改动不并入建议配文，单列说明。
 */
export function buildCaptionSuggestion(input: BuildCaptionSuggestionInput): CaptionSuggestion {
  const caption = input.caption;
  const proposals = [...(input.proposals ?? [])];
  const notes: string[] = [...(input.notes ?? [])];
  const rejectedProposals: CaptionSuggestion["rejectedProposals"] = [];
  const changes: CaptionSuggestionChange[] = [];

  const pairs = input.claims
    .map((claim, index) => ({ claim, conclusion: input.conclusions[index] ?? null }))
    .filter((entry): entry is { claim: SourceClaim; conclusion: ClaimSourceConclusion } =>
      !entry.claim.fromImage && entry.conclusion !== null);

  // 提议按主张原文归位：同一条主张只采用第一条，其余与对不上主张的提议都记进拒绝列表，不静默丢弃。
  const proposalsByClaim = new Map<number, CaptionRewriteProposal[]>();
  for (const proposal of proposals) {
    if (!proposal.claimText.trim()) {
      rejectedProposals.push({
        claimText: proposal.claimText,
        suggestedText: proposal.suggestedText,
        reason: proposal.reason,
        rejectedReason: "这条提议没有写清针对哪条主张，未采用。",
      });
      continue;
    }
    if (!proposal.reason.trim()) {
      rejectedProposals.push({
        claimText: proposal.claimText,
        suggestedText: proposal.suggestedText,
        reason: proposal.reason,
        rejectedReason: "这条提议没有写理由，未采用。",
      });
      continue;
    }
    const target = matchClaimIndex(pairs.map((entry) => entry.claim), proposal.claimText);
    if (target === null) {
      rejectedProposals.push({
        claimText: proposal.claimText,
        suggestedText: proposal.suggestedText,
        reason: proposal.reason,
        rejectedReason: "这条提议没有对应的已核验配文主张（可能主张没有展开或原文对不上），未采用。",
      });
      continue;
    }
    proposalsByClaim.set(target, [...(proposalsByClaim.get(target) ?? []), proposal]);
  }

  for (const [pairIndex, { claim, conclusion }] of pairs.entries()) {
    const fallback = programChangeFor(claim, conclusion);
    let text = fallback.text;
    let kind = fallback.kind;
    let reason = fallback.reason;
    let origin: CaptionSuggestionChange["origin"] = "program";
    let rejectedReason: string | null = null;

    const claimProposals = proposalsByClaim.get(pairIndex) ?? [];
    const proposal = claimProposals[0] ?? null;
    for (const duplicate of claimProposals.slice(1)) {
      rejectedProposals.push({
        claimText: duplicate.claimText,
        suggestedText: duplicate.suggestedText,
        reason: duplicate.reason,
        rejectedReason: "同一条主张有多条改写提议，只采用第一条；这条未被采用。",
      });
    }
    if (proposal) {
      const validation = validateCaptionChangeText(proposal.suggestedText, {
        caption,
        claim,
        conclusion,
        claims: input.claims,
        hits: input.hits,
        acceptedCitations: input.acceptedCitations,
      });
      if (validation.ok) {
        text = proposal.suggestedText.trim();
        kind = deriveChangeKind(text, claim, conclusion);
        reason = proposal.reason;
        origin = "model";
      } else {
        rejectedReason = validation.violations.join(" ");
        rejectedProposals.push({
          claimText: proposal.claimText,
          suggestedText: proposal.suggestedText,
          reason: proposal.reason,
          rejectedReason,
        });
      }
    }

    const span = locateCaptionSpan(caption, claim.claimText);
    changes.push({
      claimText: claim.claimText,
      original: span ? `${span.matchedRun}${sentenceTerminatorAfter(caption, span.end)}` : null,
      suggested: text,
      kind,
      reason,
      sourceIds: [...conclusion.citedSourceIds],
      status: conclusion.status,
      origin,
      rejectedReason,
      applied: false,
    });
  }

  // 逐处并回配文：按位置替换；定位不到或与别处重叠的改动不并入，改为在说明里列出。
  const placements = changes
    .flatMap((change) => {
      const span = change.original ? locateCaptionSpan(caption, change.claimText) : null;
      return span ? [{ change, span }] : [];
    })
    .sort((left, right) => left.span.start - right.span.start);

  const unapplied: string[] = [];
  let cursor = 0;
  let suggestedCaption = "";
  const overlapping = new Set<CaptionSuggestionChange>();
  for (const placement of placements) {
    if (overlapping.has(placement.change)) continue;
    if (placement.span.start < cursor) {
      overlapping.add(placement.change);
      unapplied.push(`「${placement.change.claimText}」与别处的改动在配文里重叠，未并入建议配文。`);
      continue;
    }
    const terminator = sentenceTerminatorAfter(caption, placement.span.end);
    const replacement = placement.change.suggested.trim();
    // 建议文本自带句末标点时吸收原文的标点，否则把原文标点接回去；删除整句时连标点一起删。
    const text = replacement.length === 0 || endsWithTerminator(replacement)
      ? replacement
      : `${replacement}${terminator}`;
    placement.change.applied = true;
    suggestedCaption += caption.slice(cursor, placement.span.start) + text;
    cursor = placement.span.end + terminator.length;
  }
  suggestedCaption += caption.slice(cursor);

  for (const change of changes) {
    if (change.applied || overlapping.has(change)) continue;
    unapplied.push(`「${change.claimText}」在配文里定位不到原句，未并入建议配文；请自行在原文中修改。`);
  }
  if (unapplied.length > 0) notes.push(...unapplied);

  const kinds = new Set(changes.map((change) => change.kind));
  if (changes.length > 0 && !kinds.has("replace-value") && !kinds.has("unchanged")) {
    notes.push("本次没有可以据以改正配文的适用来源，建议只保留限定表述或删除未核实内容。");
  }
  if (changes.length === 0) {
    notes.push("本次没有从配文里拆出可核对的主张，建议配文保持原样；如需改写请先缩小配文范围。");
  }
  if (changes.some((change) => change.status === "not-verifiable")) {
    notes.push("配文里的观点或超出数据的判断不在核验范围内，建议里保留原句，请自行取舍。");
  }
  if (proposals.length > 0 && changes.every((change) => change.origin === "program")) {
    notes.push("模型提出的改写都没有通过逐处校验，建议由程序按当前结论生成。");
  }

  const fingerprint = captionSuggestionFingerprint({
    caption,
    conclusions: pairs.map((entry) => entry.conclusion),
    acceptedCitations: input.acceptedCitations,
  });

  return { caption, suggestedCaption, changes, rejectedProposals, notes, fingerprint };
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
  /** 本次调查的补证记录（问题、用户回答、解析与冲突）；没有补证时为 null。 */
  supplement: SupplementRecord | null;
  /** 补证恢复时与补证前结论的逐条对照；首次调查为 null。 */
  conclusionChanges: ConclusionChange[] | null;
  /** 核验结束后按当前结论生成的建议配文；无法生成时为 null（例如没有有效汇总）。 */
  captionSuggestion: CaptionSuggestion | null;
  /** 本次结果所属的调查记录 ID（服务端签发，补证前后保持同一 ID）；纯编排测试为 null。 */
  investigationId: string | null;
  /** 输入指纹（图片+配文）；改动输入即失配，用于过期恢复校验。 */
  inputFingerprint: string | null;
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
  /** 官方修订声明（只有带修订声明的发布才有）。 */
  revision?: { statement: string; revisedAt: string; supersedes: string };
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
