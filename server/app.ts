import express, { type Express } from "express";
import multer, { MulterError } from "multer";
import { z } from "zod";
import { evaluateGrowth } from "../shared/audit.js";
import { OpenAIResponsesVisionAdapter, VisionModelError } from "./openai-vision.js";
import {
  FileModelSettingsStore,
  type ModelSettings,
  type ModelSettingsStore,
  toPublicModelSettings,
} from "./model-settings.js";
import { parseVisionObservation } from "./observation.js";
import { sampleCases } from "../shared/samples.js";

export interface UploadedChartImage {
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

export interface VisionAdapter {
  extract(image: UploadedChartImage): Promise<unknown>;
}

export interface AppOptions {
  visionAdapter?: VisionAdapter | null;
  visionAdapterFactory?: (settings: ModelSettings) => VisionAdapter;
  settingsStore?: ModelSettingsStore;
}

const settingsUpdateSchema = z.object({
  baseUrl: z.string().url().max(500).refine((value) => {
    const url = new URL(value);
    const localHost = url.hostname === "localhost"
      || url.hostname.endsWith(".localhost")
      || url.hostname === "[::1]"
      || url.hostname.startsWith("127.");
    const secureTransport = url.protocol === "https:" || (url.protocol === "http:" && localHost);
    return secureTransport
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  }),
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().max(1000).optional(),
  clearApiKey: z.boolean().optional(),
}).strict();

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

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const settingsStore = options.settingsStore ?? new FileModelSettingsStore();
  const createVisionAdapter = options.visionAdapterFactory ?? ((settings: ModelSettings) =>
    new OpenAIResponsesVisionAdapter(settings));
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
        error: { code: "INVALID_SETTINGS", message: "远程服务请使用 HTTPS；HTTP 仅支持 localhost 回环地址。请同时检查模型名。" },
      });
      return;
    }

    const current = await settingsStore.read();
    const apiKey = parsed.data.clearApiKey
      ? ""
      : parsed.data.apiKey?.trim() || current.apiKey;
    const settings: ModelSettings = {
      baseUrl: parsed.data.baseUrl.replace(/\/$/, ""),
      model: parsed.data.model,
      apiKey,
    };
    await settingsStore.write(settings);
    response.json({ settings: toPublicModelSettings(settings) });
  });

  app.get("/api/samples", (_request, response) => {
    response.json({
      samples: sampleCases.map(({ id, name, description, imageUrl }) => ({
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

    response.json({ observation: sample.observation });
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
      visionAdapter = storedSettings.apiKey.trim()
        ? createVisionAdapter(storedSettings)
        : null;
    }

    if (!visionAdapter) {
      response.status(503).json({
        error: {
          code: "MODEL_NOT_CONFIGURED",
          message: "实时视觉读取尚未配置。请前往模型设置页填写 Responses API 地址、模型名和 API Key。",
        },
      });
      return;
    }

    try {
      const parsed = parseVisionObservation(await visionAdapter.extract({
        buffer: request.file.buffer,
        mimeType,
      }));
      response.json({
        observation: {
          ...parsed,
          older: {
            ...parsed.older,
            valueSource: parsed.older.value === null ? "unreadable" : "model",
          },
          newer: {
            ...parsed.newer,
            valueSource: parsed.newer.value === null ? "unreadable" : "model",
          },
          confirmed: false,
          source: "vision-model",
        },
      });
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

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
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
