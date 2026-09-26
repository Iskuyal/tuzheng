// 界面评审用截图：着陆页／审计台／设置页 × 桌面与窄屏，外加模型读取面板。
// 委派独立评审时把这些 PNG 交给评审员，评审结论写进 docs/STAGE-1.md 的评审表。
// 用法：node e2e/review-screenshots.mjs [输出目录]（默认 .cache/design-review/round-35，需要 npm run dev 在跑）
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = "http://127.0.0.1:5173";
const out = process.argv[2] ?? ".cache/design-review/round-35";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });

async function open(url, width, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(base + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  return page;
}

async function save(page, locator, name) {
  const target = locator ? page.locator(locator) : page;
  await target.first().screenshot({ path: `${out}/${name}.png` });
  console.log("saved", name);
}

// 着陆页
for (const [name, width] of [["landing-desktop", 1440], ["landing-390", 390], ["landing-320", 320]]) {
  const page = await open("/", width);
  await save(page, "main", name);
  await page.close();
}

// 审计台：三主张样例，确认一条主张并展开记录，展示完整功能
for (const [name, width] of [["audit-review-desktop", 1440], ["audit-review-390", 390], ["audit-review-320", 320]]) {
  const page = await open("/audit?sample=multi-claims", width);
  const cards = page.locator(".claim-observation-card");
  await cards.first().getByRole("button", { name: "确认并计算此主张" }).click();
  await page.waitForTimeout(500);
  await cards.nth(1).locator("summary").click();
  await cards.nth(1).locator(".claim-observation-point").nth(1).getByLabel("核对数值").fill("100");
  await cards.nth(1).getByRole("button", { name: "确认并计算此主张" }).click();
  await page.waitForTimeout(500);
  await cards.nth(1).locator(".claim-audit-log summary").click();
  await page.waitForTimeout(300);
  await save(page, ".review-column", name);
  await page.close();
}

// 图表列（桌面）与设置页
{
  const page = await open("/audit?sample=multi-claims", 1440);
  await save(page, ".image-column", "audit-image-desktop");
  await page.close();
}
for (const [name, width] of [["settings-desktop", 1440], ["settings-390", 390]]) {
  const page = await open("/settings", width);
  await save(page, "main", name);
  await page.close();
}

// 模型读取面板（真实调用一次）
if (!process.env.SKIP_MODEL_READ) {
  const page = await open("/audit", 1440);
  await page.setInputFiles("#chart-upload", "web/public/samples/conflict.png");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "读取整张图片" }).click();
  await page.waitForSelector(".model-read", { timeout: 60_000 });
  await page.locator(".model-read details summary").click();
  await page.waitForTimeout(300);
  await save(page, ".review-column", "audit-model-read-1440");
  await page.close();
}

await browser.close();
console.log("done");
