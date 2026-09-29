import { expect, test, type Page } from "@playwright/test";

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

test("从自制图与配文走到带引用与工具轨迹的来源结论", async ({ page }) => {
  await page.route("**/api/source-audit/investigate", async (route) => {
    await route.fulfill({ status: 200, json: { investigation: FULL_INVESTIGATION } });
  });

  await page.goto("/source-audit");
  await expect(page.getByRole("heading", { name: "CPI 图文主张的来源核验" })).toBeVisible();
  // 未选择图片时先给出可操作提示，不发请求。
  await page.getByTestId("run-source-audit").click();
  await expect(page.locator(".error-message")).toContainText("请先上传图表图片");

  await page.getByTestId("load-source-sample").click();
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await expect(page.locator("#source-audit-caption")).toHaveValue("比上月上涨 0.8%");

  await page.getByTestId("run-source-audit").click();

  // 运行摘要与停止原因。
  await expect(page.locator(".source-run-summary")).toContainText("stub-source-model");
  await expect(page.locator(".source-run-summary")).toContainText("工具调用：2 / 6");
  await expect(page.getByTestId("stop-reason")).toContainText("看完工具结果后给出汇总");

  // 图内观察：口径缺失被标为来源待核对，不假装确认。
  const imageCard = page.locator(".source-claim-card").filter({ hasText: IMAGE_CLAIM.claimText });
  await expect(imageCard).toContainText("图上未写比较方式");
  // 图上抄录可见，复查者能看到图上到底写了什么。
  await expect(imageCard).toContainText("图上抄录");
  await expect(imageCard).toContainText("2025 年 12 月全国 CPI 上涨 0.8%");
  await expect(imageCard.locator(".source-state-pill")).toHaveText("来源待核对");

  // 配文主张：与官方发布记载的环比不一致。
  const captionCard = page.locator(".source-claim-card").filter({ hasText: CAPTION_CLAIM.claimText });
  await expect(captionCard.locator(".source-state-pill")).toHaveText("与来源不一致");
  await expect(captionCard).toContainText("环比 0.2%");
  await expect(captionCard).toContainText("相差 0.6 个百分点");
  await expect(captionCard).toContainText("依据原句");
  await expect(captionCard).not.toContainText("造假");

  // 引用指向本次命中的官方发布，带原始链接与发布日期。
  const citedDocument = page.locator(".source-document-card.is-cited");
  await expect(citedDocument).toHaveCount(1);
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
