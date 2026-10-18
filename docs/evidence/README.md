# 验证证据索引

按记录的版本、输入、执行方式和分母解释结果。截图与 HTTP 200 不能单独证明任务通过；本地测试和 CI 不代替负责人、设备或真实读者验收。

| 要核对什么 | 入口 | 可证明的范围 |
| --- | --- | --- |
| 结构与材料收尾 | [整理报告](../reviews/2026-10-18-structure-closeout.md)、[文档/PDF 检查](structure-closeout-2026-10-18/document-verification.json)、[打包机制检查](structure-closeout-2026-10-18/package-verification.json) | 当前文档、材料指纹、离线回归及独立临时仓库打包；不构成固定提交包或人工验收 |
| 最新实录是否为当前网页操作 | [2026-10-18 视频证明](formal-demo-2026-10-18/video-verification.json)、[录制说明](../submission/demo-2026-10-18/README.md) | 本次 1080p 无声画面、原片映射、实际播放和动作；配音/最终人工走查待完成 |
| 最新官方调用与用量 | [请求核对](formal-demo-2026-10-18/accounting-verification.json)、[汇总](formal-demo-2026-10-18/summary.json) | 7 次实际 HTTP 与已知用量；是演示，不是盲审或稳定性结论 |
| 当前 UI 和离线回归 | [主线交付报告](../reviews/2026-10-18-main-delivery.md)、[靛蓝主题报告](../reviews/2026-10-18-evidence-room-indigo.md) | 对应版本的本地/API/替身浏览器、配色及配置端口检查 |
| 本机文件与环境配置 | [配置矩阵验收](model-config-env-2026-10-02.md) | 临时目录、假密钥、file/env 与默认/自定义端口；不是付费模型验证 |
| 来源核验及历史失败分母 | [可靠性整理](../reviews/2026-10-02-source-audit-reliability.md) | 历史原始记录、失败、阻塞和 replay 重统计；不升级为当前修复在线效果 |
| 冻结输入与正式执行方式 | [受控评测说明](../evaluations/candidate-runbook.md)、[三臂计划](../evaluations/) | 输入冻结、预算、逐请求账本与负责人抽查条件；准备不等于已执行 |
| 中断探索和旧网关未知请求 | [核账交接](../submission/closeout/accounting-handoff.md)、[原收尾核对](../submission/closeout-2026-10-15.md) | 12 次确认执行与第 13 次送达/用量未知分别保留；不按零费用处理 |

日期目录里的 `before`、`review-*`、`current` 是同一工作项的不同轮次，不相加成独立用户试验。模型替身、团队自制图片和静态首页示例在说明中明确区分。独立审阅、产品路径演示、正式评测和人工签字分别保留各自状态。

整理新材料时增加日期报告及本索引链接，保留原始 JSON/JSONL、失败运行、指纹和停止原因。当前进度在[路线图](../PHASES.md)，最终提交待办在[材料清单](../submission/README.md)。
