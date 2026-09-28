import { expect, test } from "@playwright/test";

test("模型设置可用未保存参数测试连接，并区分成功和鉴权失败", async ({ page }) => {
  let saves = 0;
  let attempts = 0;
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT") saves += 1;
    await route.fulfill({
      status: 200,
      json: { settings: { baseUrl: "https://saved.example/v1", model: "saved-model", hasApiKey: true } },
    });
  });
  await page.route("**/api/settings/test-connection", async (route) => {
    const submitted = route.request().postDataJSON();
    expect(submitted).toMatchObject({
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
