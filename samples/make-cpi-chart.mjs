// 阶段四 CPI 样例图的生成器：与柱状图样例同一套画布、配色和「团队自制」标识，
// 但只写一个当月涨幅数值，故意不写同比／环比，让比较方式成为图上读不到的信息。
// 用法：node samples/make-cpi-chart.mjs
// 生成后跑 node samples/render-chart-png.mjs cpi-2025-12 得到 PNG 栅格。
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "public", "samples");
const FONT = "Segoe UI, Microsoft YaHei, sans-serif";

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 640" role="img" aria-labelledby="title desc">`,
  `  <title id="title">2025 年 12 月全国 CPI 上涨 0.8%</title>`,
  `  <desc id="desc">团队自制示意图：全国居民消费价格 2025 年 12 月上涨 0.8%，图上没有写比较方式。</desc>`,
  `  <rect width="960" height="640" fill="#edf2f0"/>`,
  `  <rect width="960" height="12" fill="#143c46"/>`,
  `  <text x="54" y="56" fill="#176b68" font-family="${FONT}" font-size="15" font-weight="700">图表摘录　/　团队自制</text>`,
  `  <text x="54" y="112" fill="#132d3b" font-family="${FONT}" font-size="36" font-weight="700">2025 年 12 月全国 CPI 上涨 0.8%</text>`,
  `  <text x="54" y="148" fill="#64777a" font-family="${FONT}" font-size="15">全国居民消费价格 · 月度数据示意图</text>`,
  `  <rect x="54" y="183" width="852" height="385" rx="8" fill="#ffffff" stroke="#d7e0dc"/>`,
  `  <text x="88" y="222" fill="#41585d" font-family="${FONT}" font-size="15">居民消费价格（CPI）涨幅</text>`,
  `  <text x="872" y="222" fill="#64777a" font-family="${FONT}" font-size="14" text-anchor="end">单位：%</text>`,
  `  <text x="88" y="392" fill="#1c7471" font-family="${FONT}" font-size="140" font-weight="700">0.8%</text>`,
  `  <text x="88" y="442" fill="#41585d" font-family="${FONT}" font-size="20">全国 · 2025 年 12 月</text>`,
  `  <rect x="88" y="468" width="784" height="1" fill="#e4eae7"/>`,
  `  <text x="88" y="504" fill="#64777a" font-family="${FONT}" font-size="15">本卡片只写出当月涨幅数值。</text>`,
  `  <text x="88" y="532" fill="#64777a" font-family="${FONT}" font-size="15">未标注比较基准，也未标注数据发布机构。</text>`,
  `  <text x="54" y="606" fill="#52646b" font-family="${FONT}" font-size="15">团队自制示意图，不是国家统计局原图　/　供口径核验演示使用</text>`,
  `</svg>`,
  ``,
].join("\n");

writeFileSync(join(outDir, "cpi-2025-12.svg"), svg, "utf8");
console.log("wrote cpi-2025-12.svg");
