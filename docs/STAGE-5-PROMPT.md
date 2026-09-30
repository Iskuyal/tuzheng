# 阶段五后续任务交接提示词

**状态（2026-09-30 第三次更新）：** 阶段四任务 01—05 全部实现并通过在线验收（证据索引见 [PHASES.md](PHASES.md) 阶段四一节）。阶段五 01／02／03／06／07／08 已完成：07 的人为变红验证已补齐（类型错误 [run 36723291466](https://github.com/Iskuyal/web-match/actions/runs/36723291466)、断言失败 [run 36723673814](https://github.com/Iskuyal/web-match/actions/runs/36723673814)，回退后 main 绿 [run 36724007809](https://github.com/Iskuyal/web-match/actions/runs/36724007809)）；08（主图载入期间选择对照图被静默取消）已改为「载入在途时跨图区禁用并说明原因」，语义见 [ADR 0001](adr/0001-disable-cross-picker-while-main-image-loads.md)，已合并于 PR #17。**04 的仓库侧材料已完成（PR #14 冻结）并在 2026-09-30 与 08／07 的实测同步**：README 材料索引与冻结演示路径、24 页技术 PDF、演示脚本与逐条走查清单、访问检查记录、20 张替身响应截图；材料里的 e2e 条数已改为 **87/87（29 用例 ×3 视口）**，`docs/submission/` 下不再有 78/78 与「26 用例」（其余出现都在 PHASES、本文件的历史提示词与 docs/evidence 的当时记录里，属快照）。

**仍未完成的是 04 的两项人工步骤——录制 5—8 分钟视频、把仓库从私有改为评审可访问——它们同时阻塞阶段五 05；再往后是阶段四 06（`needs-info`）。** 不要动：阶段五 04／05 的验收状态（04 只加 Comments）、视频录制／仓库可见性／团队信息／赛事提交这些人工事项。

复制下面整段到以 `F:\VibeCoding\web-match` 为工作目录的新会话。

```text
[$implement](C:\Users\dusta\.agents\skills\implement\SKILL.md)

请在 F:\VibeCoding\web-match 实现阶段五任务 05（.scratch/stage-5-stability-submission/issues/05-final-acceptance-handoff.md），开工前先核对 04 的两项人工步骤是否已经完成。开始前先记录当前 HEAD 作为代码审查对照点（写这份提示词时是本次材料同步的提交；以你实际开工时的 `git rev-parse HEAD` 为准）、检查工作区，并阅读 AGENTS.md、CONTEXT.md、docs/PHASES.md 的阶段五一节（04、07、08 三段记录）、.scratch/stage-5-stability-submission/issues/04 与 05、README.md 的「提交材料索引」「当前能力状态」与「本地验证」、docs/submission/accessibility-check.md、docs/submission/demo-video-script.md、docs/submission/technical-report.html，以及 docs/evidence/ 里的阶段四证据记录。

先简短说明你对任务的理解、哪些验收项现在可做、哪些仍缺人工输入，以及每项的验收方式。这一片要证明的是：**团队有一份可复查的最终清单，能区分本地测试、真实模型复验、人工材料检查与仍未交付的能力，且清单里没有一条是「跑了但没记录」或「没做却说通过」。**

## 开工前的两个前置检查（人工步骤，助手不能代做）
1. **仓库可见性**：`gh repo view Iskuyal/web-match --json visibility` 应为 `PUBLIC`，或已为评审开通只读访问权限。
2. **演示视频**：README「提交材料索引」的演示视频一行必须已从「待补链接」改成可打开的链接，用 `curl -s -o NUL -w "%{http_code}" -L <链接>` 实测 200。
   两项都没就绪时：如实告诉用户还差什么、给出 [演示脚本](submission/demo-video-script.md) 与 [访问检查记录](submission/accessibility-check.md) 第 5 节里的具体步骤，然后只做 05 中可先行并如实记录结果的部分——**不要为了「跑完清单」把未完成项写成通过**，也不要代录视频、代改仓库可见性或代团队提交。

## 已经确认的事实（不要重新诊断）
- 阶段五 01／02／03／06／07／08 已完成并记录在 docs/PHASES.md 阶段五一节；08 的语义、禁用范围与保留边界见 docs/adr/0001-disable-cross-picker-while-main-image-loads.md。
- 04 的仓库侧材料已在 2026-09-30 与实测同步：PDF 24/30 页（`node docs/submission/build-report.mjs`）、e2e 87/87（29 用例 ×320／390／1280px）、`npm test` 332/332；同步记录见 issues/04 的 Comments。`docs/submission/` 下不应再出现 78/78 或「26 用例」（PHASES、本文件与 docs/evidence 的当时快照除外）。
- 05 被 04 的这两项人工步骤阻塞；issues/05 的 Comments 写明「另一台 Windows 环境复跑」与「赛事日期／入口核对」可以先行的部分。阶段四 06 是 `needs-info`，不要动。
- **本任务 0 次真实模型请求**：不跑 `npm run eval:source-audit`；真实模型的证据直接引用 docs/evidence/ 的既有记录并注明轮次与失败数；`npm run eval:samples` 与 `npm run verify:sample-renders` 只在本机跑。

## 任务的交付范围
1. **可先行的验收**：按 README 从零走一遍启动与固定演示路径（先按端口清进程 → `npm install` → `npm run dev` → 打开页面 → 载入五条演示题里至少一条），记录实际 Node／npm／Edge 版本、命令与结果。拿不到第二台 Windows 机器时如实写「本机复跑」，并标注这不等同于 05 第 1 条的「另一台环境」。
2. **四类证据分别列出**（本地测试／真实模型在线／人工材料检查／仍未交付）：每条给出命令或证据文件出处，不把替身响应、预置样例或历史记录写成本轮实测。
3. **材料与权限排查**：README 材料索引与仓库内链接逐一可打开；`node docs/submission/build-report.mjs --check` 的页数与 README／accessibility-check／issues/04 三处一致；`node e2e/submission-screenshots.mjs` 的 20 张截图与「替身响应渲染」图注口径一致；仓库内无密钥（只跟踪 `.env.example`），设置读取接口不回传密钥。
4. **赛事提交清单**：核对当时的赛事截止日期、入口与材料要求（accessibility-check 第 5 节记录了 2026-11-18 与四项人工动作），形成交给团队的人工提交清单；不代替团队登录或提交。
5. **状态与文档**：只有实际通过的验收项才勾选；issue 05 的 Comments 写清本轮做了什么、命令、结果、未验证项；docs/PHASES.md 阶段五一节补一条实测记录（改了什么、命令、结果、未验证项）；本文件（docs/STAGE-5-PROMPT.md）的「未完成清单」按实际结果收敛。
6. **提交**：中文提交说明，分支 + PR 落地并用 CI 验证（本仓库已设 `git config http.version HTTP/1.1`）；最后用中文报告：改了哪些章节、命令与结果、仍未交付的能力与人工步骤。

## 纪律与预算
- 0 次真实模型请求；不碰 `web/`、`server/`、`shared/` 与既有测试；材料里的数字只引用 `docs/evidence/` 与本次实测命令。
- 跑测前先按端口清进程：反复 `npm run dev` 会累积 vite／tsx 孤儿进程，残留实例会让 `/api/samples` 报 500、e2e 大面积「did not run」。
- 人工步骤（录视频、改仓库可见性、补团队信息、赛事提交）由团队完成，助手只做核对与清单，不代做、不猜测结果。
- CI 里 `verify:sample-renders` 在当前 `windows-latest` 镜像上是 `continue-on-error` 的 0/18 非阻塞信号，不要据此改工作流。
```

<details>
<summary>已执行的提示词：阶段五 08（含 07 剩余一项；已执行，PR #17 已合并）</summary>

```text
[$implement](C:\Users\dusta\.agents\skills\implement\SKILL.md)

请在 F:\VibeCoding\web-match 实现阶段五任务 08（.scratch/stage-5-stability-submission/issues/08-cross-picker-cancelled-during-load.md），并在同一会话里顺带完成阶段五 07 剩下的「人为变红」验证项（.scratch/stage-5-stability-submission/issues/07-ci-pipeline.md 最后一项）。开始前先记录当前 HEAD 作为代码审查对照点（写这份提示词时是 eaf00d2；它与 b96026d 之间只有文档与提示词的改动，产品代码状态相同——以你实际开工时的 `git rev-parse HEAD` 为准）、检查工作区，并阅读 AGENTS.md、CONTEXT.md、PLAN.md、docs/PHASES.md 的阶段三（跨图）与阶段五一节、.scratch/stage-5-stability-submission/spec.md 与同目录 issues/07、08、docs/agents/domain.md（AGENTS.md 约定架构决策记录放 docs/adr/，该目录目前还不存在，本任务要建第一条）。

先简短说明你对任务的理解、两种候选语义的取舍理由和验收方式。这一片要证明的是：**主图仍在载入时用户对对照图选择器所做的操作，要么真正生效、要么被明确拒绝并说明原因，不再出现「选了下拉框又自己弹回去、且没有任何说明」。**

## 已经确认的事实（本次不要重新诊断）
- 缺陷来源与根因已在 issue 08 里写全：CI 首次运行（PR #9）4 条跨图 e2e 失败，trace 里 `/api/audit/sample` 的对照图请求被中止（STATUS -1）；代码路径是主图 `loadSample` 成功 → `setChartObservation`（web/pages/AuditPage.vue:346）→ `resetCrossImageSession()` → `removeReference`（:971）→ `cancelReferenceRequest()`（:859），即**主图载入完成会中止仍在飞行中的对照图请求**，主图载入前的选择因此被静默丢弃。
- 本机已用 400ms 探针确定性复现：修复前 24 通过／12 失败，修复后（当时只补测试断言）66 通过／0 失败。**产品行为当时没有改动，缺陷仍在**；那 6 处「等主图载入完成」的断言在 e2e/reader-workbench.spec.ts 里（issue 08 记的是 143／163／385／456／512／625 行附近，2026-09-30 实测已在 154／176／391／457／521／627 行，按 `.observation-form .title-field textarea` 搜索即可命中），保留即可，不要回退。
- 当前基线：`npm test` 332/332、`npm run test:e2e` 78/78（26 用例 ×320／390／1280px）、`npm run build` 通过；CI（.github/workflows/ci.yml，windows-latest + Node 24）在 PR #11／#12／#13／#14 上连续绿色。
- 07 只剩一项：人为注入一处类型错误与一处断言失败，确认 CI 变红，回退后确认绿色。**已知的坑**：`npm test` 走 esbuild，只剥离类型不做检查——历史实测注入 `shared/axis-risk.ts` 的类型错误后 typecheck 退出码 2 而 `npm test` 仍全绿，所以类型错误必须由 `npm run typecheck` 拦。

## 任务的交付范围
1. **先定语义并落成仓库第一条 ADR**（`docs/adr/0001-<slug>.md`）：在「载入期间禁用对照图选择器」与「把选择排队到载入完成后再执行」之间选一条，写清备选、理由、副作用与受影响的分支（载入失败、载入被取消、排队期间改选）。issue 08 推荐前者（语义最直白、用户不会看到「选了又弹回」），但你要自己判断并说明；如果选排队，必须把三个分支的处理写进 ADR 与测试。
2. **改产品行为**：让「主图载入中」成为可见状态，选择器在载入期间不可用（或选择被明确拒绝并给出说明），载入失败／取消后状态与提示一致，不残留半配对。既有跨图路径（配对、逐项口径确认、移除对照图、重置）不受影响。
3. **测试**：新增针对新语义的用例——载入期间的选择**被明确拒绝且用户看得到说明**（不是静默取消）；载入失败后选择器可用且无半配对残留。制造确定的慢载入请在 **e2e 里用 `page.route` 延迟 `/api/audit/sample`**（不要再去改 `server/app.ts` 注入探针）。三视口（320／390／1280）都要跑。
4. **回归对照**：用同一套 400ms 延迟条件记录改动前后的通过／失败数（issue 08 记录的旧数字是 24／12 与 66／0），如果这次数字不同要说明差异来源。
5. **07 的剩余一项**：在一条临时分支上注入一处类型错误（例如给 `shared/axis-risk.ts` 加一个类型不符的导出）与一处断言失败，推送后用 `gh workflow run CI --ref <分支>`（或开草稿 PR）触发，确认 **CI 变红**并贴出 run 链接；随后删除该分支、确认工作区还原，并在 issue 07 的记录里如实写明「本次为人为注入的变红」与绿态基线。不要把这条验证分支合并或留在远端。
6. **状态与文档**：只有验收项实际通过后才更新 issue 08 的状态与勾选项（参考 docs/agents/issue-tracker.md）、issue 07 的那一项、docs/PHASES.md 阶段五一节（补一条实测记录：改了什么、命令、结果、未验证项）。README「当前能力状态」里「失败恢复与在途请求隔离」一行按实际改动补充。
7. **提交**：中文提交说明，分支 + PR 落地并用 CI 验证，网络偶发失败时重试（本仓库已设 `git config http.version HTTP/1.1`）。最后用中文报告：改动、实测数字（含 400ms 对照）、CI 变红/恢复的 run 链接、未验证项。

## 纪律与预算
- **本任务 0 次真实模型请求**：08 与 07 都不需要调用模型，不要跑 `npm run eval:source-audit`（整组一轮约 1 元、25—30 分钟），也不要因为「顺便验证」重跑评测组。
- 跑测前先按端口清进程：反复 `npm run dev` 会累积 vite／tsx 孤儿进程，残留实例会让 `/api/samples` 报 500、e2e 大面积「did not run」。
- 用固定的对照点（本次开工 HEAD）审查改动，只改与本任务相关的文件；不要动 `web/pages/SourceAuditPage.vue` 与 `server/source-*`（阶段四已验收的路径）。
- 视频录制、仓库可见性、团队信息与赛事提交是人工步骤，本次不要代做，也不要更新阶段五 04／05 的验收状态。
```

执行结果：08 已修复并合并（PR #17）——载入在途时跨图区禁用并在跨图区显示 `role="status"` 说明，载入失败／取消后恢复，语义与保留边界写在 [docs/adr/0001-disable-cross-picker-while-main-image-loads.md](adr/0001-disable-cross-picker-while-main-image-loads.md)；e2e 由 26 用例 ×3 视口增至 **29 用例 = 87 条**，`npm test` **332/332**、`eval:samples` 23/23、`verify:sample-renders` 本机 18/18。07 的人为变红验证补齐：类型错误 [run 36723291466](https://github.com/Iskuyal/web-match/actions/runs/36723291466)、断言失败 [run 36723673814](https://github.com/Iskuyal/web-match/actions/runs/36723673814)、回退后 main 绿 [run 36724007809](https://github.com/Iskuyal/web-match/actions/runs/36724007809)。材料侧的 78/78 → 87/87 同步见本次任务记录（issues/04 的 Comments）。

</details>

<details>
<summary>已执行的提示词：阶段五 04（保留备查，2026-09-30 已执行并合并于 PR #14）</summary>

```text
[$implement](C:\Users\dusta\.agents\skills\implement\SKILL.md)

请在 F:\VibeCoding\web-match 只实现阶段五任务 04：.scratch/stage-5-stability-submission/issues/04-demo-and-technical-materials.md。开始前先记录当前 HEAD 作为代码审查对照点、检查工作区，并阅读 AGENTS.md、CONTEXT.md、PLAN.md、docs/PHASES.md 的阶段五一节与阶段四一节、.scratch/stage-5-stability-submission/spec.md 与同目录 issues/04（本次任务）、05、07、08，以及阶段四证据记录 docs/evidence/stage-4-source-audit-rewrite-2026-09-30.md（05 的实测与局限）、stage-4-source-audit-clarify-resume-2026-09-29.md（04）、stage-4-source-audit-evaluation-2026-09-29.md（02）、stage-4-source-audit-claim-reasoning-2026-09-29.md（03）、docs/STAGE-1.md 与根目录「AI-WEB网页开发挑战赛文档.md」里的提交要求。任务 01、02、03、06 已完成；05 被本任务阻塞，07 只剩一项人为变红验证，08 是 needs-triage，阶段四 06 是 needs-info——这些本次都不要动。

先简短说明你对任务的理解、关键假设、材料清单和每项的验收方式。这一片要证明的是：评审能从仓库说明启动项目，用一份技术 PDF 和一段 5—8 分钟视频看懂真实完成的 AI 路径、失败恢复与证据边界；材料只写已验收的能力，真实模型结果、替身测试与预置样例分开计数，未验收的能力（阶段四 06 反证与版本复查等）明确排除在结论之外。

（其余正文见 issue 04 的 Comments 与 docs/PHASES.md 阶段五 04 验收记录）
```

执行结果：`docs/submission/` 下的技术 PDF（24/30 页）与 HTML 源、构建脚本、演示脚本、访问检查记录、20 张替身响应截图与捕获脚本、README 材料索引与冻结演示路径、PHASES 与 issue 04／05 状态更新。

</details>

## 未完成清单（按优先级）

1. **材料同步（本任务，2026-09-30 已完成，仅作对照）**：把冻结的演示与技术材料与 08 修复、07 的人为变红验证对齐——`technical-report.html` 的 78/78（26 用例）改为 87/87（29 用例）并在 7.1 补 08 的本地验证行为，PDF 重建为 24/30 页，演示脚本数字同步，issue 04 追加同步 Comments。记录见 issues/04 的 Comments。
2. **阶段五 04 的两项人工步骤**（阻塞 05，助手不代做）：录制 5—8 分钟 1080p 视频（脚本见 [submission/demo-video-script.md](submission/demo-video-script.md)）并把链接补进 README；把仓库从 `PRIVATE` 改为 Public 或为评审开通访问权限（见 [submission/accessibility-check.md](submission/accessibility-check.md) 第 1 节）。另需补齐团队成员姓名、学校／单位与联系方式。
3. **阶段五 05**：另一台 Windows 环境按 README 启动并走演示路径、四类证据分别列出、材料与权限排查、赛事提交人工清单；被上面两项人工步骤阻塞，可先行的部分见上面的提示词与 issues/05 的 Comments。
4. **阶段四 06**：`needs-info`——固定资料库内的反证与版本复查，缺经核对的同口径冲突／修订来源对。
5. **仍成立的局限（不删题、不外推）**：q14 一次未填推断方向、q16 两次汇总缺必填 `claims`、q18 追问率有漂移（05 轮 2/3）；加强表述靠固定词表（「略贵」这类不会被拦）；采用／撤回未做真实模型下的在线复验；Responses 协议工具循环只有替身测试；题型全是开发题、没有预留题；08 的载入在途锁定在上传图模型读取路径上只有替身验证。
