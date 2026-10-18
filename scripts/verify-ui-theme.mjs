// 浏览器实测全量页面的视觉契约。只使用本机页面、假设置和网络替身。
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { chromium } from "@playwright/test";

const baseURL = process.env.UI_BASE_URL ?? "http://127.0.0.1:5173";
const output = resolve(process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ?? "docs/evidence/evidence-room-full-2026-10-18/current");
const routeSource = await readFile("web/router.ts", "utf8");
const routes = [...routeSource.matchAll(/path:\s*"([^"]+)"/g)].map((match) => match[1]).filter((path) => !path.includes(":"));
const names = { "/": "home", "/audit": "audit", "/source-audit": "source", "/settings": "settings" };
const queries = { "/audit": "?sample=multi-claims", "/source-audit": "?sample=cpi-2025-12" };
const fakeSettings = { settings: { activeProvider: "openai-responses", providers: {
  "openai-responses": { baseUrl: "https://ui-fixture.example/v1", model: "vision-ui-fixture", hasApiKey: true },
  anthropic: { baseUrl: "https://ui-fixture.example/v1", model: "vision-ui-fixture", hasApiKey: true },
} }, configuration: { source: "file", readOnly: false } };
const legacyPaints = new Set(["rgb(230, 239, 240)", "rgb(16, 36, 58)", "rgb(23, 47, 70)", "rgb(201, 234, 112)", "rgb(54, 91, 230)", "rgb(232, 235, 255)"]);
const records = [];
const pageErrors = [];
let unexpectedPosts = 0;
let stubConnectionRequests = 0;
async function captureState(page, width, path, state, clip) {
  if (state.includes("fixture")) await page.evaluate(() => {
    if (document.getElementById("ui-theme-fixture-note")) return;
    const note = document.createElement("p");
    note.id = "ui-theme-fixture-note";
    note.textContent = "离线 UI 验证 · 假设置与替身连接响应 · 非真实模型实测";
    note.style.cssText = "padding:12px;background:#f3ebd8;color:#173f35;font:13px/1.7 sans-serif";
    document.querySelector("main").prepend(note);
  });
  await page.evaluate(() => document.activeElement?.blur());
  const file = `${names[path]}-${state}-${width}.png`;
  if (clip) await page.locator(clip).screenshot({ path: join(output, file) });
  else await page.screenshot({ path: join(output, file), fullPage: true });
  const view = await page.evaluate((oldPaints) => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    legacyPaints: Array.from(document.querySelectorAll("main *")).flatMap((node) => {
      if (node.closest("svg") || node.tagName === "IMG") return [];
      const rect = node.getBoundingClientRect();
      const background = getComputedStyle(node).backgroundColor;
      return rect.width >= 60 && rect.height >= 20 && oldPaints.includes(background) ? [{ className: node.className, background }] : [];
    }),
  }), [...legacyPaints]);
  const problems = [];
  if (view.overflow > 1) problems.push(`横向溢出 ${view.overflow}px`);
  if (view.legacyPaints.length) problems.push(`仍有 ${view.legacyPaints.length} 处旧主题背景`);
  records.push({ route: path, state, width, file, clip: clip ?? null, ...view, problems, sha256: createHash("sha256").update(await readFile(join(output, file))).digest("hex"), identity: "实际页面；自制图或假配置；连接响应为替身" });
}
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 }, serviceWorkers: "block" });
    const page = await context.newPage();
    let settingsProfile = fakeSettings;
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await context.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === "POST" && ["/api/audit/sample", "/api/audit/check"].includes(path)) await route.continue();
      else if (route.request().method() !== "GET") {
        unexpectedPosts += 1;
        await route.fulfill({ status: 503, json: { error: { message: "全站视觉检查不执行真实写入或模型调用。" } } });
      } else if (path === "/api/settings") await route.fulfill({ json: settingsProfile });
      else await route.continue();
    });
    for (const path of routes) {
      await page.goto(baseURL + path + (queries[path] ?? ""), { waitUntil: "networkidle" });
      await page.locator("main h1").waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => document.activeElement?.blur());
      const view = await page.locator("main").evaluate((main, legacyColors) => {
        let root = main.parentElement;
        let canvas = "";
        while (root) {
          canvas = getComputedStyle(root).backgroundColor;
          if (canvas !== "rgba(0, 0, 0, 0)" && canvas !== "transparent") break;
          root = root.parentElement;
        }
        const heading = getComputedStyle(main.querySelector("h1"));
        const paints = Array.from(main.querySelectorAll("*")).flatMap((node) => {
          if (node.closest("svg") || ["IMG", "CANVAS"].includes(node.tagName)) return [];
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          if (box.width < 60 || box.height < 20 || style.display === "none") return [];
          return legacyColors.includes(style.backgroundColor) ? [{ element: node.tagName, className: node.className, background: style.backgroundColor }] : [];
        });
        return { canvas, headingFont: heading.fontFamily, headingColor: heading.color, overflow: document.documentElement.scrollWidth - innerWidth, legacyPaints: paints };
      }, [...legacyPaints]);
      const file = `${names[path] ?? path.replaceAll("/", "-")}-${width}.png`;
      await page.screenshot({ path: join(output, file), fullPage: true });
      const problems = [];
      if (view.canvas !== "rgb(233, 226, 213)") problems.push("页面画布没有采用本轮暖纸色主题");
      if (!view.headingFont.includes("Noto Serif SC")) problems.push("主标题仍是旧字体体系");
      if (view.headingColor !== "rgb(43, 53, 81)") problems.push("主标题未使用本轮靛蓝主题色");
      if (view.overflow > 1) problems.push(`横向溢出 ${view.overflow}px`);
      if (view.legacyPaints.length) problems.push(`仍有 ${view.legacyPaints.length} 处旧主题大块背景`);
      records.push({ route: path, width, file, ...view, problems, sha256: createHash("sha256").update(await readFile(join(output, file))).digest("hex"), settingsIdentity: path === "/settings" ? "假设置，不是用户实际模型或密钥" : null });
      if (process.argv.includes("--text-200")) {
        await page.evaluate(() => {
          const nodes = [...document.querySelectorAll("body *")].filter((node) => [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim()));
          const styles = nodes.map((node) => ({ node, size: parseFloat(getComputedStyle(node).fontSize), lineHeight: parseFloat(getComputedStyle(node).lineHeight) }));
          for (const item of styles) {
            item.node.style.fontSize = `${item.size * 2}px`;
            if (Number.isFinite(item.lineHeight)) item.node.style.lineHeight = `${item.lineHeight * 2}px`;
          }
        });
        const zoom = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, offenders: [...document.querySelectorAll("main *")].filter((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.right > innerWidth + 1 && getComputedStyle(node).position !== "absolute"; }).slice(0, 5).map((node) => ({ tag: node.tagName, className: node.className })) }));
        records.at(-1).text200Percent = zoom;
        if (zoom.overflow > 1) problems.push(`计算字号和行高放大到200%后溢出 ${zoom.overflow}px`);
      }
    }
    if (process.argv.includes("--states")) {
      await page.goto(baseURL + "/audit?sample=multi-claims", { waitUntil: "networkidle" });
      await page.locator(".claim-observation-card").first().getByRole("button", { name: "确认并计算此主张" }).click();
      await captureState(page, width, "/audit", "multi-result");
      await page.getByRole("button", { name: "放大查看", exact: true }).click();
      await captureState(page, width, "/audit", "image-viewer", "dialog[open]");
      await page.keyboard.press("Escape");
      await page.goto(baseURL + "/audit?sample=axis-truncated", { waitUntil: "networkidle" });
      await page.locator(".observation-form .confirm-button").click();
      await captureState(page, width, "/audit", "axis", ".axis-section");
      await page.goto(baseURL + "/audit?sample=cross-a-revenue", { waitUntil: "networkidle" });
      const cross = page.locator(".cross-section");
      await cross.locator("select").first().selectOption("cross-b-conflict");
      await cross.locator(".cross-side-note .cross-confirm-button").click();
      await page.locator(".observation-form .confirm-button").click();
      await page.locator(".cross-result").waitFor();
      await captureState(page, width, "/audit", "cross-result", ".cross-section");
      settingsProfile = { ...fakeSettings, configuration: { source: "env", readOnly: true } };
      await page.goto(baseURL + "/settings", { waitUntil: "networkidle" });
      await captureState(page, width, "/settings", "readonly-fixture");
      let connectionFails = false;
      await page.route("**/api/settings/test-connection", async (route) => {
        stubConnectionRequests += 1;
        await route.fulfill(connectionFails ? { status: 502, json: { error: { code: "MODEL_AUTH_FAILED", message: "离线替身：API Key 无效或没有访问此模型的权限。" } } } : { json: { connection: { model: "vision-ui-fixture", latencyMs: 10 } } });
      });
      await page.getByRole("button", { name: "测试连接", exact: true }).click();
      await page.locator(".success-feedback").waitFor();
      await captureState(page, width, "/settings", "connection-success-fixture");
      settingsProfile = fakeSettings;
      await page.goto(baseURL + "/settings", { waitUntil: "networkidle" });
      connectionFails = true;
      await page.getByRole("button", { name: "测试连接", exact: true }).click();
      await page.locator(".error-feedback").waitFor();
      await captureState(page, width, "/settings", "connection-error-fixture");
      await page.getByRole("button", { name: "清除已保存 Key" }).click();
      await captureState(page, width, "/settings", "clear-pending-fixture");
    }
    await context.close();
  }
} finally { await browser.close(); }
async function filesIn(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesIn(`${folder}/${entry.name}`) : `${folder}/${entry.name}`))).flat();
}
const sourceFiles = [...await filesIn("web"), "scripts/verify-ui-theme.mjs"].sort();
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
const result = { routes, sourceHashes, version: createHash("sha256").update(JSON.stringify(sourceHashes)).digest("hex"), viewportCount: 3, records, pageErrors, unexpectedPosts, stubConnectionRequests, realModelRequests: 0, identity: "实际本机页面；设置为假配置，未运行模型", failedScreens: records.filter((item) => item.problems.length).length };
await writeFile(join(output, "manifest.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output, routes, screens: records.length, failedScreens: result.failedScreens, failures: records.filter((item) => item.problems.length).map(({ route, width, problems }) => ({ route, width, problems })), pageErrors, unexpectedPosts, stubConnectionRequests }));
if (result.failedScreens || pageErrors.length || unexpectedPosts) process.exitCode = 1;
