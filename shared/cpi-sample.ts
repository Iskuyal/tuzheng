/** 阶段四首条路径的团队自制样例：图上只有数值、没有比较基准，配文补了一个「比上月」。 */
export const SOURCE_CPI_SAMPLE = {
  id: "cpi-2025-12",
  name: "CPI 图文来源核验样例（团队自制）",
  imageUrl: "/samples/cpi-2025-12.png",
  /** 图上写：2025 年 12 月全国 CPI 上涨 0.8%（没有写同比还是环比）。 */
  caption: "比上月上涨 0.8%",
  imageText: "2025 年 12 月全国 CPI 上涨 0.8%",
  note: "团队自制示意图，不是国家统计局原图；演示数值取自 2025 年 12 月发布，用于展示口径缺失时的核对过程。",
} as const;

export function sourceAuditSamplePayload(): {
  id: string;
  name: string;
  imageUrl: string;
  caption: string;
  imageText: string;
  note: string;
} {
  return { ...SOURCE_CPI_SAMPLE };
}
