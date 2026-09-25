import OpenAI from "openai";
import type {
  ResponseCreateParamsNonStreaming,
  ResponseFormatTextJSONSchemaConfig,
} from "openai/resources/responses/responses.js";
import type { UploadedChartImage, VisionAdapter } from "./app.js";

const REQUEST_TIMEOUT_MS = 45_000;

const claimSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    claimText: { type: ["string", "null"] },
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
  required: ["claimText", "claimedGrowthPercent", "older", "newer", "unreadableItems"],
} satisfies ResponseFormatTextJSONSchemaConfig["schema"];

const observationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    claims: { type: "array", items: claimSchema },
  },
  required: ["claims"],
} satisfies ResponseFormatTextJSONSchemaConfig["schema"];

const responseFormat: ResponseFormatTextJSONSchemaConfig = {
  type: "json_schema",
  name: "chart_claim_observations",
  description: "图表截图中的增长率主张、对应观察值、图内证据和无法辨认项，不包含用户确认或计算结果",
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
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class OpenAIResponsesVisionAdapter implements VisionAdapter {
  private readonly send: ResponsesRequester;

  constructor(config: OpenAIVisionConfig, requester?: ResponsesRequester) {
    if (!config.apiKey.trim()) throw new Error("API Key is required");
    if (!config.model.trim()) throw new Error("模型名称是必填项。");

    if (requester) {
      this.send = requester;
    } else {
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
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
                  "只检查这张图表截图。把每条明确写出的增长率主张分别放入 claims 数组，并逐字抄录对应的主张文字。",
                  "每条主张只记录与其对应的较早和较新观察值；不得根据柱高、折线位置或常识推测数字。",
                  "按清楚可见的年份先后填写 older 和 newer。顺序、数值、单位或图内证据看不清或不存在时填 null，并在 unreadableItems 说明无法辨认的内容。",
                  "evidenceText 只引用图片上确实可见、且对应这条主张的文字；不要补写缺失证据。",
                  "只返回原始观察与证据，不要给出用户确认值、增长率计算、结果状态或现实数据判断。若没有可核对的增长率主张，返回空 claims 数组。",
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
