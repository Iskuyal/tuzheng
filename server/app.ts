import express, { type Express } from "express";
import multer, { MulterError } from "multer";
import { z } from "zod";
import { evaluateGrowth, type ChartObservation, type ModelReadTrace } from "../shared/audit.js";
import { AnthropicMessagesVisionAdapter } from "./anthropic-vision.js";
import { OpenAIResponsesVisionAdapter } from "./openai-vision.js";
import { VisionModelError } from "./vision-error.js";
import {
  ModelConnectionError,
  testModelConnection,
  type ModelConnectionFailureKind,
  type ModelConnectionResult,
} from "./model-connection.js";
import {
  FileModelSettingsStore,
  InvalidModelSettingsError,
  createDefaultModelSettings,
  MODEL_PROVIDERS,
  activeProviderConfig,
  toPublicModelSettings,
  type ModelProvider,
  type ModelSettings,
  type ModelSettingsStore,
  type ProviderConfig,
} from "./model-settings.js";
import { isCompletedModelEndpoint, modelBaseUrlSchema } from "./model-base-url.js";
import { parseVisionObservation } from "./observation.js";
import { sampleCases } from "../shared/samples.js";
import {
  SOURCE_CPI_SAMPLE,
  sourceAuditSamplePayload,
} from "../shared/cpi-sample.js";
import {
  SOURCE_LIBRARY,
  type SourceDocument,
} from "../shared/source-library.js";
import {
  AnthropicSourceInvestigationDriver,
  ResponsesSourceInvestigationDriver,
  SourceInvestigationError,
  runSourceInvestigation,
  type SourceInvestigationDriver,
} from "./source-investigation.js";
import { SOURCE_INVESTIGATION_PROMPT } from "./source-prompt.js";
import { SourceSessionStore, inputFingerprint } from "./source-sessions.js";
import type { SourceInvestigationResult } from "../shared/source-audit.js";

export interface UploadedChartImage {
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

export interface VisionReadResult {
  observation: unknown;
  model: string;
  requestId: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
  rawText: string;
}

export interface VisionAdapter {
  extract(image: UploadedChartImage): Promise<VisionReadResult>;
}

export interface AppOptions {
  visionAdapter?: VisionAdapter | null;
  visionAdapterFactory?: (settings: ModelSettings) => VisionAdapter;
  connectionTester?: (settings: ModelSettings) => Promise<ModelConnectionResult>;
  settingsStore?: ModelSettingsStore;
  /** 来源调查的驱动器工厂；替身测试用它注入脚本化的模型回复。 */
  investigationDriverFactory?: (
    settings: ModelSettings,
    image: UploadedChartImage,
    caption: string,
  ) => SourceInvestigationDriver;
  /** 可恢复会话存储；测试可注入以控制过期时钟。 */
  sessionStore?: SourceSessionStore;
}

const settingsUpdateSchema = z.object({
  provider: z.enum(MODEL_PROVIDERS).optional(),
  baseUrl: modelBaseUrlSchema,
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().max(1000).optional(),
  clearApiKey: z.boolean().optional(),
}).strict();

function resolvedModelSettings(current: ModelSettings, update: z.infer<typeof settingsUpdateSchema>): ModelSettings {
  const provider: ModelProvider = update.provider ?? "openai-responses";
  const providers: Record<ModelProvider, ProviderConfig> = {
    "openai-responses": current.providers["openai-responses"],
    anthropic: current.providers.anthropic,
  };
  providers[provider] = {
    baseUrl: update.baseUrl.replace(/\/$/, ""),
    model: update.model,
    apiKey: update.clearApiKey ? "" : update.apiKey?.trim() || current.providers[provider].apiKey,
  };
  return { activeProvider: provider, providers };
}

function settingsValidationMessage(body: unknown): string {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const provider: ModelProvider = record.provider === "anthropic" ? "anthropic" : "openai-responses";
  const baseUrl = record.baseUrl;
  if (typeof baseUrl !== "string" || !isCompletedModelEndpoint(baseUrl)) {
    return "远程服务请使用 HTTPS；HTTP 仅支持 localhost 回环地址。请同时检查模型名。";
  }
  return provider === "anthropic"
    ? "请填写 Anthropic Messages 的 Base URL（如 https://api.anthropic.com/v1），不要填 /messages 的完整接口地址；服务端会自行追加 /messages。"
    : "请填写 Responses API 的 Base URL（如 https://api.openai.com/v1），不要填 /chat/completions 或 /responses 的完整接口地址；服务端会自行追加 /responses。";
}

const connectionErrorCodes: Record<ModelConnectionFailureKind, string> = {
  auth: "MODEL_AUTH_FAILED",
  endpoint: "MODEL_ENDPOINT_NOT_FOUND",
  "rate-limit": "MODEL_RATE_LIMITED",
  timeout: "MODEL_CONNECTION_TIMEOUT",
  "request-rejected": "MODEL_REQUEST_REJECTED",
  "invalid-output": "MODEL_RESPONSE_INVALID",
  upstream: "MODEL_CONNECTION_FAILED",
};

const auditPointSchema = z.object({
  period: z.string().trim().max(80).nullable(),
  value: z.number().finite().nullable(),
  unit: z.string().trim().max(40).nullable(),
  evidenceText: z.string().trim().max(240).nullable(),
  valueSource: z.enum(["preset", "model", "user", "unreadable"]),
}).strict();

const auditSubmissionSchema = z.object({
  titleOriginal: z.string().trim().max(240).nullable(),
  claimedGrowthPercent: z.number().finite().nullable(),
  older: auditPointSchema,
  newer: auditPointSchema,
  unreadableItems: z.array(z.string().trim().min(1).max(160)).max(20),
  confirmed: z.boolean(),
  source: z.enum(["preset-example", "vision-model"]),
}).strict();

function detectImageMime(buffer: Buffer): UploadedChartImage["mimeType"] | null {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

/** 来源调查（初查与恢复）共用的失败映射：失败时不附带任何结论。 */
function sendInvestigationError(error: unknown, response: express.Response): void {
  if (error instanceof SourceInvestigationError && error.kind === "timeout") {
    response.status(504).json({
      error: { code: "SOURCE_INVESTIGATION_TIMEOUT", message: "来源调查超时。请稍后重试或换用更小的图片。" },
    });
    return;
  }
  if (error instanceof SourceInvestigationError && error.kind === "invalid-output") {
    console.warn("来源调查返回内容不符合要求。");
    response.status(502).json({
      error: { code: "SOURCE_INVESTIGATION_INVALID", message: "模型返回的调查结果无法安全使用。请重试。" },
    });
    return;
  }
  console.warn("来源调查请求失败。", error instanceof Error ? error.message : error);
  response.status(502).json({
    error: { code: "SOURCE_INVESTIGATION_FAILED", message: "暂时无法完成来源调查，请稍后重试。" },
  });
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const settingsStore = options.settingsStore ?? new FileModelSettingsStore();
  async function settingsForSave(): Promise<ModelSettings> {
    try {
      return await settingsStore.read();
    } catch (error) {
      if (error instanceof InvalidModelSettingsError) return createDefaultModelSettings();
      throw error;
    }
  }
  const sessionStore = options.sessionStore ?? new SourceSessionStore();
  const createVisionAdapter = options.visionAdapterFactory ?? ((settings: ModelSettings) => {
    const { provider, config } = activeProviderConfig(settings);
    return provider === "anthropic"
      ? new AnthropicMessagesVisionAdapter(config)
      : new OpenAIResponsesVisionAdapter(config);
  });
  const connectionTester = options.connectionTester ?? testModelConnection;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/settings", async (_request, response) => {
    const settings = await settingsStore.read();
    response.json({ settings: toPublicModelSettings(settings) });
  });

  app.put("/api/settings", async (request, response) => {
    const parsed = settingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: "INVALID_SETTINGS",
          message: settingsValidationMessage(request.body),
        },
      });
      return;
    }

    const settings = resolvedModelSettings(await settingsForSave(), parsed.data);
    await settingsStore.write(settings);
    response.json({ settings: toPublicModelSettings(settings) });
  });

  app.post("/api/settings/test-connection", async (request, response) => {
    const parsed = settingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: "INVALID_SETTINGS", message: settingsValidationMessage(request.body) },
      });
      return;
    }

    const settings = resolvedModelSettings(await settingsForSave(), parsed.data);
    if (!settings.providers[settings.activeProvider].apiKey) {
      response.status(400).json({
        error: { code: "MODEL_NOT_CONFIGURED", message: "请填写 API Key，或先保存密钥后再测试连接。" },
      });
      return;
    }

    try {
      const connection = await connectionTester(settings);
      response.json({ connection });
    } catch (error) {
      const failure = error instanceof ModelConnectionError
        ? error
        : new ModelConnectionError("upstream", { cause: error });
      const status = failure.kind === "timeout" ? 504 : failure.kind === "rate-limit" ? 429 : 502;
      response.status(status).json({
        error: { code: connectionErrorCodes[failure.kind], message: failure.message },
      });
    }
  });

  app.get("/api/samples", (_request, response) => {
    response.json({
      samples: sampleCases.filter((sample) => !sample.evaluationOnly).map(({ id, name, description, imageUrl }) => ({
        id,
        name,
        description,
        imageUrl,
      })),
    });
  });

  app.post("/api/audit/sample", (request, response) => {
    const parsed = z.object({ id: z.string() }).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "INVALID_REQUEST", message: "请选择一个有效样例。" } });
      return;
    }

    const sample = sampleCases.find(({ id }) => id === parsed.data.id);
    if (!sample) {
      response.status(404).json({ error: { code: "SAMPLE_NOT_FOUND", message: "找不到这个样例。" } });
      return;
    }

    response.json({
      observation: sample.observation,
      sample: { id: sample.id, name: sample.name, description: sample.description, imageUrl: sample.imageUrl },
    });
  });

  app.post("/api/audit/check", (request, response) => {
    const parsed = auditSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: "INVALID_OBSERVATION", message: "观察值格式不完整，请重新读取或选择样例。" },
      });
      return;
    }

    response.json({ result: evaluateGrowth(parsed.data) });
  });

  app.post("/api/audit/image", upload.single("image"), async (request, response) => {
    if (!request.file) {
      response.status(400).json({
        error: { code: "IMAGE_REQUIRED", message: "请选择一张 PNG、JPG 或 WebP 图片。" },
      });
      return;
    }

    const mimeType = detectImageMime(request.file.buffer);
    if (!mimeType) {
      response.status(415).json({
        error: { code: "UNSUPPORTED_IMAGE", message: "图片内容无法识别，请使用 PNG、JPG 或 WebP。" },
      });
      return;
    }

    let visionAdapter: VisionAdapter | null;
    if (options.visionAdapter !== undefined) {
      visionAdapter = options.visionAdapter;
    } else {
      const storedSettings = await settingsStore.read();
      const { config } = activeProviderConfig(storedSettings);
      visionAdapter = config.apiKey.trim()
        ? createVisionAdapter(storedSettings)
        : null;
    }

    if (!visionAdapter) {
      response.status(503).json({
        error: {
          code: "MODEL_NOT_CONFIGURED",
          message: "实时视觉读取尚未配置。请前往模型设置页填写模型服务地址、模型名和 API Key。",
        },
      });
      return;
    }

    try {
      const image: UploadedChartImage = { buffer: request.file.buffer, mimeType };
      const startedAt = Date.now();
      const read = await visionAdapter.extract(image);
      const parsed = parseVisionObservation(read.observation);
      const observation: ChartObservation = {
        source: "vision-model",
        claims: parsed.claims.map((claim, index) => ({
          id: `claim-${index + 1}`,
          ...claim,
        })),
        axis: parsed.axis ?? null,
      };
      const modelRead: ModelReadTrace = {
        model: read.model,
        requestId: read.requestId,
        usage: read.usage,
        rawText: read.rawText,
        latencyMs: Date.now() - startedAt,
        imageBytes: request.file.buffer.byteLength,
      };
      response.json({ observation, modelRead });
    } catch (error) {
      if (error instanceof VisionModelError && error.kind === "timeout") {
        response.status(504).json({
          error: { code: "VISION_TIMEOUT", message: "图片读取超时。请换用更小或更清晰的图片后重试。" },
        });
        return;
      }

      if ((error instanceof VisionModelError && error.kind === "invalid-output") || error instanceof z.ZodError) {
        console.warn("视觉读取返回格式不符合要求。");
        response.status(502).json({
          error: { code: "INVALID_MODEL_OUTPUT", message: "模型返回内容无法安全使用。请重试或选择样例。" },
        });
        return;
      }

      console.warn("视觉模型请求失败。");
      response.status(502).json({
        error: { code: "VISION_REQUEST_FAILED", message: "暂时无法读取图片，请稍后重试。" },
      });
    }
  });

  app.get("/api/source-audit/library", (_request, response) => {
    response.json({
      library: SOURCE_LIBRARY.map(({ measures, aliases, ...document }: SourceDocument) => ({
        ...document,
        measureCount: measures.length,
        aliasCount: aliases.length,
      })),
    });
  });

  app.get("/api/source-audit/sample", (_request, response) => {
    response.json({ sample: sourceAuditSamplePayload() });
  });

  app.post("/api/source-audit/investigate", upload.single("image"), async (request, response) => {
    const caption = typeof request.body?.caption === "string" ? request.body.caption.trim() : "";
    if (!caption) {
      response.status(400).json({
        error: { code: "CAPTION_REQUIRED", message: "请填写要核对的配文，至少一句话。" },
      });
      return;
    }
    if (caption.length > 400) {
      response.status(400).json({
        error: { code: "CAPTION_TOO_LONG", message: "配文请控制在 400 字以内。" },
      });
      return;
    }
    if (!request.file) {
      response.status(400).json({
        error: { code: "IMAGE_REQUIRED", message: "请选择一张 PNG、JPG 或 WebP 图片。" },
      });
      return;
    }

    const mimeType = detectImageMime(request.file.buffer);
    if (!mimeType) {
      response.status(415).json({
        error: { code: "UNSUPPORTED_IMAGE", message: "图片内容无法识别，请使用 PNG、JPG 或 WebP。" },
      });
      return;
    }

    const image: UploadedChartImage = { buffer: request.file.buffer, mimeType };
    const settings = await settingsStore.read();
    const { provider, config } = activeProviderConfig(settings);
    if (!config.apiKey.trim()) {
      response.status(503).json({
        error: {
          code: "MODEL_NOT_CONFIGURED",
          message: "来源核验需要调用模型选择工具。请前往模型设置页填写地址、模型名和 API Key。",
        },
      });
      return;
    }

    const driver: SourceInvestigationDriver = options.investigationDriverFactory
      ? options.investigationDriverFactory(settings, image, caption)
      : provider === "anthropic"
        ? new AnthropicSourceInvestigationDriver(config, image, caption, SOURCE_INVESTIGATION_PROMPT)
        : new ResponsesSourceInvestigationDriver(config, image, caption, SOURCE_INVESTIGATION_PROMPT);

    try {
      const investigation: SourceInvestigationResult = await runSourceInvestigation(driver, { caption });
      // 签发调查记录 ID 并保存可恢复会话：追问提出后，回答要能续在同一段对话上。
      const fingerprint = inputFingerprint(image.buffer, caption);
      const investigationId = sessionStore.create({ fingerprint, driver, result: investigation });
      investigation.investigationId = investigationId;
      investigation.inputFingerprint = fingerprint;
      response.json({ investigation });
    } catch (error) {
      sendInvestigationError(error, response);
    }
  });

  app.post("/api/source-audit/resume", upload.single("image"), async (request, response) => {
    const caption = typeof request.body?.caption === "string" ? request.body.caption.trim() : "";
    if (!caption) {
      response.status(400).json({
        error: { code: "CAPTION_REQUIRED", message: "请填写要核对的配文，至少一句话。" },
      });
      return;
    }
    if (caption.length > 400) {
      response.status(400).json({
        error: { code: "CAPTION_TOO_LONG", message: "配文请控制在 400 字以内。" },
      });
      return;
    }
    const answer = typeof request.body?.answer === "string" ? request.body.answer.trim() : "";
    if (!answer) {
      response.status(400).json({
        error: { code: "ANSWER_REQUIRED", message: "请先填写对追问的回答，再提交补充。" },
      });
      return;
    }
    if (answer.length > 400) {
      response.status(400).json({
        error: { code: "ANSWER_TOO_LONG", message: "补充回答请控制在 400 字以内。" },
      });
      return;
    }
    const investigationId = typeof request.body?.investigationId === "string" ? request.body.investigationId.trim() : "";
    if (!investigationId) {
      response.status(400).json({
        error: { code: "INVESTIGATION_ID_REQUIRED", message: "缺少调查记录 ID，无法恢复这次调查。" },
      });
      return;
    }
    if (!request.file) {
      response.status(400).json({
        error: { code: "IMAGE_REQUIRED", message: "请选择一张 PNG、JPG 或 WebP 图片。" },
      });
      return;
    }

    const mimeType = detectImageMime(request.file.buffer);
    if (!mimeType) {
      response.status(415).json({
        error: { code: "UNSUPPORTED_IMAGE", message: "图片内容无法识别，请使用 PNG、JPG 或 WebP。" },
      });
      return;
    }

    const session = sessionStore.get(investigationId);
    if (!session) {
      // 过期或不存在的记录一律拒绝：不能靠恢复复活一次早已失效的调查。
      response.status(410).json({
        error: {
          code: "SESSION_EXPIRED",
          message: "这次调查已过期或不存在，请重新发起核验。",
        },
      });
      return;
    }
    if (inputFingerprint(request.file.buffer, caption) !== session.fingerprint) {
      // 图片或配文任一改动都会失配：依赖旧输入的结论立即失效，不能在新输入上恢复。
      response.status(409).json({
        error: {
          code: "INPUT_CHANGED",
          message: "图片或配文已改动，依赖旧输入的结论已失效；请重新发起核验。",
        },
      });
      return;
    }
    if (!session.result.clarification) {
      response.status(409).json({
        error: {
          code: "NO_PENDING_CLARIFICATION",
          message: "这次调查没有待回答的追问，无法补充恢复。",
        },
      });
      return;
    }

    if (!sessionStore.tryBeginResume(session.id)) {
      response.status(409).json({
        error: { code: "SESSION_BUSY", message: "这次调查正在处理另一份补充，请等待处理完成后再操作。" },
      });
      return;
    }
    try {
      const investigation: SourceInvestigationResult = await runSourceInvestigation(session.driver, {
        caption,
        resume: { answer, prior: session.result },
      });
      // 同一记录、同一段对话：恢复段更新会话里的最新结果，ID 保持不变。
      investigation.investigationId = session.id;
      investigation.inputFingerprint = session.fingerprint;
      sessionStore.update(session.id, investigation);
      response.json({ investigation });
    } catch (error) {
      sendInvestigationError(error, response);
    } finally {
      sessionStore.endResume(session.id);
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof InvalidModelSettingsError) {
      response.status(503).json({ error: { code: "INVALID_STORED_SETTINGS", message: error.message } });
      return;
    }
    if (error instanceof MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        response.status(413).json({
          error: { code: "IMAGE_TOO_LARGE", message: "图片不能超过 5 MB。" },
        });
        return;
      }
      response.status(400).json({
        error: { code: "INVALID_UPLOAD", message: "图片上传没有完成，请重试。" },
      });
      return;
    }

    response.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试。" },
    });
  });

  return app;
}
