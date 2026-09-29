// 阶段四任务 03 「推断缺口」评测用的团队自制 CPI 图：两个月同比涨幅连续回落。
// 画布与配色沿用 samples/make-chart.mjs、samples/make-cpi-eval-charts.mjs；
// 图上只写同比，不写环比——「同比涨幅下降」推不出「本月比上月便宜」，正是 03 要展示的推断缺口。
// 7 月数值是团队虚构的示意值；8 月同比 0.8% 与资料库 2026-08 发布一致。
// 用法：node samples/make-cpi-claim-charts.mjs
// 生成后跑 node samples/render-chart-png.mjs cpi-2026-07-08-yoy-trend
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "public", "samples");
const FONT = "Segoe UI, Microsoft YaHei, sans-serif";

/** 每张图的可见文字都集中在这里，评测按同一份声明核对图上确实写出来了。 */
export const cpiClaimCharts = [
  {
    name: "cpi-2026-07-08-yoy-trend",
    title: "2026 年 7—8 月全国 CPI 同比涨幅",
    note: "同比涨幅连续两个月回落",
    scopeLine: "全国 · 2026 年 7—8 月 · 同比",
    months: [
      { label: "2026 年 7 月", value: "1.0%", sentence: "2026 年 7 月全国 CPI 同比上涨 1.0%" },
      { label: "2026 年 8 月", value: "0.8%", sentence: "2026 年 8 月全国 CPI 同比上涨 0.8%" },
    ],
    desc:
      "团队自制示意图：全国居民消费价格 2026 年 7 月同比上涨 1.0%、8 月同比上涨 0.8%，"
      + "图上只写同比，没有环比；7 月数值为团队虚构的示意值。",
    visibleText: [
      "2026 年 7 月全国 CPI 同比上涨 1.0%",
      "2026 年 8 月全国 CPI 同比上涨 0.8%",
      "全国 · 2026 年 7—8 月 · 同比",
      "同比涨幅连续两个月回落",
    ],
  },
];

function renderChart(chart) {
  const [left, right] = chart.months;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 640" role="img" aria-labelledby="title desc">`,
    `  <title id="title">${chart.title}</title>`,
    `  <desc id="desc">${chart.desc}</desc>`,
    `  <rect width="960" height="640" fill="#edf2f0"/>`,
    `  <rect width="960" height="12" fill="#143c46"/>`,
    `  <text x="54" y="56" fill="#176b68" font-family="${FONT}" font-size="15" font-weight="700">图表摘录　/　团队自制</text>`,
    `  <text x="54" y="112" fill="#132d3b" font-family="${FONT}" font-size="34" font-weight="700">${chart.title}</text>`,
    `  <text x="54" y="148" fill="#64777a" font-family="${FONT}" font-size="15">全国居民消费价格 · 月度数据示意图</text>`,
    `  <rect x="54" y="183" width="852" height="385" rx="8" fill="#ffffff" stroke="#d7e0dc"/>`,
    `  <text x="88" y="222" fill="#41585d" font-family="${FONT}" font-size="15">居民消费价格（CPI）涨幅</text>`,
    `  <text x="872" y="222" fill="#64777a" font-family="${FONT}" font-size="14" text-anchor="end">单位：%</text>`,
    `  <rect x="88" y="245" width="370" height="225" rx="6" fill="#f4f8f6" stroke="#e0e8e4"/>`,
    `  <text x="112" y="286" fill="#41585d" font-family="${FONT}" font-size="18" font-weight="700">${left.label}</text>`,
    `  <text x="112" y="366" fill="#1c7471" font-family="${FONT}" font-size="72" font-weight="700">${left.value}</text>`,
    `  <text x="112" y="424" fill="#41585d" font-family="${FONT}" font-size="15">${left.sentence}</text>`,
    `  <text x="112" y="450" fill="#64777a" font-family="${FONT}" font-size="14">同比涨幅 · 团队示意值</text>`,
    `  <rect x="502" y="245" width="370" height="225" rx="6" fill="#f4f8f6" stroke="#e0e8e4"/>`,
    `  <text x="526" y="286" fill="#41585d" font-family="${FONT}" font-size="18" font-weight="700">${right.label}</text>`,
    `  <text x="526" y="366" fill="#1c7471" font-family="${FONT}" font-size="72" font-weight="700">${right.value}</text>`,
    `  <text x="526" y="424" fill="#41585d" font-family="${FONT}" font-size="15">${right.sentence}</text>`,
    `  <text x="526" y="450" fill="#64777a" font-family="${FONT}" font-size="14">同比涨幅 · 低于上月</text>`,
    `  <path d="M470 320 L494 320 M486 312 L494 320 L486 328" fill="none" stroke="#9fb2ae" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    `  <text x="88" y="506" fill="#41585d" font-family="${FONT}" font-size="16">${chart.note}</text>`,
    `  <text x="88" y="534" fill="#64777a" font-family="${FONT}" font-size="15">${chart.scopeLine}</text>`,
    `  <text x="88" y="558" fill="#64777a" font-family="${FONT}" font-size="15">未标注数据发布机构。</text>`,
    `  <text x="54" y="606" fill="#52646b" font-family="${FONT}" font-size="15">团队自制示意图，不是国家统计局原图　/　供口径核验评测使用</text>`,
    `</svg>`,
    ``,
  ].join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("make-cpi-claim-charts.mjs")) {
  for (const chart of cpiClaimCharts) {
    const path = join(outDir, `${chart.name}.svg`);
    writeFileSync(path, renderChart(chart), "utf8");
    console.log("wrote", path);
  }
}
