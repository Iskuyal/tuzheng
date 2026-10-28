# 当前提交材料与收尾事项

更新：2026-10-28。用户已提供有声演示视频，并确认第二台 Windows 已由另一位开发者验收，见[本次交付更新](closeout/delivery-update-2026-10-28.json)。当前材料由 [materials.json](materials.json)选择；团队和访问证明见[非视频记录](closeout/non-video-record-2026-10-23.json)，报名确认及停止核账的决定见[此前进度](closeout/progress-2026-10-23.json)。历史记录和空白人工回执模板保留。

## 当前材料

| 材料 | 入口 | 状态 |
| --- | --- | --- |
| 项目说明与运行 | [README](../../README.md)、[开发指南](../DEVELOPMENT.md) | 已写入岭南凤翔团队、梁钦健/梁智量、岭南职业技术学院（清远校区）和 C组；个人电话邮箱未提供 |
| 赛事技术报告 | [PDF](web-match-competition-report.pdf)、[HTML 源](competition-report.html) | 17 页，2026-10-28 更新有声视频和第二环境确认；历史模型结论按原轮次解释 |
| 当前有声演示视频 | [MP4](tuzheng-competition-demo-2026-10-28.mp4)、[技术检查](../evidence/final-video-2026-10-28/README.md) | 398.233 秒、1920×1080/30 fps、一条 AAC 音轨，完整解码通过；画面与原母版一致，用户已完整看听并确认可作为提交版，确认绑定文件哈希 |
| 配音资料 | [九段时间轴与完整讲稿](demo-2026-10-18/voiceover.md)、[章节 SRT](demo-2026-10-18/chapters.srt) | 已按最终成片对齐 |
| 实录工程与证明 | [工程及原片](demo-2026-10-18/README.md)、[视频检查](../evidence/formal-demo-2026-10-18/video-verification.json) | 当次官方模型 7 次实际 HTTP；当前图文路径演示，非独立评测 |
| 版本交付与人工回执 | [固定交付工具](closeout/README.md)、[非视频接管](closeout/non-video-handoff.md)、[空白回执](closeout/acceptance-receipt.json) | 基线固定包已重新验证；新提交的包以其 manifest 为准，模板不是人工验收结果 |
| 代码访问 | [GitHub 仓库](https://github.com/Iskuyal/tuzheng)、[匿名访问证据](../evidence/non-video-closeout-2026-10-23/anonymous-access.json) | 用户授权后已设为 PUBLIC；当时远端 `4d37f74` 的仓库、README、PDF、无声视频和运行说明匿名访问通过 |
| 报名、缴费与联系人 | [用户确认记录](closeout/progress-2026-10-23.json) | 用户确认“已报名缴费，联系人已核对”；未读取赛事个人中心，尚无作品提交回执 |
| 第二台 Windows | [用户确认记录](closeout/delivery-update-2026-10-28.json) | 用户确认另一位开发者已验收；原机器报告、环境与测试版本未提供，不代填，也不要求重复验收 |
| 旧网关第 13 次请求 | [处理决定与代查记录](closeout/accounting-handoff.md) | 按用户决定停止核账，不发送查询邮件；历史用量和费用仍未知，已移出当前待办 |
| 赛事规则 | [2026-10-23 官网核对](../competition/official-rules-verification-2026-10-23.md) | 省赛截止 2026-11-18；提交入口在缴费后的个人中心；账号内具体限制仍待负责人核对 |

有声文件的视频流与原母版相同。口径不明案例仍为待核对，没有触发追问或执行 resume；格式恢复只演示到输入合法图片。旧脚本中的预期动作不能算作本片已演示的内容。普通话讲解、音画对应、混音及最终走查的完成依据是用户明确回复“已完整检查，可作为提交版”；技术工具未转录或听审，旧 13 项表没有收到逐项回执，不伪造勾选记录。

## 仓库侧预检

```powershell
npm run docs:check
npm run verify:materials
node docs/submission/build-report.mjs --competition --check
```

材料预检会检查文件、PDF 文件头及所选视频的路径、大小、SHA-256 与音轨状态是否匹配归档证明。团队资料、指定 SHA 的公开访问证明和第二环境用户确认分别写入交付包，保留各自证据范围。预检不会重新联网、解码、听审或代签回执。

PDF 重建使用 `node docs/submission/build-report.mjs --competition`；无声视频重新导出见[录制工程](demo-2026-10-18/README.md)，复用现有原片无需模型请求。已完成的实录批次不会重复发起付费调用。

工作区提交后才能[生成固定提交的交付包](closeout/README.md)。提交前的预检只说明当时工作区通过了检查，尚未生成固定版本包；旧 SHA 的 CI 和候选锁也不能用于证明新提交通过。

## 尚未完成的人工事项

| 事项 | 当前状态 | 下一步与完成依据 |
| --- | --- | --- |
| 最终候选、负责人抽查及材料冻结 | 固定包可生成并验证，12 题尚未签字 | 负责人核对绑定候选的逐题材料并填写真实意见；最终视频和其他回执齐备后再冻结材料，历史锁继续保留 |
| 赛事提交 | 尚未提交作品 | 核对账号内上传形式、大小或链接限制，提交最终材料并留存平台回执 |

正式三臂盲审和真实读者收益声明分别需要完整评测及[真实读者记录](reader-study/README.md)。没有这些证据时，按已有能力与演示范围准备作品；实验的失败、阻塞与未知用量继续保留。

第二环境此前缺少环境的状态已由 2026-10-28 用户确认更新；原始报告未提供，不写成 agent 实测。视频已获用户最终确认，新增有声文件交付后需核对其最终地址。此前检查保留在[2026-10-23 收尾报告](../reviews/2026-10-23-non-video-closeout.md)，本次视频与确认范围见[追加记录](../evidence/final-video-2026-10-28/README.md)。

## 历史材料

| 归档 | 用途 |
| --- | --- |
| [2026-10-18 无声母版](tuzheng-competition-demo-2026-10-18-silent.mp4) | 原始画面和配音工程参考；当前主材料为上方有声文件，旧哈希保留 |
| [2026-10-16 正式实录 v2](formal-demo/README.md) | 旧界面的 7 分 29 秒画面版、旧讲稿与当次 15 次模型请求 |
| [2026-10-13 90 秒实录](code-demo/README.md) | 历史短片，不满足正式 5–8 分钟时长 |
| [旧演示方案](demo-video-script.md) | 冻结题与录制备选，不是新版成片时间轴 |
| [开发技术报告](web-match-technical-report.pdf) | 开发过程归档，当前赛事阅读版使用上方独立 PDF |
| [2026-10-15 收尾记录](closeout-2026-10-15.md)、[2026-10-07 接管记录](final-handoff-2026-10-07.md) | 保留原基线、失败与当时待办，当前选择以本页为准 |

原件和现有分享路径继续保留，通过索引区分各批归档材料，旧批次指纹不变。

文字修订和 PDF 检查记录见[本轮修订报告](../reviews/2026-10-23-document-language.md)。
