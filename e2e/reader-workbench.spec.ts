import { expect, test } from "@playwright/test";

// 只走预置示例路径，不读取模型、不需要 API Key；真实云端读取另见 docs/STAGE-1.md 的复验步骤。

test.beforeAll(async ({ request }) => {
  await expect
    .poll(async () => (await request.get("/api/samples")).status(), { timeout: 30_000 })
    .toBe(200);
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
  await expect(page.locator(".axis-section .axis-panel").nth(0)).toContainText("起点 80");

  // 手填的起点可以恢复成图上读数
  await page.locator(".axis-input button").nth(1).click();
  await expect(page.locator(".axis-section .result-status")).toHaveText("需要确认轴范围");

  // 重置审计连同跨图层一起清掉
  await page.goto("/audit?sample=cross-a-revenue");
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
