import { expect, test, type Page } from "@playwright/test";
import { tabTo } from "./keyboard.js";

// 页面路径用替身响应覆盖：真实模型调用另见 docs/evidence/stage-4-source-audit-2026-09-29.md。
// 替身只替换网络响应，页面与程序校验仍走真实实现。

const SEARCH_EVENT = {
  round: 1,
  order: 1,
  detail: "先检索 2025 年 12 月的全国 CPI 材料。",
  status: "ok",
  tool: "search_source_library",
  inputSummary: '{"metric":"全国居民消费价格","period":"2025-12","scope":"全国"}',
  resultSummary: "命中 3 条：2025年12月份居民消费价格同比上涨0.8%（口径匹配）；2026年8月份居民消费价格同比上涨0.8%（口径不适配）",
  durationMs: 4,
};

interface SourceDocumentFixture {
  id: string;
  kind: string;
  title: string;
  publisher: string;
  url: string;
  publishedAt: string;
  basis: { metric: string; period: string | null; scope: string | null };
  aliases: string[];
  excerpt: string;
  measures: Array<{ basis: string; value: number; unit: string; excerpt: string }>;
  fingerprint: string;
  distractor?: boolean;
}

const RELEASE_DOCUMENT: SourceDocumentFixture = {
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

const DISTRACTOR_DOCUMENT: SourceDocumentFixture = {
  ...RELEASE_DOCUMENT,
  id: "stats-cpi-2026-08",
  title: "2026年8月份居民消费价格同比上涨0.8%",
  url: "https://www.stats.gov.cn/sj/zxfb/202609/t20260909_1965263.html",
  publishedAt: "2026-09-09",
  basis: { metric: "全国居民消费价格", period: "2026-08", scope: "全国" },
  excerpt: "2026年8月份，全国居民消费价格同比上涨0.8%。8月份，全国居民消费价格环比上涨0.4%。",
  distractor: true,
};

const TERM_DOCUMENT: SourceDocumentFixture = {
  ...RELEASE_DOCUMENT,
  id: "stats-term-yoy-mom",
  kind: "term-explanation",
  title: "同比与环比有何不同",
  basis: { metric: "统计术语：同比与环比", period: null, scope: null },
  measures: [],
};

function hit(document: SourceDocumentFixture, applicable: boolean, matchReasons: string[]) {
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

/** 原文核对：配文主张与图上抄录各自记录出处与文字重合度。 */
function originTrace(claim: typeof IMAGE_CLAIM | typeof CAPTION_CLAIM) {
  return {
    fromImage: claim.fromImage,
    originText: claim.fromImage ? claim.imageExcerpt : "比上月上涨 0.8%。",
    traceable: true,
    coverage: 1,
    matchedRun: claim.claimText,
    note: null,
  };
}

/** 修改建议：逐处关联原句、建议、理由与当前有效引用；模型提议未通过校验的也要留档。 */
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
    SEARCH_EVENT,
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
      reasons: ["主张未说明同比或环比；所引《2025年12月份居民消费价格同比上涨0.8%》分别记载了不同比较方式，不能确定对应哪一个。"],
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
      summary: "与所引国家统计局发布《2025年12月份居民消费价格同比上涨0.8%》（2026-01-09）不一致：该发布记载环比 0.2%，主张写 0.8%，相差 0.6 个百分点。",
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
    { sourceId: "stats-cpi-2026-08", title: DISTRACTOR_DOCUMENT.title, reason: "所引资料与主张口径不一致（月份），不作为数值依据。" },
    { sourceId: "stats-term-yoy-mom", title: TERM_DOCUMENT.title, reason: "同比与环比有何不同 是术语解释页，只用于说明同比与环比的差别，不能作为数值依据。" },
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

// 阶段四 06：社会消费品零售总额的两份发布——旧值 0.35 被后续发布按官方声明修订为 0.40。
const RETAIL_DOCUMENT: SourceDocumentFixture = {
  id: "stats-retail-2026-07",
  kind: "data-release",
  title: "2026年1—7月份社会消费品零售总额增长1.2%",
  publisher: "国家统计局",
  url: "https://www.stats.gov.cn/sj/zxfb/202608/t20260817_1965052.html",
  publishedAt: "2026-08-17",
  basis: { metric: "社会消费品零售总额", period: null, scope: "全国" },
  aliases: ["社会消费品零售总额"],
  excerpt: "2026年1—7月份，社会消费品零售总额287744亿元，同比增长1.2%。附注5「环比数据修订」。",
  measures: [{ basis: "month-on-month", value: 0.35, unit: "%", excerpt: "附注5「环比数据修订」的修订结果表：2026年 6月 环比增速（%）0.35。" }],
  fingerprint: "017220654d110dda",
};

const RETAIL_REVISED_DOCUMENT: SourceDocumentFixture = {
  ...RETAIL_DOCUMENT,
  id: "stats-retail-2026-08",
  title: "2026年1—8月份社会消费品零售总额增长1.1%",
  url: "https://www.stats.gov.cn/sj/zxfb/202609/t20260915_1965311.html",
  publishedAt: "2026-09-15",
  excerpt: "2026年1—8月份，社会消费品零售总额327569亿元，同比增长1.1%。附注5「环比数据修订」。",
  measures: [{ basis: "month-on-month", value: 0.4, unit: "%", excerpt: "附注5「环比数据修订」的修订结果表：2026年 6月 环比增速（%）0.4。" }],
  fingerprint: "382eec551290742b",
};

const RETAIL_REVISION_STATEMENT = "根据季节调整模型自动修正的结果，对2025年8月份以来的社会消费品零售总额环比增速进行修订。";

const RETAIL_CLAIM = {
  ...CAPTION_CLAIM,
  claimText: "2026 年 6 月社会消费品零售总额环比增长 0.35%",
  metric: "社会消费品零售总额",
  period: "2026-06",
  value: 0.35,
  basis: "month-on-month",
  fromImage: false,
  imageExcerpt: null,
};

const REVISION_INVESTIGATION = {
  ...FULL_INVESTIGATION,
  claims: [RETAIL_CLAIM],
  conclusions: [
    {
      claimText: RETAIL_CLAIM.claimText,
      claimKind: "direct",
      fromImage: false,
      status: "source-mismatch",
      summary: `与所引国家统计局发布《${RETAIL_DOCUMENT.title}》（2026-08-17）不一致：该发布记载环比 0.4%，主张写 0.35%，相差 0.05 个百分点。版本复查：所引发布的 0.35% 已被官方修订声明修订为 0.4%，本条按修订后值对照。`,
      basisLabel: "环比",
      claimValue: 0.35,
      officialValue: 0.4,
      difference: 0.05,
      citedSourceIds: ["stats-retail-2026-07"],
      reasons: [
        "依据原句：附注5「环比数据修订」的修订结果表：2026年 6月 环比增速（%）0.4。",
        `修订声明：${RETAIL_REVISION_STATEMENT}（《${RETAIL_REVISED_DOCUMENT.title}》，2026-09-15）`,
      ],
      unresolved: [],
      parts: [],
      origin: originTrace(RETAIL_CLAIM),
      periodNote: null,
      revisionReview: {
        fromSourceId: RETAIL_DOCUMENT.id,
        fromTitle: RETAIL_DOCUMENT.title,
        fromUrl: RETAIL_DOCUMENT.url,
        fromPublishedAt: RETAIL_DOCUMENT.publishedAt,
        fromValue: 0.35,
        toSourceId: RETAIL_REVISED_DOCUMENT.id,
        toTitle: RETAIL_REVISED_DOCUMENT.title,
        toUrl: RETAIL_REVISED_DOCUMENT.url,
        toPublishedAt: RETAIL_REVISED_DOCUMENT.publishedAt,
        toValue: 0.4,
        statement: RETAIL_REVISION_STATEMENT,
        revisedAt: "2026-09-15",
      },
    },
  ],
  citations: [{ sourceId: "stats-retail-2026-07", role: "value-basis", note: null }],
  acceptedCitations: [
    { sourceId: "stats-retail-2026-07", role: "value-basis", note: null },
    { sourceId: "stats-retail-2026-08", role: "value-basis", note: null },
  ],
  citationsRejected: [],
  hits: [
    hit(RETAIL_DOCUMENT, true, ["指标与资料口径匹配", "资料在该月份有记载（2026-06）", "范围与资料一致（全国）"]),
    hit(RETAIL_REVISED_DOCUMENT, true, ["指标与资料口径匹配", "资料在该月份有记载（2026-06）", "范围与资料一致（全国）"]),
    hit(TERM_DOCUMENT, false, ["术语解释材料，可用于比较方式说明"]),
  ],
  excludedSources: [],
  unresolvedItems: [],
  captionSuggestion: {
    caption: RETAIL_CLAIM.claimText,
    suggestedCaption: "2026 年 6 月社会消费品零售总额环比增长 0.4%。",
    changes: [
      {
        claimText: RETAIL_CLAIM.claimText,
        original: "2026 年 6 月社会消费品零售总额环比增长 0.35%",
        suggested: "2026 年 6 月社会消费品零售总额环比增长 0.4%",
        kind: "replace-value",
        reason: "该值已被同系列后续发布按官方修订声明修订为 0.4%，按修订后值改正。",
        sourceIds: ["stats-retail-2026-08"],
        status: "source-mismatch",
        origin: "program",
        rejectedReason: null,
        applied: true,
      },
    ],
    rejectedProposals: [],
    notes: [],
    fingerprint: "5a1b2c3d4e5f6071",
  },
};

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
}

test.beforeAll(async ({ request }) => {
  await expect
    .poll(async () => (await request.get("/api/source-audit/library")).status(), { timeout: 30_000 })
    .toBe(200);
});

test("来源结论、依据展开、补证及采用建议可用键盘完成并恢复焦点", async ({ page }, testInfo) => {
  let initial = 0;
  let resumes = 0;
  await page.route("**/api/source-audit/investigate", async (route) => {
    initial += 1;
    await route.fulfill({ json: { investigation: { ...FULL_INVESTIGATION, investigationId: "keyboard-stub", clarification: {
      question: "请确认比较方式是同比还是环比？", purpose: "仅用于确定口径，不是官方来源。", field: "basis", claimText: CAPTION_CLAIM.claimText,
    } } } });
  });
  await page.route("**/api/source-audit/resume", async (route) => {
    resumes += 1;
    expect(route.request().postData()).toContain("环比");
    await route.fulfill({ json: { investigation: { ...FULL_INVESTIGATION, investigationId: "keyboard-stub" } } });
  });
  await page.goto("/source-audit?sample=cpi-2025-12");
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await tabTo(page, page.getByTestId("run-source-audit"));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "本次核验结果" })).toBeFocused();
  const answer = page.getByTestId("clarification-answer");
  await tabTo(page, answer);
  await page.keyboard.insertText("环比");
  await tabTo(page, page.getByTestId("submit-clarification"));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "本次核验结果" })).toBeFocused();
  const imageDetails = page.locator(".source-claim-card").filter({ hasText: IMAGE_CLAIM.claimText }).locator(".source-claim-details");
  const evidence = imageDetails.locator("summary");
  await tabTo(page, evidence);
  await page.keyboard.press("Enter");
  await expect(imageDetails).toHaveAttribute("open", "");
  await expect(imageDetails).toContainText("图上抄录");
  await page.keyboard.press("Enter");
  const trace = page.locator(".source-tool-details summary");
  await tabTo(page, trace);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tool-trace")).toBeVisible();
  await page.keyboard.press("Enter");
  // 截图明确标为替身，并使用独立缓存路径，CI 不写交付文档。
  await page.evaluate(() => {
    const note = document.createElement("p");
    note.textContent = "离线 UI 测试 · 模型结果替身 · 不代表真实模型复验";
    note.style.cssText = "padding:12px;background:#fff1d2;color:#142b41;font-weight:700";
    document.querySelector(".source-result")?.prepend(note);
  });
  await page.locator(".source-result").evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: testInfo.outputPath("source-result-stub.png") });
  await page.locator(".source-result").screenshot({ path: testInfo.outputPath("source-result-full-stub.png") });
  await tabTo(page, page.getByTestId("adopt-suggestion"));
  await page.keyboard.press("Enter");
  await expect(page.locator("#source-audit-caption")).toBeFocused();
  await expect(page.locator("#source-audit-caption")).toHaveValue("比上月上涨 0.2%");
  await expect(page.getByTestId("adopted-notice")).toHaveAttribute("role", "status");
  await expect(page.getByTestId("history-section")).toContainText("已采用建议");
  await expect(page.locator(".source-result")).toHaveCount(0);
  expect(initial).toBe(1);
  expect(resumes).toBe(1);
});

test("从自制图与配文走到带引用与工具轨迹的来源结论", async ({ page }) => {
  await page.route("**/api/source-audit/investigate", async (route) => {
    await route.fulfill({ status: 200, json: { investigation: FULL_INVESTIGATION } });
  });

  await page.goto("/source-audit");
  await expect(page.getByRole("heading", { name: "核对配文与公开来源" })).toBeVisible();
  // 未选择图片时先给出可操作提示，不发请求。
  await page.getByTestId("run-source-audit").click();
  await expect(page.locator(".error-message")).toContainText("请先上传图表图片");

  await page.getByTestId("load-source-sample").click();
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await expect(page.locator("#source-audit-caption")).toHaveValue("比上月上涨 0.8%");

  await page.getByTestId("run-source-audit").click();

  // 运行摘要按需展开；停止原因始终可见。
  await page.getByText("查看模型与运行统计", { exact: true }).click();
  await expect(page.locator(".source-run-summary")).toContainText("stub-source-model");
  await expect(page.locator(".source-run-summary")).toContainText("工具调用：2 / 6");
  await expect(page.getByTestId("stop-reason")).toContainText("看完工具结果后给出汇总");
  await expect(page.getByTestId("source-overview")).toContainText("配文：1 条与来源不一致");
  await expect(page.getByTestId("source-overview")).toContainText("图内观察：1 条来源待核对");

  // 图内观察：口径缺失被标为来源待核对，不假装确认。
  const imageCard = page.locator(".source-claim-card").filter({ hasText: IMAGE_CLAIM.claimText });
  await expect(imageCard).toContainText("图上未写比较方式");
  // 图上抄录可见，复查者能看到图上到底写了什么。
  await expect(imageCard).toContainText("图上抄录");
  await expect(imageCard).toContainText("2025 年 12 月全国 CPI 上涨 0.8%");
  await expect(imageCard.locator(".source-state-pill")).toHaveText("来源待核对");

  // 配文主张：与官方发布记载的环比不一致。
  const captionCard = page.locator(".source-claim-card").filter({ hasText: CAPTION_CLAIM.claimText });
  await expect(captionCard.getByTestId("value-evidence")).toContainText("原文 0.8% → 所引发布 0.2%");
  await expect(captionCard.getByTestId("value-evidence")).toContainText("12月份，全国居民消费价格环比上涨0.2%");
  await expect(imageCard.getByTestId("value-evidence")).toHaveCount(0);
  await expect(captionCard.locator(".source-state-pill")).toHaveText("与来源不一致");
  await expect(captionCard).toContainText("环比 0.2%");
  await expect(captionCard).toContainText("相差 0.6 个百分点");
  await expect(captionCard).toContainText("依据原句");
  await expect(captionCard).not.toContainText("造假");

  // 引用指向本次命中的官方发布，带原始链接与发布日期。
  const citedDocument = page.locator(".source-document-card.is-cited");
  await expect(citedDocument).toHaveCount(1);
  await tabTo(page, captionCard.getByRole("link", { name: "查看这条来源依据" }));
  await page.keyboard.press("Enter");
  await expect(citedDocument).toBeFocused();
  // 引用角色可见：这份材料是用作数值依据的。
  await expect(citedDocument.getByTestId("cited-badge")).toContainText("用作数值依据");
  await expect(citedDocument).toContainText("国家统计局");
  await expect(citedDocument).toContainText("发布 2026-01-09");
  await expect(citedDocument.locator(".source-document-link")).toHaveAttribute(
    "href",
    "https://www.stats.gov.cn/sj/zxfb/202601/t20260109_1962273.html",
  );

  // 干扰材料与术语页被排除，并给出原因。
  const excludedSources = page.getByTestId("excluded-sources");
  await expect(excludedSources).toContainText("2026年8月份居民消费价格同比上涨0.8%");
  await expect(excludedSources).toContainText("所引资料与主张口径不一致（月份）");
  await expect(excludedSources).toContainText("只用于说明同比与环比的差别");

  // 工具轨迹展示实际事件、状态与拒绝原因。
  await page.getByText("查看工具轨迹与调用预算", { exact: true }).click();
  const trace = page.getByTestId("tool-trace").locator("li");
  await expect(trace).toHaveCount(3);
  await expect(trace.nth(0)).toContainText("检索资料库");
  await expect(trace.nth(0)).toContainText("先检索 2025 年 12 月的全国 CPI 材料。");
  await expect(trace.nth(1)).toContainText("比较数值");
  await expect(trace.nth(2)).toContainText("未执行");
  await expect(trace.nth(2)).toContainText("本轮超过 3 次工具调用上限");

  await expect(page.getByTestId("unresolved-items")).toContainText("未标注比较基准");
  await expectNoHorizontalOverflow(page);
});

test("修改建议逐处给出原句、理由与引用；采用后写入配文并转入历史", async ({ page }) => {
  await page.route("**/api/source-audit/investigate", async (route) => {
    await route.fulfill({ status: 200, json: { investigation: FULL_INVESTIGATION } });
  });

  await page.goto("/source-audit");
  await page.getByTestId("load-source-sample").click();
  await expect(page.locator("#source-audit-caption")).toHaveValue("比上月上涨 0.8%");
  await page.getByTestId("run-source-audit").click();

  // 建议面板：原配文与建议配文分开显示，明确不自动替换。
  const panel = page.getByTestId("caption-suggestion");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("不自动替换原配文");
  await expect(page.getByTestId("suggested-caption")).toContainText("比上月上涨 0.2%");

  // 逐处改动：原句、建议、理由、状态与当前有效引用。
  const change = page.getByTestId("suggestion-changes").locator("li").first();
  await expect(change).toContainText("替换数值");
  await expect(change).toContainText("原句：比上月上涨 0.8%");
  await expect(change).toContainText("建议：比上月上涨 0.2%");
  await expect(change).toContainText("理由：所引发布记载环比 0.2%");
  await expect(change).toContainText("引用：2025年12月份居民消费价格同比上涨0.8%");
  await expect(change).toContainText("与来源不一致");

  // 模型提议未通过校验时留档，并给出拒绝原因。
  await expect(page.getByTestId("suggestion-rejected")).toContainText("创下");
  await expect(page.getByTestId("suggestion-notes")).toContainText("没有核验");

  // 没有被自动替换：配文输入框里仍然是原句。
  await expect(page.locator("#source-audit-caption")).toHaveValue("比上月上涨 0.8%");

  // 采用：只把建议写进输入框，旧结论与旧建议撤回并转入历史。
  await page.getByTestId("adopt-suggestion").click();
  await expect(page.locator("#source-audit-caption")).toHaveValue("比上月上涨 0.2%");
  await expect(page.getByTestId("adopted-notice")).toContainText("请重新核验");
  await expect(page.getByTestId("caption-suggestion")).toHaveCount(0);

  const historyEntry = page.getByTestId("history-entry-0");
  await expect(historyEntry).toContainText("已采用建议");
  await expect(historyEntry).toContainText("旧结论与旧建议撤回");
  await historyEntry.locator("summary").click();
  await expect(page.getByTestId("history-suggestion")).toContainText("历史建议配文：比上月上涨 0.2%");
  await expect(page.getByTestId("history-suggestion")).toContainText("不代表当前结果");
  await expectNoHorizontalOverflow(page);
});

test("版本复查：结论卡展示修订前后值、官方声明原句与两份发布链接", async ({ page }) => {
  await page.route("**/api/source-audit/investigate", async (route) => {
    await route.fulfill({ status: 200, json: { investigation: REVISION_INVESTIGATION } });
  });

  await page.goto("/source-audit");
  await page.getByTestId("load-source-sample").click();
  await page.getByTestId("run-source-audit").click();

  // 主张卡默认折叠，展开后再断言版本复查区块。
  await page.locator(".source-claim-details summary").first().click();
  const block = page.getByTestId("revision-review");
  await expect(block).toBeVisible();
  await expect(block).toContainText("版本复查");
  await expect(block).toContainText("0.35");
  await expect(block).toContainText("0.4");
  await expect(block).toContainText("按修订后值对照");
  // 官方修订声明逐字展示，并给出被修订发布与修订发布的原始链接。
  await expect(block).toContainText("季节调整模型自动修正");
  await expect(block.locator("a").nth(0)).toHaveAttribute("href", RETAIL_DOCUMENT.url);
  await expect(block.locator("a").nth(1)).toHaveAttribute("href", RETAIL_REVISED_DOCUMENT.url);

  // 建议配文用修订后的值。
  await expect(page.getByTestId("suggested-caption")).toContainText("0.4");
  await expectNoHorizontalOverflow(page);
});

test("推断依据不足、观点与未展开内容逐条展示，主张卡可展开复查", async ({ page }) => {
  const inferenceClaim = {
    claimText: "8 月 CPI 比上月便宜",
    metric: "全国居民消费价格",
    scope: "全国",
    period: "2026-08",
    value: null,
    basis: "month-on-month",
    kind: "inference",
    direction: "down",
    fromImage: false,
    imageExcerpt: null,
  };
  const opinionClaim = {
    claimText: "物价压力缓解说明政策效果显现",
    metric: "全国居民消费价格",
    scope: "全国",
    period: null,
    value: null,
    basis: null,
    kind: "opinion",
    direction: null,
    fromImage: false,
    imageExcerpt: null,
  };
  const pendingClaim = {
    ...inferenceClaim,
    claimText: "7 月 CPI 比上月便宜",
    period: "2026-07",
  };

  const investigation = {
    ...FULL_INVESTIGATION,
    claims: [inferenceClaim, opinionClaim, pendingClaim],
    conclusions: [
      {
        ...FULL_INVESTIGATION.conclusions[1],
        claimText: inferenceClaim.claimText,
        claimKind: "inference",
        status: "source-mismatch",
        summary: "与所引国家统计局发布《2026年8月份居民消费价格同比上涨0.8%》（2026-09-09）不一致：该发布记载环比 0.4%，方向为上涨，与这条推断断言的「下降」相反。",
        basisLabel: "环比",
        claimValue: null,
        officialValue: 0.4,
        difference: null,
        citedSourceIds: ["stats-cpi-2026-08"],
        reasons: ["依据原句：8月份，全国居民消费价格环比上涨0.4%。"],
        unresolved: ["这条推断与所引发布的方向或数字不一致，需要复核配文使用的口径（同比／环比）与数值。"],
        parts: [{ label: "推断结论", status: "contradicted", detail: "该发布记载环比 0.4%，方向为上涨，与这条推断断言的「下降」相反", sourceId: "stats-cpi-2026-08" }],
        origin: originTrace({ ...CAPTION_CLAIM, claimText: inferenceClaim.claimText }),
        periodNote: null,
      },
      {
        ...FULL_INVESTIGATION.conclusions[0],
        claimText: opinionClaim.claimText,
        claimKind: "opinion",
        status: "not-verifiable",
        summary: "不支持核验：这条是观点或超出数据范围的判断，来源核验不对它做真假定论。",
        basisLabel: null,
        claimValue: null,
        citedSourceIds: [],
        reasons: [],
        unresolved: [],
        parts: [{ label: "可核验性", status: "insufficient", detail: "观点、原因、动机与超出数据的判断不在来源核验范围内，系统只核对可追溯的数据主张。", sourceId: null }],
        origin: originTrace({ ...CAPTION_CLAIM, claimText: opinionClaim.claimText }),
        periodNote: null,
      },
      {
        ...FULL_INVESTIGATION.conclusions[0],
        claimText: pendingClaim.claimText,
        claimKind: "inference",
        status: "inference-unsupported",
        summary: "推断依据不足：本次没有可用于这条推断的适用来源（资料库没有 2026 年 7 月的发布）；这不代表结论为假，只是现有证据还不能推出它。",
        basisLabel: "环比",
        claimValue: null,
        citedSourceIds: [],
        reasons: ["资料库没有 2026 年 7 月的发布。"],
        unresolved: ["需要 2026-07 的环比数据才能继续核对这条推断。"],
        parts: [{ label: "推断结论", status: "insufficient", detail: "本次没有可用于这条推断的适用来源", sourceId: null }],
        origin: originTrace({ ...CAPTION_CLAIM, claimText: pendingClaim.claimText }),
        periodNote: "只写了「7 月」，年份按图上标注的 2026-07 补全。",
      },
    ],
    omittedClaims: [
      { claimText: "7 月 CPI 同比涨幅高于 8 月。", reason: "单次最多核验 3 条主张，这条配文主张没有展开，也没有参与结论。", source: "caption" },
      { claimText: "同比涨幅连续两个月回落", reason: "模型声明这段内容没有展开；它不在配文里（可能是图上说明），本次没有核验。", source: "other" },
    ],
    captionCoverage: 0.62,
    captionCoverageNote: "配文还有 1 处内容没有核验：「7 月 CPI 同比涨幅高于 8 月。」。缩小配文范围后可以重新核验。",
  };

  await page.route("**/api/source-audit/investigate", async (route) => {
    await route.fulfill({ status: 200, json: { investigation } });
  });

  await page.goto("/source-audit");
  await page.getByTestId("load-source-sample").click();
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await page.getByTestId("run-source-audit").click();

  // 推断被适用来源改判：逐部位给出「来源矛盾」。
  const inferenceCard = page.locator(".source-claim-card").filter({ hasText: inferenceClaim.claimText });
  await expect(inferenceCard.locator(".source-kind-chip")).toHaveText("可检查推断");
  await expect(inferenceCard.locator(".source-state-pill")).toHaveText("与来源不一致");
  await expect(inferenceCard.getByTestId("claim-parts")).toContainText("推断结论 · 来源矛盾");
  // 主张卡默认收起，点开后依据、缺口与未解决项可见。
  await expect(inferenceCard.getByTestId("claim-parts")).toBeHidden();
  await inferenceCard.locator("summary").click();
  await expect(inferenceCard.getByTestId("claim-parts")).toBeVisible();
  await expect(inferenceCard).toContainText("依据原句");

  // 缺依据的推断给「推断依据不足」，明确不等于结论为假，并说明缺哪一项。
  const pendingCard = page.locator(".source-claim-card").filter({ hasText: pendingClaim.claimText });
  await expect(pendingCard.locator(".source-state-pill")).toHaveText("推断依据不足");
  await expect(pendingCard).toContainText("不代表结论为假");
  await expect(pendingCard).toContainText("需要 2026-07 的环比数据");
  await expect(pendingCard).toContainText("年份按图上标注的 2026-07 补全");

  // 观点不做真假判定。
  const opinionCard = page.locator(".source-claim-card").filter({ hasText: opinionClaim.claimText });
  await expect(opinionCard.locator(".source-kind-chip")).toHaveText("观点（不支持核验）");
  await expect(opinionCard.locator(".source-state-pill")).toHaveText("不支持核验");
  await expect(opinionCard).toContainText("不对它做真假定论");
  await expect(opinionCard).not.toContainText("造假");

  // 没有核验的内容逐条保留原文。
  const omitted = page.getByTestId("omitted-claims");
  await expect(omitted).toContainText("本次没有核验的内容");
  await expect(omitted).toContainText("7 月 CPI 同比涨幅高于 8 月。");
  await expect(omitted).toContainText("配文未展开");
  // 模型声明的图上说明另列，不计入配文内容。
  await expect(omitted).toContainText("同比涨幅连续两个月回落");
  await expect(omitted).toContainText("图上说明／其他声明");
  await expect(omitted).toContainText("配文还有 1 处内容没有核验");

  await expectNoHorizontalOverflow(page);
});

test("引用错月份材料时降级为来源待核对并列出被拒绝的引用", async ({ page }) => {
  const mismatched = {
    ...FULL_INVESTIGATION,
    conclusions: [
      FULL_INVESTIGATION.conclusions[0],
      {
        ...FULL_INVESTIGATION.conclusions[1],
        status: "source-pending",
        summary: "来源待核对：所引来源与主张口径不一致，不能作为数值依据。",
        officialValue: null,
        difference: null,
        citedSourceIds: [],
        reasons: ["引用资料的口径与主张不一致，未能用于数值核对。"],
      },
    ],
    acceptedCitations: [],
    citationsRejected: [
      { sourceId: "stats-cpi-2026-08", reason: "所引资料与主张口径不一致（period），不作为数值依据。" },
      { sourceId: "stats-term-yoy-mom", reason: "同比与环比有何不同 是术语解释页，只用于说明同比与环比的差别，不能作为数值依据。" },
    ],
    noApplicableSourceReason: null,
  };
  await page.route("**/api/source-audit/investigate", async (route) => {
    await route.fulfill({ status: 200, json: { investigation: mismatched } });
  });

  await page.goto("/source-audit");
  await page.getByTestId("load-source-sample").click();
  // 样例图要先取回并设成待上传文件，否则点核验会被表单校验挡下。
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await page.getByTestId("run-source-audit").click();

  const captionCard = page.locator(".source-claim-card").filter({ hasText: CAPTION_CLAIM.claimText });
  await expect(captionCard.locator(".source-state-pill")).toHaveText("来源待核对");
  await expect(captionCard).toContainText("不能作为数值依据");
  await expect(page.locator(".source-document-card.is-cited")).toHaveCount(0);
  await expect(page.getByTestId("rejected-citations")).toContainText("stats-cpi-2026-08");
  await expect(page.getByTestId("rejected-citations")).toContainText("不作为数值依据");
  // 术语解释页不能充当具体月份的数值依据。
  await expect(page.getByTestId("rejected-citations")).toContainText("术语解释页");
  await expect(page.getByTestId("rejected-citations")).toContainText("不能作为数值依据");
  await expectNoHorizontalOverflow(page);
});

test("上游失败或超时时只显示失败原因，不展示任何结论", async ({ page }) => {
  await page.goto("/source-audit");
  await page.getByTestId("load-source-sample").click();
  await expect(page.locator(".source-image-stage img")).toBeVisible();

  await page.route("**/api/source-audit/investigate", async (route) => {
    await route.fulfill({
      status: 502,
      json: { error: { code: "SOURCE_INVESTIGATION_FAILED", message: "暂时无法完成来源调查，请稍后重试。" } },
    });
  });
  await page.getByTestId("run-source-audit").click();
  await expect(page.locator(".error-message")).toContainText("暂时无法完成来源调查");
  await expect(page.locator(".source-result")).toHaveCount(0);
  await expect(page.getByTestId("tool-trace")).toHaveCount(0);
  await expect(page.getByTestId("stop-reason")).toHaveCount(0);

  await page.unroute("**/api/source-audit/investigate");
  await page.route("**/api/source-audit/investigate", async (route) => {
    await route.fulfill({
      status: 504,
      json: { error: { code: "SOURCE_INVESTIGATION_TIMEOUT", message: "来源调查超时。请稍后重试或换用更小的图片。" } },
    });
  });
  await page.getByTestId("run-source-audit").click();
  await expect(page.locator(".error-message")).toContainText("来源调查超时");
  // 失败不会用上一次或预置结果顶替。
  await expect(page.locator(".source-claim-card")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("没有模型密钥时给出可操作提示，并列出固定资料库", async ({ page }) => {
  await page.route("**/api/source-audit/investigate", async (route) => {
    await route.fulfill({
      status: 503,
      json: { error: { code: "MODEL_NOT_CONFIGURED", message: "来源核验需要调用模型选择工具。请前往模型设置页填写地址、模型名和 API Key。" } },
    });
  });

  await page.goto("/source-audit");
  await page.getByTestId("load-source-sample").click();
  // 样例图要先取回并设成待上传文件，否则点核验会被表单校验挡下。
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await page.getByTestId("run-source-audit").click();

  await expect(page.locator(".error-message")).toContainText("请前往模型设置页");
  await expect(page.getByRole("link", { name: "前往模型设置并测试连接" })).toHaveAttribute("href", "/settings");
  await expect(page.locator(".source-result")).toHaveCount(0);

  // 资料库清单可展开，且标明干扰项。
  await page.getByRole("button", { name: "展开资料库" }).click();
  await expect(page.locator(".source-library-list")).toContainText("国家统计局");
  await expect(page.locator(".source-library-list")).toContainText("干扰项");
  await expectNoHorizontalOverflow(page);
});

test("追问 → 提交补充 → 沿同一记录恢复出新结论，旧结论转为历史", async ({ page }) => {
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
        supplement: { field: "basis", raw: "同比", normalized: "year-on-year", applied: true, conflict: null },
        reasons: ["依据原句：2025年12月份，全国居民消费价格同比上涨0.8%。", "比较方式「同比」由用户补充确定（用户提供，仅用于确定口径，不是官方来源）。"],
        unresolved: [],
      },
    ],
    clarification: null,
    // 补证后主张改判为一致：建议随之改为保留原句（旧建议在页面上转入历史）。
    captionSuggestion: {
      caption: "比上月上涨 0.8%",
      suggestedCaption: "比上月上涨 0.8%",
      changes: [{
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
      }],
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

  await page.route("**/api/source-audit/investigate", async (route) => {
    await route.fulfill({ status: 200, json: { investigation: CLARIFICATION_INVESTIGATION } });
  });
  await page.route("**/api/source-audit/resume", async (route) => {
    const fields = route.request().postData() ?? "";
    if (!fields.includes("answer")) throw new Error("恢复请求缺少回答");
    await route.fulfill({ status: 200, json: { investigation: RESUMED_INVESTIGATION } });
  });

  await page.goto("/source-audit");
  await page.getByTestId("load-source-sample").click();
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await page.getByTestId("run-source-audit").click();

  // 追问与回答入口可见，追问指明影响哪条主张与哪项口径。
  const clarify = page.getByTestId("clarification-block");
  await expect(clarify).toContainText("同比还是环比");
  await expect(clarify).toContainText("影响的主张");
  await expect(clarify).toContainText(CAPTION_CLAIM.claimText);
  await expect(clarify).toContainText("用户提供");

  // 补证前的结论是「与来源不一致」。
  const beforeCard = page.locator(".source-claim-card").filter({ hasText: CAPTION_CLAIM.claimText });
  await expect(beforeCard.locator(".source-state-pill")).toHaveText("与来源不一致");

  // 提交补充回答。
  await page.getByTestId("clarification-answer").fill("同比");
  await page.getByTestId("submit-clarification").click();

  // 恢复段成为当前结果：补证记录标为用户提供，结论改判。
  const supplement = page.getByTestId("supplement-block");
  await expect(supplement).toContainText("用户回答（用户提供）：同比");
  await expect(supplement).toContainText("标为用户提供（不是官方来源）");
  const afterCard = page.locator(".source-claim-card").filter({ hasText: CAPTION_CLAIM.claimText });
  await expect(afterCard.locator(".source-state-pill")).toHaveText("与来源一致");
  await expect(afterCard).toContainText("由用户补充确定");

  // 补证前后对照：结论为什么变。
  const changes = page.getByTestId("conclusion-changes");
  await expect(changes).toContainText(CAPTION_CLAIM.claimText);
  await expect(changes).toContainText("与来源不一致");
  await expect(changes).toContainText("与来源一致");
  await expect(changes).toContainText("用户补充确定了比较方式");

  // 补证前的结论只作历史展示。
  const history = page.getByTestId("history-section");
  await expect(history).toContainText("仅作历史展示");
  await expect(history).toContainText("已由补证结果接续");
  const entry = page.getByTestId("history-entry-0");
  await entry.locator("summary").click();
  await expect(entry).toContainText("历史");
  await expect(entry).toContainText("与来源不一致");

  await expectNoHorizontalOverflow(page);
});

test("现场改配文后旧结论立即失效转为历史，迟到响应不复活它", async ({ page }) => {
  const releases: Array<() => void> = [];
  let started = 0;
  let settled = 0;
  let responseNumber = 0;
  await page.route("**/api/source-audit/investigate", async (route) => {
    const number = ++responseNumber;
    started += 1;
    // 第 2 次请求挂起：制造「输入改动时响应仍在途」的窗口。
    if (number === 2) {
      await new Promise<void>((resolve) => { releases.push(resolve); });
    }
    try {
      await route.fulfill({ status: 200, json: { investigation: FULL_INVESTIGATION } });
    } catch {
      // 客户端取消或作废后，浏览器可能已关闭这次请求。
    } finally {
      settled += 1;
    }
  });

  await page.goto("/source-audit");
  await page.getByTestId("load-source-sample").click();
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await page.getByTestId("run-source-audit").click();
  await expect(page.getByTestId("stop-reason")).toBeVisible();

  // 现场改配文（改范围／月份等口径都写在配文里）→ 当前结论立即失效。
  await page.locator("#source-audit-caption").fill("全国城市 12 月 CPI 同比上涨 0.8%。");
  await expect(page.locator(".source-result")).toHaveCount(0);
  const history = page.getByTestId("history-section");
  await expect(history).toContainText("配文已改动，结论已失效");
  await expect(history).toContainText("仅作历史展示");

  // 重新发起核验，让请求挂在途中，然后再次改配文作废它。
  await page.getByTestId("run-source-audit").click();
  await expect.poll(() => started).toBe(2);
  await page.locator("#source-audit-caption").fill("12 月 CPI 上涨 0.8%，创年内新高。");
  releases.shift()?.();
  await expect.poll(() => settled).toBe(2);

  // 迟到响应被丢弃：当前仍无结果，旧结论只在历史里。
  await expect(page.locator(".source-result")).toHaveCount(0);
  await expect(page.getByTestId("stop-reason")).toHaveCount(0);
  await expect(page.getByTestId("history-section")).toContainText("仅作历史展示");

  await expectNoHorizontalOverflow(page);
});

test("重新核验后取消，旧结论不复活且只作历史展示", async ({ page }) => {
  const releases: Array<() => void> = [];
  let started = 0;
  await page.route("**/api/source-audit/investigate", async (route) => {
    const number = (started += 1);
    if (number === 2) {
      await new Promise<void>((resolve) => { releases.push(resolve); });
    }
    try {
      await route.fulfill({ status: 200, json: { investigation: FULL_INVESTIGATION } });
    } catch {
      // 取消后浏览器已关闭这次请求。
    }
  });

  await page.goto("/source-audit");
  await page.getByTestId("load-source-sample").click();
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await page.getByTestId("run-source-audit").click();
  await expect(page.getByTestId("stop-reason")).toBeVisible();

  // 重新核验：旧结论转历史；中途取消 → 不复活旧结论。
  await page.getByTestId("run-source-audit").click();
  await expect.poll(() => started).toBe(2);
  await page.getByRole("button", { name: /取消核验/ }).click();
  releases.shift()?.();

  await expect(page.locator(".source-result")).toHaveCount(0);
  await expect(page.getByTestId("history-section")).toContainText("重新核验，上一份结论已转为历史");
  await expect(page.getByTestId("history-section")).toContainText("仅作历史展示");

  await expectNoHorizontalOverflow(page);
});
