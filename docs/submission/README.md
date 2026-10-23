# 当前提交材料与收尾事项

更新：2026-10-23。按用户安排，视频稍后制作，本轮先整理其他材料并完成可执行的检查。脚本使用的材料清单是 [materials.json](materials.json)，已提供的团队信息和访问证据见[非视频记录](closeout/non-video-record-2026-10-23.json)。原始人工回执模板继续保留。

## 当前材料

| 材料 | 入口 | 状态 |
| --- | --- | --- |
| 项目说明与运行 | [README](../../README.md)、[开发指南](../DEVELOPMENT.md) | 已写入岭南凤翔团队、梁钦健/梁智量、岭南职业技术学院（清远校区）和 C组；个人电话邮箱未提供 |
| 赛事技术报告 | [PDF](web-match-competition-report.pdf)、[HTML 源](competition-report.html) | 17 页，2026-10-23 补入团队及公开访问状态；历史模型结论按原轮次解释 |
| 正式视频画面母版 | [新版 MP4](tuzheng-competition-demo-2026-10-18-silent.mp4) | 398.233 秒、1920×1080/30 fps，无音轨；等待用户普通话配音和最终走查 |
| 配音资料 | [九段时间轴与完整讲稿](demo-2026-10-18/voiceover.md)、[章节 SRT](demo-2026-10-18/chapters.srt) | 已按最终成片对齐 |
| 实录工程与证明 | [工程及原片](demo-2026-10-18/README.md)、[视频检查](../evidence/formal-demo-2026-10-18/video-verification.json) | 当次官方模型 7 次实际 HTTP；当前图文路径演示，非独立评测 |
| 版本交付与人工回执 | [固定交付工具](closeout/README.md)、[非视频接管](closeout/non-video-handoff.md)、[空白回执](closeout/acceptance-receipt.json) | 基线固定包已重新验证；新提交的包以其 manifest 为准，模板不是人工验收结果 |
| 代码访问 | [GitHub 仓库](https://github.com/Iskuyal/tuzheng)、[匿名访问证据](../evidence/non-video-closeout-2026-10-23/anonymous-access.json) | 用户授权后已设为 PUBLIC；当时远端 `4d37f74` 的仓库、README、PDF、无声视频和运行说明匿名访问通过 |
| 赛事规则 | [2026-10-23 官网核对](../competition/official-rules-verification-2026-10-23.md) | 省赛截止 2026-11-18；提交入口在缴费后的个人中心；账号内具体限制仍待负责人核对 |

视频中的口径不明案例仍为待核对，没有触发追问或执行 resume。格式恢复只演示到输入合法图片。配音使用本次讲稿；旧录制脚本中的预期动作，不能算作本片已演示的内容。

## 仓库侧预检

```powershell
npm run docs:check
npm run verify:materials
node docs/submission/build-report.mjs --competition --check
```

材料预检会检查文件是否存在、PDF 文件头是否正确，以及无声视频的路径、大小和 SHA-256 是否与归档记录一致。清单指定非视频记录时，还会核对匿名访问证明，将团队资料已提供、指定 SHA 的公开访问已验证这两项状态写入交付包。其他人工条件另行保留；预检不会重新联网、解码或签署回执。

PDF 重建使用 `node docs/submission/build-report.mjs --competition`；无声视频重新导出见[录制工程](demo-2026-10-18/README.md)，复用现有原片无需模型请求。已完成的实录批次不会重复发起付费调用。

工作区提交后才能[生成固定提交的交付包](closeout/README.md)。提交前的预检只说明当时工作区通过了检查，尚未生成固定版本包；旧 SHA 的 CI 和候选锁也不能用于证明新提交通过。

## 尚未完成的人工事项

| 事项 | 完成依据 |
| --- | --- |
| 普通话配音、混音和最终视频走查 | 最终有声 MP4、13 项人工走查及该文件哈希；无声母版不替代此项 |
| 赛事报名与公开联系方式核对 | 团队名称、姓名、学校、C组已由用户提供并写入 README/PDF；个人中心实际报名及需向赛事提供的联系信息仍由本人核对。仓库 Issues 仅作项目反馈入口 |
| 第二台 Windows | 另一台机器的环境、安装/运行输出、四页操作和操作者回执；本机演练不代签 |
| 第 13 次旧网关请求核账 | 用户回复暂无结果；提供方记录与[原账本](closeout/accounting-handoff.md)对照。未知用量/费用及未提供的处理决定继续保留 |
| 最终候选、负责人抽查及材料冻结 | 新提交 SHA、新候选锁、对应材料哈希和逐题确认；历史锁继续保留 |
| 赛事提交 | 核对当期入口和要求，提交最终材料并留存平台回执 |

正式三臂盲审和真实读者收益声明分别需要完整评测及[真实读者记录](reader-study/README.md)。没有这些证据时，按已有能力与演示范围准备作品；实验的失败、阻塞与未知用量继续保留。

用户确认目前无第二台 Windows 可连接环境，本机演练及远端 Windows CI 均不代替该机器的人工回执。公开访问证据绑定当时远端 SHA；后续提交完成交付后需重新确认最终材料地址。本轮检查与未完成条件详见[收尾报告](../reviews/2026-10-23-non-video-closeout.md)。

## 历史材料

| 归档 | 用途 |
| --- | --- |
| [2026-10-16 正式实录 v2](formal-demo/README.md) | 旧界面的 7 分 29 秒画面版、旧讲稿与当次 15 次模型请求 |
| [2026-10-13 90 秒实录](code-demo/README.md) | 历史短片，不满足正式 5–8 分钟时长 |
| [旧演示方案](demo-video-script.md) | 冻结题与录制备选，不是新版成片时间轴 |
| [开发技术报告](web-match-technical-report.pdf) | 开发过程归档，当前赛事阅读版使用上方独立 PDF |
| [2026-10-15 收尾记录](closeout-2026-10-15.md)、[2026-10-07 接管记录](final-handoff-2026-10-07.md) | 保留原基线、失败与当时待办，当前选择以本页为准 |

原件和现有分享路径继续保留，通过索引区分各批归档材料，旧批次指纹不变。

文字修订和 PDF 检查记录见[本轮修订报告](../reviews/2026-10-23-document-language.md)。
