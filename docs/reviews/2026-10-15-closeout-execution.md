# 收尾执行与固定版本接管

日期：2026-10-15。用户授权按收尾清单执行 agent 可做事项。本轮围绕“固定源码与材料 → 交给另一台 Windows 验收”推进，不新增产品能力或模型调用，不改变仓库可见性。

## 已执行

1. **远端同步与 CI：**已将 `0333fc1f80eb5557868785353b8bb88341ec5760` 推送到 `main`，对应 [CI 38753101211](https://github.com/Iskuyal/tuzheng/actions/runs/38753101211) 为 `completed/success`。CI 行为测试 445/445、录屏预算 6/6、固定样例 23/23、浏览器 122 通过/1 跳过。SVG 栅格信号为 **0/18**，工作流原有 `continue-on-error` 容忍该环境差异；不能写成 CI 所有检查通过。本机既有同源 18/18 与 CI 分开记录。
2. **可执行 Windows 接管：**新增 `docs/submission/closeout/verify-windows.mjs`，依次执行现有九组离线命令。端口占用先拒绝，不复用未知实例；失败即停，逐步保存退出码和本机日志。已在当前机器实跑九组通过；报告明确为 `local-rehearsal`，工作区包含本轮新增文件，不能当成第二环境回执。原始结构化结果见[本机演练](../evidence/closeout-execution-2026-10-15/local-windows-rehearsal.json)。
3. **交付包工具：**新增 `prepare-package.mjs`，要求干净 HEAD，使用 `git archive` 导出完整已提交文件；单列材料从同一 SHA 读取，生成新候选锁与逐文件 SHA-256。拒绝脏工作区和覆盖已有目录；准备后自动检查材料字节、源提交和锁。产物只在 `.cache/closeout-packages/<SHA>/`，提交后生成/验证，实际包路径以本次交付报告为准。
4. **未知请求核账交接：**提取第 13 个 HTTP 的北京时间、模型、序号、请求体指纹与已知前序用量，写成[核账交接](../submission/closeout/accounting-handoff.md)。未登录账户、未重发请求，送达/完成/费用继续 unknown。
5. **人工回执：**提供[独立回执模板](../submission/closeout/acceptance-receipt.json)，覆盖第二机器身份与操作、团队、评审访问、正式视频、核账、负责人抽查及赛事提交。字段全部 pending/null；没有代填姓名或签字。
6. **PDF 只读 QA：**赛事版原件 16 页已逐页渲染并用四张联系表检查，未见明显裁切、重叠或空白页；21 个链接注解均为 HTTPS，没有本机 file 链接。正文仍保留原代码参考 `00a6268` 和注明日期的历史数字；本轮不重建或提高能力声明。见[原件哈希与检查](../evidence/closeout-execution-2026-10-15/pdf-review.json)。
7. **官网重新核对：**普通网页读取失败后，使用系统 Edge 读取公开[赛道页面](https://www.boxuegu.com/matchTrack/detail/?id=10037)，HTTP 200。当前仍要求 5—8 分钟、1080p MP4、PDF 至多 30 页、可供评审访问的仓库及完整 Git 历史；省赛/国赛作品日期仍为 2026-11-18 / 2026-12-27。页面要求环境变量配置密钥，已有显式 env 实现与离线验收可复用；本轮没有部署证明。见[读取元数据](../evidence/closeout-execution-2026-10-15/rules-recheck.json)，最终提交前仍需看官网通知与登录入口。
8. **有限历史扫描：**对 `0333fc1` 可达的 121 个提交、1,022 个唯一 blob 中 911 个文本 blob，扫描私钥块和几类提供方/GitHub/AWS 密钥格式，0 组命中；只导出数量与范围，未打印匹配值。此项不覆盖所有密钥形式、私人内容、忽略配置或悬空对象，不是全面安全审计或公开许可。见[扫描记录](../evidence/closeout-execution-2026-10-15/history-pattern-scan.json)。

新脚本位于提交材料目录，不改变 npm 入口、TypeScript 引用、CI 产物路径或默认/自定义端口。配置矩阵已通过本轮 Windows 工具的实际执行。新包生成后的 SHA/哈希以包内 manifest 为准，后续改动须生成新包，不覆盖旧包。

## 仍保留的人工门槛

- 账户负责人核对第 13 次请求；核清前不启动新收费批次。
- 负责人决定公开或授予评审访问，并实际用未登录/评审账号检查；本轮仍 PRIVATE。
- 团队真实信息、第二台 Windows 回执、正式 5—8 分钟视频和逐条走查。
- 正式独立评测的逐题负责人抽查，以及真实读者研究（若作相应增益或收益声明）。
- 最终材料版本确认、赛事登录/上传和平台回执；阶段五 04/05 不提前完成。

接管者从[固定交付入口](../submission/closeout/README.md)开始，完整优先级见[项目收尾清单](../submission/closeout-2026-10-15.md)。
