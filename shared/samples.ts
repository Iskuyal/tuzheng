import type { AuditObservation } from "./audit.js";

export interface SampleCase {
  id: "conflict" | "consistent" | "unclear";
  name: string;
  description: string;
  imageUrl: string;
  observation: AuditObservation;
}

export const sampleCases: readonly SampleCase[] = [
  {
    id: "conflict",
    name: "增长说法对不上",
    description: "图中 80 到 100，标题写增长 40%。",
    imageUrl: "/samples/conflict.svg",
    observation: {
      titleOriginal: "年营业收入增长 40%",
      claimedGrowthPercent: 40,
      older: {
        period: "2024 年",
        value: 80,
        unit: "万元",
        evidenceText: "2024 年 80 万元",
        valueSource: "preset",
      },
      newer: {
        period: "2025 年",
        value: 100,
        unit: "万元",
        evidenceText: "2025 年 100 万元",
        valueSource: "preset",
      },
      unreadableItems: [],
      confirmed: false,
      source: "preset-example",
    },
  },
  {
    id: "consistent",
    name: "标题与数字相符",
    description: "同一组数字，标题写增长 25%。",
    imageUrl: "/samples/consistent.svg",
    observation: {
      titleOriginal: "年营业收入增长 25%",
      claimedGrowthPercent: 25,
      older: {
        period: "2024 年",
        value: 80,
        unit: "万元",
        evidenceText: "2024 年 80 万元",
        valueSource: "preset",
      },
      newer: {
        period: "2025 年",
        value: 100,
        unit: "万元",
        evidenceText: "2025 年 100 万元",
        valueSource: "preset",
      },
      unreadableItems: [],
      confirmed: false,
      source: "preset-example",
    },
  },
  {
    id: "unclear",
    name: "关键数字看不清",
    description: "2025 年的数字标签模糊，先不推算。",
    imageUrl: "/samples/unclear.svg",
    observation: {
      titleOriginal: "年营业收入增长 25%",
      claimedGrowthPercent: 25,
      older: {
        period: "2024 年",
        value: 80,
        unit: "万元",
        evidenceText: "2024 年 80 万元",
        valueSource: "preset",
      },
      newer: {
        period: "2025 年",
        value: null,
        unit: "万元",
        evidenceText: "2025 年数值标签无法辨认",
        valueSource: "unreadable",
      },
      unreadableItems: ["2025 年数值标签无法辨认"],
      confirmed: false,
      source: "preset-example",
    },
  },
];
