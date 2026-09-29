import { expect, test } from "@playwright/test";

const storedSettings = {
  activeProvider: "openai-responses",
  providers: {
    "openai-responses": { baseUrl: "https://saved.example/v1", model: "saved-model", hasApiKey: true },
    anthropic: { baseUrl: "https://anthropic.stored/v1", model: "claude-stored", hasApiKey: false },
  },
};

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

  await providerSelect.selectOption("anthropic");
  await expect(presetSelect.locator("option")).toContainText([
    "DeepSeek 官方 · V4.1 Flash 多模态",
    "阿里云百炼 · 通义千问 VL Flash 多模态",
  ]);

  await presetSelect.selectOption("deepseek-anthropic-flash");
  await expect(baseUrl).toHaveValue("https://api.deepseek.com/anthropic/v1");
  await expect(model).toHaveValue("deepseek-flash");
  await expect(page.getByText("已填入DeepSeek 官方 · V4.1 Flash 多模态", { exact: false })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth + 1),
  );
});
