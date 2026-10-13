# 项目结构

根目录保留运行入口与全项目约定；其他内容按用途归档。使用根目录 `package.json` 的脚本启动、测试和构建。

| 位置 | 职责 |
| --- | --- |
| `README.md`、`AGENTS.md`、`PLAN.md`、`CONTEXT.md` | 使用入口、工作约定、产品计划、领域术语 |
| `package.json`、`package-lock.json`、`tsconfig.json` | npm 入口、锁定依赖、编辑器 TypeScript 方案入口 |
| `config/` | Vite、Vitest、Playwright 与分层 TypeScript 配置 |
| `web/`、`server/`、`shared/` | Vue 页面、本机 API 与模型适配、共享领域逻辑 |
| `tests/`、`e2e/` | 单元/API 行为测试、浏览器测试与界面截图脚本 |
| `samples/`、`web/public/samples/` | 独立期望与图片指纹、团队自制图片 |
| `samples/holdout-v1/`、`docs/evaluations/` | 12题独立预留冻结包、三臂离线验证与真实运行计划 |
| `scripts/` | 评测、图片同源核对、文档链接检查、启动前端口预检 |
| `docs/` | 路线图、阶段交接、ADR、证据、审查报告与提交材料 |
| `docs/competition/` | [赛事要求原文](competition/AI-WEB网页开发挑战赛文档.md) |
| `.scratch/` | 仓库内功能规格与任务，按功能目录管理 |
| `.github/` | GitHub Actions 流水线 |
| `.cache/`、`dist/`、`node_modules/` | 忽略的缓存、编译产物与依赖 |

## 配置与产物

根目录 `tsconfig.json` 只引用 `config/tsconfig.web.json`、`config/tsconfig.server.json` 与 `config/tsconfig.e2e.json`，让编辑器分别采用 DOM、Node 与浏览器测试所需的类型。`config/tsconfig.base.json` 保存共用选项，服务端编译配置独立保存在 `config/tsconfig.server.build.json`。

Vite 与 Vitest 的项目根仍是仓库根；Vite 页面根为 `web/`。Playwright 的用例目录相对于配置文件为 `../e2e/`，产物在 `.cache/playwright/test-results/`，CI 从同一路径收集失败 trace，并在这个狭窄路径内启用隐藏文件上传。TypeScript 构建信息在 `.cache/typescript/`。原测试产物保存在 `.cache/playwright/previous-test-results/`，原构建信息以 `legacy-` 前缀保留在缓存目录。

前端构建输出 `dist/client/`，服务端入口输出 `dist/server/server/index.js`。`.env.example` 记录可选的 API 端口 `PORT`（默认 3001）与网页端口 `WEB_PORT`（默认 5173）；API 与 Vite 代理均读取根目录 `.env` 的 `PORT`，启动进程中的同名变量优先。**网页端口固定、`strictPort: true`**：被占用时直接失败而不是静默换到 5174。`npm run dev` 会先执行 `npm run dev:ports`（`scripts/check-ports.ts`）做启动前预检——为什么需要它：`tsx watch` 在子进程退出后仍会守着不退出，只靠服务端自己的 `EADDRINUSE` 处理会留下「API 已退出、命令还挂着、页面继续跑」的半启动状态；服务端与 Vite 各自也保留了兜底处理。模型配置默认由设置页与本机用户配置文件管理；显式 `MODEL_CONFIG_SOURCE=env` 时，服务端从环境变量一次完整读取协议、地址、模型、密钥，不写回、不混用，规则见[模型配置说明](MODEL-CONFIG.md)。端口变量独立于模型配置源。`npm run verify:model-config` 用临时用户目录与假密钥验收默认／自定义端口及 Vite 代理。

`.idea/`、`.zcode/` 是忽略的编辑器状态，`.firecrawl/` 是忽略的调研缓存。它们属于本机工具，不进入 Git；维护时保留已有内容，避免丢失本机工作状态。源码、测试与规格已有各自职责，本次维持这些目录以减少路径变更。

`npm run eval:holdout`只提供冻结核验、三臂替身执行和已有报告重算，不读取密钥、不调用收费模型。默认临时记录在`.cache/holdout/`；CI的替身记录归档路径为`.cache/holdout/ci-offline-fixture.json`（独立artifact，明确标为替身）。交付的离线原始记录在`docs/evidence/holdout-offline-2026-10-02.json`。新增TypeScript脚本与测试由现有`scripts/**/*.ts`、`tests/**/*.ts`引用覆盖，无产物目录迁移，默认/自定义API端口继续使用现行脚本。

## 查阅入口

2026-10-07新增 `eval:preflight`（本地候选锁prepare/verify）、`eval:holdout:http`（显式执行的三臂受控HTTP）、`eval:demo:http`（显式执行的五题受控HTTP）及 `study:readers`（匿名模板/描述性统计）。旧 `eval:holdout` 继续离线；两个HTTP入口仅在另行授权真实调用时使用。脚本/测试仍由现有TypeScript引用覆盖，没有端口迁移。CI在既有离线步骤生成/核验 `.cache/holdout/ci-candidate.json`，归档在既有 `holdout-offline-fixture` artifact，同原替身记录分别保存，不增加模型密钥或在线步骤。当前候选锁在 `docs/evidence/final-candidate-2026-10-07-round2.json`，初版锁保留；用户材料在 `docs/submission/reader-study/`，接管见 [执行说明](evaluations/candidate-runbook.md)。

来源主入口的离线生产验证脚本为 `scripts/verify-source-ui.mjs`：先构建，再以 `serve` 启动固定 `127.0.0.1:5173` 的内存配置服务并拦截模型入口，`before`／`after`／`after-final`／`after-review`／`after-evidence` 分轮采集性能与截图。该脚本不读取本机密钥；原始结果在 `docs/evidence/source-entry-ui-2026-10-03/`，验收报告在 [reviews/2026-10-03-source-entry-ui.md](reviews/2026-10-03-source-entry-ui.md)。它是专用本机验证服务，不更改正常开发的默认／自定义 API 端口、npm 脚本、TS 引用或 CI 产物路径。

赛事提交入口为 `docs/submission/web-match-competition-report.pdf`（16 页），源文件 `competition-report.html`，使用 `node docs/submission/build-report.mjs --competition` 重建。`--competition --check` 只检查已保存 PDF 的页数。旧 `technical-report.html` 与 `web-match-technical-report.pdf` 保留为开发技术记录，原不带 `--competition` 的生成命令继续可用。官网核对记录在 `docs/competition/`，完整评估在 `docs/reviews/2026-10-01-competition-assessment.md`。

90 秒实际项目实录入口在 `docs/submission/code-demo/`，成片和完整录屏保存在 `docs/submission/`，当次请求与产品结果在 `docs/evidence/product-live-demo-2026-10-13/`。已保存原件支持离线重新剪辑，不需要再调用模型。录制时的专用服务只监听 `127.0.0.1:7109`，不改变正常 API 端口；当前授权已结束。`npm run test:recording` 只验收请求预算恢复和停机规则，使用测试请求函数，不读取密钥、不调用模型，CI 在现有单元测试之后运行，无新增产物上传路径或 TypeScript 引用。

阶段进度以 [PHASES.md](PHASES.md) 为准；架构决定在 [adr/](adr/)；在线记录在 [evidence/](evidence/)；技术 PDF 与演示脚本在 [submission/](submission/)；维护结论在 [reviews/](reviews/)。历史实测中的旧路径表示当时的结构，后续操作使用本文件与 npm 脚本中的现行路径。

本次根目录已跟踪文件从 **18 个降到 9 个**。运行 `npm run docs:check` 检查 Markdown 与提交 HTML 中的本地文件链接；它只检查文件存在，不证明网络可达、锚点存在或内容通过验收。
