// 提交材料用界面截图：技术报告与演示走查清单都引用这里的 PNG。
// 全部模型调用由 route 替身应答（与 e2e/source-audit.spec.ts 的替身同构），
// 不请求真实模型、不需要 API Key；截图只用于展示界面结构，真实模型数字见 docs/evidence/。
// 用法：先 npm run dev，再 node e2e/submission-screenshots.mjs [输出目录]
// 默认输出到 docs/submission/assets（该目录会随仓库提交）。
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const out = process.argv[2] ?? "docs/submission/assets";
mkdirSync(out, { recursive: true });

// ---------- 替身载荷（与 e2e/source-audit.spec.ts 一致；不调用真实模型） ----------

const RELEASE_DOCUMENT = {
  id: "stats-cpi-2025-12",
  kind: "data-release",
  title: "2025年12月份居民消费价格同比上涨0.8%",
  publisher: "国家统计局",
  url: "https://www.stats.gov.cn/sj/zxfb/202601/t20260109_1962273.html",
  publishedAt: "2026-01-09",
  basis: { metric: "全国居民消费价格", period: "2025-12", scope: "全国" },
  aliases: ["CPI"],
  excerpt: "2025年12月份，全国居民消费价格同比上涨0.8%。12月份，全国居民消费价格环比上涨0.2%。",
  measures: [
    { basis: "year-on-year", value: 0.8, unit: "%", excerpt: "2025年12月份，全国居民消费价格同比上涨0.8%。" },
    { basis: "month-on-month", value: 0.2, unit: "%", excerpt: "12月份，全国居民消费价格环比上涨0.2%。" },
  ],
  fingerprint: "8a7f3c1d2b9e4f60",
};

const DISTRACTOR_DOCUMENT = {
  ...RELEASE_DOCUMENT,
  id: "stats-cpi-2026-08",
  title: "2026年8月份居民消费价格同比上涨0.8%",
  url: "https://www.stats.gov.cn/sj/zxfb/202609/t20260909_1965263.html",
  publishedAt: "2026-09-09",
  basis: { metric: "全国居民消费价格", period: "2026-08", scope: "全国" },
  excerpt: "2026年8月份，全国居民消费价格同比上涨0.8%。8月份，全国居民消费价格环比上涨0.4%。",
  distractor: true,
};

const TERM_DOCUMENT = {
  ...RELEASE_DOCUMENT,
  id: "stats-term-yoy-mom",
  kind: "term-explanation",
  title: "同比与环比有何不同",
  basis: { metric: "统计术语：同比与环比", period: null, scope: null },
  measures: [],
};

function hit(document, applicable, matchReasons) {
  return {
    document,
    score: applicable ? 11.75 : 8.25,
    matchReasons,
    applicability: {
      applicableForValue: applicable,
      applicableForTerm: document.kind === "term-explanation",
      mismatchFields: applicable ? [] : ["period"],
      missingFields: [],
    },
  };
}

const IMAGE_CLAIM = {
  claimText: "2025 年 12 月全国 CPI 上涨 0.8%",
  metric: "全国居民消费价格",
  scope: "全国",
  period: "2025-12",
  value: 0.8,
  basis: null,
  kind: "direct",
  direction: null,
  fromImage: true,
  imageExcerpt: "2025 年 12 月全国 CPI 上涨 0.8%",
};

const CAPTION_CLAIM = {
  claimText: "比上月上涨 0.8%",
  metric: "全国居民消费价格",
  scope: "全国",
  period: "2025-12",
  value: 0.8,
  basis: "month-on-month",
  kind: "direct",
  direction: null,
  fromImage: false,
  imageExcerpt: null,
};

function originTrace(claim) {
  return {
    fromImage: claim.fromImage,
    originText: claim.fromImage ? claim.imageExcerpt : "比上月上涨 0.8%。",
    traceable: true,
    coverage: 1,
    matchedRun: claim.claimText,
    note: null,
  };
}

const CAPTION_SUGGESTION = {
  caption: "比上月上涨 0.8%",
  suggestedCaption: "比上月上涨 0.2%",
  changes: [
    {
      claimText: CAPTION_CLAIM.claimText,
      original: "比上月上涨 0.8%",
      suggested: "比上月上涨 0.2%",
      kind: "replace-value",
      reason: "所引发布记载环比 0.2%，原文写 0.8%，建议改为 0.2%。",
      sourceIds: ["stats-cpi-2025-12"],
      status: "source-mismatch",
      origin: "model",
      rejectedReason: null,
      applied: true,
    },
  ],
  rejectedProposals: [
    {
      claimText: "比上月上涨 0.8%",
      suggestedText: "比上月上涨 0.2%，创下近三年新高。",
      reason: "补充背景。",
      rejectedReason: "建议新增了原配文没有的程度加强表述「创下」。",
    },
  ],
  notes: ["配文还有 1 处内容没有核验：「物价压力缓解」。"],
  fingerprint: "3f9c1d2a5b7e4c60",
};

const FULL_INVESTIGATION = {
  model: "stub-source-model",
  latencyMs: 6787,
  rounds: 3,
  stopReason: "模型在看完工具结果后给出汇总。",
  trace: [
    {
      round: 1,
      order: 1,
      detail: "先检索 2025 年 12 月的全国 CPI 材料。",
      status: "ok",
      tool: "search_source_library",
      inputSummary: '{"metric":"全国居民消费价格","period":"2025-12","scope":"全国"}',
      resultSummary:
        "命中 3 条：2025年12月份居民消费价格同比上涨0.8%（口径匹配）；2026年8月份居民消费价格同比上涨0.8%（口径不适配）",
      durationMs: 4,
    },
    {
      round: 2,
      order: 1,
      detail: "模型调用工具。",
      status: "ok",
      tool: "compare_values",
      inputSummary: '{"left":0.8,"right":0.2,"unit":"%"}',
      resultSummary: "两个数值相差 0.6%（0.8% 与 0.2%）。",
      durationMs: 10,
    },
    {
      round: 2,
      order: 2,
      detail: "模型调用工具。",
      status: "rejected",
      tool: "search_source_library",
      inputSummary: '{"metric":"全国居民消费价格","period":"2025-12","scope":"全国"}',
      resultSummary: "本轮超过 3 次工具调用上限，本次调用未执行。",
      durationMs: 0,
    },
  ],
  claims: [IMAGE_CLAIM, CAPTION_CLAIM],
  conclusions: [
    {
      claimText: IMAGE_CLAIM.claimText,
      claimKind: "direct",
      fromImage: true,
      status: "source-pending",
      summary: "来源待核对：主张没有写明比较方式，无法与具体数值对照。",
      basisLabel: null,
      claimValue: 0.8,
      officialValue: null,
      difference: null,
      citedSourceIds: ["stats-cpi-2025-12"],
      reasons: [
        "主张未说明同比或环比；所引《2025年12月份居民消费价格同比上涨0.8%》分别记载了不同比较方式，不能确定对应哪一个。",
      ],
      unresolved: ["需要补充比较方式（同比／环比）才能继续核对。"],
      parts: [],
      origin: originTrace(IMAGE_CLAIM),
      periodNote: null,
    },
    {
      claimText: CAPTION_CLAIM.claimText,
      claimKind: "direct",
      fromImage: false,
      status: "source-mismatch",
      summary:
        "与所引国家统计局发布《2025年12月份居民消费价格同比上涨0.8%》（2026-01-09）不一致：该发布记载环比 0.2%，主张写 0.8%，相差 0.6 个百分点。",
      basisLabel: "环比",
      claimValue: 0.8,
      officialValue: 0.2,
      difference: 0.6,
      citedSourceIds: ["stats-cpi-2025-12"],
      reasons: ["依据原句：12月份，全国居民消费价格环比上涨0.2%。"],
      unresolved: [],
      parts: [],
      origin: originTrace(CAPTION_CLAIM),
      periodNote: null,
    },
  ],
  citations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
  acceptedCitations: [{ sourceId: "stats-cpi-2025-12", role: "value-basis", note: null }],
  citationsRejected: [],
  hits: [
    hit(RELEASE_DOCUMENT, true, ["指标与资料口径匹配", "资料适用月份为 2025-12", "范围与资料一致（全国）"]),
    hit(DISTRACTOR_DOCUMENT, false, ["指标与资料口径匹配", "资料适用月份为 2026-08，与查询月份不同"]),
    hit(TERM_DOCUMENT, false, ["术语解释材料，可用于比较方式说明"]),
  ],
  excludedSources: [
    {
      sourceId: "stats-cpi-2026-08",
      title: DISTRACTOR_DOCUMENT.title,
      reason: "所引资料与主张口径不一致（月份），不作为数值依据。",
    },
    {
      sourceId: "stats-term-yoy-mom",
      title: TERM_DOCUMENT.title,
      reason: "同比与环比有何不同 是术语解释页，只用于说明同比与环比的差别，不能作为数值依据。",
    },
  ],
  unresolvedItems: ["图片卡片本身未标注比较基准（未写同比/环比）。"],
  noApplicableSourceReason: null,
  clarification: null,
  toolCallsUsed: 2,
  usage: { inputTokens: 157, outputTokens: 584 },
  omittedClaims: [],
  captionCoverage: 1,
  captionCoverageNote: null,
  captionSuggestion: CAPTION_SUGGESTION,
};

const CLARIFICATION_INVESTIGATION = {
  ...FULL_INVESTIGATION,
  investigationId: "inv-1",
  inputFingerprint: "fp-1",
  claims: [CAPTION_CLAIM],
  conclusions: [FULL_INVESTIGATION.conclusions[1]],
  clarification: {
    question: "配文没有写比较方式，0.8% 是同比还是环比？",
    purpose: "比较方式决定用同比 0.8% 还是环比 0.2% 核对，结论会不同。",
    field: "basis",
    claimText: CAPTION_CLAIM.claimText,
  },
  supplement: null,
  conclusionChanges: null,
};

const RESUMED_INVESTIGATION = {
  ...FULL_INVESTIGATION,
  investigationId: "inv-1",
  inputFingerprint: "fp-1",
  claims: [{ ...CAPTION_CLAIM, basis: "year-on-year" }],
  conclusions: [
    {
      ...FULL_INVESTIGATION.conclusions[1],
      status: "source-match",
      basisLabel: "同比",
      summary: "与所引国家统计局发布一致：该发布记载同比 0.8%，与主张中的数字一致。",
      officialValue: 0.8,
      difference: 0,
      parts: [{ label: "数字与口径", status: "supported", detail: "该发布记载同比 0.8%，与主张中的数字一致", sourceId: "stats-cpi-2025-12" }],
      reasons: [
        "依据原句：2025年12月份，全国居民消费价格同比上涨0.8%。",
        "比较方式「同比」由用户补充确定（用户提供，仅用于确定口径，不是官方来源）。",
      ],
      unresolved: [],
    },
  ],
  clarification: null,
  captionSuggestion: {
    caption: "比上月上涨 0.8%",
    suggestedCaption: "比上月上涨 0.8%",
    changes: [
      {
        claimText: CAPTION_CLAIM.claimText,
        original: "比上月上涨 0.8%",
        suggested: "比上月上涨 0.8%",
        kind: "unchanged",
        reason: "所引来源与这条主张的口径和数值一致（引用：stats-cpi-2025-12），保留原句。",
        sourceIds: ["stats-cpi-2025-12"],
        status: "source-match",
        origin: "program",
        rejectedReason: null,
        applied: true,
      },
    ],
    rejectedProposals: [],
    notes: [],
    fingerprint: "8a2b6c0d4e1f7395",
  },
  supplement: {
    question: "配文没有写比较方式，0.8% 是同比还是环比？",
    purpose: "比较方式决定用同比 0.8% 还是环比 0.2% 核对，结论会不同。",
    field: "basis",
    claimText: CAPTION_CLAIM.claimText,
    answer: "同比",
    normalized: "year-on-year",
    applied: true,
    conflicts: [],
    parseNote: null,
    note: "比较方式由用户补充确定，标为用户提供（不是官方来源）。",
  },
  conclusionChanges: [
    {
      claimText: CAPTION_CLAIM.claimText,
      before: "source-mismatch",
      after: "source-match",
      changed: true,
      reason: "用户补充确定了比较方式，据此重新核对。",
    },
  ],
};

// ---------- 截图工具 ----------

const browser = await chromium.launch({ channel: "msedge" });

async function open(url, width, height = 1000) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(base + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return page;
}

async function save(page, name, locator) {
  const target = locator ? page.locator(locator).first() : page;
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await target.screenshot({ path: `${out}/${name}.png` });
  console.log("saved", name);
}

/** 替身核验：不进真实模型，只替换网络响应，页面与程序校验仍走真实实现。 */
async function stubInvestigate(page, investigation) {
  await page.route("**/api/source-audit/investigate", async (route) => {
    await route.fulfill({ status: 200, json: { investigation } });
  });
}

async function runSample(page) {
  await page.getByTestId("load-source-sample").click();
  await page.locator(".source-image-stage img").waitFor();
  await page.getByTestId("run-source-audit").click();
  await page.locator(".source-run-summary").waitFor();
}

const SECTION = (title) => `.source-section:has(h2:text-is("${title}"))`;

// 1. 着陆页
{
  const page = await open("/", 1440, 1100);
  await save(page, "landing", "main");
  await page.close();
}

// 2. 单图审计台（多主张样例，一条已确认）——阶段一至阶段三的图内路径
{
  const page = await open("/audit?sample=multi-claims", 1440, 1100);
  const cards = page.locator(".claim-observation-card");
  await cards.first().getByRole("button", { name: "确认并计算此主张" }).click();
  await page.waitForTimeout(400);
  await save(page, "audit-workbench", ".review-column");
  await page.close();
}

// 3. 来源核验：运行前的输入区
{
  const page = await open("/source-audit", 1440, 1100);
  await page.getByTestId("load-source-sample").click();
  await page.locator(".source-image-stage img").waitFor();
  await save(page, "source-input", ".source-input-grid");
  await page.close();
}

// 4. 来源核验：结论、引用、轨迹、建议（替身响应）
{
  const page = await open("/source-audit", 1440, 1100);
  await stubInvestigate(page, FULL_INVESTIGATION);
  await runSample(page);
  await save(page, "source-summary", ".source-run-summary");
  // 主张卡的依据与未解决项默认折叠，展开后再截图，让复查者看到判断依据。
  for (const summary of await page.locator(".source-claim-details summary").all()) {
    await summary.click();
  }
  await page.waitForTimeout(300);
  await save(page, "source-claims", SECTION("配文主张"));
  await save(page, "source-image-claims", SECTION("图内观察"));
  await save(page, "source-citations", SECTION("引用与检索命中"));
  await save(page, "source-trace", SECTION("工具轨迹"));
  await save(page, "source-unresolved", SECTION("未解决项"));
  await save(page, "source-suggestion", "[data-testid='caption-suggestion']");
  await page.close();
}

// 5. 采用建议后的历史结论（替身响应）
{
  const page = await open("/source-audit", 1440, 1100);
  await stubInvestigate(page, FULL_INVESTIGATION);
  await runSample(page);
  await page.getByTestId("adopt-suggestion").click();
  await page.waitForTimeout(300);
  await save(page, "source-history", "[data-testid='history-section']");
  await page.close();
}

// 6. 追问 → 补证 → 结论变化（替身响应）
{
  const page = await open("/source-audit", 1440, 1100);
  await stubInvestigate(page, CLARIFICATION_INVESTIGATION);
  await page.route("**/api/source-audit/resume", async (route) => {
    await route.fulfill({ status: 200, json: { investigation: RESUMED_INVESTIGATION } });
  });
  await runSample(page);
  await save(page, "source-clarify", "[data-testid='clarification-block']");
  await page.getByTestId("clarification-answer").fill("同比");
  await page.getByTestId("submit-clarification").click();
  await page.getByTestId("supplement-block").waitFor();
  await save(page, "source-supplement", "[data-testid='supplement-block']");
  await save(page, "source-conclusion-changes", "[data-testid='conclusion-changes']");
  await page.close();
}

// 7. 失败恢复：未配置密钥与上游失败（替身错误响应）
{
  const page = await open("/source-audit", 1440, 1100);
  await page.route("**/api/source-audit/investigate", async (route) => {
    await route.fulfill({
      status: 503,
      json: {
        error: {
          code: "MODEL_NOT_CONFIGURED",
          message: "来源核验需要调用模型选择工具。请前往模型设置页填写地址、模型名和 API Key。",
        },
      },
    });
  });
  await page.getByTestId("load-source-sample").click();
  await page.locator(".source-image-stage img").waitFor();
  await page.getByTestId("run-source-audit").click();
  await page.locator(".error-message").waitFor();
  await save(page, "source-no-key", ".source-input-grid");
  await page.getByRole("button", { name: "展开资料库" }).click();
  await page.waitForTimeout(200);
  await save(page, "source-library", ".source-library");
  await page.close();
}

{
  const page = await open("/source-audit", 1440, 1100);
  await page.route("**/api/source-audit/investigate", async (route) => {
    await route.fulfill({
      status: 502,
      json: { error: { code: "SOURCE_INVESTIGATION_FAILED", message: "暂时无法完成来源调查，请稍后重试。" } },
    });
  });
  await page.getByTestId("load-source-sample").click();
  await page.locator(".source-image-stage img").waitFor();
  await page.getByTestId("run-source-audit").click();
  await page.locator(".error-message").waitFor();
  await save(page, "source-upstream-fail", ".source-panel:has(.error-message)");
  await page.close();
}

// 8. 设置页：协议与预设
{
  const page = await open("/settings", 1440, 1100);
  await save(page, "settings", "main");
  await page.close();
}

// 9. 窄屏结果态（390px）
{
  const page = await open("/source-audit", 390, 900);
  await stubInvestigate(page, FULL_INVESTIGATION);
  await runSample(page);
  for (const summary of await page.locator(".source-claim-details summary").all()) {
    await summary.click();
  }
  await page.waitForTimeout(300);
  await save(page, "source-mobile-summary", ".source-run-summary");
  await save(page, "source-mobile-claims", SECTION("配文主张"));
  await page.close();
}

await browser.close();
console.log("done:", out);
