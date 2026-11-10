# 来源核验结果分享：一条用户路径的实测与边界

2026-11-10。本报告记录「分享来源核验结果」这一功能的实现、实测结果与未覆盖边界。数字均为本轮真实运行结果，未做换算或估算。依据 [PLAN](../../PLAN.md)、[领域术语](../../CONTEXT.md)与[功能规格](../../.scratch/share-audit-result/spec.md)、[任务 01](../../.scratch/share-audit-result/issues/01-result-share-summary.md)。

## 本轮目标

普通读者拿到一份来源核验结果后，能把这次核对**原样**交给朋友复核：不只是截一张图，而是带走可粘贴的文本——结论逐条、引用来源与引用角色、数值对照、未解决项、停止原因和边界声明都在里面，末尾带指纹，接收者能确认自己看到的文本没有被改动。

这里延续 [PLAN](../../PLAN.md) 第 25 行「再将解释分享给朋友」的用户路径，也遵守第 82 行导出页的口径：「不把模型建议写成事实结论」。分享不是导出页的替代品，本阶段不保存文件、不做 PDF。

## 一条用户路径

已有来源核验结果 → 点结果区「分享这次核验」→ 弹层显示纯文本摘要 → 复制到剪贴板（不可用时降级为选中文本并提示 Ctrl+C）→ Escape 关闭后焦点回到触发按钮。

摘要正文的实际结构：首行「图证 · 来源核验摘要」→ 边界原文 → 配文原文／本次核验（模型 · 轮数 · 工具调用 X / 6）／停止原因 → 逐条结论（状态、说明、数值对照、口径补全、用户补充、版本复查、依据、引用来源与角色、未解决）→ 待补充确认（尚未回答）→ 整体未解决项 → 未展开核验的内容 → 配文覆盖提示 → 补充回答（用户提供，不是官方来源）→ 修改建议（模型建议，尚未采用）→ 空行 → `摘要指纹：` 加 16 位十六进制 → 一行说明「指纹由摘要正文计算；文字被改动后指纹即不同。」。

指纹行**不是最后一行**，其后还有说明行。指纹复用 `shared/source-library.ts:71` 的 `fnv1a64`，输出为 `padStart(16, "0")` 的十六进制，与既有摘录指纹同一算法、同一格式。

## 实现范围

- 新增 `web/source-share.ts`（172 行）：导出 `SHARE_TITLE`、`SHARE_BOUNDARY`、`buildShareSummaryBody({result,caption})`、`shareSummaryFingerprint(body)`、`buildShareSummary({result,caption})`。纯函数，无 DOM、无请求、无时间戳，同一输入逐字相同。工具调用上限从 `shared/source-audit.ts` 的 `TOOL_CALLS_PER_INVESTIGATION` 读，不写死 6。
- 新增 `web/components/SourceShareDialog.vue`（90 行）：原生 `<dialog class="room-share-dialog">` 加 readonly textarea、复制按钮与 `role="status"` 状态区；`previousFocus` 记录并还焦、点 backdrop 关闭、Escape 由原生 dialog 关闭；`navigator.clipboard` 缺失或写入失败时 `field.focus()+select()` 并提示「已选中摘要文本，请按 Ctrl+C 复制。」。
- 改 `web/pages/SourceAuditPage.vue`（+20 行）：结果区 `.room-result-directory` 之后新增 `.room-share-entry`（`data-testid="open-share"`）；computed `shareSummary` 随当前 result 与 caption 重算，结果被顶替或作废时摘要整段重算，不留旧摘要；页面底部挂 `<SourceShareDialog>`。历史结论区不加分享入口。
- 改 `web/evidence-room.css`（+24 行）：入口用 `.room-source .source-result > .room-share-entry { order:5 }`（这个选择器必须连同父级一起写——`.room-source .source-result > * { order:10 }` 的特异性更高，裸类名上的 `order` 会被盖掉，只剩 DOM 顺序偶然兜底），加弹层的七个类，另加一档 `@media(max-width:760px)`。`order` 取 5 是因为 4 已归 `.source-clarification`。320px 复查时发现右上「关闭」按钮被挤成两行，补了 `.room-share-header>div{min-width:0}` 与 `.room-share-header .room-button{flex:none;white-space:nowrap}`。**实际只改了这一份样式表**，`web/style.css` 未动（原计划里列了它，实现时没有需要改的内容）。
- 新增 `tests/source-share.test.ts`（10 用例）、`e2e/source-share.spec.ts`（2 用例 × 3 视口）。

## 口径红线

- 摘要必须写入边界声明原文：「仅核对当前主张与适用的收录来源；未确认整张图、原始数据或制作过程的真实性。」
- 模型**修改建议**在摘要里只标为「尚未采用」的参考——实际文案为「修改建议（模型建议，尚未采用）」，不得写成事实结论。
- 用户补充的**口径值**标为「用户提供」，不是官方来源；结论级的补充写「用户补充（用户提供，不是官方来源）」。
- 分享的是当前结果；已作废的**历史结论**不参与，也不在历史区块提供入口。
- 指纹只说明文本未被改动，不证明摘要内容正确——摘要末尾与弹层说明里都写了这一点。

## 明确不做

服务端短链、图片化海报、社交平台 SDK、上传到任何第三方；不新增后端路由。分享的文本由浏览器剪贴板承载，摘要生成在前端纯函数完成。

## 验证状态

已按下列真实运行结果完成本轮的这条用户路径验收。

| 检查 | 实测结果 |
| --- | --- |
| `npx vitest run --config config/vitest.config.ts tests/source-share.test.ts` | `Test Files 1 passed (1)` / `Tests 10 passed (10)`（7ms） |
| `npm test` | `Test Files 29 passed (29)` / `Tests 466 passed (466)`（3.96s） |
| `npm run typecheck` | 通过，三段（vue-tsc + tsc server + tsc e2e）无错误输出 |
| `npm run build` | 通过：`✓ 61 modules transformed`、`✓ built in 1.03s`；`SourceAuditPage-*.js 59.32 kB │ gzip: 19.85 kB`、`index-*.css 117.95 kB │ gzip: 21.65 kB` |
| `npx playwright test --config config/playwright.config.ts e2e/source-share.spec.ts` | 样式微调后复跑 `6 passed (12.0s)`，0 failed；`[320px]`／`[390px]`／`[1280px]` 各 2 条全绿 |
| `npx playwright test --config config/playwright.config.ts`（全量三视口） | `146 passed (1.8m)`，0 failed、0 skipped——本轮最终回归证据 |
| 三视口横向溢出 | 每个用例末尾断言 `document.documentElement.scrollWidth <= clientWidth + 1`，6 条全过 → 320／390／1280 均无横向溢出 |
| 还焦 | 用例一按 Escape 后 `open-share` 按钮 `toBeFocused()` 通过 → 焦点回到触发按钮 |
| 真实模型调用次数 | 0：e2e 用 `page.route` 覆盖 `**/api/source-audit/investigate` 返回替身，`beforeAll` 只用 `request.get("/api/source-audit/library")` 预热；单测无网络请求 |
| `npm run docs:check` | `173 份文档，842 条本地链接，0 缺失（不检查网络与锚点）。` |
| 弹层视觉复查（临时脚本，未提交） | 1280 下弹层 720×711.8、320 下 284×798.8；两档 `document.documentElement.scrollWidth === clientWidth`（1280／320），无横向溢出。320 首轮截图发现「关闭」按钮折成两行，已补样式修好并复截图确认 |

`npm test` 的 stderr 里只有 `api.test.ts` 既有的两条预期失败路径日志（来源调查请求失败／返回内容不符合要求），属既有行为，不是本轮新失败。

全量 `npx playwright test --config config/playwright.config.ts`（三个视口 project 全跑）最终一轮：**`146 passed`，0 failed，0 skipped**（1.8m）。这是本轮的最终证据。

中间过程要如实记下：早期两次全量运行分别出现过 3 条失败（`e2e/source-entry.spec.ts:84`[390px]、`e2e/evidence-room.spec.ts:28`[1280px]、`e2e/reader-workbench.spec.ts:475`[1280px]）和 1 条失败（`e2e/source-share.spec.ts` 的 `[1280px]` 用例），失败点都在 `browserContext.close: ENOENT ... .playwright-artifacts-N\traces\...-recording*.trace`／`.zip`，即**测试产物 trace 写入失败**，不是断言失败，且都发生在与 `npm run build` 并行执行时。单独复跑这些文件均全过。最终一轮串行全量运行 146 条全过，因此可以判定这些失败与本轮功能断言无关；它们的根因（并发运行时 trace 产物落盘竞争）仍未定位。

## 边界：哪些没有被本轮证据证明

- 读屏软件对弹层与只读文本域的实际朗读未被验证；本次只验证 DOM 语义（`aria-labelledby`／`aria-describedby`／`role="status"`）与键盘可达。
- 未在真机或非桌面浏览器上验证；三视口是桌面 Edge 的视口模拟。
- 键盘路径只对 **Escape** 有专门断言；Tab 焦点环与 Enter 触发入口按钮依赖原生 `<button>` 与 `showModal()` 的浏览器行为，本轮没有单独断言按键序列。
- 剪贴板行为用替身验证：系统级剪贴板权限、其他应用的粘贴结果、受管浏览器策略均未覆盖。
- 接收者拿到摘要后是否会正确理解「仅核对所引来源」这一边界，属真实读者研究，本轮不涉及。
- 摘要的指纹能发现文本被改动，但不能防止有人重新生成一份指纹自洽的假摘要；这点不由本次证据支持任何防伪声明。
- 本轮不做真实模型调用验证：结果为离线替身。摘要渲染正确不等于模型结论正确，也不等于所引来源适用。
- 「已作废的历史结果不提供分享」由代码位置（入口只放在当前结果区）与本轮代码走读支持，没有专门的 e2e 用例覆盖历史区块。
- 弹层视觉复查用的是一份手工构造的替身结果（含不匹配结论、术语引用、补证与建议），不是真实模型输出；行数远多于或远少于该替身的摘要，长文本滚动观感未被覆盖。
- 视觉复查脚本放在本地 `.cache/`，未提交进仓库，因此这次尺寸数字不可由他人用仓库内命令复现；可复现的是 e2e 里的无横向溢出断言。
