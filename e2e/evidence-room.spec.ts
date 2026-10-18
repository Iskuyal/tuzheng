import { expect, test } from "@playwright/test";

test("证据阅读室：自己的图文从首页进入来源工作台，不自动发送模型", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/source-audit/investigate", async (route) => { requests += 1; await route.abort(); });
  await page.goto("/");
  await page.locator("#landing-source-upload").setInputFiles("web/public/samples/consistent.png", { timeout: 2500 });
  await expect(page).toHaveURL(/\/source-audit$/);
  await expect(page.locator(".source-file-name")).toContainText("consistent.png");
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await expect(page.locator("#source-audit-caption")).toHaveValue("");
  await page.waitForLoadState("networkidle");
  expect(requests).toBe(0);
});

test("证据阅读室：模型设置返回后保留图像和编辑中的配文", async ({ page }) => {
  await page.goto("/source-audit?sample=cpi-2025-12");
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await page.locator("#source-audit-caption").fill("尚未核验的自定义配文");
  await page.getByTestId("source-model-settings").click({ timeout: 2500 });
  await expect(page).toHaveURL(/\/settings\?/);
  await page.getByRole("link", { name: "返回来源核验材料" }).click();
  await expect(page.locator("#source-audit-caption")).toHaveValue("尚未核验的自定义配文");
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await expect(page.locator(".source-result")).toHaveCount(0);
});

test("证据阅读室：回到首页再次选择 CPI 样例，替换旧材料且不发模型请求", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/source-audit/investigate", async (route) => { requests += 1; await route.abort(); });
  await page.goto("/source-audit");
  await page.getByLabel("选择图表图片", { exact: true }).setInputFiles("web/public/samples/consistent.png");
  await page.locator("#source-audit-caption").fill("旧配文");
  await page.getByRole("link", { name: "图证首页" }).click();
  await page.getByRole("link", { name: "试用 CPI 来源核验样例" }).click();
  await expect(page.locator("#source-audit-caption")).toHaveValue("比上月上涨 0.8%", { timeout: 2500 });
  await expect(page.locator(".source-file-name")).toContainText("CPI 图文来源核验样例");
  expect(requests).toBe(0);
});

test("证据阅读室：原图可键盘放大，Escape 关闭并返回触发按钮", async ({ page }, testInfo) => {
  await page.goto("/source-audit?sample=cpi-2025-12");
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  const open = page.getByRole("button", { name: "放大查看原图" });
  await open.click({ timeout: 2500 });
  const dialog = page.getByRole("dialog", { name: "查看图表原图" });
  await expect(dialog).toBeVisible();
  const before = await dialog.locator("output").innerText();
  await dialog.getByRole("button", { name: "放大", exact: true }).click();
  await expect(dialog.locator("output")).not.toHaveText(before);
  await page.screenshot({ path: testInfo.outputPath("original-preview.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(open).toBeFocused();
});

test("证据阅读室：取消新图片选择后，预览和核验仍使用已选材料", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/source-audit/investigate", async (route) => {
    requests += 1;
    expect(route.request().postDataBuffer()?.includes(Buffer.from("consistent.png"))).toBe(true);
    await route.fulfill({ status: 503, json: { error: { message: "离线恢复测试，不调用模型" } } });
  });
  await page.goto("/source-audit");
  const upload = page.getByLabel("选择图表图片", { exact: true });
  await upload.setInputFiles("web/public/samples/consistent.png");
  await page.locator("#source-audit-caption").fill("测试配文");
  await upload.setInputFiles([]);
  await page.getByTestId("run-source-audit").click();
  await expect.poll(() => requests, { timeout: 2500 }).toBe(1);
  await expect(page.locator(".source-file-name")).toContainText("consistent.png");
  await expect(page.getByRole("alert")).toContainText("离线恢复测试");
});
