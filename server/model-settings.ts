import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

export interface ModelSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface PublicModelSettings {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}

export interface ModelSettingsStore {
  read(): Promise<ModelSettings>;
  write(settings: ModelSettings): Promise<void>;
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiKey: "",
};

const storedSettingsSchema = z.object({
  baseUrl: z.string().url().max(500),
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().max(1000),
}).strict();

export function getDefaultSettingsPath(environment: NodeJS.ProcessEnv = process.env): string {
  const userDataDirectory = environment.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(userDataDirectory, "TuZheng", "settings.json");
}

export function toPublicModelSettings(settings: ModelSettings): PublicModelSettings {
  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    hasApiKey: settings.apiKey.length > 0,
  };
}

export class FileModelSettingsStore implements ModelSettingsStore {
  constructor(readonly filePath = getDefaultSettingsPath()) {}

  async read(): Promise<ModelSettings> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { ...DEFAULT_MODEL_SETTINGS };
      }
      throw error;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(contents) as unknown;
    } catch {
      throw new Error("本机模型设置文件无法读取，请在设置页重新保存。");
    }

    const parsed = storedSettingsSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error("本机模型设置文件格式无效，请在设置页重新保存。");
    }
    return parsed.data;
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
