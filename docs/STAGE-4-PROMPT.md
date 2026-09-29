# 阶段四任务 04 交接提示词

阶段四任务 03（拆解短配文并检查推断依据）已于 2026-09-29 完成实现在线验收，提交 `de4da13`，验收记录见 [evidence/stage-4-source-audit-claim-reasoning-2026-09-29.md](evidence/stage-4-source-audit-claim-reasoning-2026-09-29.md)（逐次运行记录见同目录 `stage-4-source-audit-eval-2026-09-29-claims-a.json` … `-claims-e.json`）。下一个无阻塞任务是 04「补充关键信息并恢复调查」；05 依赖 04，06 为 P1 条件增强。

复制下面整段到以 `F:\VibeCoding\web-match` 为工作目录的新会话。一次只执行任务 04；05 按 `Blocked by` 顺序另行启动。

```text
[$implement](C:\Users\dusta\.agents\skills\implement\SKILL.md)

请在 F:\VibeCoding\web-match 只实现阶段四任务 04：.scratch/stage-4-source-audit/issues/04-clarify-and-resume.md。开始前先记录当前 HEAD 作为代码审查对照点、检查工作区，并阅读 AGENTS.md、CONTEXT.md、PLAN.md、docs/PHASES.md 的阶段四一节、.scratch/stage-4-source-audit/spec.md（「后续垂直切片」里 04 那一段、「Implementation Decisions」与「Testing Decisions」第 2、5 条）、任务 03 与 04 两个 issue 文件、docs/evidence/stage-4-source-audit-claim-reasoning-2026-09-29.md（03 的实测结果、真实追问案例与局限）以及 samples/source-audit-questions.json 与 samples/source-audit-expectations.json。任务 01、02、03 已实现并通过在线验收，04 的 Blocked by 已满足；05 尚未实现，本次不要顺手做。

先简短说明你对任务的理解、关键假设、实现顺序和每一步的验收方式。这条路径要证明的是：**模型能就一条具体主张提出一个会改变结论的问题，用户补充后沿同一条主张恢复调查；一旦用户改动图片、配文、月份、范围或比较方式，依赖旧输入的证据与结论立即失效、不被旧响应复活，历史结论只作为历史展示。**

## 01—03 已经建好的东西（直接复用，不要重写）

- `shared/source-audit.ts`：`SourceClaim`（`kind: direct｜inference｜opinion`、`direction: up｜down｜null`、`imageExcerpt`）、三类证据状态 + `inference-unsupported`（推断依据不足）+ `not-verifiable`（不支持核验）、`ClaimSourceConclusion`（含 `parts` 分部位结果、`origin` 原文追溯、`periodNote` 月份补全说明）、`OmittedClaim`（`source: caption｜other`）、`SourceInvestigationResult`（含 `clarification`、`omittedClaims`、`captionCoverage`、`captionCoverageNote`、`trace`、`stopReason`）、`traceClaimOrigin`／`fillClaimPeriodsFromImage`／`captionClaimCoverage`、预算常量（每轮 3、单次 6、追问 1、4 轮、整体 150 秒）。
- `server/source-tools.ts`：四个受限工具与 zod 校验；`clarifyArgumentsSchema`（`question`／`purpose`／`field: period｜scope｜metric｜basis｜value`），追问每次调查最多一次，计入预算。
- `server/source-investigation.ts`：`runSourceInvestigation(driver, { search, compare, allowSearch, caption })` 多轮编排；汇总非法时的一次重报、预算用尽与轮次上限后的强制汇总、被拒调用的轨迹都已有测试。
- `server/app.ts`：`/api/source-audit/library`、`/api/source-audit/sample`、`POST /api/source-audit/investigate`；`AppOptions.investigationDriverFactory` 是注入替身驱动器的接缝（04 加「带补充信息重查」时沿用同一接缝，不要另开一套）。
- `web/pages/SourceAuditPage.vue` 与 `web/components/SourceClaimCard.vue`：已分别渲染图内主张／配文主张、分部位依据、引用与命中、本次排除与被拒引用、工具轨迹、未解决项、「本次没有核验的内容」。**目前只展示模型的追问，没有任何回答入口**——这就是 04 要补的核心缺口。
- 固定评测：17 题（02 的 12 题 + 03 的 q13—q17），输入与期望分开冻结；入口 `npm run eval:source-audit`（会调用真实模型），支持 `--runs`／`--arms`／`--ids`／`--record`／`--strict`，运行前校验图片指纹、资料库指纹、预算常量与类别覆盖。逐次记录里已有 `periodNote`、`parts`、`origin`、`clarification`、`omittedClaims`。
- 测试：`npm test` 244 条、`npm run test:e2e` 66 条 × 320／390／1280px、`npm run build` 通过。

## 本环境已实测的事实（不要重新踩）

- **再次跑真实模型前先确认 API Key 可用。** 03 的第五轮跑到一半时提供方开始返回 `402 {"error":{"message":"Insufficient Balance"}}`，会话末尾余额耗尽、无法再跑；五轮上游失败率 25%—50%，只有最后一轮记到了确切原因（400 与 402 混合）。失败运行单列、不进分母，也不要用预置结果顶替。
- 在线可用的是 **Anthropic Messages 协议 + DeepSeek 官方端点**：`https://api.deepseek.com/anthropic/v1` + `deepseek-flash`。单次调查 3.5—7.7 秒、平均 2.8—3.4 次调用；无检索臂 0.5—0.7 次。**Responses 协议的工具循环仍只有替身测试**，不要把它的结果写成在线通过。
- `request_clarification` 的真实调用：03 五轮共 9 次，**全部在无检索臂**（q17「无环比来源的推断」3 次，另有 q03／q04／q07／q11／q12／q14 各 1 次），有检索时 0 次。这正是 04 的问题：**有检索时模型从不主动追问**，而 04 要求「资料已经覆盖的问题先检索；仍缺信息时提出一个具体问题」。追问原文与用途已存档在 03 的逐次记录里，可作为设计参考。
- 模型行为漂移（继续如实计数）：同一张图拆 1—3 条主张，条数在运行间跳动；有时把图上说明文字写进 `omittedClaims`（程序已按出处分「配文未展开／图上说明」，不计入配文覆盖）；偶发漏报配文主张；q11 出现过模型给配文主张补了图上才有的比较方式，程序分不清「配文写了」与「模型补的」。
- 术语类主张仍只能到「来源待核对／推断依据不足」，不表达「与术语页矛盾」（02 就有的边界，不在 04 范围）。

## 04 要交付的内容

1. **一个具体问题**：缺的信息确实影响结论、且资料库无法回答时，模型提一个问题并说明它影响哪条主张、哪项口径；资料已覆盖的先检索（有检索臂要能看到检索发生在追问之前）。问题要能落到 03 已有的缺口上——`inference-unsupported` 的 `unresolved` 已经写明「需要 某月 的 环比 数据才能继续」，04 要把这条缺口变成一次追问与一次恢复。
2. **回答后沿原主张恢复**：用户补充标为「用户提供」，只用于确定口径，不覆盖明确的图文内容、也不自动升级为官方证据；补证后重新调查并保留前后关联（同一主张、同一记录，能看出结论为什么变）。**恢复不清零预算**：前后共享每轮 3／单次 6／追问 1／4 轮的上限。
3. **改动即失效**：修改图片、配文、月份、范围或比较方式后，受影响主张的证据适用性、结论与页面展示立即失效并重查；取消、重置与迟到响应不得复活旧结论（沿用阶段二／阶段三已有的在途请求隔离约定）。历史结论可查看但必须明确标为历史。
4. **浏览器与 API 两条路径**：浏览器完成「追问 → 补证 → 新结果」与「现场改范围 → 旧结果失效」；API 覆盖过期恢复、预算与冲突输入（用户补充与图上／来源冲突时保留双方依据，请求更正或保持待核对）。
5. **固定评测增加补证前后对照**：保留 02 的 12 题与 03 的 5 题不改，新增「补证前 → 补证后」案例（同一题两次运行，期望分别写定），整组复跑并标明版本；预置案例、固定评测与真实模型结果分别计数。
6. **文档与范围**：按实测更新 issue 04 勾选与状态、docs/PHASES.md 阶段四一节、README.md 能力状态与测试条数、CONTEXT.md 新词条（补证、恢复、历史结论、用户提供值）；沿用「计划项与已实现项分开写」。

## 建议的落地顺序

先读 03 记录里的真实追问案例，确定「追问 → 回答 → 恢复」的数据结构与接口（先写测试：回答标为用户提供、恢复不清零预算、旧响应不写回）→ 服务端接口与编排（沿用 `investigationDriverFactory` 接缝）→ 页面补上回答入口与历史／失效标记 → 固定评测加补证前后对照题（期望先写）→ 真实模型整组复跑 → 按实测更新文档。

## 收尾要求

运行 `npm test`、`npm run test:e2e`、`npm run build`，保留 `npm run eval:samples`（23/23）、`npm run verify:sample-renders`（18/18）继续通过，并用 `npm run eval:source-audit -- --runs=3 --record=docs/evidence/<新文件>.json` 整组复跑（先确认余额充足；一轮 17 题 ×2 臂 ×3 次约 25—30 分钟）。用固定的对照点审查本次改动。只有验收项实际通过后才更新 issue 04、docs/PHASES.md 与 README.md。真实模型记录写进 docs/evidence/ 新文件，明确重复运行次数、波动、失败运行数与「哪些数字属于哪个程序版本」。以中文提交说明提交并推送（本仓库已设置 `git config http.version HTTP/1.1`），建议分支 + PR 落地。最后用中文报告交付内容、实测数字、未达标项、尚未验证项，以及任务 05 的阻塞状态。

动手前请先确认你理解这一片要证明什么：**不是让用户替模型找材料，而是让模型说清「还缺哪一项、它会影响哪条结论」，并在拿到补充后沿同一条主张把调查做完、把改动后的旧结论及时作废。**
```
