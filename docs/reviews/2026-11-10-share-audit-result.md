# 来源核验结果分享：三档格式的实测与边界

2026-11-10。本报告记录「分享来源核验结果」这一功能的实现、实测结果与未覆盖边界。数字均为本轮真实运行结果，未做换算或估算。依据 [PLAN](../../PLAN.md)、[领域术语](../../CONTEXT.md)与[功能规格](../../.scratch/share-audit-result/spec.md)、[任务 01](../../.scratch/share-audit-result/issues/01-result-share-summary.md)、[任务 02](../../.scratch/share-audit-result/issues/02-share-format-options.md)。

本轮在任务 01（纯文字分享）之上按用户要求补了三档格式：①文字 ②图片 ③文字+图片。

## 本轮目标

普通读者拿到一份来源核验结果后，能把这次核对**原样**交给朋友复核。有人习惯粘贴文字（可检索、可核对），有人习惯发一张图（在社交软件里不会散版）。两种都支持，但必须是同一份内容：边界声明、逐条结论、引用来源与引用角色、未解决项、停止原因与指纹，在文字和图片里都在。

这里延续 [PLAN](../../PLAN.md) 第 25 行「再将解释分享给朋友」的用户路径，也遵守第 82 行导出页的口径：「不把模型建议写成事实结论」。

## 一条用户路径

已有来源核验结果 → 点结果区「分享这次核验」→ 弹层里选「分享格式」（默认文字）→ 拿到对应产物：

- **文字**：只读文本域 + 「复制文字」，剪贴板不可用时选中文本并提示 Ctrl+C。
- **图片**：现场画一张 1080 宽竖版长图，「下载图片」（`download` 链接）或「复制图片」（`clipboard.write`），失败时提示改用下载。
- **文字+图片**：两者同时出现，各自可复制／下载。

→ Escape 关闭弹层，焦点回到「分享这次核验」。

摘要正文的实际结构（三档共用同一份文本）：首行「图证 · 来源核验摘要」→ 边界原文 → 配文原文／本次核验（模型 · 轮数 · 工具调用 X / 6）／停止原因 → 逐条结论（状态、说明、数值对照、口径补全、用户补充、版本复查、依据、引用来源与角色、未解决）→ 待补充确认（尚未回答）→ 整体未解决项 → 未展开核验的内容 → 配文覆盖提示 → 补充回答（用户提供，不是官方来源）→ 修改建议（模型建议，尚未采用）→ 空行 → `摘要指纹：` 加 16 位十六进制 → 一行说明「指纹由摘要正文计算；文字被改动后指纹即不同。」。指纹行**不是最后一行**。

指纹复用 `shared/source-library.ts:71` 的 `fnv1a64`，输出为 `padStart(16, "0")` 的十六进制，与既有摘录指纹同一算法、同一格式。图片文件名取同一指纹的前 8 位：`图证-来源核验摘要-<8位十六进制>.png`。

## 实现范围

- 新增 `web/source-share.ts`（173 行）：导出 `SHARE_TITLE`、`SHARE_BOUNDARY`、`buildShareSummaryBody({result,caption})`、`shareSummaryFingerprint(body)`、`buildShareSummary({result,caption})`。纯函数，无 DOM、无请求、无时间戳，同一输入逐字相同。工具调用上限从 `shared/source-audit.ts` 的 `TOOL_CALLS_PER_INVESTIGATION` 读，不写死 6。
- 新增 `web/source-share-image.ts`（240 行）：图片排版纯函数。导出 `SHARE_IMAGE_WIDTH=1080`、`SHARE_IMAGE_PADDING=72`、`SHARE_IMAGE_MAX_HEIGHT=12000`、`shareImageFont(style)`、`layoutShareImage(summary, measure)`、`shareImageFileName(summary)`。测量宽度由调用方注入，浏览器传 `ctx.measureText`，单测传确定性替身——折行、缩进、悬挂标点、截断因此都能在 Node 里测，不需要无头浏览器。
- 新增 `web/share-image-render.ts`（92 行）：只在浏览器侧绘制。`renderShareImage(summary)` 建 canvas、按排版结果绘制、返回 `{dataUrl,width,height,fileName}`，不可用或 `toDataURL` 抛错返回 `null`；`copyShareImageToClipboard(dataUrl)` 走 `navigator.clipboard.write([new ClipboardItem({"image/png": blob})])`。
- 改 `web/components/SourceShareDialog.vue`（90 → 217 行）：加「分享格式」`fieldset` 与三个单选（`share-format-text`／`share-format-image`／`share-format-both`），图片档给预览、下载、复制与尺寸说明；打开后焦点落在格式单选组，`showImage` 时才懒渲染图片，摘要变化即丢弃旧图。
- 改 `web/pages/SourceAuditPage.vue`：只改入口说明文案为「可用文字、图片或两者一起分享；内容含结论、引用来源与使用边界。」。
- 改 `web/evidence-room.css`（+17 行，追加在文件末）：`.room-share-formats`／`.room-share-format-options`／`.room-share-format`（`min-height:44px`，`:has(input:checked)` 高亮当前档）／`.room-share-image`／`.room-share-image-preview`（`max-width:100%`、`max-height:52dvh`，`.has-image` 时收到 30dvh）／`.room-share-image-meta`，并在 `@media(max-width:760px)` 里让三档等宽换行、预览收到 44dvh／26dvh。**实际只改了这一份样式表**，`web/style.css` 未动。
- 新增 `tests/source-share-image.test.ts`（11 用例）、改 `e2e/source-share.spec.ts`（2 → 5 用例 × 3 视口）。

## 图片档的排版决定

- 宽度固定 1080、内边距 72、最小高度 640；超过 12000 高度时截断正文并在图内补一行「（摘要过长，图片只显示到这里；完整文字请用「文字」或「文字+图片」分享。）」。**不把截断藏起来**：宁可写清「图不全」，也不让接收者以为看到了全部。
- 层级靠字号与颜色区分：标题衬线 48/600、边界声明 26px 灰、小标题 30/600、正文 27px、指纹等宽 26px 琥珀、指纹说明 22px 灰；底色 `#f7f1e6`（与页面同色），顶部 10px 靛蓝条 `#2b3551`。
- 折行做**悬挂标点**：收尾标点跟随上一行，避免出现只剩「。」的一行（初版就出现过，截图复查时发现并修掉）。
- 拉丁词不劈开，单引原文按原文空格的 0.6 字宽缩进保留层级。

## 口径红线

- 摘要必须写入边界声明原文：「仅核对当前主张与适用的收录来源；未确认整张图、原始数据或制作过程的真实性。」文字与图片里都在。
- 模型**修改建议**只标为「尚未采用」的参考——实际文案为「修改建议（模型建议，尚未采用）」，不得写成事实结论；图片档同样是这段文字，没有另写一套。
- 用户补充的**口径值**标为「用户提供」，不是官方来源。
- 分享的是当前结果；已作废的**历史结论**不参与，也不在历史区块提供入口。
- 指纹只说明文本未被改动，不证明摘要内容正确，也不防伪造——文字档与图片档都带说明行。

## 明确不做

服务端短链、第三方图片托管、社交平台 SDK、上传到任何第三方；不新增后端路由。图片只在浏览器内存与用户自己的磁盘／剪贴板之间流转。

## 验证状态

已按下列真实运行结果完成这两条用户路径（文字档、图片／文字+图片档）的验收。

| 检查 | 实测结果 |
| --- | --- |
| `npx vitest run --config config/vitest.config.ts tests/source-share-image.test.ts` | `Test Files 1 passed (1)` / `Tests 11 passed (11)`（46ms） |
| `npx vitest run --config config/vitest.config.ts tests/source-share.test.ts` | `Tests 10 passed (10)`，未受本轮改动影响 |
| `npm test` | `Test Files 30 passed (30)` / `Tests 477 passed (477)`（3.24s） |
| `npm run typecheck` | 通过，三段（vue-tsc + tsc server + tsc e2e）无错误输出 |
| `npm run build` | 通过：`✓ built in 1.22s`；`SourceAuditPage-*.js 66.31 kB │ gzip 22.78 kB`、`index-*.css 119.64 kB │ gzip 21.89 kB` |
| `npx playwright test --config config/playwright.config.ts e2e/source-share.spec.ts` | `15 passed (18.7s)`，0 failed；`[320px]`／`[390px]`／`[1280px]` 各 5 条全绿 |
| 三视口横向溢出 | 每个用例末尾断言 `document.documentElement.scrollWidth <= clientWidth + 1`，15 条全过 |
| 三档切换 | e2e 断言默认文字档（无图片元素）、切图片档后文字域消失且出现 `1080×N` 的 PNG、切「文字+图片」后两者并存，均通过 |
| 图片真实性 | e2e 读 `naturalWidth === 1080`、`naturalHeight > 600`、`src` 前缀 `data:image/png;base64,`，通过——不是空图或占位图 |
| 图片复制 | 替身覆盖 `ClipboardItem` 与 `clipboard.write`，断言写入类型为 `["image/png"]`，通过 |
| 键盘可达 | 打开后 `share-format-text` `toBeFocused()`；方向键切到图片、再切到「文字+图片」均 `toBeChecked()`；Escape 后 `open-share` 还焦，通过 |
| 真实模型调用次数 | 0：e2e 用 `page.route` 覆盖 `**/api/source-audit/investigate` 返回替身；单测无网络请求 |
| 分享长图产物 | 从真实页面导出 PNG：**1080 × 1824 像素、527 KB**（替身结果为 2 条结论 + 建议 + 未解决项），人工查看排版无溢出、无孤行标点 |
| 弹层视觉复查（临时脚本，未提交） | 1280 弹层 720 宽、390 弹层 354 宽、320 弹层 284 宽；三档在三视口下 `document.documentElement.scrollWidth === clientWidth`（1280／390／320），无横向溢出；预览高度 1280 下 371→219、「文字+图片」档下 320 收到 166，未把文字区挤掉 |
| `npm run docs:check` | `174 份文档，845 条本地链接，0 缺失（不检查网络与锚点）。` |
| `npx playwright test --config config/playwright.config.ts`（全量三视口） | `155 passed`、`1 skipped`、0 failed（2.0m）——本轮最终回归证据；跳过的是 `source-entry.spec.ts:129` 窄屏导航用例，属既有 `test.skip`，与本轮无关 |

`npm test` 的 stderr 里只有 `api.test.ts` 既有的两条预期失败路径日志（来源调查请求失败／返回内容不符合要求），属既有行为，不是本轮新失败。

## 边界：哪些没有被本轮证据证明

- 读屏软件对弹层、只读文本域与图片预览的实际朗读未被验证；本次只验证 DOM 语义（`aria-labelledby`／`aria-describedby`／`aria-label`／`role="status"`）与键盘可达。
- 未在真机或非桌面浏览器上验证；三视口是桌面 Edge 的视口模拟。长图在手机相册里的显示效果、社交软件对长图的压缩与截断都未测。
- 图片复制依赖 `navigator.clipboard.write` 与 `ClipboardItem`，需要安全上下文与用户授权；本轮用替身验证调用与降级文案，**不是真实浏览器权限测试**。系统级剪贴板、其他应用的粘贴结果、受管浏览器策略均未覆盖。
- 「下载图片」由 `<a download>` 触发，e2e 只断言属性（`download` 文件名、`href` 是 PNG data URL），没有验证文件真的落到磁盘。
- 图片里的指纹只证明文字未被改动，不防伪造；这一点与文字档相同，不由本次证据支持任何防伪声明。
- 本轮不做真实模型调用验证：结果为离线替身。排版正确不等于模型结论正确，也不等于所引来源适用。
- 「已作废的历史结果不提供分享」由代码位置（入口只放在当前结果区）支持，没有专门的 e2e 用例覆盖历史区块。
- 排版用一份手工构造的替身结果（2 条结论 + 建议 + 未解决项）。更长或更短的摘要在图片里的观感、以及真的触发 12000 高度截断的长摘要，都只有单测覆盖，没有截图复查。
- 视觉复查脚本放在本地 `.cache/`，未提交进仓库，因此尺寸数字不可由他人用仓库内命令直接复现；可复现的是 e2e 里的无横向溢出断言与 `naturalWidth` 断言。
