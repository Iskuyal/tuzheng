import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import {
  activeProviderConfig, createDefaultModelSettings, createModelSettingsStore,
  EnvironmentModelSettingsStore, FileModelSettingsStore, settingsSource,
} from "../server/model-settings.js";
import { checkBalance, runPairedEvaluation, questionsCatalog, expectationsCatalog } from "../scripts/evaluate-source-audit.js";
import { SourceInvestigationError, type ToolLoopReply } from "../server/source-investigation.js";

const fakeKey = "fake-env-secret-for-tests";
const envConfig = {
  MODEL_CONFIG_SOURCE: "env", MODEL_PROVIDER: "anthropic",
  MODEL_BASE_URL: "https://env.example/v1", MODEL_NAME: "env-reader", MODEL_API_KEY: fakeKey,
};
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function temporaryEnvironment() {
  const directory = await mkdtemp(join(tmpdir(), "tu-zheng-env-"));
  directories.push(directory);
  return { ...envConfig, LOCALAPPDATA: directory };
}

describe("完整配置源选择与环境验证", () => {
  it.each([undefined, "file"])("%s 使用文件，忽略所有模型环境字段，并保留现有读写", async (source) => {
    const environment = { ...await temporaryEnvironment(), MODEL_CONFIG_SOURCE: source };
    const store = createModelSettingsStore(environment);
    expect(store).toBeInstanceOf(FileModelSettingsStore);
    expect(settingsSource(store)).toEqual({ source: "file", readOnly: false });
    expect(await store.read()).toEqual(createDefaultModelSettings());
    const saved = createDefaultModelSettings();
    saved.providers["openai-responses"] = { baseUrl: "https://file.example/v1", model: "file-reader", apiKey: "fake-file-key" };
    await store.write(saved);
    expect(await createModelSettingsStore(environment).read()).toEqual(saved);
    expect(JSON.stringify(await store.read())).not.toContain(fakeKey);
  });
  it("无效来源选择明确失败，消息不包含输入值", () => {
    expect(() => createModelSettingsStore({ MODEL_CONFIG_SOURCE: fakeKey })).toThrow("MODEL_CONFIG_SOURCE 只支持");
    try { createModelSettingsStore({ MODEL_CONFIG_SOURCE: fakeKey }); } catch (error) {
      expect(String(error)).not.toContain(fakeKey);
    }
  });
  it.each(["openai-responses", "anthropic"])("%s 环境快照完整且独立，完全忽略损坏文件", async (provider) => {
    const environment = { ...await temporaryEnvironment(), MODEL_PROVIDER: provider };
    const file = new FileModelSettingsStore(join(environment.LOCALAPPDATA, "TuZheng", "settings.json"));
    await file.write(createDefaultModelSettings());
    await writeFile(file.filePath, "{broken-file", "utf8");
    const before = await readFile(file.filePath, "utf8");
    const store = createModelSettingsStore(environment);
    environment.MODEL_API_KEY = "changed-after-start";
    const settings = await store.read();
    expect(activeProviderConfig(settings)).toEqual({ provider, config: {
      baseUrl: envConfig.MODEL_BASE_URL, model: envConfig.MODEL_NAME, apiKey: fakeKey,
    } });
    const inactive = provider === "anthropic" ? "openai-responses" : "anthropic";
    expect(settings.providers[inactive]).toEqual({ baseUrl: "", model: "", apiKey: "" });
    settings.providers[settings.activeProvider].apiKey = "mutated";
    expect(activeProviderConfig(await store.read()).config.apiKey).toBe(fakeKey);
    await expect(store.write(settings)).rejects.toThrow("只读");
    expect(await readFile(file.filePath, "utf8")).toBe(before);
  });
  it.each(["MODEL_PROVIDER", "MODEL_BASE_URL", "MODEL_NAME", "MODEL_API_KEY"])("缺少或空白 %s 不混用文件字段", async (name) => {
    const environment = await temporaryEnvironment();
    const file = createModelSettingsStore({ ...environment, MODEL_CONFIG_SOURCE: "file" });
    const saved = createDefaultModelSettings();
    saved.providers.anthropic = { baseUrl: "https://file.example/v1", model: "file-reader", apiKey: "fake-file-key" };
    await file.write(saved);
    for (const value of [undefined, "", "   "]) {
      const app = createApp({ settingsStore: createModelSettingsStore({ ...environment, [name]: value }) });
      const result = await request(app).get("/api/settings").expect(503);
      expect(result.body.error).toMatchObject({ code: "INVALID_ENV_SETTINGS" });
      expect(result.body.error.message).toContain(name);
      expect(result.body.configuration).toEqual({ source: "env", readOnly: true });
      expect(result.text).not.toContain(fakeKey);
      await request(app).post("/api/settings/test-connection").send({}).expect(503);
    }
    expect(await file.read()).toEqual(saved);
  });
  it.each([
    "http://remote.example/v1", "http://127.attacker.example/v1", "http://127.0.0.1.attacker.example/v1",
    "ftp://localhost/v1", "https://user:password@example.com/v1", "https://example.com/v1?key=secret",
    "https://example.com/v1#secret", "https://example.com/v1/responses", "https://example.com/v1/messages/",
    "https://example.com/v1/chat/completions", "not-a-url",
  ])("环境地址 %s 明确拒绝且不回传原值", async (baseUrl) => {
    const result = await request(createApp({ settingsStore: new EnvironmentModelSettingsStore({
      ...envConfig, MODEL_BASE_URL: baseUrl,
    }) })).get("/api/settings").expect(503);
    expect(result.body.error.code).toBe("INVALID_ENV_SETTINGS");
    expect(result.text).not.toContain(baseUrl);
    expect(result.text).not.toContain(fakeKey);
  });
  it.each(["https://remote.example/v1", "http://localhost:8080/v1", "http://127.0.0.2:8080/v1", "http://[::1]:8080/v1"])("环境地址 %s 可用", async (baseUrl) => {
    expect(activeProviderConfig(await new EnvironmentModelSettingsStore({ ...envConfig, MODEL_BASE_URL: baseUrl }).read()).config.baseUrl).toBe(baseUrl);
  });
  it.each([
    { MODEL_PROVIDER: fakeKey }, { MODEL_NAME: "x".repeat(121) }, { MODEL_API_KEY: "x".repeat(1001) },
  ])("非法协议或超长字段明确失败", async (overrides) => {
    await expect(new EnvironmentModelSettingsStore({ ...envConfig, ...overrides }).read()).rejects.toThrow();
  });
});

describe("环境配置消费与密钥边界（仅替身）", () => {
  it.each(["openai-responses", "anthropic"])("%s 来源恢复复用初查驱动器，完整配置不变且不读取文件", async (provider) => {
    const environment = { ...await temporaryEnvironment(), MODEL_PROVIDER: provider };
    const store = createModelSettingsStore(environment);
    const caption = "12 月 CPI 上涨 0.8%";
    const report = { id: "r1", name: "report_source_finding", input: {
      claims: [{ claimText: caption, metric: "全国居民消费价格", scope: "全国", period: "2025-12", value: 0.8,
        basis: null, kind: "direct", fromImage: false, imageExcerpt: null }],
      citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
      noApplicableSourceReason: null, unresolvedItems: [], omittedClaims: [],
    } };
    const reply = (calls: ToolLoopReply["calls"]): ToolLoopReply => ({ model: "stub", calls, text: null, usage: null, truncated: false });
    const replies = [reply([
      { id: "s1", name: "search_source_library", input: { metric: "全国居民消费价格", period: "2025-12", scope: "全国", terms: [] } },
      { id: "c1", name: "request_clarification", input: { question: "同比还是环比？", purpose: "确定比较口径", field: "basis", claimText: caption } },
    ]), reply([report])];
    const next = async () => replies.shift() ?? reply([report]);
    const driver = { model: "stub", start: next, continue: next, finalize: next, resume: vi.fn(next) };
    const factory = vi.fn((settings) => {
      expect(activeProviderConfig(settings)).toEqual({ provider, config: { baseUrl: envConfig.MODEL_BASE_URL, model: envConfig.MODEL_NAME, apiKey: fakeKey } });
      return driver;
    });
    const app = createApp({ settingsStore: store, investigationDriverFactory: factory });
    const initial = await request(app).post("/api/source-audit/investigate").field("caption", caption).attach("image", png, "test.png").expect(200);
    expect(initial.body.investigation.clarification).not.toBeNull();
    environment.MODEL_API_KEY = "changed-after-start";
    const resumed = await request(app).post("/api/source-audit/resume")
      .field("caption", caption).field("answer", "同比")
      .field("investigationId", initial.body.investigation.investigationId).attach("image", png, "test.png").expect(200);
    expect(factory).toHaveBeenCalledOnce();
    expect(driver.resume).toHaveBeenCalledOnce();
    expect(resumed.body.investigation.investigationId).toBe(initial.body.investigation.investigationId);
    expect(resumed.body.investigation.conclusions[0].status).toBe("source-match");
    expect(initial.text + resumed.text).not.toContain(fakeKey);
    expect(await readdir(environment.LOCALAPPDATA)).toEqual([]);
  });
  it.each(["openai-responses", "anthropic"])("%s 所有 API 入口共用完整配置；保存与表单覆盖被拒绝；密钥不落盘、不回传、不进日志", async (provider) => {
    const environment = { ...await temporaryEnvironment(), MODEL_PROVIDER: provider };
    const store = createModelSettingsStore(environment);
    const expected = activeProviderConfig(await store.read());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const connectionTester = vi.fn(async (settings) => {
      expect(activeProviderConfig(settings)).toEqual(expected);
      return { model: "stub-model", latencyMs: 1 };
    });
    const visionAdapterFactory = vi.fn((settings) => {
      expect(activeProviderConfig(settings)).toEqual(expected);
      return { extract: async () => { throw new Error(fakeKey); } };
    });
    const investigationDriverFactory = vi.fn((settings) => {
      expect(activeProviderConfig(settings)).toEqual(expected);
      return {
        model: "stub-model", start: async () => { throw new Error(fakeKey); },
        resume: async () => { throw new Error(fakeKey); },
        continue: async () => { throw new Error(fakeKey); }, finalize: async () => { throw new Error(fakeKey); },
      };
    });
    const app = createApp({ settingsStore: store, connectionTester, visionAdapterFactory, investigationDriverFactory });
    const settings = await request(app).get("/api/settings").expect(200);
    expect(settings.body.configuration).toEqual({ source: "env", readOnly: true });
    expect(settings.body.settings.providers[provider].hasApiKey).toBe(true);
    const rejected = await request(app).put("/api/settings").send({ apiKey: "replacement" }).expect(409);
    expect(rejected.body.error.code).toBe("SETTINGS_READ_ONLY");
    await request(app).post("/api/settings/test-connection").send({ provider, apiKey: "override" }).expect(400);
    expect(connectionTester).not.toHaveBeenCalled();
    const connection = await request(app).post("/api/settings/test-connection").send({}).expect(200);
    expect(connectionTester).toHaveBeenCalledOnce();
    const image = await request(app).post("/api/audit/image").attach("image", png, "test.png").expect(502);
    const source = await request(app).post("/api/source-audit/investigate").field("caption", "测试配文").attach("image", png, "test.png").expect(502);
    expect(visionAdapterFactory).toHaveBeenCalledOnce();
    expect(investigationDriverFactory).toHaveBeenCalledOnce();
    for (const response of [settings, rejected, connection, image, source]) expect(response.text).not.toContain(fakeKey);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(fakeKey);
    expect(await readdir(environment.LOCALAPPDATA)).toEqual([]);
  });
  it("环境配置无效时读图与调查均阻止模型入口，不创建配置文件", async () => {
    const environment = { ...await temporaryEnvironment(), MODEL_API_KEY: "" };
    const visionAdapterFactory = vi.fn();
    const investigationDriverFactory = vi.fn();
    const app = createApp({ settingsStore: createModelSettingsStore(environment), visionAdapterFactory, investigationDriverFactory });
    await request(app).post("/api/audit/image").attach("image", png, "test.png").expect(503);
    await request(app).post("/api/source-audit/investigate").field("caption", "测试配文").attach("image", png, "test.png").expect(503);
    expect(visionAdapterFactory).not.toHaveBeenCalled();
    expect(investigationDriverFactory).not.toHaveBeenCalled();
    expect(await readdir(environment.LOCALAPPDATA)).toEqual([]);
  });
  it("余额预检异常不能把环境密钥放入日志消息", async () => {
    const result = await checkBalance("https://api.deepseek.com/v1", fakeKey, 1, async () => { throw new Error(fakeKey); });
    expect(result.checked).toBe(false);
    expect(result.message).not.toContain(fakeKey);
  });
  it("评测失败日志和可落盘的记录只保留分类与状态，不保留上游密钥文本", async () => {
    const lines: string[] = [];
    const failure = async () => { throw new SourceInvestigationError("upstream", { cause: new Error(fakeKey) }); };
    const report = await runPairedEvaluation({ ...questionsCatalog, questions: questionsCatalog.questions.slice(0, 1) }, expectationsCatalog, {
      runs: 1, arms: ["retrieval"], log: (line) => lines.push(line),
      driverFactory: () => ({ model: "stub", start: failure, continue: failure, finalize: failure, resume: failure }),
    });
    expect(report.records[0].failureKind).toBe("upstream");
    expect(JSON.stringify(report) + lines.join("")).not.toContain(fakeKey);
  });
});
