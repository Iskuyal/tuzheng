# 图证 · 项目阅读与真实演示映射

最初阅读以 Git `8a89374ada8a78ab8088c8fc9ccf09d05faebc07` 与现有未提交内容为起点，遍历 `web/`、`server/`、`shared/`、`scripts/`、`tests/`、`e2e/`、`config/` 的 102 份代码文件，并重点核对主用户路径。用户随后要求以项目实践替换重绘动画，现已直接录制实际产品页面和真实模型调用。

| 区域 | 项目职责 | 实录中的依据 |
| --- | --- | --- |
| `web/` | Vue 首页、审计工作台、来源核验、模型设置 | 本次使用实际生产构建，点击上传、读取、核验、工具轨迹和采用建议；没有重绘界面。 |
| `server/` | 本机 Express API、两类模型适配、受限工具与会话 | 请求直接经过实际适配器和调查驱动器，外层仅增加共享真实 HTTP 计数与脱敏落盘。 |
| `shared/` | 增长率、跨图口径、纵轴风险、来源适用性和修改建议 | 不符合类型的读图输出被实际校验拒绝；来源数值、缺口和建议由现有领域代码处理。 |
| `scripts/` | 评测、候选冻结、实际请求账本与读者研究 | 复用 `HttpBudget` 的请求预占、兼容调用计数、unknown usage 与失败停止；本次不是三臂评分。 |
| `tests/`、`e2e/` | 单元/API 与 320 / 390 / 1280px 浏览器检查 | 既有替身测试独立于当次实录；没有将测试里的响应用于视频。 |
| `config/`、`.github/` | 分层 TypeScript、Vite、测试与 Windows 离线 CI | 产品仍沿用现有构建和运行方式；单独录制进程监听回环 7109，临时请求计数不改变正常 API 端口。 |
| `samples/`、`web/public/samples/` | 自制输入图、独立期望与冻结预留包 | 上传真实 PNG 文件，自制输入身份在页面保留；原冻结输入和锁文件指纹未改。 |
| `.scratch/`、`docs/` | 规格、任务依赖、ADR、证据与提交材料 | 历史结果、当前实录和正式赛事的人工条件分别保留。 |

产品与术语依据：[PLAN](../../../PLAN.md)、[路线图](../../PHASES.md)、[CONTEXT](../../../CONTEXT.md)、[结构](../../STRUCTURE.md)、[工作约定](../../../AGENTS.md)。

本次直接运行的主路径是 [AuditPage](../../../web/pages/AuditPage.vue) → [视觉适配](../../../server/openai-vision.ts) → 实际格式校验失败；随后 [SourceAuditPage](../../../web/pages/SourceAuditPage.vue) → [调查驱动器](../../../server/source-investigation.ts) → [固定资料](../../../shared/source-library.ts) 与 [程序核对](../../../shared/source-audit.ts) → 来源结论、建议采用与历史失效。

4 次模型 HTTP 及其原始响应、实际 API 输出、操作时间轴和源码指纹见 [本次证据](../../evidence/product-live-demo-2026-10-13/)。剪辑只加速实际等待，保留读取失败与重复主张；完整原录屏可逐段核对。视频不展示未经负责人审核的增益、虚构用户数据、模型内部路由或“所有路径可靠”的结论。
