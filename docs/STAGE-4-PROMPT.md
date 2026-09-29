# 阶段四任务 02 交接提示词

阶段四任务 01（CPI 图文主张的公开来源核验闭环）已于 2026-09-29 完成实现在线验收，验收记录见 [evidence/stage-4-source-audit-2026-09-29.md](evidence/stage-4-source-audit-2026-09-29.md)。下一个无阻塞任务是 02「证据不足分支与检索增益评测」。

复制下面整段到以 `F:\VibeCoding\web-match` 为工作目录的新会话。一次只执行任务 02；03—05 按 `Blocked by` 顺序另行启动，06 为 P1 条件增强。

```text
[$implement](C:\Users\dusta\.agents\skills\implement\SKILL.md)

请在 F:\VibeCoding\web-match 只实现阶段四任务 02：.scratch/stage-4-source-audit/issues/02-evidence-boundaries-and-evaluation.md。开始前先记录当前 HEAD 作为代码审查对照点、检查工作区，并阅读 AGENTS.md、CONTEXT.md、PLAN.md、docs/PHASES.md 的阶段四一节、.scratch/stage-4-source-audit/spec.md（尤其后面「后续垂直切片」「Implementation Decisions」「Testing Decisions」第 2、3 条）、任务 01 与 02 两个 issue 文件，以及 docs/evidence/stage-4-source-audit-2026-09-29.md。任务 01 已实现并通过在线验收，02 的 Blocked by 已满足；03—05 尚未实现，本次不要顺手做。02 会按实测结果缩小能力声明，涉及产品口径，动手前先读 PLAN.md。

先简短说明你对任务的理解、关键假设、实现顺序和每一步的验收方式。

## 任务 01 已经建好的东西（直接复用，不要重写）

- `shared/source-library.ts`：固定资料库三条——`stats-cpi-2025-12`（2025-12 发布，同比 0.8%／环比 0.2%）、`stats-term-yoy-mom`（同比与环比解释页，不绑月份）、`stats-cpi-2026-08`（干扰项，同比同为 0.8%、环比 0.4%）；含原始链接、发布机构、发布日期、适用口径、逐句摘录、检索别名（`aliases`）与内容指纹，`verifySourceLibrary()` 有单测。
- `shared/source-audit.ts`：`SourceClaim`（含 `imageExcerpt`）、`searchSourceLibrary`（按指标／月份／范围真实排序，不按数值或比较方式过滤）、`evaluateApplicability`（指标＋月份＋范围全中才算 `applicableForValue`；术语页只 `applicableForTerm`）、`validateCitations`、`concludeClaimSource`／`auditClaimsAgainstSources`（三类结论：与来源一致／与来源不一致／来源待核对）、`basisMentionedInImage`（图内主张的比较方式必须能在它抄录的图上文字里看到）、预算常量（每轮 3、单次 6、追问 1、4 轮、整体 150 秒）与 `SourceInvestigationResult` 线上结构。
- `server/source-tools.ts`（四个工具声明与 zod 校验）、`server/source-investigation.ts`（编排 + Anthropic／Responses 两个驱动器）、`server/source-prompt.ts`。
- `server/app.ts` 的 `/api/source-audit/library`、`/api/source-audit/sample`、`POST /api/source-audit/investigate`；`AppOptions.investigationDriverFactory` 是注入替身驱动器的接缝。
- `web/pages/SourceAuditPage.vue`（路由 `/source-audit`）已展示图内观察、配文主张、引用与命中（链接／发布日期／摘录／指纹／引用角色）、排除原因、被拒绝的引用、工具轨迹、未解决项与停止原因。
- 测试：`tests/source-audit.test.ts` 36 条、`tests/source-investigation.test.ts` 20 条、`tests/api.test.ts` 里「CPI 图文来源核验 API」8 条；`e2e/source-audit.spec.ts` 3 用例 × 320／390／1280px。当前 `npm test` 185/185、`npm run test:e2e` 60/60、`npm run build` 通过。
- 自制样例 `web/public/samples/cpi-2025-12.{svg,png}`（生成器 `samples/make-cpi-chart.mjs`，渲染 `samples/render-chart-png.mjs`），图上只写「2025 年 12 月全国 CPI 上涨 0.8%」不写比较基准，页脚标明「团队自制示意图，不是国家统计局原图」。

## 本环境已实测的事实（不要重新踩）

- 视觉与工具调用在线可用的是 **Anthropic Messages 协议 + DeepSeek 官方端点**：`https://api.deepseek.com/anthropic/v1` + `deepseek-flash`（多模态）。连接约 0.65 秒，一次来源调查 4.3—6.5 秒、3 轮、2—4 次工具调用。
- `tool_choice: {"type":"auto"}` 在「关思考」「不带 thinking 字段」「开思考」三种变体下都返回 `stop_reason: tool_use`，模型自行选择工具；**强制** `tool_choice` 才需要 `thinking: {"type":"disabled"}`。一次回复可能返回多个 `tool_use`，所以预算必须按轮与总计双重限制。
- commandcode 网关的 `/messages` 对本账户不可用（仅 Claude 且需 Pro+），不要用它做工具调用验收；它的 Responses 路由约 30 秒/张且偶发结构不符。
- **Responses 协议的工具循环只有替身测试，从未在线验证**。要在 02 里做无检索对照，优先在 Anthropic 面完成并如实标注协议。
- 真实模型行为漂移（都要在评测里如实计数）：模型有时把图上数值补一个图上没写的「同比」（已被 `imageExcerpt` 规则拦下，结论退回待核对）；有时把同一张图拆成 1—3 条主张；约 10 次页面在线运行里有 2 次在上游请求阶段失败（约 60 秒后 HTTP 502），页面如实降级、不写回预置结果。**评测设计必须按重复运行和波动来报告，不能只跑一遍就下结论。**

## 02 要交付的内容

1. **固定问题集**：≥10 个团队自制图文问题及**独立**期望，输入与期望分开保存（建议放 `.scratch/stage-4-source-audit/evaluation/` 或 `samples/`，参照 `samples/fixed-evaluation.json` 的形态）。覆盖面必须包含：数值正确、把同比当环比（或反之）、错月份、错范围／人群、图上比较方式不明、资料库无适用来源、以及干扰来源命中。期望要由人预先写好，不能由模型生成后再回填。
2. **有检索／无检索对照**：同一模型、同一题集、同一资料版本，除检索工具可用性外其余配置一致。无检索臂要么在服务端把 `search_source_library` 从工具列表里去掉（并让模型在 `noApplicableSourceReason` 里说明），要么用等价的可复核做法——但**不得**在无检索臂里静默回落到检索结果。做法要写进文档，配置要预先锁定。
3. **逐题记录**：结论状态、引用是否支持、无来源时是否克制、工具选择与调用数、耗时、失败原因。真实模型结果与替身／预置结果**分开计数**，绝不合并。
4. **门槛**：主张状态正确率 ≥80%、虚构引用为零、无适用来源案例**全部**不下确定来源结论。未达标就如实记录并缩小能力声明，不要删除失败题，也不要调题后只报通过的那部分。
5. **分支与降级**：来源缺失、口径不合、引用无效、模型输出无效、工具失败、超时都不输出确定来源结论；至少一条**真实**路径展示请求确认（`request_clarification`）或停止。任务 01 的在线运行里模型从未主动请求确认，这个工具目前只有替身覆盖——如果真实模型仍不选它，就如实记录，不要为了打勾去伪造。
6. **本地与浏览器验证**：本地测试继续验证「引文 ID 只能来自本次命中」「来源口径必须对齐」「调用上限有效」；浏览器端验证证据与失败原因可见。不要为了评测把这些断言改松。
7. **报告口径**：事实正确性、证据可追溯性、不适用来源识别**分别**报告；允许无检索答对、检索无增益甚至退化，保留退化题；只有可复查的配对结果支持时才宣称某个维度有增益。明确写出重复运行次数与波动，单次小样本不外推准确率。
8. **范围同步**：按实测结果同步阶段四与阶段五的演示／材料范围（哪些题可以进演示、哪些只能记为局限）。

## 建议的落地顺序

先冻结题集与期望（先写期望，再跑模型）→ 加无检索臂与评测脚本（例如 `npm run eval:source-audit`，独立于 `npm test`，因为它调用真实模型）→ 补齐失败分支的本地与浏览器覆盖 → 跑固定题集（每题重复运行并记录波动）→ 按结果修改检索或缩小声明 → 复跑全组。

## 收尾要求

运行 `npm test`、`npm run test:e2e`、`npm run build`，并保留 `npm run eval:samples`、`npm run verify:sample-renders` 继续通过（阶段五已验收项不能被这次改动破坏）。用固定的对照点审查本次改动。只有验收项**实际**通过后才更新 issue 02 的勾选与状态、`docs/PHASES.md` 阶段四一节和 `README.md` 的能力状态，计划项与已实现项始终分开写。真实模型的在线记录写进 `docs/evidence/` 新文件，明确重复运行次数与波动。预置案例、固定评测和真实模型结果分别计数；不把替身或预置输出写成在线通过；团队自制图不得冒充官方原图。最后以中文提交说明在当前分支创建提交并推送（本仓库已设置 `git config http.version HTTP/1.1`）。用中文报告交付内容、实测数字、未达标项、尚未验证项，以及任务 03 的阻塞状态。

动手前请先确认你理解这条路径要证明什么：**不是证明我们抓到了现实真相，而是证明模型在有/无公开来源两种条件下的判断差异是可复核、可量化、且有边界的。**
```
