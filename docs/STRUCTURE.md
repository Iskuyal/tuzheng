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
| `scripts/` | 评测、图片同源核对、文档链接检查 |
| `docs/` | 路线图、阶段交接、ADR、证据、审查报告与提交材料 |
| `docs/competition/` | [赛事要求原文](competition/AI-WEB网页开发挑战赛文档.md) |
| `.scratch/` | 仓库内功能规格与任务，按功能目录管理 |
| `.github/` | GitHub Actions 流水线 |
| `.cache/`、`dist/`、`node_modules/` | 忽略的缓存、编译产物与依赖 |

## 配置与产物

根目录 `tsconfig.json` 只引用 `config/tsconfig.web.json`、`config/tsconfig.server.json` 与 `config/tsconfig.e2e.json`，让编辑器分别采用 DOM、Node 与浏览器测试所需的类型。`config/tsconfig.base.json` 保存共用选项，服务端编译配置独立保存在 `config/tsconfig.server.build.json`。

Vite 与 Vitest 的项目根仍是仓库根；Vite 页面根为 `web/`。Playwright 的用例目录相对于配置文件为 `../e2e/`，产物在 `.cache/playwright/test-results/`，CI 从同一路径收集失败 trace。TypeScript 构建信息在 `.cache/typescript/`。原测试产物保存在 `.cache/playwright/previous-test-results/`，原构建信息以 `legacy-` 前缀保留在缓存目录。

前端构建输出 `dist/client/`，服务端入口输出 `dist/server/server/index.js`。`.env.example` 只记录可选 API 端口；API 与 Vite 代理均读取根目录 `.env` 的 `PORT`，启动进程中的同名变量优先。模型密钥仍由设置页与本机用户配置文件管理。

`.idea/`、`.zcode/` 是忽略的编辑器状态，`.firecrawl/` 是忽略的调研缓存。它们属于本机工具，不进入 Git；维护时保留已有内容，避免丢失本机工作状态。源码、测试与规格已有各自职责，本次维持这些目录以减少路径变更。

## 查阅入口

阶段进度以 [PHASES.md](PHASES.md) 为准；架构决定在 [adr/](adr/)；在线记录在 [evidence/](evidence/)；技术 PDF 与演示脚本在 [submission/](submission/)；维护结论在 [reviews/](reviews/)。历史实测中的旧路径表示当时的结构，后续操作使用本文件与 npm 脚本中的现行路径。

本次根目录已跟踪文件从 **18 个降到 9 个**。运行 `npm run docs:check` 检查 Markdown 与提交 HTML 中的本地文件链接；它只检查文件存在，不证明网络可达、锚点存在或内容通过验收。
