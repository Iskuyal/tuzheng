# 项目结构

根目录提供使用、产品和协作入口。运行配置集中在 `config/`；代码按页面、API、共享领域规则分层；文档按当前说明、提交材料与历史证据组织。

```text
web-match/
├── README.md / PLAN.md / CONTEXT.md / AGENTS.md
├── package.json / package-lock.json / tsconfig.json
├── config/                 Vite、Vitest、Playwright、TypeScript
├── web/                    Vue 页面、组件、主题、浏览器状态
├── server/                 本机 API、模型适配、会话和来源工具
├── shared/                 领域类型、确定性计算与固定资料
├── scripts/                验证、评测、材料预检及记账工具
├── tests/ / e2e/            单元/API 与浏览器验证
├── samples/                冻结题、独立期望、图片/输入指纹
├── docs/
│   ├── README.md           按任务查阅文档
│   ├── DEVELOPMENT.md      开发、端口、配置和检查
│   ├── PHASES.md           当前阶段和证据入口
│   ├── submission/         当前材料清单、视频/PDF、交付工具
│   ├── evidence/           原始记录、截图与账本
│   ├── reviews/            日期审查和交付报告
│   ├── history/            完整历史路线图
│   ├── adr/ / agents/      决策与任务约定
│   └── competition/        赛事原文与注明日期的核对
├── .scratch/               功能规格与带状态的任务
└── .github/workflows/      离线 CI
```

## 代码和资源

`web/pages/` 是当前四个路由，`web/components/` 保存复用组件。主题入口由 `web/main.ts` 加载：`style.css` 提供基础，`evidence-room.css` 与 `evidence-room-workspaces.css` 承载当前主题。静态团队自制图片在 `web/public/samples/`；独立期望和指纹在根 `samples/`，两者职责不同。

API 入口为 `server/index.ts`，应用工厂在 `server/app.ts`。模型协议适配、来源工具与可恢复调查会话位于 `server/`，确定性规则与领域类型在 `shared/`。具体术语与设计决定查[领域上下文](../CONTEXT.md)及 [ADR](adr/)。

## 脚本、类型与 CI

所有命令从仓库根运行，以 `package.json` 为入口；按用途查[脚本导航](../scripts/README.md)。录制原始工程跟随日期材料保留，固定交付工具在 `docs/submission/closeout/`；当前交付文件由 `docs/submission/materials.json` 统一列出，材料预检和打包共用 `scripts/submission-materials.ts`。

根 `tsconfig.json` 引用 `config/tsconfig.web.json`、`config/tsconfig.server.json` 和 `config/tsconfig.e2e.json`。服务端层已覆盖 `server/**/*.ts`、`shared/**/*.ts`、`scripts/**/*.ts`、`tests/**/*.ts`；新增材料工具不需要另建编译工程。前端构建目录为 `dist/client/`，编译后的服务端入口为 `dist/server/server/index.js`。

CI 运行文档/材料检查、类型检查、构建、行为/API、录制预算恢复、冻结样例和三视口浏览器验证。材料检查仅核对已保存字节和录制指纹，不发模型请求。离线三臂/候选产物仍由 `holdout-offline-fixture` artifact 收集；失败浏览器 trace 仍在既有路径，无新增上传范围。

## 端口和配置

默认 API 为 `3001`，网页为 `5173`，均仅在 `127.0.0.1` 上使用；根 `.env` 或进程变量 `PORT`、`WEB_PORT` 可覆盖。Vite 代理消费同一个 API 端口，网页启用 `strictPort`。开发与端口验证方法见[开发指南](DEVELOPMENT.md)。

模型默认通过设置页存于当前 Windows 用户 LocalAppData，显式 `env` 模式整份读取协议、地址、模型和密钥。密钥不随仓库或交付包分发；完整契约见[模型配置](MODEL-CONFIG.md)。

## 产物与保留策略

| 目录 | 用途 |
| --- | --- |
| `.cache/playwright/test-results/` | 当前 Playwright 失败 trace，CI 沿用此路径 |
| `.cache/typescript/` | TypeScript 构建信息 |
| `.cache/closeout-packages/<SHA>/` | 干净提交的源码、当前材料、候选锁和哈希清单 |
| `.cache/windows-acceptance/<时间>/` | 第二环境检查或明确标注的本机演练 |
| `docs/evidence/<批次>/` | 需随项目保留的原始证据、失败和账本 |
| `docs/submission/` | 选中的主材料、原片与历史材料；角色见目录索引 |

`.cache/`、`dist/`、`node_modules/`、`test-results/` 和本机配置为忽略产物；`.idea/`、`.zcode/`、`.firecrawl/` 是本机工作状态。本次按文档职责归档，原视频分享路径、冻结样例和旧批次指纹保留。

## 修改目录时

先检查导入路径、npm 命令、TypeScript 引用和 CI 产物，再更新文档索引及材料清单。运行 `docs:check`、`verify:materials`、相关测试、构建和默认/自定义端口验证。新提交重新生成候选锁，保留旧版本记录；本地链接存在、远端可访问和验收通过分别确认。
