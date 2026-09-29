import type { ResponseFormatTextJSONSchemaConfig } from "openai/resources/responses/responses.js";

/** 观察结构的工具名：Anthropic Messages 强制工具调用时使用。 */
export const OBSERVATION_TOOL_NAME = "record_chart_observation";

export const OBSERVATION_SCHEMA_DESCRIPTION =
  "图表截图中的增长率主张、对应观察值、图内证据和无法辨认项，不包含用户确认或计算结果";

const claimSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    claimText: { type: ["string", "null"] },
    metric: { type: ["string", "null"] },
    scope: { type: ["string", "null"] },
    claimedGrowthPercent: { type: ["number", "null"] },
    older: {
      type: "object",
      additionalProperties: false,
      properties: {
        period: { type: ["string", "null"] },
        value: { type: ["number", "null"] },
        unit: { type: ["string", "null"] },
        evidenceText: { type: ["string", "null"] },
      },
      required: ["period", "value", "unit", "evidenceText"],
    },
    newer: {
      type: "object",
      additionalProperties: false,
      properties: {
        period: { type: ["string", "null"] },
        value: { type: ["number", "null"] },
        unit: { type: ["string", "null"] },
        evidenceText: { type: ["string", "null"] },
      },
      required: ["period", "value", "unit", "evidenceText"],
    },
    unreadableItems: { type: "array", items: { type: "string" } },
  },
  required: ["claimText", "metric", "scope", "claimedGrowthPercent", "older", "newer", "unreadableItems"],
} satisfies ResponseFormatTextJSONSchemaConfig["schema"];

const axisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: ["string", "null"] },
    min: { type: ["number", "null"] },
    max: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
  },
  required: ["label", "min", "max", "unit"],
};

export const observationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    claims: { type: "array", items: claimSchema },
    axis: { anyOf: [axisSchema, { type: "null" }] },
  },
  required: ["claims", "axis"],
} satisfies ResponseFormatTextJSONSchemaConfig["schema"];
