/** 离线进程验收：临时用户目录、假密钥，只请求设置与静态页面，绝不调用模型。 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createDefaultModelSettings, FileModelSettingsStore } from "../server/model-settings.js";

const fakeKey = "fake-runtime-env-secret-never-use";
const directory = await mkdtemp(join(tmpdir(), "tu-zheng-config-verify-"));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const logs: string[] = [];
const children = new Set<ChildProcess>();

function start(args: string[], environment: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(process.execPath, args, { env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));
  return child;
}
async function stop(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) {
    const closed = once(child, "exit");
    child.kill();
    await closed;
  }
  children.delete(child);
}
async function ready(url: string, child: ChildProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, "验收子进程提前退出，请检查端口占用或启动配置。");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* 等待启动 */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("验收服务未按时就绪。");
}
try {
  for (const source of ["file", "env"] as const) {
    for (const custom of [false, true]) {
      const apiPort = custom ? 3107 : 3001;
      const webPort = custom ? 5187 : 5173;
      const userDirectory = join(directory, `${source}-${apiPort}`);
      const store = new FileModelSettingsStore(join(userDirectory, "TuZheng", "settings.json"));
      const saved = createDefaultModelSettings();
      saved.providers["openai-responses"] = { baseUrl: "https://file.example/v1", model: "file-runtime", apiKey: "fake-runtime-file-key" };
      await store.write(saved);
      const before = await readFile(store.filePath, "utf8");
      const environment = {
        ...process.env, LOCALAPPDATA: userDirectory, PORT: custom ? String(apiPort) : "",
        WEB_PORT: custom ? String(webPort) : "", MODEL_CONFIG_SOURCE: source,
        MODEL_PROVIDER: "anthropic", MODEL_BASE_URL: "https://env.example/v1",
        MODEL_NAME: "env-runtime", MODEL_API_KEY: fakeKey,
      };
      const api = start(["--import", "tsx", "server/index.ts"], environment);
      const web = start(["node_modules/vite/bin/vite.js", "--config", "config/vite.config.ts"], environment);
      try {
        await ready(`http://127.0.0.1:${apiPort}/api/samples`, api);
        await ready(`http://127.0.0.1:${webPort}/`, web);
        for (const port of [apiPort, webPort]) {
          const response = await fetch(`http://127.0.0.1:${port}/api/settings`);
          assert.equal(response.status, 200);
          const text = await response.text();
          assert.ok(!text.includes(fakeKey) && !text.includes("fake-runtime-file-key"));
          const payload = JSON.parse(text);
          assert.deepEqual(payload.configuration, { source, readOnly: source === "env" });
          assert.equal(payload.settings.activeProvider, source === "env" ? "anthropic" : "openai-responses");
          assert.equal(payload.settings.providers[payload.settings.activeProvider].model, `${source}-runtime`);
        }
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        try {
          await page.goto(`http://127.0.0.1:${webPort}/settings`, { waitUntil: "networkidle" });
          await page.locator(".settings-source").filter({ hasText: source === "env" ? "只读" : "可编辑" }).waitFor();
          assert.equal(await page.locator('input[type="password"]').inputValue(), "");
          assert.equal(await page.locator('input[type="url"]').isDisabled(), source === "env");
          assert.equal(await page.getByRole("button", { name: "保存设置" }).isDisabled(), source === "env");
          assert.ok(!(await page.content()).includes(fakeKey));
          const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
          assert.ok(!storage.includes(fakeKey));
          // 截图输出只在忽略的缓存目录，便于复查。
          await page.screenshot({ path: `.cache/model-config-${source}-${apiPort}.png`, fullPage: true });
        } finally { await page.close(); }
        assert.equal(await readFile(store.filePath, "utf8"), before);
        assert.deepEqual(await readdir(join(userDirectory, "TuZheng")), ["settings.json"]);
        // 在线评测 CLI 的入口也必须选同一配置；假模型／协议不符合冻结门槛，必须在任何联网前停止。
        const evaluation = start(["--import", "tsx", "scripts/evaluate-source-audit.ts"], environment);
        await once(evaluation, "exit", { signal: AbortSignal.timeout(10_000) });
        assert.equal(evaluation.exitCode, 1);
        children.delete(evaluation);
        assert.ok(logs.join("").includes(source === "env" ? "当前模型是 env-runtime" : "当前启用协议是 openai-responses"));
        assert.ok(!logs.join("").includes(fakeKey) && !logs.join("").includes("fake-runtime-file-key"));
        console.log(`${source}：API ${apiPort} / 网页 ${webPort}，真实进程与 Vite 代理、设置页、密钥边界通过；模型调用 0 次。`);
      } finally {
        await stop(web);
        await stop(api);
      }
    }
  }
} finally {
  await Promise.all([...children].map(stop));
  await browser.close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()), "仅清理本次创建的临时目录。");
  await rm(directory, { recursive: true, force: true });
}
