// 团队自制样例图的生成器：统一 960×640 的画布、配色与柱状图几何，避免手写 SVG 出现风格漂移。
// 用法：node samples/make-chart.mjs
// 生成后跑 node samples/render-chart-png.mjs <样例名> 得到上传/模型读取用的 PNG 栅格。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "public", "samples");

const PLOT = { top: 270, baseline: 494, left: 162, right: 840 };
const BAR = { width: 128, centers: [360, 646] };
const FONT = "Segoe UI, Microsoft YaHei, sans-serif";

/** 值 → 柱顶 y（轴 min..max 映射到基线与顶部网格线之间）。 */
function barTop(value, axis) {
  const span = axis.max - axis.min;
  return Math.round(PLOT.baseline - ((value - axis.min) / span) * (PLOT.baseline - PLOT.top));
}

function tickValues(axis) {
  const steps = 4;
  return Array.from({ length: steps + 1 }, (_, index) => axis.max - (index * (axis.max - axis.min)) / steps);
}

function formatTick(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

function renderChart(chart) {
  const axis = chart.axis;
  const gridlines = [270, 326, 382, 438, 494];
  const tickY = [274, 330, 386, 442, 498];
  const { min, max } = axis;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 640" role="img" aria-labelledby="title desc">`,
    `  <title id="title">${chart.title}</title>`,
    `  <desc id="desc">${chart.desc}</desc>`,
  ];
  if (chart.blurTicks) {
    parts.push(`  <defs><filter id="blur"><feGaussianBlur stdDeviation="4.5"/></filter></defs>`);
  }
  parts.push(
    `  <rect width="960" height="640" fill="#edf2f0"/>`,
    `  <rect width="960" height="12" fill="#143c46"/>`,
    `  <text x="54" y="56" fill="#176b68" font-family="${FONT}" font-size="15" font-weight="700">图表摘录　/　团队自制</text>`,
    `  <text x="54" y="112" fill="#132d3b" font-family="${FONT}" font-size="36" font-weight="700">${chart.title}</text>`,
    `  <text x="54" y="148" fill="#64777a" font-family="${FONT}" font-size="15">${chart.subtitle}</text>`,
    `  <rect x="54" y="183" width="852" height="385" rx="8" fill="#ffffff" stroke="#d7e0dc"/>`,
    `  <text x="88" y="222" fill="#41585d" font-family="${FONT}" font-size="15">${chart.metricLabel}</text>`,
    `  <text x="849" y="222" fill="#64777a" font-family="${FONT}" font-size="14" text-anchor="end">${chart.axisNote ?? `单位：${axis.unit}`}</text>`,
    `  <g stroke="#e4eae7" stroke-width="1">`,
    ...gridlines.map((y) => `    <line x1="${PLOT.left}" y1="${y}" x2="${PLOT.right}" y2="${y}"/>`),
    `  </g>`,
  );

  const ticks = tickValues(axis);
  const tickAttrs = chart.blurTicks ? ` filter="url(#blur)"` : "";
  parts.push(
    `  <g fill="#536a73" font-family="${FONT}" font-size="16" text-anchor="end"${tickAttrs}>`,
    `    ${ticks.map((value, index) => `<text x="145" y="${tickY[index]}">${formatTick(value)}</text>`).join("")}`,
    `  </g>`,
  );
  if (chart.blurTicks) {
    parts.push(
      `  <rect x="96" y="258" width="60" height="252" fill="#c3cfca" opacity=".55"/>`,
      `  <text x="126" y="240" fill="#805313" font-family="${FONT}" font-size="13" text-anchor="middle">刻度已模糊</text>`,
    );
  }
  parts.push(`  <line x1="${PLOT.left}" y1="${PLOT.baseline}" x2="${PLOT.right}" y2="${PLOT.baseline}" stroke="#aebdb8" stroke-width="1.5"/>`);

  chart.values.forEach((value, index) => {
    const top = barTop(value, axis);
    const x = BAR.centers[index] - BAR.width / 2;
    parts.push(`  <rect x="${x}" y="${top}" width="${BAR.width}" height="${PLOT.baseline - top}" fill="${index === 0 ? "#82aaa4" : "#1c7471"}"/>`);
    const label = chart.blurBarLabels?.includes(index)
      ? `<text x="${BAR.centers[index]}" y="${top - 16}" fill="#17333e" font-family="${FONT}" font-size="20" font-weight="700" text-anchor="middle" filter="url(#blur)">${value}</text>`
      : `<text x="${BAR.centers[index]}" y="${top - 16}" fill="#17333e" font-family="${FONT}" font-size="20" font-weight="700" text-anchor="middle">${value}</text>`;
    parts.push(`  ${label}`);
  });

  parts.push(
    `  <g fill="#52696d" font-family="${FONT}" font-size="15" text-anchor="middle">`,
    `    ${chart.periods.map((period, index) => `<text x="${BAR.centers[index]}" y="526">${period}</text>`).join("")}`,
    `  </g>`,
    `  <text x="54" y="606" fill="#52646b" font-family="${FONT}" font-size="15">${chart.footer}</text>`,
    `</svg>`,
    ``,
  );
  return parts.join("\n");
}

export const charts = [
  {
    file: "cross-a-revenue.svg",
    title: "年营业收入增长 25%",
    desc: "团队自制示例，全国门店营业收入 2024 年 80 万元、2025 年 100 万元，纵轴从零开始。",
    subtitle: "全国门店 · 营业收入 · 2024—2025",
    metricLabel: "营业收入",
    axis: { min: 0, max: 120, unit: "万元" },
    periods: ["2024 年", "2025 年"],
    values: [80, 100],
    footer: "团队自制　/　口径：全国门店 · 营业收入 · 万元",
  },
  {
    file: "cross-b-consistent.svg",
    title: "营业收入同比 +25%",
    desc: "团队自制示例，与另一张图同口径：全国门店营业收入 2024 年 80 万元、2025 年 100 万元。",
    subtitle: "全国门店 · 营业收入 · 2024—2025",
    metricLabel: "营业收入",
    axis: { min: 0, max: 120, unit: "万元" },
    periods: ["2024 年", "2025 年"],
    values: [80, 100],
    footer: "团队自制　/　口径：全国门店 · 营业收入 · 万元",
  },
  {
    file: "cross-b-conflict.svg",
    title: "营业收入增长 50%",
    desc: "团队自制示例，与另一张图同口径但数值不同：全国门店营业收入 2024 年 80 万元、2025 年 120 万元。",
    subtitle: "全国门店 · 营业收入 · 2024—2025",
    metricLabel: "营业收入",
    axis: { min: 0, max: 160, unit: "万元" },
    periods: ["2024 年", "2025 年"],
    values: [80, 120],
    footer: "团队自制　/　口径：全国门店 · 营业收入 · 万元",
  },
  {
    file: "cross-b-scope-mismatch.svg",
    title: "营业收入增长 25%",
    desc: "团队自制示例，数值与另一张图相同，但范围是直营门店，与全国门店不是同一口径。",
    subtitle: "直营门店 · 营业收入 · 2024—2025",
    metricLabel: "营业收入",
    axis: { min: 0, max: 120, unit: "万元" },
    periods: ["2024 年", "2025 年"],
    values: [80, 100],
    footer: "团队自制　/　口径：直营门店 · 营业收入 · 万元",
  },
  {
    file: "axis-zero-based.svg",
    title: "年营业收入增长 25%",
    desc: "团队自制示例，纵轴从零开始：2024 年 80 万元、2025 年 100 万元。",
    subtitle: "全国门店 · 纵轴从零开始",
    metricLabel: "营业收入",
    axis: { min: 0, max: 120, unit: "万元" },
    periods: ["2024 年", "2025 年"],
    values: [80, 100],
    footer: "团队自制　/　纵轴刻度 0—120",
  },
  {
    file: "axis-truncated.svg",
    title: "年营业收入增长 25%",
    desc: "团队自制示例，纵轴从 80 开始：2024 年 80 万元、2025 年 100 万元，柱高差异被放大。",
    subtitle: "全国门店 · 纵轴自 80 起",
    metricLabel: "营业收入",
    axis: { min: 80, max: 100, unit: "万元" },
    periods: ["2024 年", "2025 年"],
    values: [80, 100],
    footer: "团队自制　/　纵轴刻度 80—100",
  },
  {
    file: "axis-unknown-start.svg",
    title: "年营业收入增长 25%",
    desc: "团队自制示例，柱顶数字 80 与 100 可读，但纵轴刻度被模糊处理，无法确认起点。",
    subtitle: "全国门店 · 纵轴刻度看不清",
    metricLabel: "营业收入",
    axis: { min: 0, max: 120, unit: "万元" },
    axisNote: "单位：万元（刻度不可辨认）",
    periods: ["2024 年", "2025 年"],
    values: [80, 100],
    blurTicks: true,
    footer: "团队自制　/　纵轴刻度已模糊　请确认轴范围",
  },
];

if (process.argv[1] && process.argv[1].endsWith("make-chart.mjs")) {
  mkdirSync(outDir, { recursive: true });
  for (const chart of charts) {
    const path = join(outDir, chart.file);
    writeFileSync(path, renderChart(chart), "utf8");
    console.log("wrote", path);
  }
}
