import { mkdtemp, readFile, rm } from "node:fs/promises";
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

  it("将配置保存在指定的本机文件，并可由新实例读取", async () => {
    const store = await createTemporaryStore();
    const configured = {
      baseUrl: "https://vision.example/v1",
      model: "chart-reader-v2",
      apiKey: "local-test-secret",
    };

    await store.write(configured);
    const reopenedStore = new FileModelSettingsStore(store.filePath);

    await expect(reopenedStore.read()).resolves.toEqual(configured);
    await expect(readFile(store.filePath, "utf8")).resolves.toContain("local-test-secret");
    expect(toPublicModelSettings(configured)).toEqual({
      baseUrl: configured.baseUrl,
      model: configured.model,
      hasApiKey: true,
    });
    expect(JSON.stringify(toPublicModelSettings(configured))).not.toContain("local-test-secret");
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
