# 图证工作约定

编码前说明理解、假设、权衡和验收方法；遇到影响产品结论的歧义时先澄清。每次只完成当前阶段的一条端到端用户路径，并按实际验证结果更新文档状态。

- **产品决定或用户体验改动**：先读 [PLAN.md](PLAN.md)。第一目标用户是只有截图的普通读者。截图只支持图内检查；有可核查来源后才进入来源核验。
- **阶段选择与进度**：读 [docs/PHASES.md](docs/PHASES.md)。计划、实现、验收是三种不同状态；不要把计划写成已交付。
- **阶段一开发**：读 [docs/STAGE-1.md](docs/STAGE-1.md) 的交付范围与验收清单。阶段一只建立单图闭环，保持 Windows + Node + npm 可运行。
- **阶段二开发**：读 [阶段二规格](.scratch/stage-2-reader-workbench/spec.md) 和其 `issues/` 中首个无阻塞任务。一次只实现一条端到端路径，按实测结果更新任务与路线图。
- **密钥与示例**：默认使用本机配置：API Key 由设置页交给仅监听 `127.0.0.1` 的服务端，保存在当前 Windows 用户的 LocalAppData。显式启用 `MODEL_CONFIG_SOURCE=env` 时，服务端从环境变量一次完整读取协议、地址、模型与密钥；缺项或非法配置明确失败，两种配置源整份选择。环境密钥仅在服务端内存使用，不写回文件、不回传页面、不进日志或仓库，设置页显示来源并只读。远程模型地址须使用 HTTPS；HTTP 只允许本机回环服务。修改配置消费入口时先读[模型配置说明](docs/MODEL-CONFIG.md)，验收覆盖临时配置、假密钥和默认／自定义 API 端口。示例图片与资料使用团队自制或允许公开使用的内容。
- **提交**：GitHub 提交说明和提交报告使用中文。
- **目录或工具配置调整**：读 [项目结构](docs/STRUCTURE.md)，同步 npm 脚本、TypeScript 引用与 CI 产物路径，并验证默认和自定义 API 端口。

## Agent skills

### 任务跟踪

规格与任务以仓库内 Markdown 文件管理，存放在 `.scratch/<功能名>/`。参见 `docs/agents/issue-tracker.md`。

### 分诊标签

使用 `needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human` 和 `wontfix`。参见 `docs/agents/triage-labels.md`。

### 领域文档

本仓库使用单一领域上下文：术语表位于根目录 `CONTEXT.md`，架构决策记录位于 `docs/adr/`。参见 `docs/agents/domain.md`。
