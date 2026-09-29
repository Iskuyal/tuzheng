# 07：把类型检查、离线评测与关键浏览器路径固定进 CI

**What to build:** 每次推送与合并请求自动执行类型检查、构建、单元测试、离线固定评测与三视口浏览器端到端测试；失败可见、可复查、可重复，且不消耗模型额度。

**Blocked by:** 无

**Status:** 已实现，首次 CI 运行已验收大部分项；剩余一项见下方 Comments

- [x] 推送与合并请求触发一次完整校验：类型检查、构建、`npm test`、`npm run eval:samples`、`npm run test:e2e`；任一步失败即整体失败。
- [x] 运行环境为 Windows 且 Node 为 24.x：`playwright.config.ts` 与 `scripts/verify-sample-renders.mjs` 都用 `channel: "msedge"`，依赖系统自带 Edge；Node 版本与阶段验收记录一致。
- [x] CI 只跑离线路径：不配置任何模型密钥，不执行 `npm run eval:source-audit`；仓库内不出现真实密钥，评测结果不写回仓库。
- [x] `npm run verify:sample-renders` 作为**不阻塞**的信号运行：它逐字节比对 SHA-256，结果依赖本机 Edge 版本的字体栅格化，CI 的 Edge 版本与开发机不同可能报与环境有关的假失败，失败只提示不拦截。
- [x] 失败时上传 Playwright trace 作为构建产物以便复查；成功运行不保留多余产物。
- [ ] 人为引入一处类型错误与一处断言失败，确认 CI 变红，回退后确认恢复绿色；绿态连续两次可重复。
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

