# 阶段四任务 05 交接提示词

**状态（2026-09-30）：已执行完毕。** 任务 05 已实现并通过在线验收，经 PR #11 合并进 main（合并提交 `e31dc58`）；验收记录见 [evidence/stage-4-source-audit-rewrite-2026-09-30.md](evidence/stage-4-source-audit-rewrite-2026-09-30.md)（逐次运行记录见同目录 `stage-4-source-audit-eval-2026-09-30-rewrite.json`）。阶段四核心（01—05）就此完成；**任务 06 仍是 `needs-info`**（缺经核对的同口径冲突／修订来源对），P1 条件增强，演示与材料不声称具备反证或版本复查能力；下一步是阶段五的材料与稳定性任务，见 [PHASES.md](PHASES.md) 的阶段五一节。下面是从任务 04 收尾时写给本次会话的原始提示词，作为存档保留。

阶段四任务 01—04 均已完成实现并通过在线验收。任务 04（补充关键信息并恢复调查）于 2026-09-29 验收，经 PR #10 合并进 main（合并提交 `eebb21b`），验收记录见 [evidence/stage-4-source-audit-clarify-resume-2026-09-29.md](evidence/stage-4-source-audit-clarify-resume-2026-09-29.md)（逐次运行记录见同目录 `stage-4-source-audit-eval-2026-09-29-clarify-resume.json`）。下一个无阻塞任务是 05「带引用的修改建议与核心路径验收」，它同时是阶段四 P0 的整体收口；阶段五的材料任务（04、05）以它为前提。06 为 P1 条件增强（`needs-info`），依赖 05 与已核实的来源对，本次不要顺手做。

**先说钱：2026-09-29 任务 04 收尾时该 DeepSeek 账户余额 1.03 元，已经贴近评测入口的 `--min-balance` 下限（默认 1 元）。** 04 的验收轮（19 题 ×2 臂 ×3 次 + 恢复段，计划 120 次请求）实耗约 0.86 元，整组一轮约 25—30 分钟。**05 要复跑一次完整整组，开跑前必须先充值**（建议至少 10 元：覆盖调试小跑、一轮整组和可能的废弃重跑）。余额不足时评测脚本会直接停，不要用 `--allow-low-balance` 硬跑；充值属于只有人能做的操作，先向 owner 说明再继续。

复制下面整段到以 `F:\VibeCoding\web-match` 为工作目录的新会话。一次只执行任务 05；06 按 `Blocked by` 另行评估。

```text
[$implement](C:\Users\dusta\.agents\skills\implement\SKILL.md)

请在 F:\VibeCoding\web-match 只实现阶段四任务 05：.scratch/stage-4-source-audit/issues/05-grounded-rewrite.md。开始前先记录当前 HEAD 作为代码审查对照点、检查工作区，并阅读 AGENTS.md、CONTEXT.md、PLAN.md、docs/PHASES.md 的阶段四一节、.scratch/stage-4-source-audit/spec.md（「后续垂直切片」里 05 那一段、「Implementation Decisions」与「Testing Decisions」第 2、3、5 条）、任务 04 与 05 两个 issue 文件、docs/evidence/stage-4-source-audit-clarify-resume-2026-09-29.md（04 的实测结果、局限与花费），以及 samples/source-audit-questions.json 与 samples/source-audit-expectations.json。任务 01—04 已实现并通过在线验收，05 的 Blocked by 已满足；06 尚未具备资料条件，本次不要动。

先简短说明你对任务的理解、关键假设、实现顺序和每一步的验收方式。这条路径要证明的是：**核验结束（含必要补证）后，用户得到一条建议配文——每一处改动都关联原句、修改内容、理由和当前有效引用；可以用适用来源中的正确数字替换原文错误值，不能引入证据未覆盖的数值、月份、范围或更强的因果表述；未解决的主张保留限定或建议删除并写明原因；建议不自动替换原配文，上游输入或引用一变，旧建议立即撤回并只作历史展示。**

## 01—04 已经建好的东西（直接复用，不要重写）

- `shared/source-audit.ts`：`SourceClaim`（`kind: direct｜inference｜opinion`、`direction`、`imageExcerpt`）、证据状态集合（含 `inference-unsupported`、`not-verifiable`）、`ClaimSourceConclusion`（`parts` 分部位结果、`origin` 原文追溯、`periodNote`）、`OmittedClaim`、`SourceInvestigationResult`（`clarification`、`omittedClaims`、`captionCoverage`、`trace`、`stopReason`）、预算常量；04 新增 `parseClarificationAnswer`／`applySupplementToClaims`／`applySupplementToConclusion`／`diffConclusions`／`resolveSupplementTarget`。
- `server/source-tools.ts`：四个受限工具（检索／比较／请求确认／汇报结论）与 zod 校验；`clarifyArgumentsSchema`（`question`／`purpose`／`field`／`claimText`）。
- `server/source-investigation.ts`：`runSourceInvestigation(driver, { search, compare, allowSearch, caption, resume })` 多轮编排；汇总非法时的一次重报、预算与轮次上限后的强制汇总、被拒调用的轨迹、补证恢复段（共享预算、工具调用配对补齐）都已实现并有测试。
- `server/source-sessions.ts` 与 `server/app.ts`：`POST /api/source-audit/investigate` 签发 `investigationId` 与图片+配文指纹；`POST /api/source-audit/resume` 失败映射（过期 410、指纹失配 409、无追问 409、缺参数 400）；会话 TTL 30 分钟、上限 16 条；`AppOptions.investigationDriverFactory` 是注入替身驱动器的接缝，沿用它，不要另开一套。
- `web/pages/SourceAuditPage.vue` 与 `web/components/SourceClaimCard.vue`：图内／配文主张、分部位依据、引用与命中、本次排除与被拒引用、工具轨迹、未解决项、追问回答入口（标「用户提供」）、补证记录与结论前后对照、「历史结论（仅作历史展示）」、请求序号令牌 + AbortController 在途隔离。
- 固定评测：**19 题**（02 的 12 题 + 03 的 5 题 + 04 的 q18/q19），输入与期望分开冻结、整体哈希守护；入口 `npm run eval:source-audit`（会调用真实模型），支持 `--runs`／`--arms`／`--ids`／`--record`／`--strict`，开跑前打印计划请求数与账户余额。
- 测试基线：`npm test` 292 条、`npm run test:e2e` 75 条 × 320／390／1280px、`npm run build` 通过。

## 预算纪律（先读这一节，再动手）

真实模型调用要花钱，余额现在只有 1.03 元。这一轮按下面的顺序花，不要跳步：

1. **默认零成本**：`npm test`、`npm run test:e2e`、`npm run build`、`npm run eval:samples`、`npm run verify:sample-renders` 都不调用真实模型。05 的实现、失败分支、撤回与失效全部先用替身驱动器与浏览器接缝验证（沿用 `AppOptions.investigationDriverFactory`），这些不需要 API Key。
2. **开跑前先充值**：余额低于 1 元时脚本直接停；充值后再跑。要碰真实模型时先跑最小档：`npm run eval:source-audit -- --ids=<新题号,…> --arms=retrieval --runs=1`（几次请求，几毛钱以内）。
3. **整组只跑一轮**：`npm run eval:source-audit -- --runs=3 --record=docs/evidence/<新文件>.json`；19（+改写增量）题 ×2 臂 ×3 次外加恢复／改写段约 25—30 分钟。**不要再跑第二、第三轮对照**；确实需要对照时，先在报告里说明理由并先估花费，再问 owner 要不要跑。04 因为中途修复缺陷与审查意见废弃了三轮，全程花掉约 3.95 元（4.98 → 1.03 元），这个代价不要重演。
4. **开跑前看脚本打印的两行**：本次计划请求数、账户余额。跑完把余额写进证据记录，便于下一位控制花费。
5. **失败先查钱**：拿到 `failureKind: upstream` 时先看失败原因里有没有 `402 Insufficient Balance`；那是余额问题，不是程序缺陷，不要据此改代码。

## 本环境已实测的事实（不要重新踩）

- **在线可用的是 Anthropic Messages 协议 + DeepSeek 官方端点**：`https://api.deepseek.com/anthropic/v1` + `deepseek-flash`（本机设置页已保存，评测前脚本会校验配置与冻结值一致）。04 实测有检索臂单次调查平均 6.8 秒、平均 3.55 次调用；无检索臂约 6.0 秒、1.0 次调用。
- **追问已打通，但率是漂移的**：04 的 q18（必要追问）有检索臂 3/3 先检索后追问、恢复段 3/3 通过且补充套用 3/3；q19（资料已覆盖）0 次追问。但 q18 无检索臂追问率只有 2/3——提示词行为有漂移，未追问的运行已如实判未通过。05 不要依赖「模型一定会追问」，要靠程序校验兜底。
- **模型行为漂移（继续如实计数）**：同一张图拆 1—3 条主张；偶发漏报配文主张；q11 出现过模型给配文主张补了图上才有的比较方式（程序分不清「配文写了」与「模型补的」）；q19 出现过 1 次输出被 `max_tokens` 截断。这些都不删题、不回填。
- **补证回答的解析只覆盖**「同比／环比、YYYY-MM、数值、范围／指标原文」这些写法；更口语化的回答会被记为无法解析且不套用（有单测覆盖）。05 生成建议时不要假设用户补证一定能解析成功。
- **Responses 协议的工具循环与恢复配对仍只有替身测试**，不要把它的结果写成在线通过。
- **术语类主张仍只能到「来源待核对／推断依据不足」**，结论词汇暂不表达「与术语页矛盾」（02 就有的边界，不在 05 范围）。

## 05 要交付的内容

1. **逐处有据的建议**：只使用当前有效主张与已采用的证据生成一条建议配文；逐处关联原句、修改内容、理由和引用。可以用适用来源中的正确数字替换原文错误值，不能引入证据未覆盖的数值、月份、范围或更强的因果表述。
2. **未解决的部分不硬写**：对未解决主张保留限定或建议删除，显示原因；无法生成有依据建议时明确说明，不能为完成输出而补造事实。
3. **采用与撤回**：建议由用户选择采用，不自动替换原配文；更改上游输入（图片／配文／补证／引用失效）后撤回旧建议并保留历史标识。
4. **核心路径贯通**：页面可走「上传图文 → 主张拆解 → 工具检索 → 推断检查 → 必要补证 → 修改建议」，并展开实际核验过程与工具轨迹。
5. **引用有效性沿三层检查**：API、页面与独立评测分别覆盖引用有效性、未解决项保留及新事实引入；模型语义正确性单列真实调用复核，不能只凭引用 ID 存在判定通过。
6. **整组复跑**：复跑增量后的完整固定题集与有无检索对照，保留失败和退化结果，达到规格功能门槛（有检索臂主张状态正确率 ≥ 80%、虚构引用为零、无适用来源不下确定来源结论）；完整行为测试、浏览器测试及构建通过。
7. **收口文档**：按实测更新 issue 05、01—05 的真实完成状态与证据索引，交付给阶段五材料任务；若 06 未验收，演示不声称具备反证或版本复查。

## 建议的落地顺序

先定「建议配文」的数据结构与判定规则（逐处 diff：原句片段、建议文本、理由、引用 ID、处理方式：改值／保留限定／建议删除；程序校验禁止引入未覆盖数字与范围），先写测试（无有效引用不得作为建议依据、未解决主张必须带限定或删除标记、上游失效后建议撤回并历史化）→ 服务端生成与校验（复用引用校验与结论状态，模型只提议、程序把关）→ 页面（建议展示、逐处理由与引用、采用操作、撤回与历史标识）→ 固定评测加改写期望题（期望先写、冻结）→ 按预算纪律做最小档真实调用 → 整组只跑一轮 → 按实测更新文档。

## 收尾要求

先零成本验证：`npm test`、`npm run test:e2e`、`npm run build`，并保留 `npm run eval:samples`（23/23）、`npm run verify:sample-renders`（18/18）继续通过。确认真实模型路径前先确认余额已充值；先跑最小档确认改写与新判定（几毛钱），最后整组只跑一轮并 `--record` 到 `docs/evidence/` 新文件，写明重复次数、波动、失败运行数、开跑与收尾余额，以及「哪些数字属于哪个程序版本」。用固定的对照点审查本次改动。只有验收项实际通过后才更新 issue 05、docs/PHASES.md（阶段四一节与「下一个无阻塞任务」）、README.md（能力状态与测试条数）；CONTEXT.md 按实际实现补词条（修改建议、建议采用／撤回、未解决主张的保留等，命名以实现为准）。以中文提交说明提交并推送（本仓库已设置 `git config http.version HTTP/1.1`，网络偶发失败时重试），建议分支 + PR 落地。最后用中文报告交付内容、实测数字、未达标项、尚未验证项、本轮花费区间，以及任务 06 与阶段五 04／05 的阻塞状态。

动手前请先确认你理解这一片要证明什么：**不是让模型把配文写得更漂亮，而是让每一处改动都能指到一条当前有效的证据；没有证据支持的部分宁可保留限定或建议删除，也不许补造事实。**
```
