# 01：审查证据链并整理根目录

Status: in-progress
Blocked by: 无

- [x] 固定审查点并核对远端 PR、Issue、最新 CI。
- [x] 按规范与规格两轴审查，确认缺陷先重现再修复。
- [x] 配置集中到 `config/`，赛事资料归档到 `docs/competition/`，生成产物归入缓存。
- [x] 同步 npm、TypeScript、CI 与文档路径。
- [x] 本地完整验证：行为/API、构建、三视口、固定样例、图片同源与文档链接。
- [ ] 技术 PDF 重建与视觉检查。
- [ ] 提交、推送、GitHub PR 与远端 CI 验证。
- [ ] 工作结束后执行用户要求的关机命令。

## Comments

审查与证据边界见 [维护报告](../../../docs/reviews/2026-10-01-project-review.md)。新增回归先得到 9 项失败、原 338 项保持通过；修复及扩充后当前为 353/353。
