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

export const BASIS_LABELS: Record<ComparisonBasis, string> = {
  "year-on-year": "同比",
  "month-on-month": "环比",
};

export type SourceClaimKind = "direct" | "inference";

export interface SourceClaim {
  claimText: string;
  metric: string | null;
  scope: string | null;
  period: string | null;
  value: number | null;
  basis: ComparisonBasis | null;
  kind: SourceClaimKind;
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

/** 引用只能来自本次命中；数值依据还必须口径适配，术语依据只能指向解释页。 */
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
    if (citation.role === "value-basis") {
      if (hit.document.kind === "term-explanation") {
        rejected.push({
          citation,
          reason: `${hit.document.title} 是术语解释页，只用于说明同比与环比的差别，不能作为数值依据。`,
        });
        continue;
      }
      if (!hit.applicability.applicableForValue) {
        const detail = [...hit.applicability.mismatchFields, ...hit.applicability.missingFields].join("、");
        rejected.push({
          citation,
          reason: `所引资料与主张口径不一致（${detail || "口径不适配"}），不作为数值依据。`,
        });
        continue;
      }
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

export type ClaimSourceStatus = "source-match" | "source-mismatch" | "source-pending";

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
}

export interface ClaimConclusionInput {
  claim: SourceClaim;
  citations: ModelCitation[];
  hits: SourceHit[];
  /** 模型给出的「本次没有适用来源」说明，用于降级原因。 */
  noApplicableSourceReason?: string | null;
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

function resolveCitationDocument(
  citation: ModelCitation,
  hits: SourceHit[],
): { hit: SourceHit; document: SourceDocument } | null {
  const hit = hits.find((candidate) => candidate.document.id === citation.sourceId);
  return hit ? { hit, document: hit.document } : null;
}

/**
 * 结论由程序按「引用是否有效 + 口径是否匹配 + 数值比对」组合，模型只提供引用与解释。
 * 引用缺失、不存在或口径不适配，一律降级为「来源待核对」。
 */
export function concludeClaimSource(input: ClaimConclusionInput): ClaimSourceConclusion {
  const { claim, citations, hits } = input;
  const basisLabel = claim.basis ? BASIS_LABELS[claim.basis] : null;
  const base = {
    claimText: claim.claimText,
    claimKind: claim.kind,
    fromImage: claim.fromImage,
    basisLabel,
    claimValue: claim.value,
    citedSourceIds: [] as string[],
  };

  const valueCitations = citations.filter((citation) => citation.role === "value-basis");
  if (valueCitations.length === 0) {
    const reason = input.noApplicableSourceReason?.trim()
      || "模型没有引用可用于数值核对的适用来源。";
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

  const resolvedValueCitation = valueCitations
    .map((citation) => ({ citation, resolved: resolveCitationDocument(citation, hits) }))
    .find((entry) => entry.resolved?.hit.applicability.applicableForValue);

  if (!resolvedValueCitation?.resolved) {
    return {
      ...base,
      status: "source-pending",
      summary: "来源待核对：所引来源与主张口径不一致，不能作为数值依据。",
      officialValue: null,
      difference: null,
      reasons: ["引用资料的口径与主张不一致，未能用于数值核对。"],
      unresolved: [],
    };
  }

  const { document } = resolvedValueCitation.resolved;

  if (!claim.basis) {
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
  const conclusions = input.claims.map((claim) => concludeClaimSource({
    claim,
    citations: validation.accepted,
    hits: input.hits,
    noApplicableSourceReason: input.noApplicableSourceReason,
  }));

  const excluded = input.hits
    .filter((hit) => !hit.applicability.applicableForValue)
    .map((hit) => ({
      sourceId: hit.document.id,
      title: hit.document.title,
      reason: hit.document.kind === "term-explanation"
        ? "术语解释页只用于说明同比与环比的差别，不提供具体月份的数值。"
        : hit.applicability.mismatchFields.length > 0
          ? `口径不符（${hit.applicability.mismatchFields.map(fieldLabel).join("、")}）：${hit.matchReasons.join("；")}`
          : hit.applicability.missingFields.length > 0
            ? `无法确认口径（${hit.applicability.missingFields.map(fieldLabel).join("、")}）：${hit.matchReasons.join("；")}`
            : "该材料与主张口径不匹配，未采用。",
    }));

  const seen = new Set<string>();
  const acceptedCitations = validation.accepted.filter((citation) => {
    const key = `${citation.sourceId}|${citation.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    conclusions,
    acceptedCitations,
    excluded,
    citationsRejected: validation.rejected.map((entry) => ({
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
};
