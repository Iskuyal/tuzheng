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
  /**
   * 这一行数值适用的月份（`YYYY-MM`）；缺省表示沿用 `SourceDocument.basis.period`。
   * 多月份发布（例如社会消费品零售总额的「环比数据修订」附注表）逐行给出月份。
   */
  period?: string;
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
  /**
   * 本发布对同系列既有发布所做的修订（仅在有官方修订声明时填写）。
   * 程序据此把被修订的旧值替换为修订后的值，并在结论上附「版本复查」记录。
   */
  revision?: SourceRevision;
}

/** 官方修订声明：说清修订了哪一份发布、修订日期与逐字原句。 */
export interface SourceRevision {
  /** 修订声明的逐字原句。 */
  statement: string;
  /** 本次修订的发布日期（`YYYY-MM-DD`）。 */
  revisedAt: string;
  /** 被本发布修订的那份发布的 `SourceDocument.id`。 */
  supersedes: string;
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

/**
 * 指纹只覆盖会被引用与展示的内容，注释与干扰标记不参与。
 * 逐行月份与修订声明「存在时才拼进去」：没有这些字段的材料（阶段四已冻结的三条）
 * 规范化串与加入新字段之前完全一致，指纹不变。
 */
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
    document.measures.map((measure) => [
      measure.basis,
      measure.value,
      measure.unit,
      measure.excerpt,
      ...(measure.period === undefined ? [] : [measure.period]),
    ]),
    ...(document.revision === undefined
      ? []
      : [document.revision.statement, document.revision.revisedAt, document.revision.supersedes]),
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

/** 把 `YYYY-MM` 写成页面表里的「YYYY年 M月」。 */
function monthLabel(period: string): string {
  const [year, month] = period.split("-");
  return `${year}年 ${Number(month)}月`;
}

/** 社零发布附注 5「环比数据修订」表：逐行录成带月份的 measure。 */
function retailMeasures(rows: ReadonlyArray<readonly [string, number]>): SourceMeasure[] {
  return rows.map(([period, value]) => ({
    basis: "month-on-month",
    period,
    value,
    unit: "%",
    excerpt: `附注5「环比数据修订」的修订结果表：${monthLabel(period)} 环比增速（%）${value}。`,
  }));
}

/** 社会消费品零售总额（1—7 月发布）：本表的 2026-06 值 0.35 已被下一份发布修订为 0.40。 */
const RETAIL_2026_07: FingerprintInput = {
  id: "stats-retail-2026-07",
  kind: "data-release",
  title: "2026年1—7月份社会消费品零售总额增长1.2%",
  publisher: "国家统计局",
  url: "https://www.stats.gov.cn/sj/zxfb/202608/t20260817_1965052.html",
  publishedAt: "2026-08-17",
  basis: { metric: "社会消费品零售总额", period: null, scope: "全国" },
  aliases: ["社会消费品零售总额", "消费品零售总额", "消费品零售额", "零售总额", "社零"],
  excerpt:
    "2026年1—7月份，社会消费品零售总额287744亿元，同比增长1.2%。"
    + "附注5「环比数据修订」：根据季节调整模型自动修正的结果，对2025年7月份以来的社会消费品零售总额环比增速进行修订。",
  measures: retailMeasures([
    ["2025-07", 0.01],
    ["2025-08", 0.18],
    ["2025-09", -0.08],
    ["2025-10", 0.15],
    ["2025-11", -0.1],
    ["2025-12", -0.01],
    ["2026-01", 0.18],
    ["2026-02", 0.23],
    ["2026-03", 0.1],
    ["2026-04", -0.27],
    ["2026-05", -0.15],
    ["2026-06", 0.35],
    ["2026-07", 0.06],
  ]),
  note:
    "多月份发布：basis.period 为空，各月数值在 measures[].period。本发布的「环比数据修订」表 0.35（2026-06）、"
    + "0.06（2026-07）已被 2026-09-15 发布的《2026年1—8月份社会消费品零售总额增长1.1%》再次修订。",
};

/** 社会消费品零售总额（1—8 月发布）：带官方修订声明，修订了上一份发布的同名月份。 */
const RETAIL_2026_08: FingerprintInput = {
  id: "stats-retail-2026-08",
  kind: "data-release",
  title: "2026年1—8月份社会消费品零售总额增长1.1%",
  publisher: "国家统计局",
  url: "https://www.stats.gov.cn/sj/zxfb/202609/t20260915_1965311.html",
  publishedAt: "2026-09-15",
  basis: { metric: "社会消费品零售总额", period: null, scope: "全国" },
  aliases: ["社会消费品零售总额", "消费品零售总额", "消费品零售额", "零售总额", "社零"],
  excerpt:
    "2026年1—8月份，社会消费品零售总额327569亿元，同比增长1.1%。"
    + "附注5「环比数据修订」：根据季节调整模型自动修正的结果，对2025年8月份以来的社会消费品零售总额环比增速进行修订。",
  measures: retailMeasures([
    ["2025-08", 0.22],
    ["2025-09", -0.07],
    ["2025-10", 0.14],
    ["2025-11", -0.13],
    ["2025-12", -0.06],
    ["2026-01", 0.21],
    ["2026-02", 0.27],
    ["2026-03", 0.12],
    ["2026-04", -0.23],
    ["2026-05", -0.1],
    ["2026-06", 0.4],
    ["2026-07", 0.01],
    ["2026-08", -0.13],
  ]),
  revision: {
    statement: "根据季节调整模型自动修正的结果，对2025年8月份以来的社会消费品零售总额环比增速进行修订。",
    revisedAt: "2026-09-15",
    supersedes: "stats-retail-2026-07",
  },
  note:
    "修订链在本库内从 2026-08-17 发布开始记录；更早的 2026-07-15 发布（1—6 月）同样带修订声明，本次未收录。"
    + "修订幅度 0.01—0.10 个百分点，属季节调整模型自动修正，与 CPI 基期轮换不是同一件事。",
};

function withFingerprint(document: FingerprintInput): SourceDocument {
  return { ...document, fingerprint: sourceFingerprint(document) };
}

export const SOURCE_LIBRARY: readonly SourceDocument[] = [
  withFingerprint(CPI_2025_12),
  withFingerprint(TERM_YOY_MOM),
  withFingerprint(CPI_2026_08),
  withFingerprint(RETAIL_2026_07),
  withFingerprint(RETAIL_2026_08),
];

export function findSourceDocument(id: string): SourceDocument | undefined {
  return SOURCE_LIBRARY.find((document) => document.id === id);
}

/** 找「修订了这份发布」的后续发布；没有就是没有修订记录。 */
export function findSupersedingDocument(
  id: string,
  library: readonly SourceDocument[] = SOURCE_LIBRARY,
): SourceDocument | undefined {
  return library.find((document) => document.revision?.supersedes === id);
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
    for (const measure of document.measures) {
      if (measure.period !== undefined && !/^\d{4}-\d{2}$/.test(measure.period)) {
        problems.push(`资料逐行月份格式不正确：${document.id}（${measure.period}）`);
      }
    }
  }
  if (!library.some((document) => document.distractor)) {
    problems.push("资料库缺少错口径干扰项。");
  }
  for (const document of library) {
    if (!document.revision) continue;
    if (!document.revision.statement.trim()) {
      problems.push(`修订声明为空：${document.id}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(document.revision.revisedAt)) {
      problems.push(`修订日期格式不正确：${document.id}`);
    }
    const superseded = library.find((candidate) => candidate.id === document.revision?.supersedes);
    if (!superseded) {
      problems.push(`修订声明指向的资料不在库内：${document.id} → ${document.revision.supersedes}`);
      continue;
    }
    // 修订必须真的改了值：同一比较方式与月份上，两份发布要有一个不同的数值。
    const changed = document.measures.some((measure) => {
      if (measure.period === undefined) return false;
      const previous = superseded.measures.find(
        (candidate) => candidate.basis === measure.basis && candidate.period === measure.period,
      );
      return previous !== undefined && previous.value !== measure.value;
    });
    if (!changed) {
      problems.push(`修订声明没有对应的数值变化：${document.id} → ${superseded.id}`);
    }
  }
  return problems;
}
