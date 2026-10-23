# 文档导航

按要完成的任务选择下面的入口。当前状态看路线图和提交材料清单；需要追溯时，再查日期报告和原始数据。

| 任务 | 入口 |
| --- | --- |
| 了解作品、首次启动 | [项目 README](../README.md) |
| 安装、端口、模型配置与离线验证 | [开发与运行](DEVELOPMENT.md)、[模型配置](MODEL-CONFIG.md) |
| 找文件、调整目录或工具入口 | [项目结构](STRUCTURE.md)、[脚本导航](../scripts/README.md) |
| 核对完成范围和下一步 | [当前路线图](PHASES.md) |
| 准备视频配音、PDF 和最终提交 | [当前提交材料及剩余事项](submission/README.md) |
| 检查交付清单、制作固定版本包 | [固定交付与人工回执](submission/closeout/README.md) |
| 视频延期时接管其他材料 | [非视频接管](submission/closeout/non-video-handoff.md)、[2026-10-23 规则复核](competition/official-rules-verification-2026-10-23.md) |
| 阅读模型和界面验证证据 | [证据索引](evidence/README.md)、[维护报告](reviews/) |
| 查产品范围与术语 | [产品蓝图](../PLAN.md)、[术语表](../CONTEXT.md)、[架构决策](adr/) |
| 接手具体开发任务 | [任务管理约定](agents/issue-tracker.md)、[仓库任务](../.scratch/) |
| 复查旧轮次与原始阶段验收 | [历史路线图](history/PHASES-2026-10-18.md)、[阶段一验收](STAGE-1.md) |

## 文档层次

- 根 README 负责介绍和快速开始；运行细节进入开发与配置文档。
- `PHASES.md` 记录当前阶段；`submission/README.md` 维护当前材料与人工待办。
- `history/`、日期审查报告和原始证据保留当轮事实；旧测试数字、旧截图和旧模型结果按各自版本解释。
- `.scratch/` 保存规格及逐项验收，不用说明文档代替任务状态。
- `submission/materials.json` 是固定交付包的材料清单；替换主材料时同时更新清单、索引和对应验证记录。

部署参考：[Windows Server 指引](DEPLOY-WINDOWS-SERVER.md)、[临时演示方案](DEPLOY-DEMO-QUICK.md)。两份方案均未在目标服务器实测，项目尚不能据此称为已部署到公网。
