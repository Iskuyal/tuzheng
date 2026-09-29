# 阶段四任务 03 交接提示词

阶段四任务 02（证据不足分支与检索增益评测）已于 2026-09-29 完成实现在线验收，提交 `f2f0121`，验收记录见 [evidence/stage-4-source-audit-evaluation-2026-09-29.md](evidence/stage-4-source-audit-evaluation-2026-09-29.md)（逐次运行记录见同目录的 `stage-4-source-audit-eval-2026-09-29.json`）。下一个无阻塞任务是 03「拆解短配文并检查推断依据」。

复制下面整段到以 `F:\VibeCoding\web-match` 为工作目录的新会话。一次只执行任务 03；04—05 按 `Blocked by` 顺序另行启动，06 为 P1 条件增强。

```text
[$implement](C:\Users\dusta\.agents\skills\implement\SKILL.md)

请在 F:\VibeCoding\web-match 只实现阶段四任务 03：.scratch/stage-4-source-audit/issues/03-claim-reasoning.md。开始前先记录当前 HEAD 作为代码审查对照点、检查工作区，并阅读 AGENTS.md、CONTEXT.md、PLAN.md、docs/PHASES.md 的阶段四一节、.scratch/stage-4-source-audit/spec.md（尤其「后续垂直切片」里 03 那一段、「Implementation Decisions」与「Testing Decisions」第 3、5 条）、任务 02 与 03 两个 issue 文件、docs/evidence/stage-4-source-audit-evaluation-2026-09-29.md（02 的实测结果、失败分类与局限）以及 samples/source-audit-questions.json 与 samples/source-audit-expectations.json。任务 01、02 已实现并通过在线验收，03 的 Blocked by 已满足；04—05 尚未实现，本次不要顺手做。03 会改动共享的结论口径与提示词，动手前先读 PLAN.md 与 CONTEXT.md 的「来源核验（阶段四）」词条。

先简短说明你对任务的理解、关键假设、实现顺序和每一步的验收方式。这条路径要证明的是：**数字正确不等于整句成立——系统能指出「配文里的哪一部分现有证据推不出来」，并且不把缺依据自动当成假。** 不要把它做成对观点的自动判错。

## 01 与 02 已经建好的东西（直接复用，不要重写）

- `shared/source-library.ts`：固定资料库三条——`stats-cpi-2025-12`（同比 0.8%／环比 0.2%）、`stats-term-yoy-mom`（术语页，不绑月份）、`stats-cpi-2026-08`（干扰项，同比同为 0.8%、环比 0.4%）；`verifySourceLibrary()` 与内容指纹有单测。
- `shared/source-audit.ts`：`SourceClaim`（已含 `kind: "direct" | "inference"` 与 `imageExcerpt`）、`searchSourceLibrary`、`evaluateApplicability`、`claimQueryOf`／`fitsClaimAsValueBasis`／`describeInapplicableSource`、`validateCitations`（只做结构校验：是否在本次命中内、角色与资料类型是否相符）、`concludeClaimSource`／`auditClaimsAgainstSources`（三类结论：与来源一致／与来源不一致／来源待核对）、`basisMentionedInImage`、预算常量（每轮 3、单次 6、追问 1、4 轮、整体 150 秒）与 `SourceInvestigationResult`。
- `server/source-tools.ts`：四个工具声明与 zod 校验；`reportArgumentsSchema` 已限制 `claims` 最多 3 条、`kind` 目前只有 `direct`／`inference` 两个值。
- `server/source-investigation.ts`：`runSourceInvestigation(driver, { search, compare, allowSearch })` 多轮编排，`AnthropicSourceInvestigationDriver`（第 6 个参数 `{ includeSearch }`）与 `ResponsesSourceInvestigationDriver`。
- `server/source-prompt.ts`：`SOURCE_INVESTIGATION_PROMPT`、`SOURCE_NO_RETRIEVAL_NOTE`、`sourceInvestigationPrompt({ retrieval })`。
- `server/app.ts`：`/api/source-audit/library`、`/api/source-audit/sample`、`POST /api/source-audit/investigate`；`AppOptions.investigationDriverFactory` 是注入替身驱动器的接缝。
- `web/pages/SourceAuditPage.vue`（路由 `/source-audit`）：已分别渲染图内主张与配文主张、引用与命中（链接／发布日期／摘录／指纹／引用角色）、本次排除的材料及原因、被拒绝的引用、工具轨迹、未解决项与停止原因。
- 固定评测：`samples/source-audit-questions.json`（12 题输入）与 `samples/source-audit-expectations.json`（人写的独立期望、资料库指纹与预算冻结值）分开保存；入口 `npm run eval:source-audit`（会调用真实模型，独立于 `npm test`），逐次记录写进 `docs/evidence/`。
- 测试：`npm test` 207 条（其中 `tests/source-audit-evaluation.test.ts` 覆盖冻结集完整性、逐题判定、无检索臂与两臂配对）、`npm run test:e2e` 63 条 × 320／390／1280px、`npm run build` 通过。

## 本环境已实测的事实（不要重新踩）

- 在线可用的是 **Anthropic Messages 协议 + DeepSeek 官方端点**：`https://api.deepseek.com/anthropic/v1` + `deepseek-flash`。一次来源调查 3.5—6.7 秒、中位约 5.4 秒，2—4 次工具调用、2—4 轮。**Responses 协议的工具循环仍只有替身测试**，不要把它的结果写成在线通过。
- 上游请求失败是常态而非异常：03 要跑真实模型时，有检索臂约 5%、无检索臂约 16% 的请求会在约 60 秒后失败。失败运行单列、不进正确率分母，也不要用预置结果顶替。
- 模型行为漂移（02 已如实计数，03 要继续计数）：同一张图会拆成 1—3 条主张，条数在运行间跳动；有时把图上数值补一个图上没写的比较方式（已有 `imageExcerpt` 规则拦下）；**配文只写月份时有时不去图上取年份**，导致口径月份落不到 `YYYY-MM`、结论退回待核对（02 有检索臂 4 次运行因此判错）；**出现过一次把检索到的官方原句当成一条配文主张并判「与来源一致」**。后两条正是 03 要收掉的口子：主张必须能追溯到图或配文的原文，配文缺年份时应从图上补齐口径。
- 不提供检索工具时模型会真实调用 `request_clarification`（02 里 5 次，问题原文与用途已存档），有检索时 0 次——03 的「缺依据」路径可以利用这个真实行为，但不要为了打勾伪造追问。
- 02 的数字只属于 02 提交时的程序版本：12 题固定题集的三轮结果是「有检索臂 90.9%／91.7%／91.2%、无检索臂 41.4%／44.8%／33.3%」。03 改了提示词或口径判定之后，**原来的数字不能再当作当前程序的成绩**，必须整组复跑并标明版本。

## 03 要交付的内容

1. **主张分类**：区分直接陈述、可检查推断与不支持核验的观点，各自保留图文原文与出处。`SourceClaimKind` 现在只有 `direct`／`inference`，要新增「观点」一类时，记得同步 `server/source-tools.ts` 的 zod 与工具 schema 描述、页面展示和 CONTEXT.md 词条；观点不能自动判错。
2. **超过三条不静默丢弃**：`reportArgumentsSchema.claims` 现在最多 3 条，模型只会丢内容。要在提示词与程序上让「配文太长」变成明确提示（例如要求模型在 `unresolvedItems` 或专门字段说明还有哪些没拆），并测试「不能静默漏掉主张」。
3. **推断缺口**：数字正确不能推出整句成立。首批限定 CPI 同比／环比、涨幅与价格水平；逐项显示「来源支持」「来源矛盾」或「推断依据不足」，并说明缺哪一项依据才能继续。这条要能在没有适用环比来源时生效，也要在有适用来源时改判。
4. **自制案例**：「两个月同比涨幅下降 → 配文说本月比上月便宜」。需要新的团队自制图（生成器沿用 `samples/make-chart.mjs` 的画布与配色，PNG 用 `samples/render-chart-png.mjs` 渲染，页脚必须标「团队自制示意图，不是国家统计局原图」并注明图上读了什么）。**不要把它塞进 `shared/samples.ts` 的 `sampleCases`**：那会连带 `samples/fixed-evaluation.json`、`samples/image-checksums.json` 与 `tests/fixed-evaluation.test.ts` 里「18 张」的不变量一起改。走 02 的固定题集路线（新图片 + 新题 + 人写期望 + 指纹冻结）更合适。
5. **预算与隔离**：主张之间共享同一次调查的调用预算（每轮 3、单次 6、追问 1、4 轮）；达到上限时保留已核验项并明确剩余项未完成；更正或重查一条主张不能把结果套到其他主张上（沿用 API 与浏览器接缝验证）。
6. **固定评测扩展**：增加正确推断、错误推断、证据不足与观点案例，**保留 02 的 12 道原题不改**；期望仍由人先写，新增图片同样冻结指纹。改冻结集要在记录里说明改了哪几条、为什么，并整组复跑。
7. **页面**：主张卡可逐条展开，显示分类、依据、推断缺口与未解决项；图内主张与配文主张继续分开。
8. **文档与范围**：按实测更新 issue 03 勾选与状态、docs/PHASES.md 阶段四一节、README.md 能力状态与测试条数、CONTEXT.md 新词条；沿用「计划项与已实现项分开写」。

## 建议的落地顺序

先读 02 的失败分类，确定「主张归属」与「配文缺年份」两条怎么收 → 设计 `SourceClaimKind` 扩展与推断缺口的数据结构（先写测试）→ 改提示词与程序校验 → 新增自制图与题集题目（先写期望，再跑模型）→ 补齐 API／浏览器失败分支 → 真实模型整组复跑（每题重复运行、记录波动）→ 按结果缩小或更新声明。

## 收尾要求

运行 `npm test`、`npm run test:e2e`、`npm run build`，保留 `npm run eval:samples`（23/23）、`npm run verify:sample-renders`（18/18）继续通过，并用 `npm run eval:source-audit -- --runs=3 --record=docs/evidence/<新文件>.json` 整组复跑（一轮约 11 分钟）。用固定的对照点审查本次改动。只有验收项实际通过后才更新 issue 03、docs/PHASES.md 与 README.md。真实模型记录写进 docs/evidence/ 新文件，明确重复运行次数、波动、失败运行数与「哪些数字属于哪个程序版本」；预置案例、固定评测与真实模型结果分别计数。以中文提交说明提交并推送（本仓库已设置 `git config http.version HTTP/1.1`）。本仓库近几次改动用分支 + PR 落地（见已合并的 PR #1—#5），建议这次在 `stage-4-03-claim-reasoning` 分支上提交、推送后用 `gh pr create` 开 PR 并合并；owner 当轮另有指示时按 owner 的来。最后用中文报告交付内容、实测数字、未达标项、尚未验证项，以及任务 04 的阻塞状态。

动手前请先确认你理解这一片要证明什么：**不是证明配文真假，而是证明系统能把一句配文拆到「哪一部分有依据、哪一部分现有证据推不出来」，并且对推不出来的部分保持克制。**
```
