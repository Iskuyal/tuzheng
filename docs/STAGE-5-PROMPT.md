# 阶段五后续任务交接提示词

**状态（2026-10-01 第六次更新）：** 阶段四任务 01—05 全部实现并通过在线验收，**06 的「版本修订／版本替代」已于 2026-10-01 实现并完成整组实测**（整组一轮 22 题 ×2 臂 ×3 次：有检索臂 89.7%，版本复查替代生效 5 次、修正 5／误改 0；「同口径冲突 → 来源存在分歧」仍为 `needs-info`）；证据索引见 [PHASES.md](PHASES.md) 阶段四一节。阶段五 01／02／03／06／07／08 已完成：07 的人为变红验证已补齐（类型错误 [run 36723291466](https://github.com/Iskuyal/web-match/actions/runs/36723291466)、断言失败 [run 36723673814](https://github.com/Iskuyal/web-match/actions/runs/36723673814)，回退后 main 绿 [run 36724007809](https://github.com/Iskuyal/web-match/actions/runs/36724007809)）；08（主图载入期间选择对照图被静默取消）已改为「载入在途时跨图区禁用并说明原因」，语义见 [ADR 0001](adr/0001-disable-cross-picker-while-main-image-loads.md)，已合并于 PR #17。**04 的仓库侧材料已完成（PR #14 冻结）并在 2026-09-30 与 08／07 的实测同步**：README 材料索引与冻结演示路径、技术 PDF（2026-10-01 为 **25/30 页**）、演示脚本与逐条走查清单、访问检查记录、20 张替身响应截图；材料里的 e2e 条数已改为 **90/90（30 用例 ×3 视口）**、`npm test` **338/338**、固定资料库 **5 条**、题集 **22 题**，`docs/submission/` 下不再有 78/78 与「26 用例」（其余出现都在 PHASES、本文件的历史提示词与 docs/evidence 的当时记录里，属快照）。

**阶段四 06 已于 2026-10-01 完成「版本修订／版本替代」这一支**（全量调研 → 用户批准把资料库扩到「社会消费品零售总额」→ 实现 → 整组实测：有检索臂 **89.7%（61/68）**、虚构引用 0、越界 0、退化题 0，q21／q22 各 3/3，**版本复查替代生效 5 次、修正 5／误改 0**；PDF 重建为 25/30 页）；**「同口径冲突 → 来源存在分歧」仍因没有可核对材料停在 `needs-info`，不进入任何能力声明**。**另按用户要求做了预设端点核实与补齐（C7，2026-10-01）**：新增 6 条 documented 预设（Anthropic 侧 MiniMax、Fireworks；Responses 侧百炼、Moonshot、MiniMax、Nebius），修掉 OpenRouter 两条失效出处链接，把「路由存在 ≠ 能读图」和未核实项如实写明；提示词与结果见下方 details。**现在剩下的都是人工步骤**：录制 5—8 分钟视频、把仓库从私有改为评审可访问、补齐团队信息、赛事提交——它们阻塞阶段五 05 的整体通过（其中「另一台 Windows 环境复跑」已由用户 2026-09-30 决定交团队在服务器上执行）。**documented → live 升格已按用户 2026-10-01 的决定暂缓**（本机只有 Command Code 与 DeepSeek 两把密钥，且这两条预设已是 `live`；其余 documented 条目要各自的密钥才能实测）。**下一片 = 预设「未核实」清单收口（0 次真实模型请求），提示词在最上面**；**阶段五 05 收尾的提示词已排队在它下面**，等人工步骤就绪再复制。不要动：阶段五 04／05 的验收状态、这些人工事项。

<details>
<summary>已执行的提示词：阶段四 06（调研＋实现；已执行 2026-10-01，明细见 PHASES 阶段四 06 记录与证据记录）</summary>

```text
[$implement](C:\Users\dusta\.agents\skills\implement\SKILL.md)

请在 F:\VibeCoding\web-match 做阶段四 06 的**前半段调研**：为「固定资料库内的反证与版本复查」找经得起核对的同口径来源对（.scratch/stage-4-source-audit/issues/06-counterevidence-review.md 的第一条勾选项，`needs-info` 就卡在这里）。**本片只产出候选清单：不实现代码、不改固定资料库与题集、不解除 `needs-info`。** 开始前先记录当前 HEAD 作为代码审查对照点（写这份提示词时是 2026-09-30 阶段五 05 可先行部分的提交；以你实际开工时的 `git rev-parse HEAD` 为准）、检查工作区，并阅读 AGENTS.md、CONTEXT.md（固定资料库、口径适配、引用角色、来源结论等术语）、docs/PHASES.md 阶段四一节、shared/source-library.ts、samples/source-audit-questions.json 与 samples/source-audit-expectations.json、docs/evidence/stage-4-source-audit-*.md、.scratch/stage-4-source-audit/spec.md。

先简短说明你对任务的理解、候选来源对的判定标准和验收方式。这一片要证明的是：**有一份可核对的候选来源对清单——每条写明指标、月份、范围、两侧数值、发布日期、原始链接与短摘录，并说明它构成「同口径冲突」还是「版本修订」；口径不适配或依据不足的候选如实剔除，找不到就如实说找不到。**

## 已经确认的事实（不要重新诊断）
- 固定资料库现在只有三条材料（`shared/source-library.ts`）：2025-12 发布（同比 0.8%／环比 0.2%）、同比与环比解释页、2026-08 发布（同比 0.8%／环比 0.4%，已作为「错口径干扰项」）。干扰项不等于反证——它月份不适配，正是程序要降级为「来源待核对」的那种。
- 06 缺的是「经核对的同口径冲突／修订来源对」，判定标准写在 06 条目的勾选项里：先验证发布机构、口径、版本与修订关系；只有明确修订关系才允许版本替代；同口径冲突无法消解时标为「来源存在分歧」，不能用投票或日期新旧直接裁决；找不到合适材料就保持候选状态，不伪造官方版本或修订声明。
- **本片 0 次真实模型请求**：不跑 `npm run eval:source-audit`（整组一轮约 1 元、25—30 分钟），也不要因为「顺便看看」重跑评测组；公开来源核对用 `curl`／网页即可。

## 任务的交付范围
1. **找候选**：在国家统计局公开发布（以及资料库已有三条材料的原文）里找两类来源对——① 同一指标、同一月份、同一范围的两份发布数值不同（同口径冲突）；② 同一发布被更正、重发或后续修订改变了原值（版本修订）。**不要把错月份／错范围的干扰材料当反证。**
2. **逐条核对**：每条候选给出发布机构、发布日期、原始链接、适用口径（指标／月份／范围）、两侧数值与短摘录，并写明属于冲突还是修订、依据是哪句话；链接用 `curl -L -w "%{http_code}"` 实测可打开并记录结果。
3. **口径适配判定**：按 CONTEXT.md 的「口径适配」逐条判定能否作为数值依据（术语页不能；指标／月份／范围任一不匹配即不合格），不合格的列进「不构成」并写明原因。
4. **产出**：新建 `.scratch/stage-4-source-audit/06-source-pairs-candidates.md`，分「可直接归档的候选」「需人工复核」「不构成」三档，每条写清需要人核对什么；不改 `shared/source-library.ts`、不改题集与期望、不重跑评测。一份可用候选都找不到时，如实写「本轮未找到可用来源对」并列出已检查过的检索路径——不要为了交差把不适配的材料包装成候选。
5. **文档**：`.scratch/stage-4-source-audit/issues/06-counterevidence-review.md` 与 docs/PHASES.md 阶段四一节各补一条「候选清单已产出、等人工核对」的记录（**状态保持 `needs-info`**，只有人能解除并决定是否归档进资料库）；最后用中文报告：候选清单、判定理由、仍需人核对的部分、本轮已检查但排除的来源。

## 纪律与预算
- **0 次真实模型请求**；不碰 `web/`、`server/`、`shared/` 与既有测试；摘录要短、能指回原始链接，不把检索命中等同于证据成立。
- 只用可公开引用、能追溯发布机构的材料；不编造版本号、修订声明或数值。
- 分支 + PR 落地并用 CI 验证（本仓库已设 `git config http.version HTTP/1.1`）；最后用中文报告。
```

执行结果（2026-10-01）：调研结论是 **CPI 口径下一对都没有**（490 条发布列表系统性排除），唯一可用的是**非 CPI** 的社零环比修订对；用户据此批准把资料库扩到「社会消费品零售总额」。随后实现「版本修订／版本替代」（资料库 3→5 条、程序侧 `applyRevision`、结论卡「版本复查」区块、题集 20→22 题），并跑完整组一轮：有检索臂 **89.7%（61/68）**、虚构引用 0、越界 0、退化题 0，**版本复查替代生效 5 次（修正 5／误改 0；额外模型调用 0 次、额外轮次 0 轮）**；PDF 重建为 **25/30 页**。明细见 [PHASES.md](PHASES.md) 阶段四「任务 06 实现记录」、[ADR 0002](adr/0002-revision-substitution-in-source-library.md) 与[证据记录](evidence/stage-4-source-audit-eval-2026-10-01-revision.md)；「同口径冲突 → 来源存在分歧」仍停在 `needs-info`。

</details>

<details>
<summary>已执行的提示词：预设端点核实与补齐（C7；已执行 2026-10-01）</summary>

```text
[$implement](C:\Users\dusta\.agents\skills\implement\SKILL.md)

请在 F:\VibeCoding\web-match 做「常用模型预设」的端点核实与补齐（用户反馈：两个协议的服务商预设不同，且有的条目依据不足）。开始前记录当前 HEAD 作为代码审查对照点、检查工作区，并阅读 AGENTS.md、docs/STRUCTURE.md、shared/model-presets.ts、docs/evidence/anthropic-provider-2026-09-28.md、README 的「模型设置」一节。

先说明理解与判定标准。这一片要证明的是：**每一条进预设的服务商与型号都有「它支持该协议的端点」和「型号支持图片输入」两类证据；证据不足的不进预设，宁少勿假。**

## 判定标准（缺一不可）
1. 该服务商确实提供本应用实际调用的端点：OpenAI 协议走 `<baseUrl>/responses`（不是 /chat/completions），Anthropic 协议走 `<baseUrl>/messages`。
2. 该端点下的型号有**图片输入**证据（官方文档含 image 字段或示例，或 models.dev、OpenRouter 的模态元数据）。
3. baseUrl 填到版本段（应用自行追加 /messages 或 /responses），不得以 /messages、/responses、/chat/completions 结尾。
4. 路由存在性要有**对照探测**：未鉴权 POST 目标路径，同时 POST 一个不存在的控制路径；控制 404 而目标 401/400 → 路由存在；两者同码 → 不可判定，不得据此下结论。
5. 每条写清出处链接与 verification（live／documented）；documented 的说明里必须写明「未做…」，不允许把「按文档」读成「已实测」。

## 交付范围
1. 逐家核实现有预设与候选补充（阿里云百炼、智谱、OpenCode Zen、OpenRouter、DeepSeek、Command Code、Anthropic、OpenAI，以及 Moonshot／Kimi、MiniMax、Fireworks、Nebius、SiliconFlow、火山方舟、DeepInfra、Groq、Together、xAI、Gemini、StepFun、七牛、Gitee AI、Infini、AI-ML API、ModelScope 等），产出 `.scratch/model-presets-research/endpoints-<日期>.md`：逐条给 protocol、label、baseUrl、model、证据原句、探测状态码、verification、还需人确认什么；分「建议补」「可以但没必要」「不能收及原因」「未核实」四档。
2. 按结论改 `shared/model-presets.ts`：补齐两边覆盖、修失效出处链接、如实保留口径差异说明；不改产品逻辑。
3. 测试：`tests/model-presets.test.ts` 增加新条目的协议／地址／型号断言、两侧共同覆盖的服务商断言，以及「documented 必须在说明里写明未做真实验证」的守护；e2e 设置页补按 `option[value=…]` 的精确断言。
4. 文档：README 的预设清单与「两侧为什么不同」、docs/PHASES.md 的预设记录同步。
5. 分支 + PR + CI；中文报告：补了哪些、依据是什么、哪些明确不能收、还需人工确认什么。

## 纪律与预算
- **0 次真实模型请求**：全程不调用模型、不发图片、不跑 `npm run eval:source-audit`；只做未鉴权路由探测、抓官方文档与第三方模态元数据。
- 不改产品逻辑与既有能力声明；不把「路由存在」说成「读图可用」。
- 网络不可达或被 WAF 拦的（本机实测 403／000）如实列入「未核实」，不算证据。
```

执行结果（2026-10-01）：新增 **6 条** documented 预设——Anthropic 侧 MiniMax 官方（`https://api.minimax.cn/anthropic/v1` + `MiniMax-M3.1-Flash-Preview`）与 Fireworks AI（`https://api.fireworks.ai/inference/v1` + Kimi K3）；Responses 侧阿里云百炼（`compatible-mode/v1`，补上「只有 Anthropic 面」的不对称）、Moonshot 官方（`kimi-k3`，其 `/messages` 实测 404）、MiniMax 官方、Nebius Token Factory。同轮修 OpenRouter 两条失效出处链接，给 DeepSeek Responses 的 baseUrl 口径差异与 OpenAI 官方页 403 留下如实说明；每条 documented 都在说明里写明「未做真实调用」，并加单元测试守护。方法为「未鉴权路由探测（带对照路径）＋官方文档原句＋models.dev／OpenRouter 模态元数据」，逐条证据与状态码见 [`.scratch/model-presets-research/endpoints-2026-10-01.md`](../.scratch/model-presets-research/endpoints-2026-10-01.md)。**未核实（如实保留）**：火山方舟 Ark（JS 外壳文档、探测不可判定）、Groq／Together（403 WAF）、xAI／Gemini／Mistral／Perplexity（000 不可达）、智谱 Responses 面、硅基流动 Anthropic 面图片证据、DeepInfra Anthropic 面图片原句、StepFun 的 base 口径差一步、千帆 `/v2/responses` 的图片字段。

</details>

复制下面整段到以 `F:\VibeCoding\web-match` 为工作目录的新会话（**下一片：预设「未核实」清单收口，0 次真实模型请求、不升 live**）。

```text
[$implement](C:\Users\dusta\.agents\skills\implement\SKILL.md)

请在 F:\VibeCoding\web-match 做「预设：『未核实』清单收口」这一片——把上一轮端点核实留下的「未核实／需人工确认」逐条推进到「有证据 → 补进预设」或「确认不能收 → 写清原因」。**本片 0 次真实模型请求**，也**不做 documented → live 升格**（用户 2026-10-01 决定暂缓，原因见下）。

## 开工前置（先说清）
1. 记录当前 HEAD 作为代码审查对照点、检查工作区，并阅读 AGENTS.md、docs/STRUCTURE.md、shared/model-presets.ts、`.scratch/model-presets-research/endpoints-2026-10-01.md`（重点看「未核实／需人工确认」13 项与「不能收录及原因」）、docs/evidence/anthropic-provider-2026-09-28.md、README「模型设置」一节。
2. 逐条给出本轮判定：**能补 / 仍不能补 / 本机网络不可达无法判**；每条都要有**本轮新拿到**的证据（官方文档原句，或带对照路径的未鉴权探测状态码）。上一轮已排除的不要重查一遍。
3. 说明为什么本片不升 live：本机模型设置里只有 Command Code（Responses 槽）与 DeepSeek 官方（Anthropic 槽）两把密钥，而这两条预设**已经是 `live`**；其余 documented 条目没有对应密钥。**不要从别的协议槽借密钥**（应用刻意不这么做），也不要让用户把密钥贴进对话——若之后用户在本机设置里存了目标服务商的密钥，再单独开一片做升格。

## 判定标准（缺一不可）
1. 该服务商确实提供本应用实际调用的端点：OpenAI 协议走 `<baseUrl>/responses`（不是 /chat/completions），Anthropic 协议走 `<baseUrl>/messages`；
2. 该端点下的型号有**图片输入**证据（官方文档含 image 字段或示例，或 models.dev、OpenRouter 的模态元数据）；
3. baseUrl 填到版本段（应用自行追加 /messages 或 /responses），不得以 /messages、/responses、/chat/completions 结尾；
4. 路由存在性要有**对照探测**：未鉴权 POST 目标路径，同时 POST 一个不存在的控制路径；控制 404 而目标 401/400 → 路由存在；两者同码 → 不可判定，不得据此下结论；
5. 每条写清出处链接与 `verification`；documented 的说明里必须写明「未做…」，不允许把「按文档」读成「已实测」。

## 交付范围
1. **更新调研文件**：把 `.scratch/model-presets-research/endpoints-2026-10-01.md` 的「未核实」表逐条改写为「已核实并补进预设／已核实且确认不能收（原因）／本机不可达（给出可复核命令与替代路径）」，保留探测状态码与文档链接；新结论另起一节并注明日期。
2. **按结论改 `shared/model-presets.ts`**：只补双证齐全的条目，宁少勿假；每条 documented 说明写明「未做真实调用」；baseUrl 按「应用自行追加 /messages 或 /responses」的口径填。
3. **测试与文档**：`tests/model-presets.test.ts` 同步（新条目断言、两侧共同覆盖断言、documented 必须写明「未做…」的守护）；README 的预设清单与两侧差异说明、docs/PHASES.md 的预设记录同步。
4. **提交**：中文提交说明，分支 + PR + CI 绿；中文报告：逐条结论、补了哪些、哪些仍不能收及原因、哪些因本机网络不可达而保留未核实、以及「live 升格」的当前状态（暂缓，等密钥）。

## 纪律与预算
- **0 次真实模型请求**：不调用模型、不发图片、不跑 `npm run eval:source-audit`；只做未鉴权路由探测、抓官方文档与第三方模态元数据（models.dev／OpenRouter）。
- 不把「路由存在」「连接测试通过」说成「读图可用」；证据不足宁可不收。
- 不改业务逻辑（`shared/model-presets.ts` 的数据除外）、不动固定题集与资料库；403／000 的如实列为「本机网络不可达」，不算证据。
```

<details>
<summary>已排队的提示词：阶段五 05 收尾（等两项人工步骤就绪后再复制）</summary>

```text
[$implement](C:\Users\dusta\.agents\skills\implement\SKILL.md)

请在 F:\VibeCoding\web-match 收尾阶段五任务 05（.scratch/stage-5-stability-submission/issues/05-final-acceptance-handoff.md），**开工前先核对 04 的两项人工步骤是否已经完成**：① 仓库可见性——`gh repo view Iskuyal/web-match --json visibility` 应为 `PUBLIC`，或已为评审开通只读访问权限；② 演示视频——README「提交材料索引」的视频行应是可打开的链接，用 `curl -s -o NUL -w "%{http_code}" -L <链接>` 实测 200。两项都没就绪时：如实告诉用户还差什么、只做可先行部分并标成「等人」，**不要把没做的写成通过**。开始前先记录当前 HEAD 作为代码审查对照点、检查工作区，并阅读 AGENTS.md、CONTEXT.md、docs/PHASES.md 阶段四一节（06 记录）与阶段五一节（04、05、07、08 记录）、.scratch/stage-5-stability-submission/issues/04 与 05、README.md 的「提交材料索引」「当前能力状态」「本地验证」「持续集成」、docs/submission/accessibility-check.md、docs/submission/demo-video-script.md、docs/submission/technical-report.html、docs/adr/0001 与 0002，以及`docs/competition/AI-WEB网页开发挑战赛文档.md`。

当前基线（2026-10-01，写这份提示词时）：`npm test` **338/338**、`npm run test:e2e` **90/90**（30 用例 ×3 视口）、`npm run build` 通过、`npm run eval:samples` 23/23、`npm run verify:sample-renders` 18/18；技术 PDF **25/30 页**；固定资料库 5 条、题集 22 题；阶段四 06 的「版本修订／版本替代」已实现并整组实测，仍停在 `needs-info` 的只有「同口径冲突 → 来源存在分歧」。

先简短说明你对任务的理解、哪些验收项现在可做、哪些仍缺人工输入，以及每项的验收方式。这一片要证明的是：**团队有一份可复查的最终清单，能区分本地测试、真实模型复验、人工材料检查与仍未交付的能力，且清单里没有一条是「跑了但没记录」或「没做却说通过」。**

## 任务的交付范围
1. **核对两项人工步骤**（见上），结果写进 issues/05 的 Comments：就绪的部分补齐 05 的勾选项，未就绪的保持未勾选并写明「还缺什么、由谁来做」。
2. **另一台环境复跑**（用户已确认交团队在另一台 Windows 服务器上执行）：拿到团队回执后把实际版本、命令与结果补进 issues/05 的记录；没有回执就不要改那一项的勾选依据。
3. **材料与权限排查**：README 材料索引与仓库内链接逐一可打开；`node docs/submission/build-report.mjs --check` 的页数与 README／accessibility-check／issues/04 三处一致（当前 25/30）；`docs/submission/assets/` 的 20 张截图与图注口径一致；仓库内无密钥（只跟踪 `.env.example`）、`GET /api/settings` 不回传密钥。
4. **四类证据分别列出**（本地测试／真实模型在线／人工材料检查／仍未交付）：每条给出命令或证据文件出处，不把替身响应、预置样例或历史记录写成本轮实测。
5. **赛事清单复核**：核对当时的截止日期与入口（省赛 2026-11-18、国赛作品提交 2026-12-27；省赛入口需缴费后登录个人中心），更新 issues/05 里的人工提交清单；不代替团队登录、缴费或提交。
6. **状态与文档**：只有实际通过的验收项才勾选；docs/PHASES.md 阶段五一节补一条 05 的实测记录；本文件（docs/STAGE-5-PROMPT.md）的状态与「未完成清单」按实际结果收敛。
7. **提交**：中文提交说明，分支 + PR 落地并用 CI 验证；最后用中文报告：改了什么、命令与结果、哪些仍是人工步骤、未验证项。

## 纪律与预算
- 真实模型调用只用于 05 明确需要的抽样／复验，**不跑 `npm run eval:source-audit` 整组**（整组约 1—1.5 元、25—30 分钟，且阶段四 06 刚跑过一轮）；离线命令只在本机跑。
- 不碰 `web/`、`server/`、`shared/` 与既有测试；人工步骤（录视频、改仓库可见性、补团队信息、赛事提交）由团队完成，助手只做核对与清单、不代做。
- 跑测前先按端口清进程：反复 `npm run dev` 会累积 vite／tsx 孤儿进程，残留实例会让 `/api/samples` 报 500、e2e 大面积「did not run」。
- CI 里 `verify:sample-renders` 在当前 `windows-latest` 镜像上是 `continue-on-error` 的 0/18 非阻塞信号，不要据此改工作流。
```

执行前提：先确认两项人工步骤（录制视频、仓库可见性）已就绪；就绪前本片没有可执行部分。

</details>

<details>
<summary>已执行的提示词：阶段五 05（可先行部分；已执行 2026-09-30，明细见 issues/05 的 Comments）</summary>

```text
[$implement](C:\Users\dusta\.agents\skills\implement\SKILL.md)

请在 F:\VibeCoding\web-match 做阶段五任务 05 的**可先行部分**（.scratch/stage-5-stability-submission/issues/05-final-acceptance-handoff.md）：05 整体仍被 04 的两项人工步骤（录制视频、仓库可见性）阻塞，本片只做不依赖它们、并且能如实记录结果的部分，**不勾选被阻塞的验收项，不代做人工步骤，也不把「本机复跑」写成「另一台环境」**。开始前先记录当前 HEAD 作为代码审查对照点（写这份提示词时是 0834084；以你实际开工时的 `git rev-parse HEAD` 为准）、检查工作区，并阅读 AGENTS.md、CONTEXT.md、docs/PHASES.md 的阶段五一节（04、07、08 三段记录）、.scratch/stage-5-stability-submission/issues/04 与 05、README.md 的「提交材料索引」「当前能力状态」「本地验证」「持续集成」、docs/submission/accessibility-check.md、docs/submission/demo-video-script.md、docs/submission/technical-report.html、docs/adr/0001-disable-cross-picker-while-main-image-loads.md，以及`docs/competition/AI-WEB网页开发挑战赛文档.md`的提交要求。

先简短说明你对任务的理解、哪些验收项现在可做、哪些仍缺人工输入，以及每项的验收方式。这一片要证明的是：**05 里不依赖人工步骤的部分都有可复查的记录（命令、版本、结果、未验证项），没做的部分被明确标成「等人」而不是「通过」。**

## 开工前的两个前置检查（人工步骤，助手不能代做）
1. **仓库可见性**：`gh repo view Iskuyal/web-match --json visibility` 应为 `PUBLIC`，或已为评审开通只读访问权限（当前预期是 `PRIVATE`）。
2. **演示视频**：README「提交材料索引」的视频一行应为可打开的链接，用 `curl -s -o NUL -w "%{http_code}" -L <链接>` 实测 200（当前预期仍是「待补链接」）。
   两项就绪与否只决定哪些验收项能勾选；没就绪时如实记录，只做不依赖它们的部分，不要为了「跑完清单」把未完成项写成通过。

## 已经确认的事实（不要重新诊断）
- 阶段五 01／02／03／06／07／08 已完成并记录在 docs/PHASES.md 阶段五一节；08 的语义、禁用范围与保留边界见 [ADR 0001](adr/0001-disable-cross-picker-while-main-image-loads.md)；07 的人为变红验证有三次 run（36723291466 类型错误红、36723673814 断言失败红、36724007809 回退后绿）。
- 04 的仓库侧材料已完成并与 2026-09-30 实测同步（合并提交 `0834084`）：技术 PDF **24/30 页**、`npm test` **332/332**、`npm run test:e2e` **87/87**（29 用例 ×320／390／1280px）、`npm run build` 通过；`docs/submission/` 下已无 78/78 与「26 用例」，同步记录见 issues/04 的 Comments。
- 05 的阻塞项与可先行部分写在 issues/05 的 Comments：可先行的是「按 README 从零启动并走固定演示路径」「四类证据分别列出」「赛事日期／入口核对与人工提交清单」；拿不到第二台 Windows 机器时只能做本机复跑并如实标注。阶段四 06 是 `needs-info`，不要动。
- **本任务 0 次真实模型请求**：不跑 `npm run eval:source-audit`；真实模型的证据只引用 docs/evidence/ 的既有记录并注明轮次、重复次数与失败数；`npm run eval:samples` 23/23 与 `npm run verify:sample-renders` 18/18 只在本机跑。
- CI（.github/workflows/ci.yml，windows-latest + Node 24）在 PR #11—#19 上连续绿色；`verify:sample-renders` 在当前镜像上是 `continue-on-error` 的 0/18 非阻塞信号，**不要据此改工作流**。

## 任务的交付范围
1. **从零启动复跑**：先按端口清进程（残留 vite／tsx 会让 `/api/samples` 报 500、e2e 大面积「did not run」），再按 README 的「Windows 快速开始」走一遍 `npm install` → `npm run dev` → 打开 `http://127.0.0.1:5173` → 载入五条冻结演示题里至少一条并走通到结论；记录实际 Windows／Node／npm／Edge 版本、命令、耗时与结果。**没有第二台 Windows 机器时写「本机复跑」，并注明这不等同于 05 第 1 条要求**；不要出现「已在另一台环境验证」这类没做过的表述。
2. **四类证据分别列出**（本地测试／真实模型在线／人工材料检查／仍未交付）：每条给出命令或证据文件出处——本地给命令与结果，在线引用 docs/evidence/ 记录并注明轮次与失败数，人工项给检查方式，未交付项写明原因。不把替身响应、预置样例或历史记录写成本轮实测。
3. **材料与权限排查**：README 材料索引与仓库内链接逐一可打开；`node docs/submission/build-report.mjs --check` 的页数与 README／accessibility-check／issues/04 三处一致；`docs/submission/assets/` 的截图张数与「替身响应渲染」图注口径一致；仓库内无密钥（只跟踪 `.env.example`）、设置读取接口不回传密钥；确认 `dist/`、`node_modules/` 等未入库。
4. **顺带修材料排查中发现的引用缺口**（只补引用，不新增能力声明）：① issues/05 的「19 张替身响应截图」应为 20 张；② 材料里没有一处引用 `docs/adr/0001-…`，而 `technical-report.html` 的 7.1 已声称该 ADR 里那条行为，附录 A.2 证据索引应补一条；③ 6.1 写着「类型检查单独成步是实测教训」，而 07 的三次 run（红→红→绿）在材料里没有出处，应在合适位置（README「持续集成」或报告 6.1／附录 A）补引用。判断某处不该加的，写清理由。
5. **赛事日期与入口核对 + 人工提交清单**：读`docs/competition/AI-WEB网页开发挑战赛文档.md`并（如需要）访问赛事官网，核对截止日期、提交入口与材料形式要求（accessibility-check 第 5 节记录了 2026-11-18），产出交给团队的人工提交清单（谁做、做什么、依赖什么、当前状态）。不代替团队登录、缴费或提交。
6. **状态与文档**：issue 05 的 Comments 写清本轮做了什么、命令、结果、仍未做什么（**不勾选被阻塞的验收项、不改 Status**）；docs/PHASES.md 阶段五一节补一条本次可先行部分的实测记录（改了什么、命令、结果、未验证项）；本文件（docs/STAGE-5-PROMPT.md）的「未完成清单」按实际结果收敛。
7. **提交**：中文提交说明，分支 + PR 落地并用 CI 验证（网络偶发失败时重试；本仓库已设 `git config http.version HTTP/1.1`）。最后用中文报告：做了什么、命令与结果、哪些仍是人工步骤、未验证项。

## 纪律与预算
- 0 次真实模型请求；不碰 `web/`、`server/`、`shared/` 与既有测试；材料里的数字只引用 `docs/evidence/` 与本次实测命令。
- 跑测前先按端口清进程：反复 `npm run dev` 会累积 vite／tsx 孤儿进程，残留实例会让 `/api/samples` 报 500、e2e 大面积「did not run」。
- 人工步骤（录视频、改仓库可见性、补团队信息、赛事提交）由团队完成，助手只做核对与清单，不代做、不猜测结果。
- CI 里 `verify:sample-renders` 在当前 `windows-latest` 镜像上是 `continue-on-error` 的 0/18 非阻塞信号，不要据此改工作流。
- **只做可先行部分**：任何依赖上面两个前置检查的验收项保持未勾选，并在报告里单独列出「还缺什么、由谁来做」。
```

执行结果（2026-09-30，对照点 HEAD `fd3a6d1`；离线部分 **0 次真实模型请求**，同日获准后补跑一次抽样）：本机从零启动复跑（Windows 11 + Node 24.16 + npm 11.17 + 系统 Edge 154）——首页四个入口与 11 张样例可交互；`/audit?sample=multi-claims` 点「确认并计算此主张」得「图内一致」与 `(100 - 80) / 80 × 100 = 25%`（预置样例，离线到结论）；`/source-audit` 载入 CPI 样例后图片与配文就位、固定资料库 3 条可展开，**停在「运行来源核验」之前**（再点是真实模型请求）；`/settings` 密钥框为空。四类证据：`npm test` 332/332、`test:e2e` 87/87、`build` 通过、`eval:samples` 23/23、`verify:sample-renders` 18/18、PDF 24/30；**真实模型抽样**（五条冻结演示题 ×1 次检索臂）6/6 通过、虚构引用 0、越界 0、q18 追问后补证改判一致，见 `docs/evidence/stage-5-05-demo-path-live-2026-09-30.md`；材料与权限排查（README 34 条内链 0 缺失、三条统计局链接 200、作品仓库未登录 404、20 张截图、只有 `.env.example`、`/api/settings` 不回传密钥）；赛事截止与九项要求的人工提交清单；三处引用缺口修补（issues/05 的「19 张」→20 张、7.1 与 README 补 ADR 出处、07 三次 run 补进 README「持续集成」与报告 6.4）。**「另一台 Windows 环境复跑」由团队人工接管（用户 2026-09-30 决定），仓库内没有该环境的实测输出；05 第 3 条仍不通过（视频未录制、仓库仍 `PRIVATE`）。**

</details>

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

请在 F:\VibeCoding\web-match 只实现阶段五任务 04：.scratch/stage-5-stability-submission/issues/04-demo-and-technical-materials.md。开始前先记录当前 HEAD 作为代码审查对照点、检查工作区，并阅读 AGENTS.md、CONTEXT.md、PLAN.md、docs/PHASES.md 的阶段五一节与阶段四一节、.scratch/stage-5-stability-submission/spec.md 与同目录 issues/04（本次任务）、05、07、08，以及阶段四证据记录 docs/evidence/stage-4-source-audit-rewrite-2026-09-30.md（05 的实测与局限）、stage-4-source-audit-clarify-resume-2026-09-29.md（04）、stage-4-source-audit-evaluation-2026-09-29.md（02）、stage-4-source-audit-claim-reasoning-2026-09-29.md（03）、docs/STAGE-1.md 与`docs/competition/AI-WEB网页开发挑战赛文档.md`里的提交要求。任务 01、02、03、06 已完成；05 被本任务阻塞，07 只剩一项人为变红验证，08 是 needs-triage，阶段四 06 是 needs-info——这些本次都不要动。

先简短说明你对任务的理解、关键假设、材料清单和每项的验收方式。这一片要证明的是：评审能从仓库说明启动项目，用一份技术 PDF 和一段 5—8 分钟视频看懂真实完成的 AI 路径、失败恢复与证据边界；材料只写已验收的能力，真实模型结果、替身测试与预置样例分开计数，未验收的能力（阶段四 06 反证与版本复查等）明确排除在结论之外。

（其余正文见 issue 04 的 Comments 与 docs/PHASES.md 阶段五 04 验收记录）
```

执行结果：`docs/submission/` 下的技术 PDF（24/30 页）与 HTML 源、构建脚本、演示脚本、访问检查记录、20 张替身响应截图与捕获脚本、README 材料索引与冻结演示路径、PHASES 与 issue 04／05 状态更新。

</details>

## 未完成清单（按优先级）

1. **阶段五 04 的两项人工步骤**（阻塞 05 的整体通过，助手不代做）：录制 5—8 分钟 1080p 视频（脚本见 [submission/demo-video-script.md](submission/demo-video-script.md)）并把链接补进 README；把仓库从 `PRIVATE` 改为 Public 或为评审开通访问权限（见 [submission/accessibility-check.md](submission/accessibility-check.md) 第 1 节）。另需补齐团队成员姓名、学校／单位与联系方式。
2. **阶段五 05 收尾（等人）**：视频与仓库权限两项检查 ＋ 团队信息 ＋ 赛事提交；「另一台 Windows 环境复跑」已由用户 2026-09-30 决定交团队在服务器上执行（仓库内没有该环境的实测输出，拿到回执后补记录），真实模型抽样已于 2026-09-30 补跑。人工步骤就绪后复制本文件 `<details>` 里排队的 05 提示词跑完，并更新 05 的 Status 与勾选项。
3. **预设「未核实」清单收口（下一片，0 次真实模型请求）**：把 `.scratch/model-presets-research/endpoints-2026-10-01.md` 里 13 项「未核实／需人工确认」逐条推进到「有证据 → 补进预设」或「确认不能收 → 写清原因」。提示词见本文件顶部。
4. **documented → live 升格：暂缓（用户 2026-10-01 决定先不做）**：本机模型设置里只有 Command Code（Responses 槽）与 DeepSeek 官方（Anthropic 槽）两把密钥，而 `commandcode-responses-deepseek` 与 `deepseek-anthropic-flash` **已经是 `live`**；其余 9 条 documented 条目要各自的密钥才能实测。不借别的协议槽的密钥（应用刻意不这么做）。以后本机存好目标服务商的密钥，可单独开一片做「一次连接测试 + 一次真实读图」的升格并记账。
5. **阶段四 06（已实现「版本修订／版本替代」；剩余部分等人）**：实现与整组实测见 [PHASES.md](PHASES.md) 阶段四「任务 06 实现记录」与[证据记录](evidence/stage-4-source-audit-eval-2026-10-01-revision.md)。**「同口径冲突 → 来源存在分歧」仍为 `needs-info`**：缺经人工核对的同口径分歧材料，找到之前不实现、不声明。
6. **阶段四 06 未验证的边界**：只覆盖「有官方修订声明」的修订；国家数据月度库被 WAF 拦（403），基期轮换后的月份级新旧值未核到；整组一轮里有 7 次未通过，全部是既有模型漂移（q06／q16／q18／q20），已逐题记录、不删题。
7. **仍成立的局限（不删题、不外推）**：q14 一次未填推断方向、q16 两次汇总缺必填 `claims`、q18 追问率有漂移（05 轮 2/3、06 轮 2/5）；加强表述靠固定词表（「略贵」这类不会被拦）；采用／撤回未做真实模型下的在线复验；Responses 协议工具循环只有替身测试；题型全是开发题、没有预留题；08 的载入在途锁定在上传图模型读取路径上只有替身验证。
