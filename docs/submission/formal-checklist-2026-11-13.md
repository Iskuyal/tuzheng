# 图证正式省赛提交核对表

2026-11-13 只读核对。正式表单每队一次，截止 **2026-11-18 15:00:00（北京时间）**。字段与截止时间以[表单原文](../evidence/formal-prep-2026-11-11/submission-form.txt)和[官网原文](../evidence/formal-prep-2026-11-11/official-page.txt)为准；操作流程沿用[11月11日正式指南](formal-submit-guide-2026-11-11.md)。

本表只做一件事：把「仓库里能证明的」和「只能由提交人给的」分开，避免临场猜测或代填。

## 状态口径

| 状态 | 含义 |
| --- | --- |
| 已具备 | 值已在本仓库可核实，填表时照抄即可 |
| 待你提供 | 仓库内没有该值，只能由提交人本人给出，不猜、不代填 |
| 待提交 | 材料已在仓库备好并核验完毕，只差在表单里递交这一动作 |

## 一、表单七项

| 项 | 要求 | 仓库内可核实值 | 状态 | 证据路径 |
| --- | --- | --- | --- | --- |
| 1. 提交成员 uid | 提交作品的成员自己的实际赛事 UID | 仓库无此值；团队声明中 `uid` 为 `null` | 待你提供 | [团队声明](../evidence/submission-prep-2026-10-29/team-declaration.json) |
| 2. 团队名称 | 与报名信息一致 | 岭南凤翔团队（报名组别 C 组；成员 梁钦健、梁智量） | 已具备 | [根 README](../../README.md)、[团队声明](../evidence/submission-prep-2026-10-29/team-declaration.json) |
| 3. 学校 | 学校全称 | 岭南职业技术学院（清远校区） | 已具备 | [根 README](../../README.md)、[团队声明](../evidence/submission-prep-2026-10-29/team-declaration.json) |
| 4. 联系人手机号 | 提交人已核对的真实号码 | 仓库无此值；团队声明中 `phone` 为 `null`，该号码不进公开仓库 | 待你提供 | [团队声明](../evidence/submission-prep-2026-10-29/team-declaration.json) |
| 5. 完整作品文件链接 | 上传至百度、夸克、阿里云盘等主流网盘，填有效可访问链接，建议长期有效并附提取码 | 正式包生成脚本已就绪；网盘链接本身在仓库内不存在 | 待你提供 | [收尾入口](closeout/README.md)、[正式指南](formal-submit-guide-2026-11-11.md) |
| 6. 作品介绍文档 | 最多 1 个文件、单个 ≤100MB；须覆盖项目详情与使用方式、亮点、AI 测试技术落地、关键技术、项目图片、此前发表或获奖、基于其他项目的优化部分 | `tuzheng-project-introduction.pdf`：**4 页**，**1,047,105 字节**（约 1.00 MiB），`%PDF-1.4`，SHA-256 `85e0e6536c0e77dead1b3afecbeb81e915569905410ac4a6c3a8fdf0d87cb8b4`；单文件、体积远低于 100MB | 待提交 | [介绍 PDF](tuzheng-project-introduction.pdf)、[PDF 检查记录](../evidence/formal-prep-2026-11-11/pdf-check.json) |
| 7. 演示视频地址 | B 站、抖音等公开平台的可直接播放页面；视频材料不用百度网盘链接 | 成片 `tuzheng-competition-demo-2026-10-28.mp4`：**36,498,045 字节**，容器时长 **398.234 秒**（6 分 38.2 秒），**1920×1080**，含 1 条音轨，SHA-256 `5fdae469d8fde160b4111da76de8da8d1e3286062530e1fb67c057eb6ff91e09`；公开播放页在仓库内不存在 | 待你提供 | [视频](tuzheng-competition-demo-2026-10-28.mp4)、[技术检查](../evidence/final-video-2026-10-28/README.md) |

第 5 项与第 6 项的限制不同：100MB 只对应第 6 项单个附件，不是完整作品包的上限。两个页面都没有给出统一 ZIP 命名规则，包结构和命名属于团队整理方式。

## 二、附加要求

| 要求 | 官方出处 | 仓库内可核实值 | 状态 | 证据路径 |
| --- | --- | --- | --- | --- |
| Git 托管在 GitHub／Gitee，设为 Public 或向评审开放访问 | 官网「代码仓库·托管平台」 | `origin` 为 `https://github.com/Iskuyal/tuzheng.git`；`gh repo view` 返回 `visibility=PUBLIC`、`isPrivate=false`、默认分支 `main`、`pushedAt=2026-11-11T09:32:37Z` | 已具备 | 见下方取证记录、[匿名访问证据](../evidence/non-video-closeout-2026-10-23/anonymous-access.json) |
| 保留完整 Git 提交历史 | 官网「代码仓库·Git 记录」 | `main` 分支 140 个提交；本地 `HEAD` 与 `origin/main` 同为 `53aaf8211ef250546ece615cce48fa109392d478` | 已具备 | 见下方取证记录 |
| README 含项目介绍、技术架构、安装运行指南、团队信息 | 官网「代码仓库·README 文件」 | 根 `README.md` 含项目说明与团队两成员；`docs/` 下另有开发、结构、模型配置说明 | 已具备 | [根 README](../../README.md)、[材料页](README.md) |
| 提供环境配置说明（环境变量模板、依赖清单） | 官网「代码仓库·环境配置」 | `.env.example` 共 7 个键，其中模型相关 5 项（配置来源、协议、服务根地址、模型名、密钥）全部留空，PORT 与 WEB_PORT 只给默认端口；`package-lock.json` 锁定依赖 | 已具备 | [环境模板](../../.env.example)、[依赖锁](../../package-lock.json) |
| 技术文档为 PDF，≤30 页 | 官网「技术文档·格式」 | `web-match-competition-report.pdf`：**18 页**、**1,539,022 字节**、SHA-256 `9185b3c495fa43e71bd999846fa7d9a0d33d68893a87f42d70b8c8d3cd8b4fcc`，满足 18 ≤ 30；2026-11-13 按当前主题截图重建（原 11-11 版 1,314,041 字节 / `5fcce518…` 作废） | 已具备 | [技术 PDF](web-match-competition-report.pdf)、[PDF 检查记录](../evidence/formal-prep-2026-11-11/pdf-check.json) |
| 视频 5–8 分钟 | 官网「演示视频·时长」 | 容器 `mvhd` 得 398.234 秒；仓库既有 ffprobe 记录为 398.233333 秒（**引用既有记录**）。两者均落在 300–480 秒内 | 已具备 | [视频检查](../evidence/final-video-2026-10-28/video-verification.json) |
| 视频为 MP4、分辨率不低于 1080p | 官网「演示视频·格式」 | ISO BMFF 容器，`tkhd` 实测 1920×1080，含 `vide` 与 `soun` 两条 handler；既有记录另给 H.264／yuv420p、30 fps、11947 帧（**引用既有记录**） | 已具备 | [视频检查](../evidence/final-video-2026-10-28/video-verification.json) |
| 普通话讲解，可配字幕 | 官网「演示视频·语言」 | 用户 2026-10-28 对「已完整看完、听完，确认普通话讲解、音画对应、混音与最终走查」回复「已完整检查，可作为提交版」，确认绑定本条视频哈希；工具未转录、未听审 | 已具备（依据用户确认，非工具复核） | [交付更新](closeout/delivery-update-2026-10-28.json)、[视频检查](../evidence/final-video-2026-10-28/README.md) |
| API 密钥等敏感信息不出现在公开仓库，改用环境变量 | 官网「提交注意事项」 | `.env.example` 中模型相关键值全部为空、无真实密钥；历史模式扫描覆盖 127 个提交、1098 个文本 blob，findings 为空；运行期密钥只在本机 LocalAppData 与进程内存 | 已具备（扫描为有限范围，见其 `limits`） | [历史扫描](../evidence/non-video-closeout-2026-10-23/history-pattern-scan.json)、[环境模板](../../.env.example) |
| 在线演示地址（可选加分项） | 官网「在线演示」 | 仓库内没有可核验的公网应用地址 | 待你提供（可选项；没有地址时不填示例站点或虚构测试账号） | [正式指南](formal-submit-guide-2026-11-11.md) |

赛道原文的完整要求另见[两入口对照](../competition/submission-requirements-2026-10-29.md)与[赛道文档](../competition/AI-WEB网页开发挑战赛文档.md)。

## 三、提交当天步骤

1. **冻结版本**。确认工作区干净、`HEAD` 已推送到 `origin/main`，记录 `git rev-parse HEAD`。取证当时本地与远端同为 `53aaf82`，但工作区另有 9 项未提交改动，因此正式包必须等到主控提交之后再生，包内 SHA 与最终仓库一致。
2. **生成正式包**。依次执行：

   ```powershell
   npm run verify:materials
   node --import tsx docs/submission/closeout/prepare-package.mjs --prepare
   python -X utf8 docs/submission/closeout/create-formal-package.py --date 2026-11-11
   ```

   用当日实际日期替换 `--date`。核对生成的 `07_文件校验.json` 与 ZIP 的 SHA-256，确认采用这一版，不覆盖旧包。
3. **上传网盘**。把完整正式 ZIP 传到百度／夸克／阿里云盘，复制可访问链接与提取码，在未登录窗口打开验证能访问、提取码有效。
4. **上传视频**。把 `tuzheng-competition-demo-2026-10-28.mp4` 上传 B 站／抖音等公开平台，取可直接播放的页面 URL，未登录窗口验证可完整播放。视频材料不使用百度网盘链接。
5. **登录填表**。指定一名提交人登录[正式表单](https://f.kdocs.cn/ksform/w/write/SltUAlpn)，按 1–7 顺序填写：七项中「已具备」的团队与学校两项直接照抄，「待你提供」的 UID、手机号、网盘链接、视频播放页四项由提交人本人当场给出，第 6 项上传已核验的介绍 PDF（4 页、约 1.00 MiB），不再附加其他文件。
6. **提交前复核**。负责人逐项对照本表复核实际值、文件和链接；确认后点提交，注意每队只有一次。
7. **存回执**。按下一节归档，回执到手前状态保持「待提交」。

## 四、回执存档

提交成功页面出现后立即保存，缺一项都算没有回执：

| 存档项 | 内容 |
| --- | --- |
| 成功页截图 | 含表单标题、提交时间、提交人身份 |
| 提交时间 | 北京时间，精确到分；与截止时间对照 |
| 提交人与 UID | 实际操作者姓名及其 UID |
| 七项实际值 | 逐项抄下表单里最终填入的原文，含团队、学校、手机号填写方式 |
| 链接 | 网盘链接与提取码、公开视频播放页 URL |
| 正式包指纹 | 冻结的 Git SHA 与 ZIP 的 SHA-256 |
| 回执存放 | 建议新建 `docs/evidence/formal-submit-<日期>/` 目录存放截图与抄录，不与既有材料混放；随后在[材料页](README.md)把状态改为已提交并挂上回执路径 |

存档时的口径：本地打包、GitHub 同步、预参赛 81 分都不等于本次提交完成；也没有取得分数截图或正式评审原件，81 分只作预参赛反馈。提交后按官网要求不再改动仓库，确需变更联系组委会处理。

## 五、本次取证记录

本轮只读执行，未登录表单、未上传、未提交、未调用模型。

| 命令 | 结果 |
| --- | --- |
| `python` + `pypdf` 读页数 | 介绍 PDF 4 页／1,047,105 字节；技术 PDF 18 页／1,539,022 字节（11-13 重建）；历史开发报告 23 页（仅存档） |
| `python` 解析 MP4 `mvhd`／`tkhd`／`hdlr` | 时长 398.234 秒，1920×1080，`vide`+`soun`，36,498,045 字节，SHA-256 `5fdae469…`（与既有记录一致） |
| `git remote -v` | `origin https://github.com/Iskuyal/tuzheng.git`（fetch 与 push 同名） |
| `git rev-list --count HEAD` | 140 个提交 |
| `git rev-parse HEAD` / `origin/main` | 均为 `53aaf8211ef250546ece615cce48fa109392d478`，ahead/behind 为 0/0 |
| `git status --porcelain` | 当时 9 项未提交改动（属其他任务），打包前须先提交 |
| `gh repo view Iskuyal/tuzheng --json …` | `visibility=PUBLIC`、`isPrivate=false`、`isArchived=false`、默认分支 `main` |

未核验项：本机没有 `ffprobe`、`pdfinfo`，视频时长与画面规格除容器解析外引用了[既有技术检查](../evidence/final-video-2026-10-28/README.md)（标注「引用既有记录」）；普通话讲解只有用户确认，没有工具转录或听审记录。
