import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// 只走预置示例路径，不读取模型、不需要 API Key；真实云端读取另见 docs/STAGE-1.md 的复验步骤。

// 切换主图在窄屏用折叠的选择器、桌面用样例卡，两者都调同一个 loadSample。
async function selectMainSample(page: Page, id: string): Promise<void> {
  const { samples } = await (await page.request.get("/api/samples")).json() as { samples: Array<{ id: string }> };
  if ((page.viewportSize()?.width ?? 1280) <= 480) {
    await page.locator("#mobile-sample-select").selectOption(id);
    return;
  }
  await page.locator(".sample-button").nth(samples.findIndex((sample) => sample.id === id)).click();
}

test.beforeAll(async ({ request }) => {
  await expect
    .poll(async () => (await request.get("/api/samples")).status(), { timeout: 30_000 })
    .toBe(200);
});

test("上传读取失败能辨认原因、重试，且不沿用旧结论", async ({ page, request }) => {
  const preset = (await (await request.post("/api/audit/sample", { data: { id: "consistent" } })).json()).observation;
  const failures = [
    { status: 503, code: "MODEL_NOT_CONFIGURED", message: "实时视觉读取尚未配置。" },
    { status: 504, code: "VISION_TIMEOUT", message: "图片读取超时。" },
    { status: 502, code: "INVALID_MODEL_OUTPUT", message: "模型返回内容无法安全使用。" },
    { status: 502, code: "VISION_REQUEST_FAILED", message: "暂时无法读取图片。" },
  ];
  let attempts = 0;
  await page.route("**/api/audit/image", async (route) => {
    const failure = failures[attempts++];
    await route.fulfill(failure
      ? { status: failure.status, json: { error: { code: failure.code, message: failure.message } } }
      : { status: 200, json: { observation: { ...preset, source: "vision-model" } } });
  });
  await page.goto("/audit?sample=conflict");
  await page.locator(".observation-form .confirm-button").click();
  await expect(page.locator(".result-sheet .result-status")).toHaveText("图内矛盾");
  await page.locator("#chart-upload").setInputFiles("web/public/samples/consistent.png");
  await expect(page.locator(".result-sheet")).toHaveCount(0);
  for (const failure of failures) {
    await page.getByRole("button", { name: /读取整张图片/ }).click();
    await expect(page.locator(".review-column .error-message")).toContainText(failure.message);
    await expect(page.locator(".result-sheet, .claim-result-sheet")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "重试读取整张图片" })).toBeVisible();
    if (failure.code === "MODEL_NOT_CONFIGURED") {
      await expect(page.getByRole("link", { name: "前往模型设置并测试连接" })).toHaveAttribute("href", "/settings");
    }
  }
  await page.getByRole("button", { name: "重试读取整张图片" }).click();
  await expect(page.locator(".source-badge")).toHaveText("模型读取");
  await expect(page.locator(".review-column .error-message")).toHaveCount(0);
  await expect(page.locator(".result-sheet")).toHaveCount(0);
  await page.locator("#chart-upload").setInputFiles({ name: "wrong.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(page.locator(".review-column .error-message")).toContainText("请上传 PNG、JPG 或 WebP 图片");
  await page.locator("#chart-upload").setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(page.locator(".review-column .error-message")).toContainText("图片不能超过 5 MB");
});

test("取消、换图与重试使迟到的模型响应失效", async ({ page, request }) => {
  const preset = (await (await request.post("/api/audit/sample", { data: { id: "consistent" } })).json()).observation;
  const outdated = (await (await request.post("/api/audit/sample", { data: { id: "conflict" } })).json()).observation;
  const modelObservation = { ...preset, source: "vision-model" };
  const releases: Array<() => void> = [];
  let started = 0;
  let settled = 0;
  let responseNumber = 0;
  await page.route("**/api/audit/image", async (route) => {
    const number = ++responseNumber;
    started += 1;
    if (number === 1 || number === 3) {
      await new Promise<void>((resolve) => { releases.push(resolve); });
    }
    try {
      await route.fulfill({ status: 200, json: { observation: number === 2 ? modelObservation : { ...outdated, source: "vision-model" } } });
    } catch {
      // 客户端主动取消后，浏览器可能已关闭这次请求。
    } finally {
      settled += 1;
    }
  });
  await page.goto("/audit?sample=conflict");
  await page.locator("#chart-upload").setInputFiles("web/public/samples/consistent.png");
  await page.getByRole("button", { name: "读取整张图片" }).click();
  await expect.poll(() => started).toBe(1);
  await page.getByRole("button", { name: "取消读取" }).click();
  await expect(page.locator(".review-column .error-message")).toContainText("已取消这次读取");
  await page.getByRole("button", { name: "重试读取整张图片" }).click();
  await expect(page.locator(".source-badge")).toHaveText("模型读取");
  await expect(page.locator(".observation-form .claim-field input")).toHaveValue("25");
  releases.shift()?.();
  await expect.poll(() => settled).toBe(2);
  await expect(page.locator(".source-badge")).toHaveText("模型读取");
  await expect(page.locator(".observation-form .claim-field input")).toHaveValue("25");
  await expect(page.locator(".review-column .error-message")).toHaveCount(0);

  await page.getByRole("button", { name: "读取整张图片" }).click();
  await expect.poll(() => started).toBe(3);
  if (await page.locator("#mobile-sample-select").isVisible()) {
    await page.locator("#mobile-sample-select").selectOption("conflict");
  } else {
    await page.locator(".sample-button").filter({ hasText: "增长说法对不上" }).first().click();
  }
  await expect(page.locator(".source-badge")).toHaveText("预置示例");
  releases.shift()?.();
  await expect.poll(() => settled).toBe(3);
  await expect(page.locator(".source-badge")).toHaveText("预置示例");
  await expect(page.locator(".observation-form .claim-field input")).toHaveValue("40");
});

test("重新框选使旧区域的在途结果失效", async ({ page, request }) => {
  const oldObservation = (await (await request.post("/api/audit/sample", { data: { id: "conflict" } })).json()).observation;
  const newObservation = (await (await request.post("/api/audit/sample", { data: { id: "consistent" } })).json()).observation;
  let releaseOld!: () => void;
  let started = 0;
  let settled = 0;
  await page.route("**/api/audit/image", async (route) => {
    const number = ++started;
    if (number === 1) await new Promise<void>((resolve) => { releaseOld = resolve; });
    try {
      await route.fulfill({ status: 200, json: { observation: { ...(number === 1 ? oldObservation : newObservation), source: "vision-model" } } });
    } catch {
      // 旧选区请求取消后，浏览器可关闭连接。
    } finally {
      settled += 1;
    }
  });
  await page.goto("/audit?sample=conflict");
  await page.locator("#chart-upload").setInputFiles("web/public/samples/consistent.png");
  const drawCrop = async (left: number) => {
    const bounds = await page.locator(".crop-overlay").boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    await page.mouse.move(bounds.x + bounds.width * left, bounds.y + bounds.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * (left + 0.25), bounds.y + bounds.height * 0.65);
    await page.mouse.up();
    await expect(page.locator(".pending-crop-preview")).toBeVisible();
  };
  await page.getByRole("button", { name: "框选证据区域" }).click();
  await drawCrop(0.15);
  await page.getByRole("button", { name: "读取选中区域" }).click();
  await expect.poll(() => started).toBe(1);
  await page.getByRole("button", { name: "重新框选" }).click();
  await drawCrop(0.55);
  releaseOld();
  await expect.poll(() => settled).toBe(1);
  await expect(page.locator(".source-badge")).toHaveCount(0);
  await page.getByRole("button", { name: "读取选中区域" }).click();
  await expect(page.locator(".observation-form .claim-field input")).toHaveValue("25");
});

test("更换对照样例失败时清除旧配对结论", async ({ page }) => {
  await page.route("**/api/audit/sample", async (route) => {
    if (route.request().postDataJSON()?.id === "cross-b-consistent") {
      await route.fulfill({ status: 503, json: { error: { message: "对照样例暂时无法载入" } } });
    } else {
      await route.continue();
    }
  });
  await page.goto("/audit?sample=cross-a-revenue");
  // 主图载入完成后再动跨图区：载入结束会重置跨图会话，并把在途的对照图请求一并取消，
  // 抢在载入途中选对照图会静默失效（CI 机器较慢时稳定复现，见阶段五任务 08）。
  await expect(page.locator(".observation-form .title-field textarea")).toHaveValue("年营业收入增长 25%");
  const cross = page.locator(".cross-section");
  await cross.locator("select").first().selectOption("cross-b-conflict");
  await cross.locator(".cross-side-note .cross-confirm-button").click();
  await page.locator(".observation-form .confirm-button").click();
  await expect(cross.locator(".cross-result")).toBeVisible();
  await cross.locator(".cross-swap select").selectOption("cross-b-consistent");
  await expect(cross.locator(".cross-result")).toHaveCount(0);
  await expect(cross.locator(".cross-body")).toHaveCount(0);
  await expect(cross.locator(".error-message")).toContainText("对照图样例无法载入");
});

test("对照图读取失败在空状态可见并能重试", async ({ page, request }) => {
  const preset = (await (await request.post("/api/audit/sample", { data: { id: "cross-b-consistent" } })).json()).observation;
  let attempts = 0;
  await page.route("**/api/audit/image", async (route) => {
    attempts += 1;
    await route.fulfill(attempts === 1
      ? { status: 503, json: { error: { code: "MODEL_NOT_CONFIGURED", message: "实时视觉读取尚未配置。" } } }
      : { status: 200, json: { observation: { ...preset, source: "vision-model" } } });
  });
  await page.goto("/audit?sample=cross-a-revenue");
  await expect(page.locator(".observation-form .title-field textarea")).toHaveValue("年营业收入增长 25%");
  await page.locator(".cross-empty input[type=file]").setInputFiles("web/public/samples/cross-b-consistent.png");
  await page.getByRole("button", { name: "读取这张对照图" }).click();
  await expect(page.locator(".cross-section .error-message")).toContainText("实时视觉读取尚未配置");
  await expect(page.locator(".cross-section .error-message a")).toHaveAttribute("href", "/settings");
  await expect(page.locator(".cross-result")).toHaveCount(0);
  await page.getByRole("button", { name: "重试读取这张对照图" }).click();
  await expect(page.locator(".cross-body")).toBeVisible();
  await expect(page.locator(".cross-section .error-message")).toHaveCount(0);
});

// 阶段五任务 08：主图载入完成会重置跨图会话并中止在途的对照图请求（见 docs/adr/0001）。
// 新语义是「载入在途时跨图区禁用并说明原因」，而不是让选择静默失效。
test("主图载入期间跨图区禁用并说明原因，载入完成后恢复", async ({ page }) => {
  await page.goto("/audit?sample=cross-a-revenue");
  const cross = page.locator(".cross-section");
  await expect(page.locator(".observation-form .title-field textarea")).toHaveValue("年营业收入增长 25%");
  await expect(cross.locator(".cross-lock-note")).toHaveCount(0);

  // 先备好一张待读取的对照图，锁定期才能看到「读取这张对照图」也被禁用。
  await cross.locator(".cross-empty input[type=file]").setInputFiles("web/public/samples/cross-b-consistent.png");
  const readButton = cross.locator(".cross-read-action button");
  await expect(readButton).toBeEnabled();

  // 换一张主图并按住这次载入：载入在途期间跨图区不能开始配对。
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/audit/sample", async (route) => {
    if (route.request().postDataJSON()?.id !== "cross-b-consistent") {
      await route.continue();
      return;
    }
    markStarted();
    await held;
    await route.continue();
  });

  const reload = selectMainSample(page, "cross-b-consistent");
  await started;
  const picker = cross.locator(".cross-empty .cross-picker select");
  await expect(cross.locator(".cross-lock-note")).toContainText("主图还在载入");
  await expect(picker).toBeDisabled();
  await expect(cross.locator(".cross-empty input[type=file]")).toBeDisabled();
  await expect(readButton).toBeDisabled();

  release();
  await reload;
  await expect(cross.locator(".cross-lock-note")).toHaveCount(0);
  await expect(picker).toBeEnabled();
  await expect(cross.locator(".cross-empty input[type=file]")).toBeEnabled();
  // 载入成功会按既有语义重置跨图会话，之前选的待读文件一并清掉；重新选一张即可读。
  await cross.locator(".cross-empty input[type=file]").setInputFiles("web/public/samples/cross-b-consistent.png");
  await expect(readButton).toBeEnabled();
  // 载入完成后选择照常生效：载入期间只是「不可用」，不是「选了也白选」。
  await picker.selectOption("cross-b-conflict");
  await expect(cross.locator(".cross-body")).toBeVisible();
});

test("主图载入失败后跨图区恢复可用且不残留半配对", async ({ page }) => {
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  let releaseFirst!: () => void;
  const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });
  // 前两次主图载入（请求的样例 + 清单兜底的那一张）都失败，之后放行。
  let failuresLeft = 2;
  let seen = 0;
  await page.route("**/api/audit/sample", async (route) => {
    if (failuresLeft <= 0) {
      await route.continue();
      return;
    }
    failuresLeft -= 1;
    seen += 1;
    if (seen === 1) {
      markFirstStarted();
      await firstHeld;
    }
    await route.fulfill({ status: 503, json: { error: { message: "样例载入失败（测试注入）" } } });
  });

  const navigation = page.goto("/audit?sample=cross-a-revenue");
  await firstStarted;
  const cross = page.locator(".cross-section");
  const picker = cross.locator(".cross-empty .cross-picker select");
  await expect(cross.locator(".cross-lock-note")).toContainText("主图还在载入");
  await expect(picker).toBeDisabled();

  releaseFirst();
  await expect(page.locator(".review-column .error-message")).toContainText("样例载入失败（测试注入）");
  // 载入失败后立刻解锁：既不残留「载入中」，也没有半配对状态。
  await expect(cross.locator(".cross-lock-note")).toHaveCount(0);
  await expect(picker).toBeEnabled();
  await expect(cross.locator(".cross-body")).toHaveCount(0);
  await expect(cross.locator(".cross-reference-label")).toHaveCount(0);
  await expect(cross.locator(".cross-element")).toHaveCount(0);

  // 失败之后选择器照常可用：对照图能载入，但没有主图主张时不会拼出半张比较表。
  await picker.selectOption("cross-b-conflict");
  await expect(cross.locator(".cross-body")).toBeVisible();
  await expect(cross.locator(".cross-reference-label")).toContainText("跨图对照：说法对不上");
  await expect(cross.locator(".cross-element")).toHaveCount(0);
  await navigation;
});

test("主图重新载入期间跨图区已配对的操作一并禁用", async ({ page }) => {
  await page.goto("/audit?sample=cross-a-revenue");
  const cross = page.locator(".cross-section");
  await expect(page.locator(".observation-form .title-field textarea")).toHaveValue("年营业收入增长 25%");
  await cross.locator(".cross-empty .cross-picker select").selectOption("conflict");
  await expect(cross.locator(".cross-element")).toHaveCount(4);
  const missingElement = cross.locator(".cross-element").nth(3);
  await expect(missingElement.locator(".cross-element-state")).toHaveText("图上没读到");
  const confirmElementButton = missingElement.locator(".cross-confirm-button");
  const confirmReferenceButton = cross.locator(".cross-side-note .cross-confirm-button");
  await expect(confirmElementButton).toHaveCount(1);

  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/audit/sample", async (route) => {
    if (route.request().postDataJSON()?.id !== "cross-b-consistent") {
      await route.continue();
      return;
    }
    markStarted();
    await held;
    await route.continue();
  });

  const reload = selectMainSample(page, "cross-b-consistent");
  await started;
  await expect(cross.locator(".cross-lock-note")).toContainText("主图还在载入");
  // 会改变配对的操作全部禁用：换图、两侧主张选择、逐要素「确认一致」、确认对照图读数。
  await expect(cross.locator(".cross-swap select")).toBeDisabled();
  await expect(cross.locator(".cross-body .cross-picker-row select").first()).toBeDisabled();
  await expect(cross.locator(".cross-body .cross-picker-row select").nth(1)).toBeDisabled();
  await expect(confirmElementButton).toBeDisabled();
  await expect(confirmReferenceButton).toBeDisabled();
  // 「移除对照图」刻意保持可用：它的效果不会被载入完成时的重置静默撤销（见 ADR）。
  await expect(cross.locator(".cross-remove")).toBeEnabled();

  release();
  await reload;
  // 载入成功后跨图会话按既有语义重置，不残留半配对。
  await expect(cross.locator(".cross-empty")).toHaveCount(1);
  await expect(cross.locator(".cross-lock-note")).toHaveCount(0);
  await expect(cross.locator(".cross-element")).toHaveCount(0);
});

test("样例清单迟到时不覆盖刚选择的上传图", async ({ page }) => {
  let releaseSamples!: () => void;
  let started = false;
  await page.route("**/api/samples", async (route) => {
    started = true;
    await new Promise<void>((resolve) => { releaseSamples = resolve; });
    await route.continue();
  });
  await page.goto("/audit");
  await expect.poll(() => started).toBe(true);
  await page.locator("#chart-upload").setInputFiles("web/public/samples/consistent.png");
  releaseSamples();
  await expect(page.locator(".image-stage img").first()).toHaveAttribute("alt", /上传图片预览/);
  await expect(page.locator(".source-badge")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "读取整张图片" })).toBeVisible();
});

test("逐条核对、更正、重算，查看审计记录并重置", async ({ page }) => {
  await page.goto("/audit?sample=multi-claims");

  const cards = page.locator(".claim-observation-card");
  await expect(cards).toHaveCount(3);

  // 逐条查看主张、状态与图内证据
  await expect(cards.nth(0)).toContainText("营业收入增长 25%");
  await expect(cards.nth(0).locator("summary .confirmation-state")).toHaveText("待核对");
  await cards.nth(1).locator("summary").click();
  await cards.nth(2).locator("summary").click();
  await expect(cards.nth(1)).toContainText("图上原始读数：2024 年 · 50 万元");
  await expect(cards.nth(1)).toContainText("2025 年利润 100 万元");
  await expect(cards.nth(2)).toContainText("图上原始读数：2025 年 · 缺少图内依据");
  await expect(cards.nth(2)).toContainText("缺少图中文字依据");

  // 每个观察点标明读数来源：未更正时是预置示例值，缺失证据标为图上不可读
  const points = (cardIndex: number, pointIndex: number) =>
    cards.nth(cardIndex).locator(".claim-observation-point").nth(pointIndex);
  await expect(points(0, 0).locator(".value-source")).toHaveText("预置示例值");
  await expect(points(0, 1).locator(".value-source")).toHaveText("预置示例值");
  await expect(points(1, 1).locator(".value-source")).toHaveText("预置示例值");
  await expect(points(2, 1).locator(".value-source")).toHaveText("图上暂不可读");

  // 确认收入主张：图内一致
  await cards.nth(0).getByRole("button", { name: "确认并计算此主张" }).click();
  await expect(cards.nth(0).locator(".claim-result-sheet .result-status")).toHaveText("图内一致");
  await expect(cards.nth(0).locator("summary .confirmation-state")).toHaveText("输入已确认");
  await expect(points(0, 0).locator(".value-source")).toHaveText("预置示例值");

  // 更正利润主张的 2025 年读数：来源变为用户手动更正，原始读数标出已更正，图内矛盾
  await points(1, 1).getByLabel("核对数值").fill("100");
  await expect(points(1, 1).locator(".value-source")).toHaveText("用户手动更正");
  await expect(points(1, 0).locator(".value-source")).toHaveText("预置示例值");
  await expect(points(1, 1).locator(".claim-raw-observation")).toContainText("（已更正）");
  await expect(points(1, 0).locator(".claim-raw-observation")).not.toContainText("（已更正）");
  await cards.nth(1).getByRole("button", { name: "确认并计算此主张" }).click();
  await expect(cards.nth(1).locator(".claim-result-sheet .result-status")).toHaveText("图内矛盾");
  await expect(cards.nth(1).locator(".claim-result-sheet")).toContainText("新数值由用户手动更正");
  await expect(cards.nth(1)).toContainText("图上原始读数：2025 年 · 70 万元");

  // 更正利润主张不改变收入主张
  await expect(cards.nth(0).locator(".claim-result-sheet .result-status")).toHaveText("图内一致");

  // 缺图内依据的用户数主张：补入数字后仍为需要确认
  await cards.nth(2).locator(".claim-observation-point").nth(1).getByLabel("核对数值").fill("60");
  await cards.nth(2).getByRole("button", { name: "确认并计算此主张" }).click();
  await expect(cards.nth(2).locator(".claim-result-sheet .result-status")).toHaveText("需要确认");
  await expect(cards.nth(2).locator(".claim-result-sheet")).toContainText("新数值缺少可复查的图内文字依据");

  // 审计记录：归属正确、顺序正确、含变化值
  await expect(page.getByText("记录只保留在本次会话；刷新、切换图片或重置后清空。")).toBeVisible();
  await cards.nth(1).locator(".claim-audit-log summary").click();
  await expect(cards.nth(1).locator(".claim-audit-log")).toContainText("更正读数");
  await expect(cards.nth(1).locator(".claim-audit-log")).toContainText("较新数值 70 → 100");
  await expect(cards.nth(1).locator(".claim-audit-log li").last()).toContainText("图内矛盾");
  await cards.nth(0).locator(".claim-audit-log summary").click();
  await expect(cards.nth(0).locator(".claim-audit-log")).toContainText("图内一致");
  await expect(cards.nth(0).locator(".claim-audit-log")).not.toContainText("更正读数");

  // 标签与「已更正」标记同一判据：只改时间也算更正，改回原值两者一起回到预置示例值
  await points(1, 0).getByLabel("核对时间").fill("2023 年");
  await expect(points(1, 0).locator(".value-source")).toHaveText("用户手动更正");
  await expect(points(1, 0).locator(".claim-raw-observation")).toContainText("（已更正）");
  await points(1, 0).getByLabel("核对时间").fill("2024 年");
  await points(1, 1).getByLabel("核对数值").fill("70");
  await expect(points(1, 0).locator(".value-source")).toHaveText("预置示例值");
  await expect(points(1, 1).locator(".value-source")).toHaveText("预置示例值");
  await expect(points(1, 1).locator(".claim-raw-observation")).not.toContainText("（已更正）");

  // 窄屏可读、可点、无横向溢出，且确认按钮不被提示文字压住（阶段二修复过的缺陷）
  const layout = await page.evaluate(() => {
    const confirm = document.querySelector(".claim-observation-body .confirm-button");
    const hint = document.querySelector(".claim-observation-body .confirm-hint");
    const reset = document.querySelector(".reset-audit-button");
    const inputs = [...document.querySelectorAll(".claim-workspace-point-fields input")];
    let buttonHintOverlap = 0;
    if (confirm && hint) {
      const buttonBox = confirm.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(hint);
      const textBox = range.getBoundingClientRect();
      buttonHintOverlap = Math.round(Math.max(
        0,
        Math.min(buttonBox.bottom, textBox.bottom) - Math.max(buttonBox.top, textBox.top),
      ));
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      confirmHeight: confirm ? Math.round(confirm.getBoundingClientRect().height) : 0,
      resetHeight: reset ? Math.round(reset.getBoundingClientRect().height) : 0,
      narrowestInput: Math.round(Math.min(...inputs.map((input) => input.getBoundingClientRect().width))),
      buttonHintOverlap,
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.confirmHeight).toBeGreaterThanOrEqual(40);
  expect(layout.resetHeight).toBeGreaterThanOrEqual(40);
  expect(layout.narrowestInput).toBeGreaterThanOrEqual(56);
  expect(layout.buttonHintOverlap).toBe(0);

  // 重置：恢复最初载入的观察值并清空记录
  await page.getByRole("button", { name: "重置本次审计" }).click();
  await expect(page.getByText("已重置本次会话：读数回到最初载入的值，确认状态、结果和审计记录已清空。")).toBeVisible();
  await expect(page.locator(".claim-audit-log")).toHaveCount(0);
  await expect(page.locator(".claim-result-sheet")).toHaveCount(0);
  await expect(cards.nth(0).locator("summary .confirmation-state")).toHaveText("待核对");
  await expect(cards.nth(1).locator(".claim-observation-point").nth(1).getByLabel("核对数值")).toHaveValue("70");
  await expect(cards.nth(1)).toContainText("2025 年利润 100 万元");
  await expect(points(0, 0).locator(".value-source")).toHaveText("预置示例值");
  await expect(points(1, 1).locator(".value-source")).toHaveText("预置示例值");
  await expect(page.getByRole("button", { name: "重置本次审计" })).toBeDisabled();

  // 重置后仍可从零核对
  await cards.nth(0).getByRole("button", { name: "确认并计算此主张" }).click();
  await expect(cards.nth(0).locator(".claim-result-sheet .result-status")).toHaveText("图内一致");
});

test("阶段一单主张路径仍可核对，操作区不重叠", async ({ page }) => {
  await page.goto("/audit?sample=conflict");

  const form = page.locator(".observation-form");
  await expect(form.locator(".title-field textarea")).toHaveValue("年营业收入增长 40%");
  await expect(form.locator(".claim-field input")).toHaveValue("40");
  await expect(form.locator(".point-editor").nth(0).getByLabel("数值 · 可核对")).toHaveValue("80");
  await expect(form.locator(".point-editor").nth(1).getByLabel("数值 · 可核对")).toHaveValue("100");

  await form.getByRole("button", { name: "确认读数并计算" }).click();
  await expect(page.locator(".result-sheet .result-status")).toHaveText("图内矛盾");
  await expect(page.locator(".result-sheet .formula-line")).toContainText("(100 - 80) / 80 × 100 = 25%");

  // 单主张路径同样提供会话记录与重置
  const record = page.locator(".claim-audit-log");
  await record.locator("summary").click();
  await expect(record).toContainText("确认并计算");
  await expect(record).toContainText("图内矛盾");

  // 重新输入同一个值不算更正：不记事件，也不清掉已有结论
  await form.locator(".point-editor").nth(0).getByLabel("数值 · 可核对").fill("80");
  await expect(page.locator(".result-sheet .result-status")).toHaveText("图内矛盾");

  await form.locator(".point-editor").nth(0).getByLabel("数值 · 可核对").fill("90");
  await expect(record).toContainText("较早数值 80 → 90");
  await expect(page.locator(".result-sheet")).toHaveCount(0);

  await page.getByRole("button", { name: "重置本次审计" }).click();
  await expect(page.getByText("已重置本次会话：读数回到最初载入的值，确认状态、结果和审计记录已清空。")).toBeVisible();
  await expect(form.locator(".title-field textarea")).toHaveValue("年营业收入增长 40%");
  await expect(form.locator(".point-editor").nth(0).getByLabel("数值 · 可核对")).toHaveValue("80");
  await expect(form.locator(".point-editor").nth(1).getByLabel("数值 · 可核对")).toHaveValue("100");
  await expect(record).toHaveCount(0);
  await expect(page.locator(".result-sheet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重置本次审计" })).toBeDisabled();

  // 重置后仍可重新核对，结论回到最初
  await form.getByRole("button", { name: "确认读数并计算" }).click();
  await expect(page.locator(".result-sheet .result-status")).toHaveText("图内矛盾");
  await expect(page.locator(".result-sheet .formula-line")).toContainText("(100 - 80) / 80 × 100 = 25%");

  const layout = await page.evaluate(() => {
    const button = document.querySelector(".observation-form .confirm-button");
    const hint = document.querySelector(".observation-form .confirm-hint");
    const evidence = document.querySelector(".observation-form .evidence-field");
    const buttonBox = button?.getBoundingClientRect();
    const range = document.createRange();
    if (hint) range.selectNodeContents(hint);
    const textBox = hint ? range.getBoundingClientRect() : null;
    const overlap = (a?: DOMRect, b?: DOMRect) => (a && b
      ? Math.round(Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) * Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)))
      : 0);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      buttonHeight: buttonBox ? Math.round(buttonBox.height) : 0,
      buttonHintOverlap: overlap(buttonBox ?? undefined, textBox ?? undefined),
      buttonFieldOverlap: overlap(buttonBox ?? undefined, evidence?.getBoundingClientRect()),
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.buttonHeight).toBeGreaterThanOrEqual(40);
  expect(layout.buttonHintOverlap).toBe(0);
  expect(layout.buttonFieldOverlap).toBe(0);
});

test("跨图口径确认与纵轴对照在窄屏可完成", async ({ page }) => {
  await page.goto("/audit?sample=cross-a-revenue");
  await expect(page.locator(".observation-form .title-field textarea")).toHaveValue("年营业收入增长 25%");

  // 放入对照图：口径四要素逐项显示
  const cross = page.locator(".cross-section");
  await cross.locator("select").first().selectOption("cross-b-conflict");
  const elements = cross.locator(".cross-element");
  await expect(elements).toHaveCount(4);
  await expect(elements.nth(0)).toContainText("营业收入");
  await expect(elements.nth(3)).toContainText("全国门店");
  await expect(cross.locator(".cross-gate")).toContainText("两侧读数都确认后");

  // 确认对照图读数后才允许比较
  await cross.locator(".cross-side-note .cross-confirm-button").click();
  await expect(cross.locator(".cross-side-note")).toContainText("对照图读数已确认");
  await page.locator(".observation-form .confirm-button").click();

  const crossResult = page.locator(".cross-result");
  await expect(crossResult.locator(".result-status")).toHaveText("数值冲突");
  await expect(crossResult.locator(".result-title")).toContainText("相差 25 个百分点");
  await expect(crossResult.locator(".cross-evidence")).toContainText("2025 年营业收入 120 万元");
  await expect(crossResult.locator(".result-boundary")).toContainText("不代表现实数据真伪");

  // 换成范围不同的对照图：不给结论，指出差在范围
  await cross.locator(".cross-swap select").selectOption("cross-b-scope-mismatch");
  await expect(page.locator(".cross-result")).toHaveCount(0);
  await expect(cross.locator(".cross-gate")).toContainText("还差 范围／人群");

  // 读到却不一致的要素不给「确认一致」按钮：不能把范围不同抹平成一致
  await expect(cross.locator(".cross-element").nth(3)).toContainText("不一致");
  await expect(cross.locator(".cross-element").nth(3).locator(".cross-confirm-button")).toHaveCount(0);
  await expect(cross.locator(".cross-gate")).toContainText("待核对");

  // 换成图上没写范围的对照图：用户可对「图上没读到」的要素确认一致
  await cross.locator(".cross-swap select").selectOption("conflict");
  await expect(cross.locator(".cross-element").nth(3)).toContainText("图上没读到");
  await cross.locator(".cross-element").nth(3).locator(".cross-confirm-button").click();
  await expect(cross.locator(".cross-element").nth(3).locator(".cross-element-state")).toHaveText("你已确认一致");

  // 纵轴：截断的样例给出可能误读与两版柱形
  await page.goto("/audit?sample=axis-truncated");
  await page.locator(".observation-form .confirm-button").click();
  const axis = page.locator(".axis-section");
  await expect(axis.locator(".result-status")).toHaveText("可能误读");
  await expect(axis.locator(".axis-panel")).toHaveCount(2);
  await expect(axis.locator(".axis-panel").nth(0)).toContainText("0 / 20");
  await expect(axis.locator(".axis-panel").nth(1)).toContainText("80 / 100");
  await expect(axis.locator(".axis-panel").nth(1)).toContainText("高度比 1 : 1.25");
  await expect(axis.locator(".result-reasons")).toContainText("不能据此认定作者造假");
  await expect(axis.locator(".result-boundary")).toContainText("不是造假判断");

  // 刻度看不清：要求确认轴范围，手填起点后重新判断
  await page.goto("/audit?sample=axis-unknown-start");
  await page.locator(".observation-form .confirm-button").click();
  await expect(page.locator(".axis-section .result-status")).toHaveText("需要确认轴范围");
  await page.locator(".axis-input input").fill("80");
  await page.locator(".axis-input button").click();
  await expect(page.locator(".axis-section .result-status")).toHaveText("可能误读");
  await expect(page.locator(".axis-section .axis-panel").nth(0)).toContainText("按已知起点示意（起点 80");
  await expect(page.locator(".axis-section .axis-summary")).toContainText("轴上限未读到");

  // 手填的起点可以恢复成图上读数
  await page.locator(".axis-input button").nth(1).click();
  await expect(page.locator(".axis-section .result-status")).toHaveText("需要确认轴范围");

  // 重置审计连同跨图层一起清掉
  await page.goto("/audit?sample=cross-a-revenue");
  await expect(page.locator(".observation-form .title-field textarea")).toHaveValue("年营业收入增长 25%");
  await cross.locator("select").first().selectOption("cross-b-conflict");
  await expect(cross.locator(".cross-element")).toHaveCount(4);
  await page.locator(".observation-form .confirm-button").click();
  await page.getByRole("button", { name: "重置本次审计" }).click();
  await expect(page.locator(".cross-section .cross-empty")).toHaveCount(1);
  await expect(page.locator(".cross-element")).toHaveCount(0);

  // 窄屏可触达且无横向溢出
  const layout = await page.evaluate(() => {
    const select = document.querySelector(".cross-picker select");
    const confirm = document.querySelector(".cross-confirm-button");
    const axisInput = document.querySelector(".axis-input input");
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      selectHeight: select ? Math.round(select.getBoundingClientRect().height) : 0,
      confirmHeight: confirm ? Math.round(confirm.getBoundingClientRect().height) : 0,
      axisInputHeight: axisInput ? Math.round(axisInput.getBoundingClientRect().height) : 0,
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
});

test("多主张会话重置清除跨图状态，口径确认留下可复查记录", async ({ page }) => {
  await page.goto("/audit?sample=multi-claims");
  await expect(page.locator(".claim-observation-card")).toHaveCount(3);
  const cross = page.locator(".cross-section");
  const reset = page.getByRole("button", { name: "重置本次审计" });

  await cross.locator("select").first().selectOption("conflict");
  await expect(cross.locator(".cross-element")).toHaveCount(4);
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(cross.locator(".cross-empty")).toHaveCount(1);
  await expect(reset).toBeDisabled();

  await cross.locator("select").first().selectOption("conflict");
  const missingScope = cross.locator(".cross-element").nth(3);
  await expect(missingScope.locator(".cross-element-state")).toHaveText("图上没读到");
  await missingScope.locator(".cross-confirm-button").click();
  const history = cross.locator(".cross-history");
  await expect(history.locator("li")).toHaveCount(1);
  await expect(history).toContainText("范围／人群 · 已确认一致");
  await expect(history).toContainText("营业收入增长 25%");
  await expect(history.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth + 1),
  );

  await cross.locator(".cross-swap select").selectOption("cross-b-scope-mismatch");
  await expect(history.locator("li")).toHaveCount(1);
  await page.locator(".claim-observation-card").first().locator(".confirm-button").click();
  await expect(page.locator(".claim-observation-card").first().locator(".result-sheet")).toBeVisible();
  await expect(page.locator(".axis-section")).toHaveCount(0);

  await reset.click();
  await expect(cross.locator(".cross-empty")).toHaveCount(1);
  await expect(history).toHaveCount(0);
  await expect(page.locator(".claim-observation-card").first().locator(".confirmation-state")).toHaveText("待核对");
});

test("已确认时间进入跨图口径，已读到的轴上限决定柱高", async ({ page }) => {
  await page.goto("/audit?sample=cross-a-revenue");
  await expect(page.locator(".observation-form .title-field textarea")).toHaveValue("年营业收入增长 25%");
  const cross = page.locator(".cross-section");
  const reset = page.getByRole("button", { name: "重置本次审计" });
  await cross.locator("select").first().selectOption("cross-b-conflict");
  await expect(cross.locator(".cross-element")).toHaveCount(4);
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(cross.locator(".cross-empty")).toHaveCount(1);

  const form = page.locator(".observation-form");
  await form.locator(".point-editor").first().locator(".period-field input").fill("2023 年");
  await form.locator(".confirm-button").click();
  await expect(page.locator(".axis-section .axis-panel").first().locator(".axis-bar").nth(1))
    .toHaveAttribute("style", /height: 83%/);

  await cross.locator("select").first().selectOption("cross-b-conflict");
  await expect(cross.locator(".cross-element")).toHaveCount(4);
  await cross.locator(".cross-side-note .cross-confirm-button").click();
  await expect(cross.locator(".cross-element").nth(1).locator(".cross-element-state")).toHaveText("不一致");
  await expect(cross.locator(".cross-element").nth(1)).toContainText("2023 年");
  await expect(cross.locator(".cross-result")).toHaveCount(0);
});

test("重置会取消仍在载入的对照图", async ({ page }) => {
  await page.goto("/audit?sample=multi-claims");
  await expect(page.locator(".claim-observation-card")).toHaveCount(3);
  let markStarted: () => void = () => {};
  let releaseResponse: () => void = () => {};
  const requestStarted = new Promise<void>((resolve) => { markStarted = resolve; });
  const heldResponse = new Promise<void>((resolve) => { releaseResponse = resolve; });
  await page.route("**/api/audit/sample", async (route) => {
    if (route.request().postDataJSON()?.id !== "cross-b-conflict") {
      await route.continue();
      return;
    }
    markStarted();
    await heldResponse;
    try {
      await route.continue();
    } catch {
      // 重置已取消这个请求。
    }
  });

  const selectAction = page.locator(".cross-section select").first().selectOption("cross-b-conflict");
  await requestStarted;
  const reset = page.getByRole("button", { name: "重置本次审计" });
  await expect(reset).toBeEnabled();
  await reset.click();
  releaseResponse();
  await selectAction;
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".cross-section .cross-empty")).toHaveCount(1);
  await expect(page.locator(".cross-element")).toHaveCount(0);
});

test("口径记录区分图上原始观察与用户更正后的比对值", async ({ page }) => {
  await page.goto("/audit?sample=cross-a-revenue");
  const form = page.locator(".observation-form");
  await form.locator(".point-editor").first().locator(".period-field input").fill("2023 年");
  await form.locator(".confirm-button").click();

  await page.route("**/api/audit/sample", async (route) => {
    if (route.request().postDataJSON()?.id !== "cross-b-conflict") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = await response.json();
    payload.observation.claims[0].older.period = "2023 年";
    payload.observation.claims[0].newer.period = null;
    await route.fulfill({ response, json: payload });
  });

  const cross = page.locator(".cross-section");
  await cross.locator("select").first().selectOption("cross-b-conflict");
  const period = cross.locator(".cross-element").nth(1);
  await expect(period.locator(".cross-element-state")).toHaveText("图上没读到");
  await period.locator(".cross-confirm-button").click();

  const record = cross.locator(".cross-history li").first();
  await expect(record).toContainText("图上原始观察：2024 年 → 2025 年 / 2023 年");
  await expect(record).toContainText("确认时采用的口径：2023 年 → 2025 年 / 2023 年");
});

test("固定评测样例可按链接查看，舍入与零旧值各自给出正确状态", async ({ page }) => {
  await page.goto("/audit?sample=eval-rounding");
  await expect(page.locator(".source-badge")).toHaveText("预置示例");
  await expect(page.locator(".image-stage img").first()).toHaveAttribute("src", "/samples/eval-rounding.svg");
  await page.locator(".observation-form .confirm-button").click();
  await expect(page.locator(".result-sheet .result-status").first()).toContainText("图内一致");
  await expect(page.locator(".result-sheet .formula-line").first()).toContainText("33.33%");

  await page.goto("/audit?sample=eval-zero-base");
  await page.locator(".observation-form .confirm-button").click();
  await expect(page.locator(".result-sheet .result-status").first()).toContainText("需要确认");
  await expect(page.locator(".result-sheet .result-reasons").first()).toContainText("旧值为 0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth + 1),
  );

  await page.goto("/audit?sample=missing-example-id");
  await expect(page.locator(".image-stage img").first()).toHaveAttribute("src", "/samples/conflict.svg");
  await expect(page.locator(".source-badge")).toHaveText("预置示例");

  await page.goto("/audit?sample=eval-cross-period-mismatch");
  await expect(page.locator(".observation-form .title-field textarea")).toHaveValue("营业收入增长 50%");
  const cross = page.locator(".cross-section");
  await cross.locator("select").first().selectOption("cross-a-revenue");
  await expect(cross.locator(".cross-element").nth(1).locator(".cross-element-state")).toHaveText("不一致");
  await expect(cross.locator(".cross-gate")).toContainText("还差 时间");
  await expect(cross.locator(".cross-result")).toHaveCount(0);
});
