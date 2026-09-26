// 把 web/public/samples/<名字>.svg 渲染成同尺寸 960×640 PNG；上传与视觉读取只接受位图，
// 所以每个样例都要有同名 SVG（页面展示）与 PNG（上传/模型读取）。
// 用法：node .cache/render-sample-png.mjs <样例名> [...]
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const names = process.argv.slice(2);
if (!names.length) {
  console.error("用法：node .cache/render-sample-png.mjs multi-claims [conflict ...]");
  process.exit(1);
}

const root = process.cwd();
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });

for (const name of names) {
  const svgPath = join(root, "web", "public", "samples", `${name}.svg`);
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><body style="margin:0">${readFileSync(svgPath, "utf8")}</body>`,
    { waitUntil: "load" },
  );
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 960, height: 640 } });
  const outPath = join(root, "web", "public", "samples", `${name}.png`);
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${Math.round(png.length / 1024)} KB)`);
}

await browser.close();
