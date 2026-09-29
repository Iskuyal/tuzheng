import { z } from "zod";
import type { AnthropicToolDefinition } from "./anthropic-messages.js";
import type { ComparisonBasis, SourceDocument } from "../shared/source-library.js";
import type { CitationRole, SourceClaim, SourceClaimKind } from "../shared/source-audit.js";

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
  kind: z.enum(["direct", "inference"]).optional().default("direct"),
  fromImage: z.boolean().optional().default(false),
  imageExcerpt: z.string().trim().max(300).nullable().optional().default(null),
}).strict();

export const reportArgumentsSchema = z.object({
  claims: z.array(claimSchema).max(3),
  citations: z.array(z.object({
    sourceId: z.string().trim().min(1).max(80),
    role: z.enum(["value-basis", "term-explanation", "context"]).optional().default("value-basis"),
    note: z.string().trim().max(300).nullable().optional().default(null),
  }).strict()).optional().default([]),
  noApplicableSourceReason: z.string().trim().max(300).nullable().optional().default(null),
  unresolvedItems: z.array(z.string().trim().min(1).max(200)).max(8).optional().default([]),
}).strict();

export interface ModelFinding {
  claims: SourceClaim[];
  citations: Array<{ sourceId: string; role: CitationRole; note: string | null }>;
  noApplicableSourceReason: string | null;
  unresolvedItems: string[];
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
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claimText: { type: "string", description: "逐字保留的主张原文，不要改写。" },
          metric: nullString,
          scope: nullString,
          period: nullString,
          value: { type: ["number", "null"] },
          basis: {
            anyOf: [
              { type: "string", enum: ["year-on-year", "month-on-month"] },
              { type: "null" },
            ],
            description: "同比为 year-on-year，环比为 month-on-month；文中没写比较方式时填 null。",
          },
          kind: {
            type: "string",
            enum: ["direct", "inference"],
            description: "direct 为原文直接陈述，inference 为需要推出来的结论。",
          },
          fromImage: { type: "boolean", description: "这条主张是否来自图片上的文字。" },
          imageExcerpt: {
            ...nullString,
            description: "从图上逐字抄录、支撑这条主张的文字。图上没有对应文字时填 null；程序会据此核对比较方式是否真的写在图上。",
          },
        },
        required: ["claimText", "metric", "scope", "period", "value", "basis", "kind", "fromImage", "imageExcerpt"],
      },
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
  },
  required: ["claims", "citations", "noApplicableSourceReason", "unresolvedItems"],
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
    description: "当缺失的口径会改变结论、且资料库无法回答时，向用户提一个问题。单次调查最多一次。",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string", description: "要问用户的一个具体问题。" },
        purpose: { type: "string", description: "这个答案会怎样影响结论。" },
        field: { type: "string", enum: ["period", "scope", "metric", "basis", "value"] },
      },
      required: ["question", "purpose", "field"],
    },
  },
  {
    name: REPORT_TOOL_NAME,
    description: "结束调查并给出结构化结果。必须在看完工具结果之后再调用；引用只能来自本次检索命中的资料。",
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
