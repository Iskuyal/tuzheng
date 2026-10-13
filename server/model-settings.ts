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
  readonly source?: "file" | "env";
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
  readonly source = "file";
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

/** 消息只包含变量名和规则，绝不附带输入值或校验器的原始错误。 */
export class EnvironmentModelSettingsError extends Error {}

export class ReadOnlyModelSettingsError extends Error {
  constructor() {
    super("当前使用服务端环境配置，设置为只读。请修改服务端环境变量并重启服务。");
  }
}

export function settingsSource(store: ModelSettingsStore): { source: "file" | "env"; readOnly: boolean } {
  const source = store.source ?? "file";
  return { source, readOnly: source === "env" };
}

/** 进程创建配置源时一次快照四项；env 从不读取或写入本机配置文件。 */
export class EnvironmentModelSettingsStore implements ModelSettingsStore {
  readonly source = "env";
  private readonly snapshot: Record<string, string | undefined>;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.snapshot = Object.fromEntries(
      ["MODEL_PROVIDER", "MODEL_BASE_URL", "MODEL_NAME", "MODEL_API_KEY"]
        .map((name) => [name, environment[name]?.trim()]),
    );
  }

  async read(): Promise<ModelSettings> {
    const missing = Object.keys(this.snapshot).filter((name) => !this.snapshot[name]);
    if (missing.length) {
      throw new EnvironmentModelSettingsError(`服务端环境配置缺少：${missing.join("、")}。请补齐后重启服务；不会回退本机配置。`);
    }
    const provider = z.enum(MODEL_PROVIDERS).safeParse(this.snapshot.MODEL_PROVIDER);
    if (!provider.success) {
      throw new EnvironmentModelSettingsError("MODEL_PROVIDER 只支持 openai-responses 或 anthropic。");
    }
    const config = providerConfigSchema.safeParse({
      baseUrl: this.snapshot.MODEL_BASE_URL,
      model: this.snapshot.MODEL_NAME,
      apiKey: this.snapshot.MODEL_API_KEY,
    });
    if (!config.success) {
      throw new EnvironmentModelSettingsError("服务端环境配置无效：MODEL_BASE_URL 必须是 HTTPS 或 HTTP 回环根地址，无凭据、查询参数或片段，不能包含 /responses、/messages 或 /chat/completions 等完整接口路径；MODEL_NAME 最长 120 字符，MODEL_API_KEY 最长 1000 字符。");
    }
    // 未启用的协议保持空配置，不能从默认值或本机文件拼入任何字段。
    const providers: Record<ModelProvider, ProviderConfig> = {
      "openai-responses": { baseUrl: "", model: "", apiKey: "" },
      anthropic: { baseUrl: "", model: "", apiKey: "" },
    };
    providers[provider.data] = { ...config.data, baseUrl: config.data.baseUrl.replace(/\/$/, "") };
    return { activeProvider: provider.data, providers };
  }

  async write(_settings: ModelSettings): Promise<void> {
    throw new ReadOnlyModelSettingsError();
  }
}

/** 唯一配置源选择入口；省略选择器保持原有文件行为。 */
export function createModelSettingsStore(environment: NodeJS.ProcessEnv = process.env): ModelSettingsStore {
  const source = environment.MODEL_CONFIG_SOURCE?.trim() || "file";
  if (source === "file") return new FileModelSettingsStore(getDefaultSettingsPath(environment));
  if (source === "env") return new EnvironmentModelSettingsStore(environment);
  throw new EnvironmentModelSettingsError("MODEL_CONFIG_SOURCE 只支持 file 或 env。");
}
