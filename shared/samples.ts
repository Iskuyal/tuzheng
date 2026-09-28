import type { ChartObservation } from "./audit.js";

export interface SampleCase {
  id:
    | "conflict"
    | "consistent"
    | "unclear"
    | "multi-claims"
    | "cross-a-revenue"
    | "cross-b-consistent"
    | "cross-b-conflict"
    | "cross-b-scope-mismatch"
    | "axis-zero-based"
    | "axis-truncated"
    | "axis-unknown-start";
  name: string;
  description: string;
  imageUrl: string;
  observation: ChartObservation;
}

export const sampleCases: readonly SampleCase[] = [
  {
    id: "conflict",
    name: "增长说法对不上",
    description: "图中 80 到 100，标题写增长 40%。",
    imageUrl: "/samples/conflict.svg",
    observation: {
      source: "preset-example",
      axis: { label: "营业收入", min: 0, max: 160, unit: "万元" },
      claims: [{
        id: "revenue-growth",
        metric: "营业收入",
        scope: null,
        claimText: "年营业收入增长 40%",
        claimedGrowthPercent: 40,
        older: {
          period: "2024 年",
          value: 80,
          unit: "万元",
          evidenceText: "2024 年 80 万元",
        },
        newer: {
          period: "2025 年",
          value: 100,
          unit: "万元",
          evidenceText: "2025 年 100 万元",
        },
        unreadableItems: [],
      }],
    },
  },
  {
    id: "consistent",
    name: "标题与数字相符",
    description: "同一组数字，标题写增长 25%。",
    imageUrl: "/samples/consistent.svg",
    observation: {
      source: "preset-example",
      axis: { label: "营业收入", min: 0, max: 160, unit: "万元" },
      claims: [{
        id: "revenue-growth",
        metric: "营业收入",
        scope: null,
        claimText: "年营业收入增长 25%",
        claimedGrowthPercent: 25,
        older: {
          period: "2024 年",
          value: 80,
          unit: "万元",
          evidenceText: "2024 年 80 万元",
        },
        newer: {
          period: "2025 年",
          value: 100,
          unit: "万元",
          evidenceText: "2025 年 100 万元",
        },
        unreadableItems: [],
      }],
    },
  },
  {
    id: "unclear",
    name: "关键数字看不清",
    description: "2025 年的数字标签模糊，先不推算。",
    imageUrl: "/samples/unclear.svg",
    observation: {
      source: "preset-example",
      axis: { label: "营业收入", min: 0, max: 160, unit: "万元" },
      claims: [{
        id: "revenue-growth",
        metric: "营业收入",
        scope: null,
        claimText: "年营业收入增长 25%",
        claimedGrowthPercent: 25,
        older: {
          period: "2024 年",
          value: 80,
          unit: "万元",
          evidenceText: "2024 年 80 万元",
        },
        newer: {
          period: "2025 年",
          value: null,
          unit: "万元",
          evidenceText: "2025 年数值标签无法辨认",
        },
        unreadableItems: ["2025 年数值标签无法辨认"],
      }],
    },
  },
  {
    id: "multi-claims",
    name: "多项主张图内核对",
    description: "一张自制图含收入、利润和用户数三条主张。",
    imageUrl: "/samples/multi-claims.svg",
    observation: {
      source: "preset-example",
      claims: [
        {
          id: "revenue-growth",
          metric: "营业收入",
          scope: null,
          claimText: "营业收入增长 25%",
          claimedGrowthPercent: 25,
          older: {
            period: "2024 年",
            value: 80,
            unit: "万元",
            evidenceText: "2024 年营业收入 80 万元",
          },
          newer: {
            period: "2025 年",
            value: 100,
            unit: "万元",
            evidenceText: "2025 年营业收入 100 万元",
          },
          unreadableItems: [],
        },
        {
          id: "profit-growth",
          metric: "利润",
          scope: null,
          claimText: "利润增长 40%",
          claimedGrowthPercent: 40,
          older: {
            period: "2024 年",
            value: 50,
            unit: "万元",
            evidenceText: "2024 年利润 50 万元",
          },
          newer: {
            period: "2025 年",
            value: 70,
            unit: "万元",
            evidenceText: "2025 年利润 100 万元",
          },
          unreadableItems: [],
        },
        {
          id: "user-count-growth",
          metric: "用户数",
          scope: null,
          claimText: "用户数增长 20%",
          claimedGrowthPercent: 20,
          older: {
            period: "2024 年",
            value: 50,
            unit: "万人",
            evidenceText: "2024 年用户数 50 万人",
          },
          newer: {
            period: "2025 年",
            value: null,
            unit: "万人",
            evidenceText: null,
          },
          unreadableItems: [],
        },
      ],
    },
  },
  {
    id: "cross-a-revenue",
    name: "跨图基准：营业收入 25%",
    description: "全国门店营业收入 80→100 万元；另外三张对照图与它配对。",
    imageUrl: "/samples/cross-a-revenue.svg",
    observation: {
      source: "preset-example",
      axis: { label: "营业收入", min: 0, max: 120, unit: "万元" },
      claims: [{
        id: "revenue-growth",
        metric: "营业收入",
        scope: "全国门店",
        claimText: "年营业收入增长 25%",
        claimedGrowthPercent: 25,
        older: {
          period: "2024 年",
          value: 80,
          unit: "万元",
          evidenceText: "2024 年营业收入 80 万元",
        },
        newer: {
          period: "2025 年",
          value: 100,
          unit: "万元",
          evidenceText: "2025 年营业收入 100 万元",
        },
        unreadableItems: [],
      }],
    },
  },

  {
    id: "cross-b-consistent",
    name: "跨图对照：说法对得上",
    description: "另一张海报写「同比 +25%」，与基准图口径与数值都一致。",
    imageUrl: "/samples/cross-b-consistent.svg",
    observation: {
      source: "preset-example",
      axis: { label: "营业收入", min: 0, max: 120, unit: "万元" },
      claims: [{
        id: "revenue-growth",
        metric: "营业收入",
        scope: "全国门店",
        claimText: "营业收入同比 +25%",
        claimedGrowthPercent: 25,
        older: {
          period: "2024 年",
          value: 80,
          unit: "万元",
          evidenceText: "2024 年营业收入 80 万元",
        },
        newer: {
          period: "2025 年",
          value: 100,
          unit: "万元",
          evidenceText: "2025 年营业收入 100 万元",
        },
        unreadableItems: [],
      }],
    },
  },

  {
    id: "cross-b-conflict",
    name: "跨图对照：说法对不上",
    description: "同一指标与时间段，这张写 80→120、标题 50%，与基准图冲突。",
    imageUrl: "/samples/cross-b-conflict.svg",
    observation: {
      source: "preset-example",
      axis: { label: "营业收入", min: 0, max: 160, unit: "万元" },
      claims: [{
        id: "revenue-growth",
        metric: "营业收入",
        scope: "全国门店",
        claimText: "营业收入增长 50%",
        claimedGrowthPercent: 50,
        older: {
          period: "2024 年",
          value: 80,
          unit: "万元",
          evidenceText: "2024 年营业收入 80 万元",
        },
        newer: {
          period: "2025 年",
          value: 120,
          unit: "万元",
          evidenceText: "2025 年营业收入 120 万元",
        },
        unreadableItems: [],
      }],
    },
  },

  {
    id: "cross-b-scope-mismatch",
    name: "跨图对照：范围不同",
    description: "范围写的是直营门店，与基准图的全国门店不是同一口径，不能直接比。",
    imageUrl: "/samples/cross-b-scope-mismatch.svg",
    observation: {
      source: "preset-example",
      axis: { label: "营业收入", min: 0, max: 120, unit: "万元" },
      claims: [{
        id: "revenue-growth",
        metric: "营业收入",
        scope: "直营门店",
        claimText: "营业收入增长 25%",
        claimedGrowthPercent: 25,
        older: {
          period: "2024 年",
          value: 80,
          unit: "万元",
          evidenceText: "2024 年营业收入 80 万元",
        },
        newer: {
          period: "2025 年",
          value: 100,
          unit: "万元",
          evidenceText: "2025 年营业收入 100 万元",
        },
        unreadableItems: [],
      }],
    },
  },

  {
    id: "axis-zero-based",
    name: "纵轴从零开始",
    description: "同一组数字画在从 0 开始的纵轴上，柱高差异与数值差异一致。",
    imageUrl: "/samples/axis-zero-based.svg",
    observation: {
      source: "preset-example",
      axis: { label: "营业收入", min: 0, max: 120, unit: "万元" },
      claims: [{
        id: "revenue-growth",
        metric: "营业收入",
        scope: "全国门店",
        claimText: "年营业收入增长 25%",
        claimedGrowthPercent: 25,
        older: {
          period: "2024 年",
          value: 80,
          unit: "万元",
          evidenceText: "2024 年营业收入 80 万元",
        },
        newer: {
          period: "2025 年",
          value: 100,
          unit: "万元",
          evidenceText: "2025 年营业收入 100 万元",
        },
        unreadableItems: [],
      }],
    },
  },

  {
    id: "axis-truncated",
    name: "纵轴截断放大差异",
    description: "纵轴从 80 起，80 与 100 的柱高差被放大，标签仍然清楚。",
    imageUrl: "/samples/axis-truncated.svg",
    observation: {
      source: "preset-example",
      axis: { label: "营业收入", min: 80, max: 100, unit: "万元" },
      claims: [{
        id: "revenue-growth",
        metric: "营业收入",
        scope: "全国门店",
        claimText: "年营业收入增长 25%",
        claimedGrowthPercent: 25,
        older: {
          period: "2024 年",
          value: 80,
          unit: "万元",
          evidenceText: "2024 年营业收入 80 万元",
        },
        newer: {
          period: "2025 年",
          value: 100,
          unit: "万元",
          evidenceText: "2025 年营业收入 100 万元",
        },
        unreadableItems: [],
      }],
    },
  },

  {
    id: "axis-unknown-start",
    name: "纵轴刻度看不清",
    description: "柱顶数字可读，纵轴刻度被模糊处理，无法确认起点。",
    imageUrl: "/samples/axis-unknown-start.svg",
    observation: {
      source: "preset-example",
      axis: { label: "营业收入", min: null, max: null, unit: "万元" },
      claims: [{
        id: "revenue-growth",
        metric: "营业收入",
        scope: "全国门店",
        claimText: "年营业收入增长 25%",
        claimedGrowthPercent: 25,
        older: {
          period: "2024 年",
          value: 80,
          unit: "万元",
          evidenceText: "2024 年营业收入 80 万元",
        },
        newer: {
          period: "2025 年",
          value: 100,
          unit: "万元",
          evidenceText: "2025 年营业收入 100 万元",
        },
        unreadableItems: [],
      }],
    },
  },
];
