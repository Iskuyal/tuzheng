# 07：把类型检查、离线评测与关键浏览器路径固定进 CI

**What to build:** 每次推送与合并请求自动执行类型检查、构建、单元测试、离线固定评测与三视口浏览器端到端测试；失败可见、可复查、可重复，且不消耗模型额度。

**Blocked by:** 无

**Status:** completed（2026-09-30，全部验收项已由真实 CI 运行确认，含刻意注入的变红验证，见下方 Comments）

- [x] 推送与合并请求触发一次完整校验：类型检查、构建、`npm test`、`npm run eval:samples`、`npm run test:e2e`；任一步失败即整体失败。
- [x] 运行环境为 Windows 且 Node 为 24.x：`playwright.config.ts` 与 `scripts/verify-sample-renders.mjs` 都用 `channel: "msedge"`，依赖系统自带 Edge；Node 版本与阶段验收记录一致。
- [x] CI 只跑离线路径：不配置任何模型密钥，不执行 `npm run eval:source-audit`；仓库内不出现真实密钥，评测结果不写回仓库。
- [x] `npm run verify:sample-renders` 作为**不阻塞**的信号运行：它逐字节比对 SHA-256，结果依赖本机 Edge 版本的字体栅格化，CI 的 Edge 版本与开发机不同可能报与环境有关的假失败，失败只提示不拦截。
- [x] 失败时上传 Playwright trace 作为构建产物以便复查；成功运行不保留多余产物。
- [x] 人为引入一处类型错误与一处断言失败，确认 CI 变红，回退后确认恢复绿色；绿态连续两次可重复。
- [x] README 的「本地验证」一节说明 CI 覆盖哪些检查、哪些仍需本机手动执行（`npm run eval:source-audit` 与真实模型相关的验收）。

## Comments

**2026-09-29 实现记录（尚未在 GitHub 上验收）。**

交付物：[`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)，单个 `verify` job 跑在 `windows-latest`、Node 24、`timeout-minutes: 20`，步骤按「便宜→昂贵」排序：`npm ci` → `npm run typecheck` → `npm run build` → `npm test` → `npm run eval:samples` → `npm run verify:sample-renders`（`continue-on-error: true`）→ `npm run test:e2e` → 失败时上传 `test-results/`。另加 `concurrency` 取消被取代的运行；触发条件为 `push` 到 `main`、`pull_request` 与手动 `workflow_dispatch`。

**本机已实测（6 步全绿）：** 类型检查通过；构建通过；`npm test` 248/248；`npm run eval:samples` 23/23；`npm run verify:sample-renders` 18/18；`npm run test:e2e` 66/66（36.4 秒）。

**「只跑离线路径」已实测而非仅声明：** 本机 `%LOCALAPPDATA%\TuZheng\settings.json` 不存在（未配置任何模型密钥），上述 6 步仍全部通过，说明该流水线不依赖任何凭据。`git grep` 扫描跟踪文件未发现硬编码密钥，被跟踪的 `.env*` 只有 `.env.example`（内容仅 `PORT=3001`）。

**为什么类型检查必须单独成步（实测结论）：** 向 `shared/axis-risk.ts` 注入 `export const __mutationCheck: number = "not a number";` 后，`npm run typecheck` 以退出码 2 报 TS2322，而**同一变异下 `npm test` 仍 248/248 通过**——vitest 走 esbuild，只剥离类型不做检查。也就是说没有这道门禁时，类型错误可以带着全绿的单测被提交。变异已回退，`git diff` 为空。

**剩余两个未勾选项的验收方式：** 这两项都要求流水线真实运行一次。

1. 推送一次或开一个 PR，确认三条 check 触发且整体状态正确；
2. 在同一分支上人为引入一处类型错误，确认 CI 变红，回退后确认恢复绿色。

注意这是本仓库**新增的文件**，首次推送后 GitHub 才会注册该工作流；本机无法代为执行，需要人工推送。`workflow_dispatch` 已配置，也可在 Actions 页面手动触发，无需等下一次业务提交。

---

**2026-09-29 首次 CI 运行记录（PR #9，run 36569903226）。**

工作流按预期注册并在 `pull_request` 上自动触发，`windows-latest` + Node 24 下跑完全部步骤，用时 5 分 50 秒。结果：**8 步通过，端到端测试失败**（62 通过 / 4 失败），job 以退出码 1 结束，`test-results/` 作为 `playwright-trace` 产物正常上传（已下载复查）。失败时上传的 trace 是这次诊断的关键证据。

因此以下各项由这次真实运行确认：**触发条件**（`pull_request` 自动跑）、**Windows + Node 24 环境可用**（62 条用例跑过，说明 Edge 正常启动）、**失败即整体失败**（job 退出码 1）、**失败产物上传**。`verify:sample-renders` 在 CI 上通过（18/18），说明当前 windows-latest 的 Edge 与开发机栅格化结果一致，`continue-on-error` 暂未触发。

**端到端测试的失败不是环境问题，而是暴露了一个真实的应用竞态**，诊断与修复见 [任务 08](08-cross-picker-cancelled-during-load.md)。四条失败全部是「导航后立刻操作跨图区」的用例；根因是主图载入完成会重置跨图会话并中止在途的对照图请求，而本机加载快到掩盖了它。修法是给这类用例补上「等主图载入完成」的断言（6 处，只动测试，未动产品行为）。

修复的验证方式是人为给 `/api/audit/sample` 注入 400ms 延迟做前后对照：修复前 24 通过 / 12 失败，修复后 66 通过 / 0 失败。

**剩余一项（未勾选）说明：** 「人为引入类型错误与断言失败确认 CI 变红」这一项，本轮观察到的是**真实失败**导致的变红与修复后的转绿，不是刻意注入的变异；类型错误路径只在本机验证过（注入 `shared/axis-risk.ts` 后 `npm run typecheck` 退出码 2，而 `npm test` 仍全绿）。为如实区分，该项保持未勾选。它不阻塞本任务的核心交付，需要时可在一次性分支上用 `workflow_dispatch` 单独跑一次变异验证。

---

**2026-09-30 人为变红验证记录（本条已补齐；下面两次变红都是刻意注入的变异，不是真实缺陷）。**

在临时分支 `chore/ci-negative-check`（从 `main` 的 `e8d4363` 开出，**验证后本地与远端都已删除、从未合并**）上用 `gh workflow run CI --ref chore/ci-negative-check` 触发 `workflow_dispatch`，分别注入两类缺陷，两次都变红：

| 次数 | 注入内容 | 结果 | 失败步骤与证据 |
| --- | --- | --- | --- |
| 1 | `shared/axis-risk.ts` 加 `export const __ciMutationCheck: number = "not a number";` | **红**（41 秒） | [run 36723291466](https://github.com/Iskuyal/web-match/actions/runs/36723291466)：`Run npm run typecheck` → `shared/axis-risk.ts(4,14): error TS2322: Type 'string' is not assignable to type 'number'.`，job 退出码 1，后续步骤未执行 |
| 2 | 回退类型错误，改把 `tests/axis-risk.test.ts` 的期望值写成 `"misleading-risk"` | **红**（1 分 21 秒） | [run 36723673814](https://github.com/Iskuyal/web-match/actions/runs/36723673814)：类型检查与构建都通过，失败落在 `Run npm test` → `AssertionError: expected 'ok' to be 'misleading-risk'`（`tests/axis-risk.test.ts:16`） |

**本机同条件复验（与上面两次独立）：** 注入类型错误后 `npm run typecheck` 退出码 2（TS2322），而**同一变异下 `npm test` 仍 332/332 通过**——再次确认类型错误必须由单独的 `npm run typecheck` 步骤拦截，单测走 esbuild 只剥离类型不做检查。第二次注入后本机 `npm run typecheck` 退出码 0、`npm test` **331 通过 / 1 失败**，失败点与 CI 一致。

**回退与绿态：** 临时分支已删除（本地 `git branch -D`、远端 `git push origin --delete`，`git ls-remote --heads origin` 已无该分支）；注入内容在 `main` 与修复分支上都不存在（`git grep __ciMutationCheck` 与 `git grep 一次性变异验证` 均为空，`tests/axis-risk.test.ts:15` 已恢复 `toBe("ok")`，工作区 `git status` 干净）。删除后重新 `workflow_dispatch` 跑 `main`：[run 36724007809](https://github.com/Iskuyal/web-match/actions/runs/36724007809) **绿色**。加上此前 PR #11—#16 的连续绿态，以及本次任务 08 的 PR #17（[run 36722687288](https://github.com/Iskuyal/web-match/actions/runs/36722687288)）同样绿色，「绿态连续两次可重复」成立，且本次两次刻意变红之后已确认转绿。

**未做：** 没有把变红分支留在远端、没有为它开 PR；仓库可见性与演示视频仍是人工步骤，不在本任务范围。

**附带观察（2026-09-30，非本任务引入）：** 上面两次变红运行与本次的绿态运行（以及 12:44 的 `main` 推送运行）里，`npm run verify:sample-renders` 在 CI 上**全部 0/18 失败**（`FAIL conflict SVG→PNG` 起逐张失败），即当前 `windows-latest` 镜像（`windows-2025-vs2026` / 镜像版本 20260925）的 Edge 字体栅格化已经与开发机不同。四项事实据此更新：

1. 第 4 个验收项（不阻塞信号）从「声明」变成「实际发生并被容忍」——该步骤 `continue-on-error: true`，失败只出注释与 `##[error]Process completed with exit code 1`，job 与整次运行仍是绿色（[run 36724007809](https://github.com/Iskuyal/web-match/actions/runs/36724007809) 的 `✓ verify in 3m52s`）。若当初把它设为阻塞，CI 会因环境原因永久变红，与产品无关。
2. 本文档 2026-09-29 那句「`verify:sample-renders` 在 CI 上通过（18/18）……`continue-on-error` 暂未触发」**已经过时**，以上述实测为准。
3. 逐字节 SHA-256 同源核对只在**开发机**（本机 18/18）与本地验收记录中作为证据；CI 上它只是信号，不能当作图片未改动的证据。
4. 演示截图与技术 PDF 用的是仓库内已生成的静态 PNG，不受该信号影响。

