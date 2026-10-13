import { expect, test } from "@playwright/test";

const storedSettings = {
  activeProvider: "openai-responses",
  providers: {
    "openai-responses": { baseUrl: "https://saved.example/v1", model: "saved-model", hasApiKey: true },
    anthropic: { baseUrl: "https://anthropic.stored/v1", model: "claude-stored", hasApiKey: false },
  },
};

test("环境配置显示来源、锁定编辑，密钥留空且连接测试只提交空对象", async ({ page }) => {
  let saves = 0;
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT") saves += 1;
    await route.fulfill({ status: 200, json: {
      settings: { ...storedSettings, activeProvider: "anthropic", providers: {
        ...storedSettings.providers,
        anthropic: { ...storedSettings.providers.anthropic, hasApiKey: true },
      } },
      configuration: { source: "env", readOnly: true },
    } });
  });
  let attempts = 0;
  await page.route("**/api/settings/test-connection", async (route) => {
    expect(route.request().postDataJSON()).toEqual({});
    attempts += 1;
    await route.fulfill({ status: 200, json: { connection: { model: "env-stub", latencyMs: 1 } } });
  });
  await page.goto("/settings");
  await expect(page.locator(".settings-source")).toContainText("服务端环境（env） · 只读");
  for (const input of await page.locator(".settings-field input, .settings-field select").all()) await expect(input).toBeDisabled();
  await expect(page.locator('input[type="password"]')).toHaveValue("");
  await expect(page.locator('input[type="password"]')).toHaveAttribute("placeholder", "环境密钥不回显");
  await expect(page.getByRole("button", { name: "保存设置" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "清除已保存 Key" })).toHaveCount(0);
  expect(attempts).toBe(0); // 不自动测通，只有点击后才请求（这里是 route 替身）。
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.locator(".success-feedback")).toContainText("连接成功：env-stub");
  expect(saves).toBe(0);
  expect(attempts).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth + 1),
  );
});

test("环境配置缺项显示错误和只读来源，不展示默认配置或提供保存入口", async ({ page }) => {
  await page.route("**/api/settings", async (route) => {
    await route.fulfill({ status: 503, json: {
      error: { code: "INVALID_ENV_SETTINGS", message: "服务端环境配置缺少：MODEL_API_KEY。请补齐后重启服务。" },
      configuration: { source: "env", readOnly: true },
    } });
  });
  await page.goto("/settings");
  await expect(page.locator(".settings-source")).toContainText("服务端环境（env） · 只读");
  await expect(page.getByRole("alert")).toContainText("MODEL_API_KEY");
  await expect(page.locator(".settings-form")).toHaveCount(0);
});

test("损坏的文件配置仍允许在设置页重新填写并保存", async ({ page }) => {
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 503, json: {
        error: { code: "INVALID_STORED_SETTINGS", message: "本机模型设置文件无法读取。请重新填写两种协议并保存。" },
        configuration: { source: "file", readOnly: false },
      } });
    } else {
      expect(route.request().postDataJSON()).toMatchObject({ apiKey: "fake-recovery-key" });
      await route.fulfill({ status: 200, json: { settings: storedSettings, configuration: { source: "file", readOnly: false } } });
    }
  });
  await page.goto("/settings");
  await expect(page.getByRole("alert")).toContainText("重新填写");
  await expect(page.locator(".settings-source")).toContainText("本机文件（file） · 可编辑");
  await page.locator('input[type="password"]').fill("fake-recovery-key");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.locator(".success-feedback")).toContainText("设置已保存到本机");
  await expect(page.locator('input[type="password"]')).toHaveValue("");
});

test("模型设置可用未保存参数测试连接，并区分成功和鉴权失败", async ({ page }) => {
  let saves = 0;
  let attempts = 0;
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT") saves += 1;
    await route.fulfill({ status: 200, json: { settings: storedSettings } });
  });
  await page.route("**/api/settings/test-connection", async (route) => {
    const submitted = route.request().postDataJSON();
    expect(submitted).toMatchObject({
      provider: "openai-responses",
      baseUrl: attempts === 0 ? "https://new.example/v1" : "https://bad.example/v1",
      model: "new-model",
      apiKey: "unsaved-test-key",
    });
    attempts += 1;
    await route.fulfill(attempts === 1
      ? { status: 200, json: { connection: { model: "new-model", latencyMs: 321 } } }
      : { status: 502, json: { error: { code: "MODEL_AUTH_FAILED", message: "API Key 无效或没有访问此模型的权限。" } } });
  });

  await page.goto("/settings");
  const baseUrl = page.locator(".settings-field input[type=url]");
  const model = page.locator(".settings-field input[type=text]");
  const apiKey = page.locator(".settings-field input[type=password]");
  // 测试说明写清「测通 ≠ 能读图」，避免把纯文本模型当成可用配置。
  await expect(page.locator(".settings-test-note")).toContainText("测试通过不代表能读图");
  await expect(page.locator(".settings-test-note")).toContainText("纯文本模型也可能测通");
  await baseUrl.fill("https://new.example/v1");
  await model.fill("new-model");
  await apiKey.fill("unsaved-test-key");
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.locator(".settings-feedback.success-feedback")).toContainText("连接成功：new-model，耗时 321 毫秒");
  await expect(page.locator(".settings-feedback.success-feedback")).toContainText("已验证Responses 结构化输出");
  await expect(page.locator(".settings-feedback.success-feedback")).toContainText("图片识别仍需上传样例核验");
  await expect(apiKey).toHaveValue("unsaved-test-key");
  expect(saves).toBe(0);

  await baseUrl.fill("https://bad.example/v1");
  await expect(page.locator(".settings-feedback.success-feedback")).toHaveCount(0);
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.locator(".settings-feedback.error-feedback")).toContainText("API Key 无效");
  expect(attempts).toBe(2);
  expect(saves).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth + 1),
  );
});

test("切换协议带出该协议已存配置，并按所选协议测试连接", async ({ page }) => {
  await page.route("**/api/settings", async (route) => {
    await route.fulfill({ status: 200, json: { settings: storedSettings } });
  });
  let submitted: unknown;
  await page.route("**/api/settings/test-connection", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 200, json: { connection: { model: "claude-live", latencyMs: 210 } } });
  });

  await page.goto("/settings");
  const baseUrl = page.locator(".settings-field input[type=url]");
  const model = page.locator(".settings-field input[type=text]");
  const providerSelect = page.locator(".settings-field select").first();
  await expect(baseUrl).toHaveValue("https://saved.example/v1");
  await expect(model).toHaveValue("saved-model");

  await providerSelect.selectOption("anthropic");
  await expect(baseUrl).toHaveValue("https://anthropic.stored/v1");
  await expect(model).toHaveValue("claude-stored");
  await expect(page.locator(".settings-field small", { hasText: "自行调用 `/messages`" })).toBeVisible();

  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.locator(".settings-feedback.success-feedback")).toContainText("连接成功：claude-live");
  await expect(page.locator(".settings-feedback.success-feedback")).toContainText("Messages 工具调用结构化输出");
  expect(submitted).toMatchObject({
    provider: "anthropic",
    baseUrl: "https://anthropic.stored/v1",
    model: "claude-stored",
  });

  await providerSelect.selectOption("openai-responses");
  await expect(baseUrl).toHaveValue("https://saved.example/v1");
  await expect(page.locator(".settings-feedback.success-feedback")).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth + 1),
  );
});

test("模型预设按协议过滤，选取后填入地址与型号", async ({ page }) => {
  await page.route("**/api/settings", async (route) => {
    await route.fulfill({ status: 200, json: { settings: storedSettings } });
  });

  await page.goto("/settings");
  const baseUrl = page.locator(".settings-field input[type=url]");
  const model = page.locator(".settings-field input[type=text]");
  const providerSelect = page.locator(".settings-field select").first();
  const presetSelect = page.locator(".settings-field select").nth(1);

  await expect(presetSelect.locator("option")).toContainText(["OpenAI 官方 · GPT-4.1 mini"]);
  // 名称按官方写法（Command Code），并带「本项目已实测」标注。
  await expect(presetSelect.locator('option[value="commandcode-responses-deepseek"]'))
    .toHaveText("Command Code 网关 · DeepSeek V4.1 Flash（历史实测）");
  // 2026-10-01 按端点核实扩充的条目：百炼补上了「只有 Anthropic 面」的不对称。
  await expect(presetSelect.locator('option[value="dashscope-responses-qwen-flash"]'))
    .toHaveText("阿里云百炼 · Qwen3.8 Flash 多模态（文档预设·未在线验收）");
  await expect(presetSelect.locator('option[value="moonshot-responses-kimi-k3"]'))
    .toHaveText("Moonshot 官方 · Kimi K3 多模态（文档预设·未在线验收）");
  // 2026-10-02「未核实清单收口」：智谱的 Responses 面是独立基址，StepFun 两侧都能落。
  await expect(presetSelect.locator('option[value="zhipu-responses-glm"]'))
    .toHaveText("智谱开放平台 · GLM-5.3 多模态（Response API）（文档预设·未在线验收）");
  await expect(presetSelect.locator('option[value="stepfun-responses-step-flash"]'))
    .toHaveText("阶跃星辰 StepFun · Step 3.7 Flash 多模态（Responses 面）（文档预设·未在线验收）");
  // 2026-10-02 二轮深挖：DeepInfra / 七牛云 / AI-ML API 的 Responses 面。
  await expect(presetSelect.locator('option[value="deepinfra-responses-qwen-vl"]'))
    .toHaveText("DeepInfra · Qwen3-VL 235B 多模态（Responses 面）（文档预设·未在线验收）");
  await expect(presetSelect.locator('option[value="qiniu-responses-gpt"]'))
    .toHaveText("七牛云 AI · GPT-5 多模态（Responses 面）（文档预设·未在线验收）");
  await expect(presetSelect.locator('option[value="aimlapi-responses-gpt-sol"]'))
    .toHaveText("AI-ML API · GPT-6 Sol 多模态（文档预设·未在线验收）");
  // 多模态要求与「两侧预设为什么不同」写在页面上（桌面走侧栏说明、窄屏走移动端说明），不是只写在 README 里。
  await expect(page.locator("li", { hasText: "所配模型必须支持图片输入（多模态）" }).first()).toBeAttached();
  await expect(page.locator("small", { hasText: "同一家服务商只在支持该协议的端点上出现" }).first()).toBeAttached();

  await providerSelect.selectOption("anthropic");
  await expect(presetSelect.locator("option")).toContainText([
    "DeepSeek 官方 · V4.1 Flash 多模态",
    "阿里云百炼 · Qwen3.8 Flash 多模态",
    "智谱开放平台 · GLM-5.3-Flash 原生多模态",
  ]);
  await expect(presetSelect.locator('option[value="minimax-anthropic-m3-flash"]'))
    .toHaveText("MiniMax 官方 · M3.1 Flash 多模态（文档预设·未在线验收）");
  await expect(presetSelect.locator('option[value="fireworks-anthropic-kimi-k3"]'))
    .toHaveText("Fireworks AI · Kimi K3 多模态（文档预设·未在线验收）");
  await expect(presetSelect.locator('option[value="stepfun-anthropic-step-flash"]'))
    .toHaveText("阶跃星辰 StepFun · Step 3.7 Flash 多模态（Anthropic 面）（文档预设·未在线验收）");
  await expect(presetSelect.locator('option[value="kimi-coding-anthropic-k3"]'))
    .toHaveText("Kimi 编码套餐 · K3 多模态（Anthropic 面）（文档预设·未在线验收）");
  await expect(presetSelect.locator('option[value="qiniu-anthropic-claude"]'))
    .toHaveText("七牛云 AI · Claude Opus 4.6 多模态（Anthropic 面）（文档预设·未在线验收）");

  await presetSelect.selectOption("deepseek-anthropic-flash");
  await expect(baseUrl).toHaveValue("https://api.deepseek.com/anthropic/v1");
  await expect(model).toHaveValue("deepseek-flash");
  await expect(page.getByText("已填入DeepSeek 官方 · V4.1 Flash 多模态", { exact: false })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth + 1),
  );
});
