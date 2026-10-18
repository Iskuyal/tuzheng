# 图证 · 让结论有据可查

把一张图表截图和一段配文放在一起，检查数字是否自洽、推断缺什么依据，以及适用公开来源是否支持这些说法。

图证面向没有原始数据文件的普通读者，也可用于内容编辑发布前核稿。模型读图和拆解主张，程序执行计算、检索及引用校验，用户逐项确认后再采用修改建议。

![图证当前首页](docs/evidence/evidence-room-indigo-2026-10-18/current/home-1440.png)

首页为静态示意，不是模型运行结果。当前界面采用暖纸色与靛蓝，覆盖首页、图内工作台、来源核验和模型设置四个页面。

## 快速开始

Windows 开发环境使用 Node.js 24、npm 与系统 Edge。

```powershell
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。API 默认监听 `127.0.0.1:3001`；端口被占用时明确报错。自定义端口、WebStorm、模型配置及验证方式见[开发与运行](docs/DEVELOPMENT.md)。

先试团队自制样例，预置图内观察不会调用模型。新图片主动点击读取、运行来源核验、提交补证或测试连接时才请求配置的上游服务。默认通过设置页保存本机配置；显式环境配置、协议与密钥边界见[模型配置](docs/MODEL-CONFIG.md)。

## 可以做什么

| 用户任务 | 路径与结果 |
| --- | --- |
| 只有截图，先核对数字 | `/audit`：模型提取 → 人工确认/更正 → 程序计算 → 图内结论、公式与证据摘录 |
| 一张图里有多条说法 | 主张独立确认、重算、会话记录和重置；缺少可复查依据时保留待核对 |
| 比较两张图或检查视觉呈现 | 核对时间、单位和范围，再比较数字；柱状图可查看纵轴风险与零起点对照 |
| 核对图表和配文的来源 | `/source-audit`：主张拆解、固定公开资料库检索、口径对照、引用与真实工具轨迹 |
| 修改一段配文 | 逐处查看建议、理由和引用，主动采用；输入改变后旧结论进入历史，需重新核验 |

截图内自洽不等于原始数据真实；来源核验只覆盖当前收录资料，检索命中也不自动成为适用证据。必要补证能力已实现，但是否发起追问取决于实际运行；本次新版视频中的缺口径案例保留待核对，没有触发追问或恢复调查。

## 演示与提交材料

| 材料 | 当前入口 |
| --- | --- |
| 新版实机视频 | [6 分 38 秒无声 MP4](docs/submission/tuzheng-competition-demo-2026-10-18-silent.mp4)，1080p / 30 fps；等待用户后期配音 |
| 配音 | [九段时间轴与完整讲稿](docs/submission/demo-2026-10-18/voiceover.md)、[章节 SRT](docs/submission/demo-2026-10-18/chapters.srt) |
| 赛事技术文档 | [17 页 PDF](docs/submission/web-match-competition-report.pdf)、[HTML 源](docs/submission/competition-report.html)，已补充当前交付状态 |
| 当前材料和人工待办 | [提交材料索引](docs/submission/README.md)、[交付包与第二环境回执](docs/submission/closeout/README.md) |

2026-10-18 实录使用当前生产页面和 DeepSeek 官方真实请求：7 次模型 HTTP，用量完整。它是产品路径演示；模型效果评测、CI、人工验收和真实读者收益分别记录，见[证据索引](docs/evidence/README.md)。

普通话配音、最终人工走查、真实团队信息、评审访问、第二台 Windows 回执及赛事提交仍待完成。2026-10-18 只读核对 [GitHub 仓库](https://github.com/Iskuyal/tuzheng)为 PRIVATE，评审账号实际访问尚无本轮证明。

## 开发与检查

前端为 Vue 3 / Vue Router / Vite / TypeScript，Node + Express 负责模型适配与核验，`shared/` 保存领域类型和确定性规则。本机 API 仅监听回环地址；不需要数据库进程或本地 GPU。

```powershell
npm run docs:check
npm run verify:materials
npm test
npm run build
npm run test:e2e
```

以上为离线检查。配置矩阵、固定样例、受控在线评测和 CI 边界统一见[开发指南](docs/DEVELOPMENT.md)及[脚本导航](scripts/README.md)；付费评测另行授权，不能从日常验证命令中意外执行。

## 文档与团队

- [文档导航](docs/README.md)：按运行、结构、材料与证据查阅。
- [当前路线图](docs/PHASES.md)：阶段状态与最近实测；[历史记录](docs/history/PHASES-2026-10-18.md)保留旧轮次。
- [产品蓝图](PLAN.md)、[领域术语](CONTEXT.md)、[项目结构](docs/STRUCTURE.md)。

| 团队角色 | 工作范围 | 报名信息 |
| --- | --- | --- |
| 成员 A | 产品、样例、前端、交互和演示 | 姓名、学校/单位、联系方式待本人填写 |
| 成员 B | 模型适配、来源核验、共享规则和服务端 | 姓名、学校/单位、联系方式待本人填写 |

技术标识和仓库名为 `tuzheng`。旧材料文件名中的 `web-match` 为历史标识，保留路径供追溯。
