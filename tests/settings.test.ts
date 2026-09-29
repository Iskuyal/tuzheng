import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_SETTINGS,
  FileModelSettingsStore,
  getDefaultSettingsPath,
  toPublicModelSettings,
} from "../server/model-settings.js";

const temporaryDirectories: string[] = [];

async function createTemporaryStore(): Promise<FileModelSettingsStore> {
  const directory = await mkdtemp(join(tmpdir(), "tu-zheng-settings-"));
  temporaryDirectories.push(directory);
  return new FileModelSettingsStore(join(directory, "settings.json"));
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("本机模型设置存储", () => {
  it("缺少本机配置文件时返回安全默认项", async () => {
    const store = await createTemporaryStore();

    await expect(store.read()).resolves.toEqual(DEFAULT_MODEL_SETTINGS);
  });

  it("将两种协议的配置保存在指定的本机文件，并可由新实例读取", async () => {
    const store = await createTemporaryStore();
    const configured = {
      activeProvider: "anthropic" as const,
      providers: {
        "openai-responses": {
          baseUrl: "https://openai.example/v1",
          model: "gpt-reader",
          apiKey: "openai-local-secret",
        },
        anthropic: {
          baseUrl: "https://anthropic.example/v1",
          model: "claude-reader",
          apiKey: "anthropic-local-secret",
        },
      },
    };

    await store.write(configured);
    const reopenedStore = new FileModelSettingsStore(store.filePath);

    await expect(reopenedStore.read()).resolves.toEqual(configured);
    await expect(readFile(store.filePath, "utf8")).resolves.toContain("anthropic-local-secret");

    const publicSettings = toPublicModelSettings(configured);
    expect(publicSettings).toEqual({
      activeProvider: "anthropic",
      providers: {
        "openai-responses": { baseUrl: "https://openai.example/v1", model: "gpt-reader", hasApiKey: true },
        anthropic: { baseUrl: "https://anthropic.example/v1", model: "claude-reader", hasApiKey: true },
      },
    });
    expect(JSON.stringify(publicSettings)).not.toContain("anthropic-local-secret");
    expect(JSON.stringify(publicSettings)).not.toContain("openai-local-secret");
  });

  it("旧版扁平设置文件读取时迁移为 Responses 配置并补 Anthropic 默认值", async () => {
    const store = await createTemporaryStore();
    await writeFile(store.filePath, JSON.stringify({
      baseUrl: "https://legacy.example/v1",
      model: "legacy-reader",
      apiKey: "legacy-secret",
    }), "utf8");

    await expect(store.read()).resolves.toEqual({
      activeProvider: "openai-responses",
      providers: {
        "openai-responses": {
          baseUrl: "https://legacy.example/v1",
          model: "legacy-reader",
          apiKey: "legacy-secret",
        },
        anthropic: { ...DEFAULT_MODEL_SETTINGS.providers.anthropic },
      },
    });
  });

  it("拒绝无法读取、协议名无效或缺少启用配置的设置文件", async () => {
    const store = await createTemporaryStore();
    await writeFile(store.filePath, "not-json", "utf8");
    await expect(store.read()).rejects.toThrow("本机模型设置文件无法读取");

    await writeFile(store.filePath, JSON.stringify({
      activeProvider: "gemini",
      providers: {},
    }), "utf8");
    await expect(store.read()).rejects.toThrow("本机模型设置文件格式无效");

    await writeFile(store.filePath, JSON.stringify({
      baseUrl: "https://only.example/v1",
      model: "legacy-reader",
    }), "utf8");
    await expect(store.read()).rejects.toThrow("本机模型设置文件格式无效");
  });

  it("默认路径位于 Windows 当前用户的本机配置目录", () => {
    const path = getDefaultSettingsPath({
      LOCALAPPDATA: "C:\\Users\\reader\\AppData\\Local",
    });

    expect(path).toContain("TuZheng");
    expect(path.startsWith("C:\\Users\\reader\\AppData\\Local")).toBe(true);
    expect(path).not.toContain("web-match");
  });
});
