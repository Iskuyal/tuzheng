# 阶段三第一个任务交接提示词

复制下面整段到以 `F:\VibeCoding\web-match` 为工作目录的会话。阶段三任务 02 起按 `Blocked by` 顺序执行，一次一个。

```text
[$implement](C:\Users\dusta\.agents\skills\implement\SKILL.md)

请在 F:\VibeCoding\web-match 从最新的 main 拉一个阶段三分支，只实现 .scratch/stage-3-cross-image-and-axis/issues/ 中首个无阻塞任务。开始前先记录当前 HEAD 作为代码审查的固定对照点，检查工作区，并阅读 AGENTS.md、CONTEXT.md、PLAN.md、docs/PHASES.md、docs/STAGE-1.md、.scratch/stage-3-cross-image-and-axis/spec.md 与对应任务文件。

阶段三的边界：只做两图比较与柱状图纵轴对照，图文核稿、真实来源核验、CSV、RAG 与导出都不做。跨图结论只允许「数值一致」「数值冲突」「待核对」三类，口径四要素（指标、时间、单位、范围／人群）任一不清楚就必须停在「待核对」，不得判定冲突；纵轴只允许「可能误读」「从零起点差异不大」「待核对」，不判断作者动机。判定一律用两侧**已确认**的读数，走阶段一二那套确定性规则，不读草稿值。预置样例与视觉模型只提供原文字段与坐标轴读数，不提供任何判定结果。

已知现状：任务 01 已完成——`claims[]` 有 `metric`／`scope`，`ChartObservation` 有可空 `axis`，仓库里有 11 张团队自制样例（`web/public/samples/`，SVG 供展示、同名 PNG 供上传与模型读取；新增样例可用 `node samples/make-chart.mjs` 生成后 `node samples/render-chart-png.mjs <名字>` 出图），`samples/expectations.json` 里已有 `crossImage.pairs` 与 `axis` 的预期结果。

写测试的边界沿用现有约定：纯判定规则与结构校验用 vitest，浏览器端到端用 `npm run test:e2e`（Playwright + 系统自带 Edge，三个视口，不依赖 API Key）。运行相关测试、完整 `npm test`、`npm run test:e2e` 与 `npm run build`；用固定对照点审查本次改动。只有任务验收项实际通过后才更新任务状态与路线图，并以中文提交说明在当前分支创建本地提交。最后用中文报告提交内容、测试结果、尚未验证项及下一条任务的阻塞状态。
```
