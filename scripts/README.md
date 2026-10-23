# 脚本导航

在仓库根目录运行 `package.json` 中的 npm 命令。下表列出各类工具的用途和使用范围，参数以脚本及对应的执行说明为准。

| 类别 | npm 入口 | 说明 |
| --- | --- | --- |
| 启动与端口 | `dev`、`dev:ports` | 前后端启动前检查固定端口，实际配置见[开发指南](../docs/DEVELOPMENT.md) |
| 构建与测试 | `build`、`typecheck`、`test`、`test:e2e`、`test:recording` | 行为、API、替身浏览器及录制预算恢复检查，0 次真实模型调用 |
| 文档与材料 | `docs:check`、`verify:materials` | 本地链接、材料与视频指纹；可收录团队资料及指定 SHA 的匿名访问证据，不联网或代签其他人工条件 |
| 配置与界面 | `verify:model-config`、`verify:ui` | 临时配置/假密钥、端口矩阵和替身界面；模型请求为 0 |
| 样例 | `eval:samples`、`verify:sample-renders` | 规则固定评测与 SVG/PNG 同源核对；栅格哈希受字体环境影响 |
| 冻结与离线三臂 | `eval:preflight`、`eval:holdout` | 候选锁、冻结包或替身机制，不能作为模型成绩 |
| 真实模型评测 | `eval:source-audit`、`eval:demo:http`、`eval:holdout:http` | 另行授权、预算和账本后执行；`eval:source-audit -- --check-only` 与 replay 为零调用分支 |
| 读者试用 | `study:readers` | 空白任务包与记录统计；没有原始真实答复时不产生用户收益结论 |

`holdout-evaluation.ts`、`holdout-http.ts`、`holdout-fixtures.ts`、`source-audit-recording.ts` 是相关入口共用的执行、计数和记录实现。固定交付脚本放在 [docs/submission/closeout/](../docs/submission/closeout/README.md)，视频原始工程随对应日期材料保留。

新增当前交付文件时编辑 [materials.json](../docs/submission/materials.json) 并运行 `npm run verify:materials`。改脚本或目录时同步 npm 入口、TypeScript 覆盖与 CI；当前配置已覆盖 `scripts/**/*.ts`，产物路径见[结构说明](../docs/STRUCTURE.md)。
