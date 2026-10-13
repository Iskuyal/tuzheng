// 生产构建的离线 UI 证据：node scripts/verify-source-ui.mjs serve|before|after|after-final|after-review|after-evidence
// serve 固定监听 127.0.0.1:5173，使用内存配置并拦截全部模型入口。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const mode = process.argv[2];
const output = path.resolve("docs/evidence/source-entry-ui-2026-10-03");
const modelPaths = new Set([
  "/api/audit/image", "/api/source-audit/investigate", "/api/source-audit/resume", "/api/settings/test-connection",
]);
if (mode === "serve") {
  const { default: express } = await import("express");
  const { createApp } = await import("../dist/server/server/app.js");
  const { createDefaultModelSettings } = await import("../dist/server/server/model-settings.js");
  let settings = createDefaultModelSettings();
  let blockedModelRequests = 0;
  const app = express();
  app.use((request, response, next) => {
    if (modelPaths.has(request.path) && request.method === "POST") {
      blockedModelRequests += 1;
      response.status(503).json({ error: { code: "OFFLINE_UI_ONLY", message: "离线 UI 验证不调用模型。" } });
    } else next();
  });
  app.get("/__ui-verification", (_request, response) => response.json({ blockedModelRequests, realModelRequests: 0 }));
  app.use(createApp({ settingsStore: { source: "file", async read() { return settings; }, async write(value) { settings = value; } } }));
  app.use(express.static(path.resolve("dist/client")));
  app.get(/.*/, (_request, response) => response.sendFile(path.resolve("dist/client/index.html")));
  const server = app.listen(5173, "127.0.0.1", () => console.log("Offline production UI: http://127.0.0.1:5173"));
  server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
} else if (["before", "after", "after-final", "after-review", "after-evidence"].includes(mode)) {
  await mkdir(path.join(output, mode), { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const measurements = [];
  const screenshots = [];
  const sourceFiles = ["web/pages/LandingPage.vue", "web/pages/SourceAuditPage.vue", "web/pages/SettingsPage.vue", "web/router.ts", "web/style.css", "shared/model-presets.ts"];
  const sources = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  const routes = [["home", "/", ".hero-actions"], ["source", "/source-audit?sample=cpi-2025-12", "#source-audit-caption"], ["settings", "/settings", ".settings-form"]];
  const startedAt = new Date().toISOString();
  try {
    for (const width of [320, 390, 1280]) {
      for (const [name, route, readySelector] of routes) {
        for (let run = 1; run <= 3; run += 1) {
          const context = await browser.newContext({ viewport: { width, height: width === 320 ? 640 : width === 390 ? 844 : 900 }, serviceWorkers: "block" });
          const page = await context.newPage();
          const errors = [];
          let modelAttempts = 0;
          page.on("pageerror", (error) => errors.push(error.message));
          await context.route("**/*", async (requestRoute) => {
            const url = new URL(requestRoute.request().url());
            if (url.protocol.startsWith("http") && url.hostname !== "127.0.0.1") throw new Error("Unexpected external request");
            if (modelPaths.has(url.pathname) && requestRoute.request().method() === "POST") {
              modelAttempts += 1;
              await requestRoute.fulfill({ status: 503, json: { error: { message: "Offline UI verification" } } });
            } else await requestRoute.continue();
          });
          await page.addInitScript(() => {
            window.__uiMetrics = { lcp: 0, shifts: [], longTasks: [] };
            new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__uiMetrics.lcp = entry.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
            new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__uiMetrics.shifts.push({ time: entry.startTime, value: entry.value }); }).observe({ type: "layout-shift", buffered: true });
            new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__uiMetrics.longTasks.push({ start: entry.startTime, duration: entry.duration }); }).observe({ type: "longtask", buffered: true });
          });
          const cdp = await context.newCDPSession(page);
          await cdp.send("Network.enable");
          await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
          await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 500000, uploadThroughput: 125000 });
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
          await page.goto(`http://127.0.0.1:5173${route}`, { waitUntil: "domcontentloaded" });
          await page.locator(readySelector).waitFor();
          if (name === "home") await page.locator(".sample-tile").first().waitFor();
          if (name === "source" && mode !== "before") await page.locator(".source-image-stage img").waitFor();
          if (name === "settings") await page.waitForFunction(() => !document.querySelector(".settings-field select")?.disabled);
          const taskReadyMs = await page.evaluate(() => performance.now());
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(500);
          const metrics = await page.evaluate(() => {
            const { lcp, shifts, longTasks } = window.__uiMetrics;
            let cls = 0, value = 0, first = 0, previous = 0;
            for (const shift of shifts) {
              if (shift.time - previous > 1000 || shift.time - first > 5000) { first = shift.time; value = 0; }
              value += shift.value; previous = shift.time; cls = Math.max(cls, value);
            }
            const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
            const observedBlockingMs = longTasks.filter((task) => fcp !== null && task.start >= fcp).reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);
            return { fcpMs: fcp, lcpMs: lcp, cls, shifts, longTasks, observedBlockingMs, transferBytes: performance.getEntriesByType("resource").reduce((sum, item) => sum + item.transferSize, 0), overflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth) };
          });
          measurements.push({ page: name, route, width, run, taskReadyMs, ...metrics, errors, modelAttempts });
          if (run === 1) {
            const file = `${mode}/${name}-${width}.png`;
            await page.screenshot({ path: path.join(output, file), fullPage: true });
            screenshots.push({ file, page: name, route, width, sha256: createHash("sha256").update(await readFile(path.join(output, file))).digest("hex") });
          }
          await context.close();
          console.log(`${mode} ${name} ${width} #${run}: ready=${Math.round(taskReadyMs)}ms cls=${metrics.cls.toFixed(4)}`);
        }
      }
    }
    const guard = await (await fetch("http://127.0.0.1:5173/__ui-verification")).json();
    await writeFile(path.join(output, `${mode}.json`), JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), build: "npm run build; dist/client; local Express static server, uncompressed", environment: { os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryGiB: os.totalmem() / 1024 ** 3, node: process.version, browser: browser.version(), headless: true, deviceScaleFactor: 1, mobileEmulation: false, network: { latencyMs: 150, downloadBytesPerSecond: 500000, uploadBytesPerSecond: 125000, cacheDisabled: true }, cpuSlowdown: 4, runsPerPageAndViewport: 3 }, sources, screenshots, guard, measurements }, null, 2) + "\n");
  } finally { await browser.close(); }
} else throw new Error("Usage: node scripts/verify-source-ui.mjs serve|before|after|after-final|after-review|after-evidence");
