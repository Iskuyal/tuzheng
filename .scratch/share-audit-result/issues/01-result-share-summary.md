# 01：从当前核验结果复制一份可核对的纯文本摘要

Status: completed
Blocked by: none

规格：[spec.md](../spec.md)。本任务只做「当前结果 → 弹层 → 复制 → Escape 回到触发按钮」这一条路径，不扩展导出格式、短链或第三方分享。

## 改动的文件面

- 新增 `web/source-share.ts`：纯文本摘要生成。导出 `SHARE_TITLE`、`SHARE_BOUNDARY`、`buildShareSummaryBody({result,caption})`、`shareSummaryFingerprint(body)`、`buildShareSummary({result,caption})`；复用 `shared/source-library.ts:71` 的 `fnv1a64`，不读 DOM、不发请求，同一输入逐字相同。
- 新增 `web/components/SourceShareDialog.vue`：原生 `<dialog class="room-share-dialog">` 加 readonly textarea、复制按钮与 `role="status"` 状态区；`previousFocus` 还焦、点 backdrop 关闭、Escape 由原生 dialog 关闭；剪贴板不可用时 `field.focus()+select()` 并提示「已选中摘要文本，请按 Ctrl+C 复制。」。
- 改 `web/pages/SourceAuditPage.vue`：结果区 `.room-result-directory` 之后新增 `.room-share-entry`（`data-testid="open-share"`「分享这次核验」）、computed `shareSummary`（随当前 result 与 caption 重算）、`openShare()`，底部挂 `<SourceShareDialog v-model:open="shareOpen" :summary="shareSummary" />`。历史结论区不加分享入口。
- 改 `web/evidence-room.css`（+24 行）：入口写作 `.room-source .source-result > .room-share-entry { order:5 }`——必须带父级，否则被 `.room-source .source-result > * { order:10 }` 盖掉；另有 `.room-share-dialog`／`.room-share-header`／`.room-share-text`／`.room-share-actions`／`.room-share-status`／`.room-share-hint`，并追加一档 `@media(max-width:760px)`。`order` 取 5 是因为 4 已归 `.source-clarification`；另补 `.room-share-header>div{min-width:0}` 与 `.room-share-header .room-button{flex:none;white-space:nowrap}` 修 320px 下「关闭」按钮折行。实际只改了这一份样式表，`web/style.css` 未动。
- 新增 `tests/source-share.test.ts`（10 用例）：摘要确定性、各节内容、边界与「尚未采用」「用户提供」标注、指纹格式与正文改一字后指纹改变。
- 新增 `e2e/source-share.spec.ts`（2 用例 × 3 视口）：路径、剪贴板降级、还焦与横向溢出断言，替身响应，不触发真实模型。

## 摘要必须包含的段落

正文 = 首行 `图证 · 来源核验摘要` → 第二行边界原文 `仅核对当前主张与适用的收录来源；未确认整张图、原始数据或制作过程的真实性。` → `配文原文：…`／`本次核验：模型 … · N 轮 · 工具调用 X / 6`／`停止原因：…` → `结论（N 条）` 逐条（状态、说明、数值对照、口径补全、用户补充、版本复查、依据、引用来源与角色、未解决）→ `待补充确认（尚未回答）` → `整体未解决项` → `未展开核验的内容` → `配文覆盖提示` → `补充回答（用户提供，不是官方来源）` → `修改建议（模型建议，尚未采用）` → 空行 + `摘要指纹：<16 位十六进制>` + 下一行 `（指纹由摘要正文计算；文字被改动后指纹即不同。）`。

指纹行**不是最后一行**，其后还有一行说明——核对摘要时不要按「末行是指纹」去找。

## 验收项

- [x] 结果区出现「分享这次核验」；点击后弹层显示只读纯文本摘要，已作废的历史结果不提供分享。
- [x] 摘要含边界声明原文、逐条结论、引用来源与角色、数值对照、未解决项、未展开主张、补证记录与停止原因。
- [x] 模型**修改建议**在摘要里只标为「尚未采用」的参考；**用户提供**的补证值标为「用户提供」，不写成官方来源。
- [x] 复制按钮把摘要全文写入剪贴板并给出成功提示；剪贴板不可用时选中摘要文本并提示按 Ctrl+C，不显示「已复制」。
- [x] Escape 关闭弹层后焦点回到触发按钮；Tab 顺序可达入口与弹层内控件。
- [x] 320／390／1280 视口无横向溢出，长摘要可滚动读完。
- [x] 摘要为纯文本确定性生成，单测覆盖各节内容与 `fnv1a64` 指纹；重复生成逐字相同。
- [x] `npm run typecheck`、`npm test`、`npm run docs:check` 与 `e2e/source-share.spec.ts` 通过；真实模型调用 0 次。

## Comments

本任务不新增后端路由：复制走浏览器剪贴板，摘要生成在前端纯函数里完成。指纹只说明文本未被改动，不证明摘要内容正确，弹层与摘要里都要写清这一点。

2026-11-10 收尾：`tests/source-share.test.ts` 10 passed、`npm test` 466 passed / 29 files、`npm run typecheck` 通过、`npm run build` 通过、`e2e/source-share.spec.ts` 6 passed（320／390／1280 各 2 条），真实模型调用 0 次。实测数字与边界见 [评审报告](../../../docs/reviews/2026-11-10-share-audit-result.md)。

