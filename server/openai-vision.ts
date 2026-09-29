import OpenAI from "openai";
import type {
  ResponseCreateParamsNonStreaming,
  ResponseFormatTextJSONSchemaConfig,
} from "openai/resources/responses/responses.js";
import type { UploadedChartImage, VisionAdapter, VisionReadResult } from "./app.js";
import type { ProviderConfig } from "./model-settings.js";
import { VisionModelError } from "./vision-error.js";
import { VISION_EXTRACTION_PROMPT } from "./vision-prompt.js";
import { OBSERVATION_SCHEMA_DESCRIPTION, observationSchema } from "./vision-schema.js";

const REQUEST_TIMEOUT_MS = 45_000;

const responseFormat: ResponseFormatTextJSONSchemaConfig = {
  type: "json_schema",
  name: "chart_claim_observations",
  description: OBSERVATION_SCHEMA_DESCRIPTION,
  strict: true,
  schema: observationSchema,
};

export interface ResponsesReply {
  output_text: string;
  model?: string;
  id?: string;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
}

export type ResponsesRequester = (
  parameters: ResponseCreateParamsNonStreaming,
) => Promise<ResponsesReply>;

export class OpenAIResponsesVisionAdapter implements VisionAdapter {
  private readonly send: ResponsesRequester;

  constructor(config: ProviderConfig, requester?: ResponsesRequester) {
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

  async extract(image: UploadedChartImage): Promise<VisionReadResult> {
    const dataUrl = `data:${image.mimeType};base64,${image.buffer.toString("base64")}`;
    let reply: ResponsesReply;

    try {
      reply = await this.send({
        model: this.model,
        store: false,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: VISION_EXTRACTION_PROMPT },
              { type: "input_image", image_url: dataUrl, detail: "high" },
            ],
          },
        ],
        text: { format: responseFormat },
      });
    } catch (error) {
      if (error instanceof OpenAI.APIConnectionTimeoutError) {
        throw new VisionModelError("timeout", { cause: error });
      }
      throw new VisionModelError("upstream", { cause: error });
    }

    const outputText = reply.output_text;
    try {
      return {
        observation: JSON.parse(outputText) as unknown,
        model: reply.model?.trim() || this.model,
        requestId: reply.id?.trim() || null,
        usage: reply.usage
          ? {
              inputTokens: reply.usage.input_tokens ?? null,
              outputTokens: reply.usage.output_tokens ?? null,
            }
          : null,
        rawText: outputText,
      };
    } catch (error) {
      throw new VisionModelError("invalid-output", { cause: error });
    }
  }
}
