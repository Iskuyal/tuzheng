# 02：分享格式提供文字、图片与「文字+图片」三档

Status: completed
Blocked by: 01

规格：[spec.md](../spec.md)。本任务只做「同一份当前核验结果 → 选格式 → 拿到对应产物」这一条路径，不扩展短链、第三方上传或多语言。

## 改动的文件面

- 新增 `web/source-share-image.ts`：纯函数排版层。导出 `SHARE_IMAGE_WIDTH=1080`、`SHARE_IMAGE_PADDING=72`、`SHARE_IMAGE_MAX_HEIGHT=12000`、`shareImageFont(style)`、`layoutShareImage(summary, measure)`、`shareImageFileName(summary)`；`measure` 由调用方注入（浏览器传 `ctx.measureText`，单测传确定性替身），因此折行、缩进、悬挂标点与截断都能在 Node 里直接测。不读 DOM、不发请求。
- 新增 `web/share-image-render.ts`：浏览器侧绘制。`renderShareImage(summary)` 建 canvas、按排版结果绘制、返回 `{dataUrl,width,height,fileName}`，浏览器不支持或 `toDataURL` 抛错时返回 `null`；`copyShareImageToClipboard(dataUrl)` 走 `navigator.clipboard.write([new ClipboardItem({"image/png": blob})])`，不支持或未授权返回 `false`。
- 改 `web/components/SourceShareDialog.vue`：加「分享格式」`fieldset` + 三个 `radio`（`data-testid` 为 `share-format-text`／`share-format-image`／`share-format-both`，默认文字）、格式说明 `share-format-hint`；图片档给 `share-image-preview`（`<img>`）、`share-image-download`（`<a download>`）、`share-image-copy`、`share-image-status`、`share-image-meta`，渲染失败时给 `share-image-error`；文字档区域与复制按钮沿用任务 01 的 `share-summary-text`／`share-copy`／`share-status`。打开后焦点落在格式单选组，`showImage` 时懒渲染图片，摘要变化即丢弃旧图。
- 改 `web/pages/SourceAuditPage.vue`：结果区入口说明改为「可用文字、图片或两者一起分享；内容含结论、引用来源与使用边界。」（不再写「不带图片」）。
- 改 `web/evidence-room.css`（+17 行，追加在文件末）：`.room-share-formats`／`.room-share-format-options`／`.room-share-format`（`min-height:44px`，`input:checked` 用 `:has()` 高亮当前档）／`.room-share-format-hint`／`.room-share-image`／`.room-share-image-preview`（`max-width:100%`、`max-height:52dvh`，`.has-image` 时收到 30dvh）／`.room-share-image-meta`，并在 `@media(max-width:760px)` 里让三个档位等宽换行、预览收到 44dvh／26dvh。
- 新增 `tests/source-share-image.test.ts`（11 用例）：首行标题与完整边界声明、宽度固定且文字在内边距内（悬挂标点允许超出一字宽）、收尾标点不单独成行、指纹与说明行字号区分、长行折行不丢字、缩进保留、超长截断带提示且高度不超上限、空摘要回退、字体描述、文件名由指纹推出且稳定。
- 改 `e2e/source-share.spec.ts`：新增 3 用例 × 3 视口（图片档预览与下载、文字+图片两产物与 `clipboard.write` 类型、键盘方向键切换格式），并加 `stubImageClipboard` 替身（覆盖 `ClipboardItem` 与 `navigator.clipboard.write`）。

## 图片档的排版约定

首行 `图证 · 来源核验摘要`（衬线 48px/600）→ 边界声明原文（26px，灰 `#596174`）→ 小标题 30px/600 → 正文 27px（缩进按原文空格折算 0.6 字宽）→ `摘要指纹：` 等宽 26px 琥珀 `#79551f` → 指纹说明行 22px 灰。底色 `#f7f1e6`，顶部 10px 靛蓝条 `#2b3551`。收尾标点做悬挂处理，不出现单独的「。」行。超过 12000 高度时截断正文，并在图内补一行「（摘要过长，图片只显示到这里；完整文字请用「文字」或「文字+图片」分享。）」。

## 验收项

- [x] 弹层内有「分享格式」三档，默认文字；切换后正文区／图片区按档位显示与隐藏。
- [x] 图片档给出现场生成的长图预览与 `download` 链接，文件名形如 `图证-来源核验摘要-<8位十六进制>.png`，与摘要内容一一对应。
- [x] 「文字+图片」同时给文字区与图片区，两者各自可复制／下载，互不影响。
- [x] 剪贴板不可用时文字档提示手动复制、图片档提示改用「下载图片」，都不谎报成功。
- [x] 键盘可达：打开后焦点在格式单选组，方向键切换档位；Escape 关闭后焦点回到「分享这次核验」。
- [x] 320／390／1280 视口切换三档均无横向溢出，弹层不遮挡内容且能滚动读到说明行。
- [x] 排版纯逻辑有单测（11 条），与 canvas 绘制分离；图片档同样含边界声明与指纹。
- [x] `npm run typecheck`、`npm test`、`npm run docs:check` 与 `e2e/source-share.spec.ts` 通过；真实模型调用 0 次。

## Comments

三档都从同一份 `buildShareSummary` 文本派生，所以图片不会绕过边界声明与「尚未采用」「用户提供」的标注；这也是不做「图片单独一套文案」的原因。

留白与字号是离线截图定的（1280／390／320 各截三档），未做真机与读屏验证。图片复制依赖 `navigator.clipboard.write` 与 `ClipboardItem`，在非安全上下文或未授权时会失败并提示改用下载——这一降级路径在 e2e 里用替身覆盖，不是真实浏览器权限测试。
