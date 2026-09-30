import { z } from "zod";
import type { AnthropicToolDefinition } from "./anthropic-messages.js";
import type { ComparisonBasis, SourceDocument } from "../shared/source-library.js";
import {
  AUDITED_CLAIMS_LIMIT,
  MAX_CLAIMS_PER_REPORT,
  type CaptionRewriteProposal,
  type CitationRole,
  type SourceClaim,
  type SourceClaimKind,
} from "../shared/source-audit.js";

/** 模型可以选择的受限工具；服务端逐个校验工具名与参数，不执行模型生成的代码。 */
export const SEARCH_TOOL_NAME = "search_source_library";
export const COMPARE_TOOL_NAME = "compare_values";
export const CLARIFY_TOOL_NAME = "request_clarification";
export const REPORT_TOOL_NAME = "report_source_finding";

/** 计入调查预算的工具；汇总工具是出口，不计入调用上限。 */
export const BUDGETED_TOOL_NAMES = [SEARCH_TOOL_NAME, COMPARE_TOOL_NAME, CLARIFY_TOOL_NAME] as const;

const basisSchema = z.enum(["year-on-year", "month-on-month"]);

export const searchArgumentsSchema = z.object({
  metric: z.string().trim().min(1).max(80).nullable(),
  period: z.string().trim().max(40).nullable(),
  scope: z.string().trim().max(80).nullable(),
  terms: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
}).strict();

export const compareArgumentsSchema = z.object({
  left: z.number().finite(),
  right: z.number().finite(),
  unit: z.string().trim().max(20),
  label: z.string().trim().max(80).nullable().optional(),
}).strict();

export const clarifyArgumentsSchema = z.object({
  question: z.string().trim().min(1).max(240),
  purpose: z.string().trim().min(1).max(240),
  field: z.enum(["period", "scope", "metric", "basis", "value"]),
  /** 这条追问影响的主张原文；模型没给出时为 null（补证会退回到「唯一缺口主张」匹配）。 */
  claimText: z.string().trim().min(1).max(300).nullable().optional().default(null),
}).strict();

// 模型漏填的字段一律按「没读到」处理：缺失只会让结论退回「来源待核对」，
// 不会变成来源一致或来源矛盾，所以这里容忍缺省而不是整份汇总作废。
const claimSchema = z.object({
  claimText: z.string().trim().min(1).max(300),
  metric: z.string().trim().max(80).nullable().optional().default(null),
  scope: z.string().trim().max(80).nullable().optional().default(null),
  period: z.string().trim().max(40).nullable().optional().default(null),
  value: z.number().finite().nullable().optional().default(null),
  basis: basisSchema.nullable().optional().default(null),
  kind: z.enum(["direct", "inference", "opinion"]).optional().default("direct"),
  direction: z.enum(["up", "down"]).nullable().optional().default(null),
  fromImage: z.boolean().optional().default(false),
  imageExcerpt: z.string().trim().max(300).nullable().optional().default(null),
}).strict();

/**
 * 建议配文的改写提议：附属输出，畸形提议只被逐条拒绝并由程序兜底，不能让整份汇总作废。
 * 所以这里不写 .strict()（多写的字段忽略）、字段允许缺省（缺的由建议生成器按「未写清」拒绝）、
 * 顶层不是数组或超过条数上限时按空数组／截断处理——新增的可选输出不该成为新的失败点。
 */
const rewriteText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((value) => value ?? "");

const rewriteSchema = z.object({
  claimText: rewriteText(300),
  /** 建议文本；空串表示建议删除这句。 */
  suggestedText: rewriteText(300),
  reason: rewriteText(240),
});

const rewritesSchema = z.preprocess(
  // 不是数组按空数组；条目不是对象就丢掉；超过条数上限只截断——新增的可选输出不该让整份汇总被拒。
  (value) => (Array.isArray(value)
    ? value.filter((item) => item !== null && typeof item === "object").slice(0, MAX_CLAIMS_PER_REPORT)
    : []),
  z.array(rewriteSchema),
);

export const reportArgumentsSchema = z.object({
  // 结构上限高于单次核验上限：多出来的主张由程序移进未展开项并保留原文，不整份作废。
  claims: z.array(claimSchema).max(MAX_CLAIMS_PER_REPORT),
  citations: z.array(z.object({
    sourceId: z.string().trim().min(1).max(80),
    role: z.enum(["value-basis", "term-explanation", "context"]).optional().default("value-basis"),
    note: z.string().trim().max(300).nullable().optional().default(null),
  }).strict()).optional().default([]),
  noApplicableSourceReason: z.string().trim().max(300).nullable().optional().default(null),
  unresolvedItems: z.array(z.string().trim().min(1).max(200)).max(8).optional().default([]),
  /**
   * 配文里没有展开成主张的原文片段；单次最多核验三条，其余必须留在这里。
   * 上限给足余量：这是「不静默丢弃」的出口，附属列表超限不该让整份汇总被拒。
   */
  omittedClaims: z.array(z.string().trim().min(1).max(300)).max(30).optional().default([]),
  /** 可选的逐条改写提议；程序按结论逐条校验，不合格的不被采用。 */
  rewrites: rewritesSchema.optional().default([]),
}).strict();

export interface ModelFinding {
  claims: SourceClaim[];
  citations: Array<{ sourceId: string; role: CitationRole; note: string | null }>;
  noApplicableSourceReason: string | null;
  unresolvedItems: string[];
  omittedClaims: string[];
  rewrites: CaptionRewriteProposal[];
}

export function toModelFinding(input: z.infer<typeof reportArgumentsSchema>): ModelFinding {
  return {
    claims: input.claims.map((claim): SourceClaim => ({
      claimText: claim.claimText,
      metric: claim.metric,
      scope: claim.scope,
      period: claim.period,
      value: claim.value,
      basis: claim.basis as ComparisonBasis | null,
      kind: claim.kind as SourceClaimKind,
      direction: claim.direction,
      fromImage: claim.fromImage,
      imageExcerpt: claim.imageExcerpt,
    })),
    citations: input.citations.map((citation) => ({
      sourceId: citation.sourceId,
      role: citation.role as CitationRole,
      note: citation.note,
    })),
    noApplicableSourceReason: input.noApplicableSourceReason,
    unresolvedItems: input.unresolvedItems,
    omittedClaims: input.omittedClaims,
    rewrites: input.rewrites.map((rewrite): CaptionRewriteProposal => ({
      claimText: rewrite.claimText,
      suggestedText: rewrite.suggestedText,
      reason: rewrite.reason,
    })),
  };
}

const nullString = { type: ["string", "null"] } as const;

const commonToolSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    metric: { type: ["string", "null"], description: "指标名，例如「全国居民消费价格」；不确定时填 null。" },
    period: { ...nullString, description: "要核对的月份，写成 YYYY-MM；不确定时填 null。" },
    scope: { ...nullString, description: "地域或人群，例如「全国」；不确定时填 null。" },
    terms: { type: "array", items: { type: "string" }, description: "可选自由词，例如「同比」「环比」。" },
  },
  required: ["metric", "period", "scope"],
};

export const reportToolSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    claims: {
      type: "array",
      maxItems: MAX_CLAIMS_PER_REPORT,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claimText: { type: "string", description: "逐字保留的主张原文，不要改写；配文主张必须是配文里出现过的文字。" },
          metric: nullString,
          scope: nullString,
          period: nullString,
          value: { type: ["number", "null"] },
          basis: {
            anyOf: [
              { type: "string", enum: ["year-on-year", "month-on-month"] },
              { type: "null" },
            ],
            description: "同比为 year-on-year，环比为 month-on-month；文中没写比较方式时填 null。推断类主张必须填它依赖的比较方式。",
          },
          kind: {
            type: "string",
            enum: ["direct", "inference", "opinion"],
            description:
              "direct 为原文直接陈述；inference 为由原文推出、原文没有直接写的可检查结论（例如从「同比涨幅下降」推出「比上月便宜」）；"
              + "opinion 为对原因、动机、价值或未来走势的观点，这类不支持核验，不会被判错。",
          },
          direction: {
            anyOf: [
              { type: "string", enum: ["up", "down"] },
              { type: "null" },
            ],
            description:
              "主张断言的价格水平方向：价格比上期更高填 up，更低填 down；没有方向、或主张说的是「涨幅回落／涨幅扩大」这类涨幅本身的变化时填 null。",
          },
          fromImage: { type: "boolean", description: "这条主张是否来自图片上的文字。" },
          imageExcerpt: {
            ...nullString,
            description: "从图上逐字抄录、支撑这条主张的文字。图上没有对应文字时填 null；程序会据此核对比较方式是否真的写在图上。",
          },
        },
        required: ["claimText", "metric", "scope", "period", "value", "basis", "kind", "direction", "fromImage", "imageExcerpt"],
      },
      description: `最多核验 ${AUDITED_CLAIMS_LIMIT} 条主张；配文更长时，把没有展开的原文放进 omittedClaims，不能省略。`,
    },
    citations: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceId: { type: "string", description: "必须是本次检索结果里出现过的资料 ID。" },
          role: {
            type: "string",
            enum: ["value-basis", "term-explanation", "context"],
            description: "value-basis 表示用它的数值核对主张；term-explanation 只用于解释术语。",
          },
          note: nullString,
        },
        required: ["sourceId", "role", "note"],
      },
    },
    noApplicableSourceReason: {
      ...nullString,
      description: "本次没有适用来源时说明原因；有适用来源时填 null。",
    },
    unresolvedItems: { type: "array", items: { type: "string" }, description: "证据不足、仍未解决的问题。" },
    omittedClaims: {
      type: "array",
      maxItems: 30,
      items: { type: "string" },
      description: `配文里没有展开成主张的原文片段（逐字保留）；配文超过 ${AUDITED_CLAIMS_LIMIT} 条主张时，多出来的必须写在这里，没有就填空数组。只放配文原文，不要放图上说明文字。`,
    },
    rewrites: {
      type: "array",
      maxItems: MAX_CLAIMS_PER_REPORT,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claimText: { type: "string", description: "这条改写针对的主张原文（逐字引用）。" },
          suggestedText: {
            type: "string",
            description:
              "建议的配文写法：保持原句结构，只改有依据的部分；与所引来源不一致时用来源里的正确数值替换错误值；"
              + "没有适用来源或推断依据不足时必须保留限定词（例如「暂未核实」）；建议删除这句时填空字符串。",
          },
          reason: { type: "string", description: "为什么这样改，引用所依据的来源。" },
        },
        required: ["claimText", "suggestedText", "reason"],
      },
      description:
        "可选的逐条改写提议。规则：与所引来源一致的主张原样保留；不得引入图上、配文与所引来源里都没有的数值、月份或范围，"
        + "也不要新增原文没有的因果或加强表述；程序会逐条校验，不合格的提议不会被采用。没有把握时填空数组。",
    },
  },
  required: ["claims", "citations", "noApplicableSourceReason", "unresolvedItems", "omittedClaims"],
};

export const sourceToolDeclarations: AnthropicToolDefinition[] = [
  {
    name: SEARCH_TOOL_NAME,
    description: "在国家统计局固定资料库中检索材料。按指标、月份、范围返回候选，命中里可能包含口径不同的干扰材料，需要自行判断是否适用。",
    input_schema: commonToolSchema,
  },
  {
    name: COMPARE_TOOL_NAME,
    description: "对两个数值做确定性的相等或差异计算，不做现实数据判断。",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        left: { type: "number" },
        right: { type: "number" },
        unit: { type: "string" },
        label: { ...nullString, description: "这次比较的用途。" },
      },
      required: ["left", "right", "unit"],
    },
  },
  {
    name: CLARIFY_TOOL_NAME,
    description: "资料库检索后仍缺会影响结论的口径时，向用户提一个具体问题。先自己检索，资料库已覆盖的问题不要问用户。单次调查最多一次。",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string", description: "要问用户的一个具体问题。" },
        purpose: { type: "string", description: "这个答案会怎样影响结论、影响哪项口径。" },
        field: { type: "string", enum: ["period", "scope", "metric", "basis", "value"] },
        claimText: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "这条追问影响的主张原文（逐字引用该主张）；不影响具体主张时填 null。",
        },
      },
      required: ["question", "purpose", "field", "claimText"],
    },
  },
  {
    name: REPORT_TOOL_NAME,
    description: "结束调查并给出结构化结果。必须在看完工具结果之后再调用；引用只能来自本次检索命中的资料。"
      + `最多核验 ${AUDITED_CLAIMS_LIMIT} 条主张，未展开的配文内容必须写进 omittedClaims。`
      + "可以在 rewrites 里附上逐条配文改写提议（可选）；程序会按结论逐条校验，不合格的不会被采用。",
    input_schema: reportToolSchema,
  },
];

/** 汇总给模型看的检索结果：保留链接与摘录，便于模型判断口径并引用。 */
export function searchResultPayload(
  hits: Array<{
    document: SourceDocument;
    score: number;
    matchReasons: string[];
    applicability: { applicableForValue: boolean; applicableForTerm: boolean; mismatchFields: string[]; missingFields: string[] };
  }>,
): string {
  return JSON.stringify({
    hits: hits.map((hit) => ({
      sourceId: hit.document.id,
      kind: hit.document.kind,
      title: hit.document.title,
      publisher: hit.document.publisher,
      url: hit.document.url,
      publishedAt: hit.document.publishedAt,
      basis: hit.document.basis,
      excerpt: hit.document.excerpt,
      measures: hit.document.measures.map((measure) => ({
        basis: measure.basis,
        value: measure.value,
        unit: measure.unit,
        excerpt: measure.excerpt,
      })),
      matchReasons: hit.matchReasons,
      applicableForValue: hit.applicability.applicableForValue,
      applicableForTerm: hit.applicability.applicableForTerm,
      mismatchFields: hit.applicability.mismatchFields,
      missingFields: hit.applicability.missingFields,
    })),
  });
}
