import type { ChartObservation } from "./audit.js";

export interface SampleCase {
  id: "conflict" | "consistent" | "unclear" | "multi-claims";
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
      claims: [{
        id: "revenue-growth",
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
      claims: [{
        id: "revenue-growth",
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
      claims: [{
        id: "revenue-growth",
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
];
