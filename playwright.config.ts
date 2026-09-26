import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    // 使用系统自带 Edge，避免额外下载浏览器；没有 Edge 时可用 npx playwright install chromium 并去掉这一行。
    channel: "msedge",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "320px", use: { viewport: { width: 320, height: 640 } } },
    { name: "390px", use: { viewport: { width: 390, height: 844 } } },
    // 桌面宽度不在本任务的窄屏验收范围内，但它正是操作区重叠缺陷出现的宽度，保留一条回归防线。
    { name: "1280px", use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
