# 图证 · 真实项目实录

本版本按用户要求替换了重绘界面和脚本化动画。画面直接来自当前项目的 Vue 生产构建与 Express API；Playwright 只操作真实页面，不拦截或伪造 API 响应。输入为仓库里的团队自制 PNG，模型响应来自当次真实云请求。

成片：[90 秒 MP4](../tuzheng-product-demo-90s.mp4)。审阅原件：[完整原始录屏](../tuzheng-product-demo-uncut.webm)。90 秒版只压缩两段真实等待，画面标出原等待时长与加速倍数；保留实际操作、读取失败、来源结果、工具轨迹、建议采用与历史失效。字幕与程序配乐用于讲解，页面和结果未经重绘。

原生录屏尺寸为 1280×720；成片经统一放大后编码为 1920×1080、30 fps。当前实录授权已结束，录制进程已关闭；后续现场录制需要新的授权和独立证据目录，不能覆盖本次记录。

## 本次实际结果

日期：2026-10-13。用户在本聊天明确允许最多 12 次实际模型 HTTP 请求，金额上限与费率未给出。实际使用 4 次，输入 14,271、输出 10,730 tokens，金额与费率保持未知。

- 图表读取：模型服务 HTTP 200，但 `claimedGrowthPercent` 返回了字符串 `40%`，不符合产品要求的数值类型；真实 API 拒绝结果，画面保留失败提示。
- 来源核验：3 次实际模型 HTTP 请求，执行 2 次检索和 2 次比较，汇总不计入工具预算。配文与所引发布环比 0.2% 不一致，差 0.6 个百分点；模型给出的两条图内主张均缺比较方式，程序保持待核对，重复主张也未在录屏中隐藏。
- 实际采用建议：配文改为「比上月上涨 0.2%」，旧结果进入历史，页面提示重新核验；本次未再调用模型核验改后的配文。

原始 HTTP、实际产品 API、操作时间轴、输入指纹和授权记录在 [product-live-demo-2026-10-13](../../evidence/product-live-demo-2026-10-13/)。本次是两条产品路径的实际演示，不能据此宣布模型可靠性、独立题集增益、真实用户收益或正式赛事验收。

## 复现与导出

在仓库根目录使用现有 Node/npm、Python Playwright、系统 Edge、FFmpeg 与 ffprobe。按 `npm ci` 安装依赖，冻结锁文件保持原样。

```powershell
# 已提交的录屏可直接离线导出，无需构建产品或开启录制服务
node docs/submission/code-demo/render.mjs --render
node docs/submission/code-demo/render.mjs --verify
node docs/submission/code-demo/render.mjs --serve
```

新录制还需要 Python Playwright。以下为录制流程说明；本次固定证据目录的授权已经完成，服务会拒绝重新开启。另行录制前须取得新的真实调用授权并使用独立目录。

```powershell
# 先构建实际产品
npm run build

# 仅在另行取得真实调用授权后启动录制专用进程
# 上限跨进程重启接续，不因重录清零；未知完成或 usage 会阻止继续
node --import tsx docs/submission/code-demo/capture-server.mjs --execute

# 第二个终端操作实际产品并录屏；不会使用 page.route 或替身回复
python -X utf8 docs/submission/code-demo/record.py
```

`capture-server.mjs` 复用现有视觉适配器、调查驱动器和 `HttpBudget`。注入的 requester 只做真实 HTTP 计数、日志与 SDK 输出文本提取，响应内容直接来自配置服务；仅开启本次授权的读图与来源路径，连接测试不在本次范围。服务监听 `127.0.0.1:7109`。记录保存到上述证据目录，密钥只用于请求头，不出现在日志与视频。

`output/` 是忽略的工作产物，包括原录屏、字幕、配乐、编辑计划和验证帧。最终 MP4 与原始 WebM 另存到提交材料目录并纳入提交。旧示意版本仅保留在忽略的本机备份中。

正式 5—8 分钟赛事讲解与团队验收仍按 [原任务](../../../.scratch/stage-5-stability-submission/issues/05-final-acceptance-handoff.md)执行。
