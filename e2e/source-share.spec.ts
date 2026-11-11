import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// 来源核验结果分享：替身响应，不触发真实模型调用。
// 网络响应由 page.route 覆盖，页面渲染、摘要拼装、剪贴板降级与焦点管理都走真实实现。
// 夹具刻意在本文件内自包含（不从 source-audit.spec.ts import），避免引入那里的用例。

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

/** 修改建议：逐处关联原句、建议、理由与当前有效引用；未采用的建议要在摘要里标明。 */
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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
}

// 剪贴板替身：正常路径记录写进剪贴板的文本；降级路径把 clipboard 变成不可用。
async function stubClipboard(page: Page, record: boolean): Promise<void> {
  await page.addInitScript((shouldRecord: boolean) => {
    if (!shouldRecord) {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      return;
    }
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { __copiedShare?: string }).__copiedShare = text;
        },
      },
    });
  }, record);
}

/** 走到「本次核验结果」：载入团队自制样例 → 发起核验 → 结果区出现。 */
async function reachResult(page: Page): Promise<void> {
  await page.goto("/source-audit?sample=cpi-2025-12");
  await expect(page.locator("main h1")).toBeVisible();
  if (!(await page.locator(".source-image-stage img").isVisible())) {
    await page.getByTestId("load-source-sample").click();
  }
  await expect(page.locator(".source-image-stage img")).toBeVisible();
  await page.getByTestId("run-source-audit").click();
  await expect(page.getByRole("heading", { name: "本次核验结果" })).toBeVisible();
}

test.beforeAll(async ({ request }) => {
  await expect
    .poll(async () => (await request.get("/api/source-audit/library")).status(), { timeout: 30_000 })
    .toBe(200);
});

test("分享核验结果：摘要含结论与边界，复制后焦点可恢复", async ({ page }) => {
  await stubClipboard(page, true);
  await page.route("**/api/source-audit/investigate", (route) =>
    route.fulfill({ json: { investigation: FULL_INVESTIGATION } }),
  );

  await reachResult(page);

  // 结果区块出现分享入口。
  const openShare = page.getByTestId("open-share");
  await expect(openShare).toHaveText("分享这次核验");
  await openShare.click();

  // 原生 dialog 打开，摘要是只读纯文本。
  const dialog = page.locator("dialog.room-share-dialog");
  await expect(dialog).toBeVisible();
  const summary = page.getByTestId("share-summary-text");
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("readonly", "");

  const value = await summary.inputValue();
  const lines = value.split("\n");
  expect(lines[0]).toBe("图证 · 来源核验摘要");
  expect(value).toContain("仅核对当前主张与适用的收录来源");
  expect(value).toContain("与来源不一致");
  expect(value).toContain("尚未采用");
  expect(value).toContain(`原文链接：${RELEASE_DOCUMENT.url}`);
  // 指纹行由摘要正文算出，16 位十六进制；同一段文字应得到同一个值。
  const fingerprintLine = lines.find((line) => line.startsWith("摘要指纹："));
  expect(fingerprintLine).toBeDefined();
  expect(fingerprintLine).toMatch(/^摘要指纹：[0-9a-f]{16}$/);

  // 复制：状态提示可见，且写进剪贴板的正是只读摘要全文。
  await page.getByTestId("share-copy").click();
  await expect(page.getByTestId("share-status")).toHaveText("已复制到剪贴板。");
  const copied = await page.evaluate(() => (window as unknown as { __copiedShare?: string }).__copiedShare);
  expect(copied).toBe(value);

  // Escape 关闭，焦点回到触发按钮。
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(openShare).toBeFocused();

  await expectNoHorizontalOverflow(page);
});

test("分享核验结果：剪贴板不可用时选中摘要并提示手动复制", async ({ page }) => {
  await stubClipboard(page, false);
  await page.route("**/api/source-audit/investigate", (route) =>
    route.fulfill({ json: { investigation: FULL_INVESTIGATION } }),
  );

  await reachResult(page);

  await page.getByTestId("open-share").click();
  const dialog = page.locator("dialog.room-share-dialog");
  await expect(dialog).toBeVisible();

  const summary = page.getByTestId("share-summary-text");
  await expect(summary).toBeVisible();
  await expect(summary).toHaveValue(/图证 · 来源核验摘要/);

  // 剪贴板不可用：不假装复制成功，改为选中摘要文本并提示快捷键。
  await page.getByTestId("share-copy").click();
  await expect(page.getByTestId("share-status")).toContainText("已选中摘要文本");
  await expect(summary).toBeFocused();
  const selected = await summary.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
  });
  expect(selected).toContain("图证 · 来源核验摘要");

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("open-share")).toBeFocused();

  await expectNoHorizontalOverflow(page);
});

// 图片剪贴板替身：记录写进去的图片类型；浏览器不支持时也可复用。
async function stubImageClipboard(page: Page, record: boolean): Promise<void> {
  await page.addInitScript((shouldRecord: boolean) => {
    const scope = window as unknown as { __copiedImage?: string[] };
    if (!shouldRecord) {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      return;
    }
    class FakeClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }
    Object.defineProperty(window, "ClipboardItem", { configurable: true, value: FakeClipboardItem });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { __copiedShare?: string }).__copiedShare = text;
        },
        write: async (items: InstanceType<typeof FakeClipboardItem>[]) => {
          scope.__copiedImage = items.map((item) => Object.keys(item.items).join(","));
        },
      },
    });
  }, record);
}

test("分享格式切到「图片」：给出长图预览，可下载也可复制，文字区收起", async ({ page }, testInfo) => {
  await stubImageClipboard(page, true);
  await page.route("**/api/source-audit/investigate", (route) =>
    route.fulfill({ json: { investigation: FULL_INVESTIGATION } }),
  );

  await reachResult(page);
  await page.getByTestId("open-share").click();

  const dialog = page.locator("dialog.room-share-dialog");
  await expect(dialog).toBeVisible();
  // 默认是「文字」：文字区在，图片区不在。
  await expect(page.getByTestId("share-format-text")).toBeChecked();
  await expect(page.getByTestId("share-summary-text")).toBeVisible();
  await expect(page.getByTestId("share-image-preview")).toHaveCount(0);
  // 只有两档：没有单独的「文字+图片」选项。
  await expect(page.locator('input[name="share-format"]')).toHaveCount(2);
  await expect(page.getByTestId("share-format-both")).toHaveCount(0);

  await page.getByTestId("share-format-image").check();
  await expect(page.getByTestId("share-format-hint")).toContainText("竖版长图");

  const preview = page.getByTestId("share-image-preview");
  await expect(preview).toBeVisible();
  // 图片是真的画出来的：1080 宽、有实际高度、不是空 data URL。
  const rendered = await preview.evaluate((element) => {
    const img = element as HTMLImageElement;
    return { width: img.naturalWidth, height: img.naturalHeight, prefix: img.src.slice(0, 22) };
  });
  expect(rendered.prefix).toBe("data:image/png;base64,");
  expect(rendered.width).toBe(1080);
  expect(rendered.height).toBeGreaterThan(600);
  // 切到图片后文字区收起，避免「以为也在分享文字」。
  await expect(page.getByTestId("share-summary-text")).toHaveCount(0);

  const download = page.getByTestId("share-image-download");
  await expect(download).toHaveAttribute("download", /^图证-来源核验摘要-[0-9a-f]{8}\.png$/);
  await expect(download).toHaveAttribute("href", /^data:image\/png;base64,/);
  await expect(page.getByTestId("share-image-meta")).toContainText("图片是文字摘要的排版截图");

  const [saved] = await Promise.all([page.waitForEvent("download"), download.click()]);
  const savedPath = testInfo.outputPath("share-summary.png");
  await saved.saveAs(savedPath);
  expect(await saved.failure()).toBeNull();
  const png = await readFile(savedPath);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.readUInt32BE(16)).toBe(rendered.width);
  expect(png.readUInt32BE(20)).toBe(rendered.height);
  await page.screenshot({ path: testInfo.outputPath("share-dialog.png") });

  // 图片走 clipboard.write，类型必须是 image/png。
  await page.getByTestId("share-image-copy").click();
  await expect(page.getByTestId("share-image-status")).toHaveText("已复制图片到剪贴板。");
  const copiedTypes = await page.evaluate(() => (window as unknown as { __copiedImage?: string[] }).__copiedImage);
  expect(copiedTypes).toEqual(["image/png"]);

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("open-share")).toBeFocused();

  await expectNoHorizontalOverflow(page);
});

test("分享格式键盘可达：Tab 到格式选项，方向键切换格式", async ({ page }) => {
  await stubClipboard(page, true);
  await page.route("**/api/source-audit/investigate", (route) =>
    route.fulfill({ json: { investigation: FULL_INVESTIGATION } }),
  );

  await reachResult(page);
  await page.getByTestId("open-share").focus();
  await page.keyboard.press("Enter");

  // 打开后焦点落在格式选择上，不落在不可见的对话框本身。
  await expect(page.getByTestId("share-format-text")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("share-format-image")).toBeChecked();
  await expect(page.getByTestId("share-image-preview")).toBeVisible();
  // 只有两档，再按方向键回绕到「文字」。
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("share-format-text")).toBeChecked();
  await expect(page.getByTestId("share-summary-text")).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByTestId("share-summary-text")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("share-copy")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("share-status")).toHaveText("已复制到剪贴板。");

  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.room-share-dialog")).not.toBeVisible();
  await expect(page.getByTestId("open-share")).toBeFocused();

  await expectNoHorizontalOverflow(page);
});

test("图片剪贴板不可用时提示下载；配文改动后历史结果不能继续分享", async ({ page }) => {
  await stubImageClipboard(page, false);
  await page.route("**/api/source-audit/investigate", (route) =>
    route.fulfill({ json: { investigation: FULL_INVESTIGATION } }),
  );
  await reachResult(page);
  await page.getByTestId("open-share").click();
  await page.getByTestId("share-format-image").check();
  await page.getByTestId("share-image-copy").click();
  await expect(page.getByTestId("share-image-status")).toHaveText("图片复制未成功，请用「下载图片」保存。");
  await expect(page.getByTestId("share-image-download")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("textarea").first().fill("修改后的配文，需要重新核验。");
  await expect(page.getByTestId("open-share")).toHaveCount(0);
  await expect(page.getByTestId("history-section")).toBeVisible();
  await expect(page.getByTestId("history-section").getByText("分享这次核验")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
