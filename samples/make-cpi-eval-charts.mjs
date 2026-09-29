// 阶段四任务 02 固定评测用的团队自制 CPI 图：与 cpi-2025-12 同一画布与配色，
// 区别是这几张把比较方式（同比／环比）或地域范围明确写在图上，用来组成口径正确、口径错用与错范围的题目。
// 图上文字全部由本脚本生成，不复制国家统计局原图，也不含第三方图表素材。
// 用法：node samples/make-cpi-eval-charts.mjs
// 生成后跑 node samples/render-chart-png.mjs cpi-2025-12-yoy cpi-2025-12-mom cpi-2025-12-city cpi-2026-08-yoy
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "public", "samples");
const FONT = "Segoe UI, Microsoft YaHei, sans-serif";

/** 每张图的可见文字都集中在这里，评测按同一份声明核对图上确实写出来了。 */
export const cpiEvalCharts = [
  {
    name: "cpi-2025-12-yoy",
    title: "2025 年 12 月全国 CPI 同比上涨 0.8%",
    cardNote: "本卡片标出比较方式：同比（比上年同月）。",
    value: "0.8%",
    scopeLine: "全国 · 2025 年 12 月 · 同比",
    desc: "团队自制示意图：全国居民消费价格 2025 年 12 月同比上涨 0.8%，图上写明比较方式为同比。",
    visibleText: ["2025 年 12 月全国 CPI 同比上涨 0.8%", "全国 · 2025 年 12 月 · 同比", "同比"],
  },
  {
    name: "cpi-2025-12-mom",
    title: "2025 年 12 月全国 CPI 环比上涨 0.2%",
    cardNote: "本卡片标出比较方式：环比（比上月）。",
    value: "0.2%",
    scopeLine: "全国 · 2025 年 12 月 · 环比",
    desc: "团队自制示意图：全国居民消费价格 2025 年 12 月环比上涨 0.2%，图上写明比较方式为环比。",
    visibleText: ["2025 年 12 月全国 CPI 环比上涨 0.2%", "全国 · 2025 年 12 月 · 环比", "环比"],
  },
  {
    name: "cpi-2025-12-city",
    title: "2025 年 12 月全国城市 CPI 同比上涨 0.8%",
    cardNote: "本卡片的地域范围是全国城市，不是全国。",
    value: "0.8%",
    scopeLine: "全国城市 · 2025 年 12 月 · 同比",
    desc: "团队自制示意图：全国城市居民消费价格 2025 年 12 月同比上涨 0.8%，范围与全国口径不同。",
    visibleText: ["2025 年 12 月全国城市 CPI 同比上涨 0.8%", "全国城市 · 2025 年 12 月 · 同比", "全国城市"],
  },
  {
    name: "cpi-2026-08-yoy",
    title: "2026 年 8 月全国 CPI 同比上涨 0.8%",
    cardNote: "本卡片标出比较方式：同比（比上年同月）。",
    value: "0.8%",
    scopeLine: "全国 · 2026 年 8 月 · 同比",
    desc: "团队自制示意图：全国居民消费价格 2026 年 8 月同比上涨 0.8%，与 2025 年 12 月的同比数值相同。",
    visibleText: ["2026 年 8 月全国 CPI 同比上涨 0.8%", "全国 · 2026 年 8 月 · 同比", "2026 年 8 月"],
  },
];

function renderChart(chart) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 640" role="img" aria-labelledby="title desc">`,
    `  <title id="title">${chart.title}</title>`,
    `  <desc id="desc">${chart.desc}</desc>`,
    `  <rect width="960" height="640" fill="#edf2f0"/>`,
    `  <rect width="960" height="12" fill="#143c46"/>`,
    `  <text x="54" y="56" fill="#176b68" font-family="${FONT}" font-size="15" font-weight="700">图表摘录　/　团队自制</text>`,
    `  <text x="54" y="112" fill="#132d3b" font-family="${FONT}" font-size="36" font-weight="700">${chart.title}</text>`,
    `  <text x="54" y="148" fill="#64777a" font-family="${FONT}" font-size="15">全国居民消费价格 · 月度数据示意图</text>`,
    `  <rect x="54" y="183" width="852" height="385" rx="8" fill="#ffffff" stroke="#d7e0dc"/>`,
    `  <text x="88" y="222" fill="#41585d" font-family="${FONT}" font-size="15">居民消费价格（CPI）涨幅</text>`,
    `  <text x="872" y="222" fill="#64777a" font-family="${FONT}" font-size="14" text-anchor="end">单位：%</text>`,
    `  <text x="88" y="392" fill="#1c7471" font-family="${FONT}" font-size="140" font-weight="700">${chart.value}</text>`,
    `  <text x="88" y="442" fill="#41585d" font-family="${FONT}" font-size="20">${chart.scopeLine}</text>`,
    `  <rect x="88" y="468" width="784" height="1" fill="#e4eae7"/>`,
    `  <text x="88" y="504" fill="#64777a" font-family="${FONT}" font-size="15">${chart.cardNote}</text>`,
    `  <text x="88" y="532" fill="#64777a" font-family="${FONT}" font-size="15">未标注数据发布机构。</text>`,
    `  <text x="54" y="606" fill="#52646b" font-family="${FONT}" font-size="15">团队自制示意图，不是国家统计局原图　/　供口径核验评测使用</text>`,
    `</svg>`,
    ``,
  ].join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("make-cpi-eval-charts.mjs")) {
  for (const chart of cpiEvalCharts) {
    const path = join(outDir, `${chart.name}.svg`);
    writeFileSync(path, renderChart(chart), "utf8");
    console.log("wrote", path);
  }
}
