import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { MODEL_PROVIDERS, type ModelProvider } from "../shared/model-providers.js";
import { modelBaseUrlSchema } from "./model-base-url.js";

export { MODEL_PROVIDERS };
export type { ModelProvider };

export interface ProviderConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface ModelSettings {
  activeProvider: ModelProvider;
  providers: Record<ModelProvider, ProviderConfig>;
}

export interface PublicProviderConfig {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}

export interface PublicModelSettings {
  activeProvider: ModelProvider;
  providers: Record<ModelProvider, PublicProviderConfig>;
}

export interface ModelSettingsStore {
  read(): Promise<ModelSettings>;
  write(settings: ModelSettings): Promise<void>;
}

export const DEFAULT_PROVIDER_CONFIGS: Record<ModelProvider, ProviderConfig> = {
  "openai-responses": {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiKey: "",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-6",
    apiKey: "",
  },
};

export const DEFAULT_MODEL_SETTINGS: ModelSettings = createDefaultModelSettings();

export function createDefaultModelSettings(): ModelSettings {
  return {
    activeProvider: "openai-responses",
    providers: {
      "openai-responses": { ...DEFAULT_PROVIDER_CONFIGS["openai-responses"] },
      anthropic: { ...DEFAULT_PROVIDER_CONFIGS.anthropic },
    },
  };
}

export function activeProviderConfig(settings: ModelSettings): {
  provider: ModelProvider;
  config: ProviderConfig;
} {
  return {
    provider: settings.activeProvider,
    config: settings.providers[settings.activeProvider],
  };
}

const providerConfigSchema = z.object({
  baseUrl: modelBaseUrlSchema,
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().max(1000),
}).strict();

const storedSettingsSchema = z.object({
  activeProvider: z.enum(MODEL_PROVIDERS),
  providers: z.object({
    "openai-responses": providerConfigSchema.optional(),
    anthropic: providerConfigSchema.optional(),
  }).strict().optional(),
}).strict();

const legacyStoredSettingsSchema = z.object({
  baseUrl: modelBaseUrlSchema,
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().max(1000),
}).strict();

export function getDefaultSettingsPath(environment: NodeJS.ProcessEnv = process.env): string {
  const userDataDirectory = environment.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(userDataDirectory, "TuZheng", "settings.json");
}

function toPublicProviderConfig(config: ProviderConfig): PublicProviderConfig {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    hasApiKey: config.apiKey.length > 0,
  };
}

export function toPublicModelSettings(settings: ModelSettings): PublicModelSettings {
  return {
    activeProvider: settings.activeProvider,
    providers: {
      "openai-responses": toPublicProviderConfig(settings.providers["openai-responses"]),
      anthropic: toPublicProviderConfig(settings.providers.anthropic),
    },
  };
}

/** 仅格式/地址损坏可由设置页重建；文件权限与磁盘错误必须保留。 */
export class InvalidModelSettingsError extends Error {
  constructor(message = "本机模型设置文件格式无效或服务地址不安全。") {
    super(`${message}请重新填写两种协议并保存，未重填的协议将恢复默认值。`);
  }
}

export class FileModelSettingsStore implements ModelSettingsStore {
  constructor(readonly filePath = getDefaultSettingsPath()) {}

  async read(): Promise<ModelSettings> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return createDefaultModelSettings();
      }
      throw error;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(contents) as unknown;
    } catch {
      throw new InvalidModelSettingsError("本机模型设置文件无法读取。");
    }

    const parsed = storedSettingsSchema.safeParse(parsedJson);
    if (parsed.success) {
      return {
        activeProvider: parsed.data.activeProvider,
        providers: {
          "openai-responses": parsed.data.providers?.["openai-responses"]
            ?? { ...DEFAULT_PROVIDER_CONFIGS["openai-responses"] },
          anthropic: parsed.data.providers?.anthropic ?? { ...DEFAULT_PROVIDER_CONFIGS.anthropic },
        },
      };
    }

    const legacy = legacyStoredSettingsSchema.safeParse(parsedJson);
    if (legacy.success) {
      return {
        activeProvider: "openai-responses",
        providers: {
          "openai-responses": legacy.data,
          anthropic: { ...DEFAULT_PROVIDER_CONFIGS.anthropic },
        },
      };
    }

    throw new InvalidModelSettingsError();
  }

  async write(settings: ModelSettings): Promise<void> {
    const parsed = storedSettingsSchema.parse(settings);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}
