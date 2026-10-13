import { expect, test } from "@playwright/test";
import { tabTo } from "./keyboard.js";

test("首页来源主入口载入 CPI 输入，刷新保留入口语义且不自动调用模型", async ({ page }) => {
  let modelRequests = 0;
  await page.route(/\/api\/(source-audit\/(investigate|resume)|audit\/image|settings\/test-connection)$/, async (route) => {
    modelRequests += 1;
    await route.fulfill({ status: 503, json: { error: { message: "本用例不调用模型" } } });
  });
  await page.goto("/");
  const entry = page.getByRole("link", { name: "试用 CPI 来源核验样例" });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute("href", "/source-audit?sample=cpi-2025-12");
  await entry.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await expect(page.getByLabel("要核对的配文", { exact: false })).toHaveValue("比上月上涨 0.8%");
  await expect(page.locator(".source-input-notice")).toContainText("未开始核验");
  await expect(page.locator("h1")).toBeFocused();
  await expect(page.locator(".source-result")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await expect(page.getByTestId("run-source-audit")).toBeEnabled();
  await page.waitForLoadState("networkidle");
  expect(modelRequests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("来源输入、原生文件选择、技术展开与取消可用键盘完成，焦点和反馈清晰", async ({ page }) => {
  let requests = 0;
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/source-audit/investigate", async (route) => {
    requests += 1;
    await pending;
    await route.fulfill({ status: 503, json: { error: { message: "替身响应" } } }).catch(() => {});
  });
  await page.goto("/source-audit");
  const mechanism = page.locator(".source-mechanism summary");
  await tabTo(page, mechanism);
  await expect(mechanism).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page.locator(".source-mechanism")).toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  const upload = page.getByLabel("选择图表图片", { exact: true });
  await tabTo(page, upload);
  await expect(page.locator(".source-panel .upload-button")).toHaveCSS("outline-style", "solid");
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles("web/public/samples/cpi-2025-12.png");
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  const caption = page.locator("#source-audit-caption");
  await tabTo(page, caption);
  await page.keyboard.type("比上月上涨 0.8%");
  await expect(caption).toHaveAttribute("aria-describedby", "source-caption-hint");
  const run = page.getByTestId("run-source-audit");
  await tabTo(page, run);
  await page.keyboard.press("Enter");
  await expect(run).toBeDisabled();
  await expect(page.locator(".sr-only[role=status]")).toContainText("可取消");
  const cancel = page.getByRole("button", { name: "取消核验" });
  await tabTo(page, cancel);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("已取消");
  await expect(run).toBeFocused();
  await expect(caption).toHaveValue("比上月上涨 0.8%");
  expect(requests).toBe(1);
  finish();
});

test("CPI 深链载入失败有反馈，手动上传可恢复且无模型请求", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/source-audit/sample", (route) => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/source-audit/investigate", async (route) => { attempts += 1; await route.abort(); });
  await page.goto("/source-audit?sample=cpi-2025-12");
  await expect(page.getByRole("alert")).toContainText("手动上传");
  await page.getByLabel("选择图表图片", { exact: true }).setInputFiles("web/public/samples/cpi-2025-12.png");
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".source-input-notice")).toContainText("未开始核验");
  expect(attempts).toBe(0);
});

test("CPI 图片迟到时不会覆盖用户已修改的配文或新上传的图片", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let downloading = false;
  await page.route("**/samples/cpi-2025-12.png", async (route) => {
    downloading = true;
    await gate;
    await route.continue();
  });
  await page.goto("/source-audit?sample=cpi-2025-12");
  await expect.poll(() => downloading).toBe(true);
  await page.locator("#source-audit-caption").fill("这是用户正在编辑的配文");
  await page.getByLabel("选择图表图片", { exact: true }).setInputFiles("web/public/samples/consistent.png");
  release();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#source-audit-caption")).toHaveValue("这是用户正在编辑的配文");
  await expect(page.locator(".source-file-name")).toContainText("consistent.png");
});

test("模型预设键盘分组选择只填入参数，历史实测与文档预设不会冒充当前通过", async ({ page }) => {
  let writes = 0;
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "GET") writes += 1;
    await route.fulfill({ json: { settings: { activeProvider: "openai-responses", providers: {
      "openai-responses": { baseUrl: "https://example.com/v1", model: "offline", hasApiKey: false },
      anthropic: { baseUrl: "https://example.com/v1", model: "offline", hasApiKey: false },
    } }, configuration: { source: "file", readOnly: false } } });
  });
  await page.route("**/api/settings/test-connection", async (route) => { writes += 1; await route.abort(); });
  await page.goto("/settings");
  await expect(page.locator(".settings-evidence")).toContainText("尚无与 Messages 同等");
  const presets = page.locator(".settings-field select").nth(1);
  await tabTo(page, presets);
  await expect(presets).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".settings-field small[role=status]")).toContainText("历史实测，不代表当前配置通过");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.locator(".settings-field small[role=status]")).toContainText("文档预设，未完成在线验收");
  await expect(page.locator(".settings-feedback.success-feedback")).toHaveCount(0);
  expect(writes).toBe(0);
});

test("窄屏导航的键盘展开、Escape 返回焦点以及标题焦点", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "1280px", "桌面导航直接可见");
  await page.goto("/");
  const menu = page.locator(".mobile-menu-button");
  await tabTo(page, menu);
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  const source = page.getByRole("navigation").getByRole("link", { name: "来源核验" });
  await tabTo(page, source);
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await tabTo(page, source);
  await page.keyboard.press("Enter");
  await expect(page.locator("h1")).toBeFocused();
});

test("保留图内样例入口，键盘确认得到图内结论及可展开证据", async ({ page }) => {
  await page.goto("/audit?sample=multi-claims");
  const card = page.locator(".claim-observation-card").first();
  const confirm = card.getByRole("button", { name: "确认并计算此主张" });
  await tabTo(page, confirm);
  await page.keyboard.press("Enter");
  await expect(card).toContainText("图内一致");
  const record = card.locator(".claim-audit-log summary");
  await tabTo(page, record);
  await page.keyboard.press("Enter");
  await expect(card.locator(".claim-audit-log")).toHaveAttribute("open", "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
