/**
 * 固定官方资料库：只收录可公开引用、附原始链接与发布日期的国家统计局材料。
 * 资料在构建期写死，运行时不抓取开放网络；内容指纹用于发现摘录被改动。
 */
export type SourceKind = "data-release" | "term-explanation";

/** 比较方式：与主张的口径对齐时用它，不用数值对齐。 */
export type ComparisonBasis = "year-on-year" | "month-on-month";

export interface SourceMeasure {
  basis: ComparisonBasis;
  value: number;
  unit: string;
  /** 记载这个数值的原句，逐字摘录。 */
  excerpt: string;
}

export interface SourceBasis {
  /** 指标名，采用发布用的完整名称。 */
  metric: string;
  /** 适用月份（`YYYY-MM`）；术语解释页不绑定具体月份时为 null。 */
  period: string | null;
  /** 地域或人群。 */
  scope: string | null;
}

export interface SourceDocument {
  id: string;
  kind: SourceKind;
  title: string;
  publisher: string;
  url: string;
  /** 发布的原始日期（`YYYY-MM-DD`），取页面标注的发布时间。 */
  publishedAt: string;
  basis: SourceBasis;
  /** 检索时额外识别的说法，例如常见简称。 */
  aliases: string[];
  /** 短摘录，逐字取自页面正文。 */
  excerpt: string;
  measures: SourceMeasure[];
  /** 摘录与元数据的内容指纹，由 sourceFingerprint 计算。 */
  fingerprint: string;
  /** 检索干扰项：真实官方材料，但口径与首个案例不同。 */
  distractor?: boolean;
  /** 录入时的补充说明，例如发布日期不一致。 */
  note?: string;
}

/** FNV-1a 64 位：纯计算、无依赖，前后端都能重算，用来发现摘录或元数据被改动。 */
export function fnv1a64(input: string): string {
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

type FingerprintInput = Omit<SourceDocument, "fingerprint">;

/** 指纹只覆盖会被引用与展示的内容，注释与干扰标记不参与。 */
export function sourceFingerprint(document: FingerprintInput): string {
  const canonical = JSON.stringify([
    document.id,
    document.kind,
    document.title,
    document.publisher,
    document.url,
    document.publishedAt,
    document.basis.metric,
    document.basis.period,
    document.basis.scope,
    document.aliases,
    document.excerpt,
    document.measures.map((measure) => [measure.basis, measure.value, measure.unit, measure.excerpt]),
  ]);
  return fnv1a64(canonical);
}

const CPI_2025_12: FingerprintInput = {
  id: "stats-cpi-2025-12",
  kind: "data-release",
  title: "2025年12月份居民消费价格同比上涨0.8%",
  publisher: "国家统计局",
  url: "https://www.stats.gov.cn/sj/zxfb/202601/t20260109_1962273.html",
  publishedAt: "2026-01-09",
  basis: { metric: "全国居民消费价格", period: "2025-12", scope: "全国" },
  aliases: ["CPI", "居民消费价格指数", "居民消费价格", "全国居民消费价格", "消费价格"],
  excerpt: "2025年12月份，全国居民消费价格同比上涨0.8%。12月份，全国居民消费价格环比上涨0.2%。",
  measures: [
    {
      basis: "year-on-year",
      value: 0.8,
      unit: "%",
      excerpt: "2025年12月份，全国居民消费价格同比上涨0.8%。",
    },
    {
      basis: "month-on-month",
      value: 0.2,
      unit: "%",
      excerpt: "12月份，全国居民消费价格环比上涨0.2%。",
    },
  ],
};

const TERM_YOY_MOM: FingerprintInput = {
  id: "stats-term-yoy-mom",
  kind: "term-explanation",
  title: "同比与环比有何不同",
  publisher: "国家统计局",
  url: "https://www.stats.gov.cn/zs/tjws/tjbk/202301/t20230101_1912960.html",
  publishedAt: "2025-07-17",
  basis: { metric: "统计术语：同比与环比", period: null, scope: null },
  aliases: ["同比", "环比", "比较方式", "基期", "统计周期"],
  excerpt:
    "同比是以上年同期为基期相比较，即本期某一时间段（点）与上年某一时间段（点）相比，可以理解为今年第n月与去年第n月的比较。"
    + "环比是与上一个相邻统计周期相比较，表明统计指标逐期的发展变化，可以理解为第n月与第n－1月的比较。",
  measures: [],
  note: "页面正文标注的发布时间为 2025-07-17；URL 路径段为 202301，两者不一致，按页面标注记录。",
};

const CPI_2026_08: FingerprintInput = {
  id: "stats-cpi-2026-08",
  kind: "data-release",
  title: "2026年8月份居民消费价格同比上涨0.8%",
  publisher: "国家统计局",
  url: "https://www.stats.gov.cn/sj/zxfb/202609/t20260909_1965263.html",
  publishedAt: "2026-09-09",
  basis: { metric: "全国居民消费价格", period: "2026-08", scope: "全国" },
  aliases: ["CPI", "居民消费价格指数", "居民消费价格", "全国居民消费价格", "消费价格"],
  excerpt: "2026年8月份，全国居民消费价格同比上涨0.8%。8月份，全国居民消费价格环比上涨0.4%。",
  measures: [
    {
      basis: "year-on-year",
      value: 0.8,
      unit: "%",
      excerpt: "2026年8月份，全国居民消费价格同比上涨0.8%。",
    },
    {
      basis: "month-on-month",
      value: 0.4,
      unit: "%",
      excerpt: "8月份，全国居民消费价格环比上涨0.4%。",
    },
  ],
  distractor: true,
  note: "干扰项：同比数值与 2025 年 12 月发布相同（均为 0.8%），月份不同，环比为 0.4%。",
};

function withFingerprint(document: FingerprintInput): SourceDocument {
  return { ...document, fingerprint: sourceFingerprint(document) };
}

export const SOURCE_LIBRARY: readonly SourceDocument[] = [
  withFingerprint(CPI_2025_12),
  withFingerprint(TERM_YOY_MOM),
  withFingerprint(CPI_2026_08),
];

export function findSourceDocument(id: string): SourceDocument | undefined {
  return SOURCE_LIBRARY.find((document) => document.id === id);
}

/** 重算指纹，用于校验库内资料未被就地改动。 */
export function verifySourceLibrary(library: readonly SourceDocument[] = SOURCE_LIBRARY): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const document of library) {
    if (seen.has(document.id)) problems.push(`资料 ID 重复：${document.id}`);
    seen.add(document.id);
    if (document.fingerprint !== sourceFingerprint(document)) {
      problems.push(`资料指纹不匹配：${document.id}`);
    }
    if (!document.url.startsWith("https://")) {
      problems.push(`资料链接不是 HTTPS：${document.id}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(document.publishedAt)) {
      problems.push(`资料发布日期格式不正确：${document.id}`);
    }
    if (document.kind === "data-release" && document.measures.length === 0) {
      problems.push(`数据发布缺少数值摘录：${document.id}`);
    }
  }
  if (!library.some((document) => document.distractor)) {
    problems.push("资料库缺少错口径干扰项。");
  }
  return problems;
}
