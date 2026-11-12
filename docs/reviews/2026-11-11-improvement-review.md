# 预参赛 81 分后的网站验收与提升空间

日期：2026-11-11。基线：远端 `53aaf82`（本地已快进到同一提交）。用户转述预参赛 **81 分**与评委评语「配文主张 AI 新闻核查专业；建议增加核查结果分享功能」。评语已由 `15ef350`—`dbc2561` 四个提交落实为「文字／图片两档分享」。本轮以只读验收与改进盘点为主，顺带修掉两处低风险的首屏缺陷（第 3 节「已修」），其余为建议，没有改动核验口径、后端与配置入口。

本轮性质：本机 `npm run dev` + 生产构建实测，模型调用 0 次；分数为转述、未取得评审原件，下文估分是本文判断，不是评委打分。

## 1. 实测结论（可复现）

| 检查 | 方法与命令 | 结果 |
| --- | --- | --- |
| 单元／API | `npm test` | 30 文件、479 项通过 |
| 浏览器回归 | `npx playwright test` | 155 通过、1 项既有跳过（窄屏导航用例在 1280px 下跳过），2.0 分钟 |
| 生产构建 | `npm run build` | 通过；JS 合计约 100KB gzip，四路由分包（Landing 6.8KB / Settings 33.4KB / Source 66.3KB / Audit 73.6KB，入口 98.9KB） |
| 四路由与结果态 | msedge，1440/390/320 | 无横向溢出；截图见[证据目录](../evidence/improvement-review-2026-11-11/) |
| 分享入口 | 替身核验 → 「分享这次核验」 | 文字摘要与 1080 宽长图均渲染正常，含来源原文 URL、未解决项与指纹 |
| 首屏标题 | 计算样式取样 | 修复前 `outline: solid 3px rgb(174,70,52)`，首次加载 `:focus-visible = true`：每页标题被红框框住；修复后 `outline-style: none`，焦点仍在 h1 |
| favicon | `GET /favicon.svg`、`dist/client/` | 修复前 `/favicon.ico` 404、首页控制台一条资源报错；修复后 200，构建产物含 `favicon.svg` |
| 开发服务稳定性 | `npm run dev` + 编辑 `web/index.html` | 遇到一次 `npm run dev` 整体退出（Vite 临时目录 `EBUSY`，见 1.4）；随后复测未复现 |

### 1.1 首屏红框（真实缺陷）

`web/router.ts` 在每次导航后把焦点交给 `main h1`（a11y 做法正确），而 `web/evidence-room.css:26` 的 `:is(button,a,input,textarea,summary,[tabindex]):focus-visible` 把 `[tabindex]` 也算作交互元素，于是标题吃到 3px 红描边。首次加载时浏览器把程序化聚焦判为 `focus-visible`，框出现；鼠标点过一次导航后不再出现。表现见[首页截图](../evidence/improvement-review-2026-11-11/home-1440-focus-ring.png)：首页框贴合文字宽度，[来源页](../evidence/improvement-review-2026-11-11/audit-input-1440.png)与[设置页](../evidence/improvement-review-2026-11-11/settings-1440.png)是整行宽度，看起来像排版错误——而这正是评委打开链接的第一屏。

### 1.2 材料工具漂移

`e2e/submission-screenshots.mjs`（技术报告与走查截图的生产脚本）在当前提交跑不通：它等 `.source-run-summary` 可见，但该节点已移入 `<details class="source-run-details">` 默认折叠（`web/pages/SourceAuditPage.vue:617`）。实测超时。PDF 里那批截图因此无法从当前 HEAD 复现，评审若按文档重跑会失败。

### 1.3 仓库体量与部署形态
`.git` 290MB、受版本控制文件约 268MB，其中 6 个视频／录屏单文件 30–40MB。`server/app.ts` 只提供 `/api/*`，不托管 `dist/client`，公网部署必须再叠 nginx + NSSM（[部署指引](../DEPLOY-WINDOWS-SERVER.md)），文档明确写着尚未部署到服务器。评审拿不到可点的演示地址，也拿不到「无需密钥即可看到结果」的路径。

### 1.4 开发服务在 Windows 上的一次退出

改动 `web/index.html` 后 `npm run dev` 整体退出，日志为 `EBUSY: resource busy or locked, watch 'web\.index.html.<pid>.<uuid>.tmpdir\index.html.tmp'`，Vite 的 watcher 在原子写入口 HTML 的临时目录上抛未处理错误，concurrently 随即向 API 进程发 SIGTERM。再改动同一文件未能复现，判断为 Windows 上 Vite 原子写与 watcher 的竞态，不是编辑内容本身导致。本机 Node 为 26.8.1，而 README 与环境要求写的是 Node 24；建议在 `package.json` 加 `"engines": {"node": ">=24 <25"}` 并在 Node 24 下复测，避免评审按 README 之外的版本运行时把偶发崩溃当成项目缺陷。

## 2. 对照官方评分表的位置（推断）

权重来自[赛道文档](../competition/AI-WEB网页开发挑战赛文档.md)省赛评分细则。右侧「缺口」是本轮实测或读码所见，不是评委原话。

| 维度 | 权重 | 估分 | 依据 | 主要缺口 |
| --- | --- | --- | --- | --- |
| 大模型集成 | 8% | 7 | 双协议适配（OpenAI Responses / Anthropic Messages）、zod 逐字段校验、超时与失败不降级结论 | 无流式；无模型降级链 |
| Agent／工作流 | 8% | 6.5 | 有界工具循环、6 次调用预算、补证恢复、停止原因可回放 | 轨迹是事后静态列表，不是实时过程 |
| RAG | 6% | 4 | 引用逐条校验、命中／未采用可展开、有／无检索对照脚本 | 语料仅 5 条、别名字面匹配，无切分／向量／重排，无召回指标 |
| 多模态 | 5% | 3.5 | 图像读图 → 结构化主张 → 图内计算 | 只有图＋文；无图表反解成数据表、无 PDF／语音 |
| AI 安全可控 | 4% | 3.8 | 无来源只降级、证据分级、建议不自动替换配文 | 已接近满分，缺越权／注入用例集公开 |
| MCP／工具 | 4% | 3 | 两协议均走 Function Calling，工具参数服务端再校验 | 无 MCP server，评审看不到 MCP 协议接入 |
| 选题创新 | 10% | 8.5 | 「图表截图＋配文」核查，面向没有原始数据的读者 | — |
| 技术方案创新 | 8% | 6.5 | 模型读图＋程序计算＋引用校验的分层 | 与通用「AI 事实核查」差异点未在界面显性化 |
| 交互创新 | 7% | 4.5 | 主张卡、跨图对照、纵轴对照、分享 | 无「点证据 → 原图落点高亮」的锚定回看 |
| 前端代码质量 | 4% | 3.5 | TS strict、479 项测试、无 `any` 泛滥 | 无 ESLint／Prettier；`AuditPage.vue` 2079 行 |
| 组件化与架构 | 3% | 2.5 | 页面级分包、6 个组件、`shared/` 领域层 | 大页面承接过多状态，组件只覆盖展示层 |
| 性能优化 | 3% | 2 | 路由分包、产物 gzip 约 100KB | 无懒加载图片、无性能预算与 Lighthouse 记录 |
| 场景真实性 | 5% | 4.5 | 目标用户、边界、样例策略都写清了 | — |
| 方案有效性 | 5% | 4.5 | 图内计算可复核，来源不足会停 | 缺真实读者收益数据 |
| UI 与视觉 | 4% | 3 | 暖纸＋靛蓝体系统一，四路由一致 | 首屏红框；正文辅助文字 12px 偏小 |
| 交互体验 | 3% | 2 | 状态、错误、键盘可达都有覆盖 | 结果页在手机端长 5600px，输入区重复堆在结果之后 |
| AI 交互体验 | 3% | 1.5 | 有「模型与运行统计」折叠区 | 无流式输出、无实时思考／工具可视化 |
| 社会价值 | 5% | 4.5 | 媒介素养、图表误读 | — |
| 商业潜力 | 5% | 3 | PLAN 提到编辑核稿，但产品内无落地形态 | 无批量核稿、无 API／嵌入、无定价或试点 |

合计约 81，与转述分数自洽。**性价比最高的四块是：AI 交互体验（3%）、RAG（6%）、MCP（4%）、在线演示加分项**——它们同时改善「评委能看见什么」。

## 3. 网站需要改进的地方（按优先级）

### 本轮已修（低频改动，实测通过）

| 项 | 改动 | 验证 |
| --- | --- | --- |
| 标题焦点环 | `web/evidence-room.css` 新增 `:is(h1,h2)[tabindex="-1"]:focus,:focus-visible{outline:none}`，`router.ts` 的焦点转移不动 | 四路由计算样式 `outline-style: none`、`:focus-visible` 仍为 true、焦点仍在 h1；[修复后首页](../evidence/improvement-review-2026-11-11/home-1440-after-fix.png)与[修复前](../evidence/improvement-review-2026-11-11/home-1440-focus-ring.png)对照 |
| favicon 与控制台报错 | 新增 `web/public/favicon.svg`（沿用页头标记），`web/index.html` 引用并把 `theme-color` 改为品牌靛蓝 `#2b3551` | `/favicon.svg` 200；四路由控制台 0 报错；`npm run build` 后 `dist/client/favicon.svg` 存在且被 `index.html` 引用 |
| 回归 | 未动核验口径、服务端与配置入口 | `npm test` 479 项通过；`npx playwright test` 155 通过、1 项既有跳过，与修复前一致 |

### P0 提交前应修（低风险、直接影响第一印象与可复现性）

1. ~~**标题焦点环**~~ 已修，见上表。
2. **favicon 与分享预览**：图标已补；`og:title`／`og:description`／`og:image` 与按路由更新 `document.title` 仍未做，等公开地址和分享配图定稿后再一次性加。
3. **辅助文字字号**：`12px` 提到 `13–14px`（`.room-intro p`、`.room-breadcrumb`、`.room-source p` 共 3 处变量即可），行高同步。
4. **手机结果页**：结果生成后把输入区收进「修改材料」折叠，页面从 5598px 降到一屏半；避免底部再出现一个「运行来源核验」。
5. **截图脚本**：`submission-screenshots.mjs` 改为先点开「查看模型与运行统计」再截图，或直接定位 `[data-testid="source-overview"]`；跑通后重生成 PDF 截图。
6. **仓库瘦身**：视频移出仓库（表单本来就要求网盘／公开播放页），仓库降到 50MB 以内；必要时给历史大文件做 `git filter-repo`，或至少停止继续新增。评审克隆速度直接影响「能不能跑起来」。
7. **Node 版本**：`package.json` 加 `engines` 声明 Node 24，并在 Node 24 下复测 1.4 的偶发退出。

### P1 一周内可做（直接对应评分表）

8. **流式 + 实时轨迹**（AI 交互 3% + Agent 8%）：服务端把每轮工具选择／结果以 SSE 推给前端，界面边跑边出「检索 → 命中 3 条 → 比较数值 → 汇总」；结束后仍保留可回放轨迹。改动集中，收益最大。
9. **无密钥也能看完**（实用 5% + 可复现）：内置一份真实模型回放（明确标注「回放，非本次调用」），评委不配 Key 也能走完整条路径；这也让分享出去的读者能看懂。
10. **公开演示地址**（可选加分项）：`server/app.ts` 加 `express.static(dist/client)` + SPA 回退，配 `MODEL_CONFIG_SOURCE=env` 与每日额度，一台小机器即可；比 nginx 手册少一半步骤。
11. **分享补两点**：长图内嵌原图缩略图（有图的证据更像证据）；摘要末尾加可跳回核验的链接／二维码（需要先有公开地址，与 9 一起做）。

### P2 赛后（打 RAG／MCP／多模态的硬分）

12. **RAG 换代**：语料从 5 条扩到 30–50 条（CPI、社零多期、术语页、发布说明），段落切分 + BM25 与向量混合检索 + 重排，引用精确到段落；界面展示「命中N条／采用1条／未采用原因」与召回指标，配合已有 `eval:source-audit` 输出有／无检索对照。
13. **MCP server**：把 `search_source_library`／`compare_values` 包成 stdio MCP server，README 给出客户端配置；成本低、辨识度高。
14. **图表反解**：柱状／折线的坐标轴刻度 → 数值表 → 与标题数字对照，把「多模态」从读字升级为读结构；顺带支持粘贴 PDF 单页。
15. **证据锚定**：主张卡点击 → 原图对应区域高亮 + 缩放动画，替代现在只给文字摘录。
16. **工程补强**：ESLint + Prettier + `lint` 进 CI；拆分 `AuditPage.vue`（观察值编辑、主张卡、跨图对照、记录列表各成组件）；补 Lighthouse 与首屏预算。

## 4. 边界

- 改进项已按 P0–P3 排成可执行计划（含工时、依赖、验收与回退）：[改进执行计划](../../.scratch/improvement-2026-11/map.md)。

- 81 分为用户转述，无评审原件；本文估分为作者判断，不作成绩或获奖推论。
- 本轮全部验证在同一台 Windows 本机：`npm test`、`npx playwright test`、`npm run build`、`vite preview` 与 msedge 截图；分享长图的真实下载、真机社交软件显示、读屏朗读未重测，沿用 11 月 11 日报告的只读结论。
- 未做真实模型调用、未做真实读者研究、未部署公网；第 8–11 项均为方案，不是已交付能力。
