import OpenAI from "openai";
import type {
  ResponseCreateParamsNonStreaming,
  ResponseFormatTextJSONSchemaConfig,
} from "openai/resources/responses/responses.js";
import type { UploadedChartImage, VisionAdapter } from "./app.js";

const DEFAULT_MODEL = "gpt-4.1-mini";
const REQUEST_TIMEOUT_MS = 45_000;

const observationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    titleOriginal: { type: ["string", "null"] },
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
  required: ["titleOriginal", "claimedGrowthPercent", "older", "newer", "unreadableItems"],
} satisfies ResponseFormatTextJSONSchemaConfig["schema"];

const responseFormat: ResponseFormatTextJSONSchemaConfig = {
  type: "json_schema",
  name: "chart_observation",
  description: "图表截图的原文、两个按时间排序的数据点及无法辨认的内容",
  strict: true,
  schema: observationSchema,
};

export type ResponsesRequester = (
  parameters: ResponseCreateParamsNonStreaming,
) => Promise<{ output_text: string }>;

export type VisionModelFailureKind = "timeout" | "upstream" | "invalid-output";

export class VisionModelError extends Error {
  constructor(readonly kind: VisionModelFailureKind, options?: ErrorOptions) {
    const message = kind === "timeout"
      ? "视觉模型请求超时。"
      : kind === "invalid-output"
        ? "视觉模型没有返回可读取的结构化观察值。"
        : "视觉模型请求失败。";
    super(message, options);
    this.name = "VisionModelError";
  }
}

export interface OpenAIVisionConfig {
  apiKey: string;
  model: string;
}

export class OpenAIResponsesVisionAdapter implements VisionAdapter {
  private readonly send: ResponsesRequester;

  constructor(config: OpenAIVisionConfig, requester?: ResponsesRequester) {
    if (!config.apiKey.trim()) throw new Error("OPENAI_API_KEY is required");
    if (!config.model.trim()) throw new Error("OPENAI_MODEL is required");

    if (requester) {
      this.send = requester;
    } else {
      const client = new OpenAI({
        apiKey: config.apiKey,
        timeout: REQUEST_TIMEOUT_MS,
        maxRetries: 0,
      });
      this.send = (parameters) => client.responses.create(parameters);
    }

    this.model = config.model;
  }

  private readonly model: string;

  async extract(image: UploadedChartImage): Promise<unknown> {
    const dataUrl = `data:${image.mimeType};base64,${image.buffer.toString("base64")}`;
    let outputText: string;

    try {
      const response = await this.send({
        model: this.model,
        store: false,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  "只检查这张图表截图。逐字读取标题，并记录标题明确写出的增长百分比。",
                  "只抄录明确印出的较早和较新两个数值；不得根据柱高、折线位置或常识推测数字。",
                  "按清楚可见的年份先后填写 older 和 newer。顺序、数值、单位或文字看不清时填 null，并在 unreadableItems 说明。",
                  "evidenceText 只引用图片上确实可见的文字；不要计算增长率，不要判断真实数据是否正确。",
                  "若图中不是可比较的两个标注值，也将相应字段留空。",
                ].join(" "),
              },
              { type: "input_image", image_url: dataUrl, detail: "high" },
            ],
          },
        ],
        text: { format: responseFormat, verbosity: "low" },
      });
      outputText = response.output_text;
    } catch (error) {
      if (error instanceof OpenAI.APIConnectionTimeoutError) {
        throw new VisionModelError("timeout", { cause: error });
      }
      throw new VisionModelError("upstream", { cause: error });
    }

    try {
      return JSON.parse(outputText) as unknown;
    } catch (error) {
      throw new VisionModelError("invalid-output", { cause: error });
    }
  }
}

export function createVisionAdapterFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
): VisionAdapter | null {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  return new OpenAIResponsesVisionAdapter({
    apiKey,
    model: environment.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
  });
}
