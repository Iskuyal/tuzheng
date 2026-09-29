import type { UploadedChartImage, VisionAdapter, VisionReadResult } from "./app.js";
import type { ProviderConfig } from "./model-settings.js";
import {
  createAnthropicMessagesRequester,
  requestAnthropicToolCall,
  type AnthropicMessagesRequester,
  type AnthropicReply,
  type AnthropicToolUseBlock,
} from "./anthropic-messages.js";
import { VisionModelError } from "./vision-error.js";
import { VISION_EXTRACTION_PROMPT } from "./vision-prompt.js";
import { OBSERVATION_TOOL_NAME, observationSchema } from "./vision-schema.js";

const REQUEST_TIMEOUT_MS = 45_000;
/** Messages 必须显式给出 max_tokens；截断会在解析阶段降级为 invalid-output。 */
const MAX_OUTPUT_TOKENS = 4096;

function isObservationToolUse(block: AnthropicReply["content"][number]): block is AnthropicToolUseBlock {
  return block.type === "tool_use"
    && (block as AnthropicToolUseBlock).name === OBSERVATION_TOOL_NAME;
}

export class AnthropicMessagesVisionAdapter implements VisionAdapter {
  private readonly send: AnthropicMessagesRequester;
  private readonly model: string;

  constructor(config: ProviderConfig, requester?: AnthropicMessagesRequester) {
    if (!config.apiKey.trim()) throw new Error("API Key is required");
    if (!config.model.trim()) throw new Error("模型名称是必填项。");

    this.model = config.model;
    this.send = requester ?? createAnthropicMessagesRequester(config, { timeoutMs: REQUEST_TIMEOUT_MS });
  }

  async extract(image: UploadedChartImage): Promise<VisionReadResult> {
    let reply: AnthropicReply;

    try {
      reply = await requestAnthropicToolCall(this.send, OBSERVATION_TOOL_NAME, (variant) => ({
        model: this.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: image.mimeType,
                  data: image.buffer.toString("base64"),
                },
              },
              { type: "text", text: VISION_EXTRACTION_PROMPT },
            ],
          },
        ],
        tools: [
          {
            name: OBSERVATION_TOOL_NAME,
            description: "记录图表截图中的增长率主张、观察值与图内证据。",
            input_schema: observationSchema,
          },
        ],
        tool_choice: variant.toolChoice,
        ...(variant.thinking ? { thinking: variant.thinking } : {}),
      }));
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new VisionModelError("timeout", { cause: error });
      }
      throw new VisionModelError("upstream", { cause: error });
    }

    if (reply.stop_reason === "max_tokens") {
      throw new VisionModelError("invalid-output");
    }
    if (!Array.isArray(reply.content)) {
      throw new VisionModelError("invalid-output");
    }

    const toolUse = reply.content.find(isObservationToolUse);
    if (!toolUse) {
      throw new VisionModelError("invalid-output");
    }

    return {
      observation: toolUse.input,
      model: reply.model?.trim() || this.model,
      requestId: reply.id?.trim() || null,
      usage: reply.usage
        ? {
            inputTokens: reply.usage.input_tokens ?? null,
            outputTokens: reply.usage.output_tokens ?? null,
          }
        : null,
      rawText: JSON.stringify(toolUse.input, null, 2) ?? "",
    };
  }
}
