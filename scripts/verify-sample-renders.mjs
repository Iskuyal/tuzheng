import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import catalog from "../samples/fixed-evaluation.json" with { type: "json" };

const browser = await chromium.launch({ channel: "msedge" });
let failed = 0;

try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  for (const { id } of catalog.cases) {
    const base = join(process.cwd(), "web", "public", "samples", id);
    const svg = await readFile(`${base}.svg`, "utf8");
    const expectedPng = await readFile(`${base}.png`);
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">${svg}</body>`, { waitUntil: "load" });
    const renderedPng = await page.screenshot({ clip: { x: 0, y: 0, width: 960, height: 640 } });
    const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
    const ok = sha256(expectedPng) === sha256(renderedPng);
    console.log(`${ok ? "PASS" : "FAIL"} ${id} SVG→PNG`);
    if (!ok) failed += 1;
  }
} finally {
  await browser.close();
}

console.log(`图片同源核对：${catalog.cases.length - failed}/${catalog.cases.length} 通过。`);
if (failed) process.exitCode = 1;
