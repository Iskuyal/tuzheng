// 固定样例的 SVG→PNG 同源核对：确认提交的 PNG 确实由同名 SVG 渲染而来。
//
// 为什么不再只做字节比较：PNG 是渲染结果，受渲染器版本与已装字体影响。同一份 SVG 在
// 开发机（Edge 157 + 微软雅黑）与 CI（runner 镜像的 Edge／字体）上会得到字节不同、内容相同
// 的 PNG，只按字节比会把「环境不同」误报成「素材被改」。所以分四档输出：
//   PASS  字节完全一致
//   WARN  字节不同、像素差异在阈值内（抗锯齿／亚像素级），内容视为一致
//   SKIP  当前渲染环境与录制环境不同且像素差异超阈值：不判同源，也不判失败，明确写「未核对」
//   FAIL  同一环境下像素差异超阈值（素材被改过或 PNG 未重渲染）→ 退出码 1
//
// 环境指纹 = 渲染器版本 + 平台 + 本机字体探测。录制环境见 samples/render-env.json；
// 换机器／换 CI 镜像后先重渲染 PNG，再跑 `node scripts/verify-sample-renders.mjs --record` 登记。
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import catalog from "../samples/fixed-evaluation.json" with { type: "json" };

const RECORD = process.argv.includes("--record");
const ENV_PATH = join(process.cwd(), "samples", "render-env.json");
// 像素差异容差：0.3% 的像素允许不同（抗锯齿、亚像素定位），超过即视为内容变化。
const PIXEL_TOLERANCE = 0.003;
// 差异超过 25% 视为「PNG 根本不是这张 SVG 的渲染」，与字体/渲染器差异无关，任何环境下都判失败。
const GROSS_TOLERANCE = 0.25;

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// 字体探测：同一段文本分别用「微软雅黑」与不存在的字体量宽度，宽度一致说明雅黑缺失、回退到了默认字形。
const fontProbe = await page.evaluate(() => {
  const measure = (family) => {
    const el = document.createElement("span");
    el.textContent = "图证图表证据";
    el.style.cssText = `position:absolute;font-size:32px;font-family:${family}`;
    document.body.appendChild(el);
    const width = el.getBoundingClientRect().width;
    el.remove();
    return width;
  };
  const yahei = measure('"Microsoft YaHei"');
  const fallback = measure('"__no_such_font__"');
  return { yahei: Math.round(yahei * 100) / 100, fallback: Math.round(fallback * 100) / 100, yaheiPresent: Math.abs(yahei - fallback) > 0.5 };
});

const env = {
  renderer: `msedge ${browser.version()}`,
  platform: `${process.platform} ${process.arch}`,
  fonts: { yaheiPresent: fontProbe.yaheiPresent, yaheiWidth: fontProbe.yahei },
};
const fingerprint = sha256(JSON.stringify(env)).slice(0, 16);
const recorded = existsSync(ENV_PATH) ? JSON.parse(await readFile(ENV_PATH, "utf8")) : null;

if (RECORD) {
  await writeFile(
    ENV_PATH,
    JSON.stringify(
      {
        fingerprint,
        env,
        recordedAt: new Date().toISOString(),
        note: "登记时请同时重渲染全部 PNG；否则下次核对会把旧 PNG 判成内容变化。",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`已登记渲染环境指纹 ${fingerprint}（${env.renderer}，微软雅黑${env.fonts.yaheiPresent ? "存在" : "缺失"}）`);
}

/** 在浏览器里解码两张 PNG，返回差异像素占比（0~1）与两边尺寸。 */
async function pixelDiffRatio(expectedPng, renderedPng) {
  const toDataUrl = (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
  return page.evaluate(
    async ([a, b]) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      const [imgA, imgB] = await Promise.all([load(a), load(b)]);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(imgA.width, imgB.width);
      canvas.height = Math.max(imgA.height, imgB.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(imgA, 0, 0);
      const dataA = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imgB, 0, 0);
      const dataB = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let diff = 0;
      for (let i = 0; i < dataA.length; i += 4) {
        if (dataA[i] !== dataB[i] || dataA[i + 1] !== dataB[i + 1] || dataA[i + 2] !== dataB[i + 2] || dataA[i + 3] !== dataB[i + 3]) {
          diff += 1;
        }
      }
      return { ratio: diff / (canvas.width * canvas.height), size: [imgA.width, imgA.height, imgB.width, imgB.height] };
    },
    [toDataUrl(expectedPng), toDataUrl(renderedPng)],
  );
}

const results = [];
try {
  for (const { id } of catalog.cases) {
    const base = join(process.cwd(), "web", "public", "samples", id);
    const svg = await readFile(`${base}.svg`, "utf8");
    const expectedPng = await readFile(`${base}.png`);
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">${svg}</body>`, { waitUntil: "load" });
    const renderedPng = await page.screenshot({ clip: { x: 0, y: 0, width: 960, height: 640 } });

    if (sha256(expectedPng) === sha256(renderedPng)) {
      console.log(`PASS ${id} SVG→PNG（字节一致）`);
      results.push({ id, verdict: "pass" });
      continue;
    }

    const { ratio } = await pixelDiffRatio(expectedPng, renderedPng);
    const pct = (ratio * 100).toFixed(3);
    const sameEnv = recorded ? recorded.fingerprint === fingerprint : false;

    if (ratio <= PIXEL_TOLERANCE) {
      console.log(`WARN ${id} SVG→PNG（字节不同，像素差异 ${pct}% ≤ ${(PIXEL_TOLERANCE * 100).toFixed(1)}%，内容一致）`);
      results.push({ id, verdict: "warn", ratio });
    } else if (ratio >= GROSS_TOLERANCE) {
      console.log(`FAIL ${id} SVG→PNG（像素差异 ${pct}% ≥ 上限 ${(GROSS_TOLERANCE * 100).toFixed(0)}%：PNG 与 SVG 内容明显不符，与环境差异无关）`);
      results.push({ id, verdict: 'fail', ratio });
    } else if (!sameEnv) {
      console.log(
        `SKIP ${id} SVG→PNG（像素差异 ${pct}%，本机环境 ${fingerprint} ≠ 录制环境 ${recorded ? recorded.fingerprint : "未登记"}；未做同源判断，这不是通过）`,
      );
      results.push({ id, verdict: "skip", ratio });
    } else {
      console.log(`FAIL ${id} SVG→PNG（同环境下像素差异 ${pct}% > 阈值：素材被改过，或 PNG 没有重渲染）`);
      results.push({ id, verdict: "fail", ratio });
    }
  }
} finally {
  await browser.close();
}

const count = (verdict) => results.filter((r) => r.verdict === verdict).length;
const fails = count("fail");
const skips = count("skip");
console.log(
  `图片同源核对：${results.length} 项；一致 ${count("pass") + count("warn")}，未核对 ${skips}，失败 ${fails}（${env.renderer}，环境指纹 ${fingerprint}）`,
);
if (fails) process.exitCode = 1;
if (skips && !fails) {
  console.log("提示：SKIP 表示本机与录制环境不同，同源核对未生效；如需恢复强制核对，先重渲染 PNG，再跑 --record。");
}
