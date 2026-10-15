# 固定版本交付与人工验收入口

本目录让接管者拿到明确版本、材料哈希与可执行离线检查。它不代替正式视频、评审账号访问、账户核账或赛事提交。

## 固定交付包

在仓库根目录、工作区干净且依赖已安装时执行：

```powershell
node --import tsx docs/submission/closeout/prepare-package.mjs --prepare
```

产物保存到 `.cache/closeout-packages/<完整提交SHA>/`：

- `source.zip`：由 `git archive` 导出该提交的已跟踪源码、证据与材料；不包含忽略的本机配置、依赖、缓存，也不包含 `.git` 历史。历史继续保留在原 GitHub 仓库。
- `materials/`：README、赛事 PDF/源稿、90 秒实录/原件、正式视频脚本与接管材料，逐项从同一提交读取。
- `candidate.json`：基于干净 HEAD 的新候选预检锁；不是负责人签字或模型成绩。
- `manifest.json`：完整源码 SHA、候选哈希、每个产物的大小和 SHA-256，以及尚未完成的人工验收状态。

同一 SHA 已有目录时拒绝覆盖，包括上次失败留下的目录。保留原目录并排查原因；不要覆盖历史候选。可在对应的干净源码检出中核验：

```powershell
node --import tsx docs/submission/closeout/prepare-package.mjs --verify .cache/closeout-packages/<完整提交SHA>
```

验证会检查材料字节与 Git 提交一致、预检锁有效、工作区干净。交付包只存本机缓存，不会自动上传或提交 ZIP。PDF 正文的旧“代码参考”仍指向原材料基线，不能因生成新包就声称正文覆盖新版本的全部验收。

## 第二台 Windows

使用标准 Node 24 安装（含 npm）与系统 Edge。在第二台机器从有访问权限的 GitHub 仓库克隆，检出交付 manifest 的完整 SHA，确认工作区干净后执行：

```powershell
node docs/submission/closeout/verify-windows.mjs --install
```

`--install` 使用现有锁文件执行 `npm ci`，需要 npm registry 网络；去掉该参数可复用已安装依赖。脚本只运行文档、行为/API、录屏预算、固定样例、题集冻结、构建、配置矩阵及三视口浏览器测试，不运行模型评测或连接测试。3001/5173/3107/5187 端口被占用时先报错，不终止他人进程，也不复用未知实例。任一命令失败就停止，保留已执行步骤及失败；输出位于 `.cache/windows-acceptance/<时间>/`。

在当前机器演练时加 `--local-rehearsal`。即使全部离线检查通过，报告也不会自动确认“第二台机器”，仍需操作者提供环境回执和人工操作结果。

脚本结束后由团队在该机器执行 `npm run dev`，逐项记录：

1. 首页可打开，来源入口只载入 CPI 样例，不自动调用模型。
2. 图内核对页选择“预置示例”，确认数字后得到公式与图内结论；明确记录使用预置值。
3. 来源页载入 CPI 图片与配文、展开资料库；未知请求未核账前停在输入态，不点运行。
4. 设置页可打开，密钥不回显；本轮不点“测试连接”，也不更改已有配置。

将原始脚本报告、环境版本、四页截图/操作结果和真实操作者的确认，填入[验收回执模板](acceptance-receipt.json)的新副本。不要把本机演练改名当作第二环境，不在模板或仓库填写 API Key。

## 账户、视频与最终验收

中断请求的核对入口见[账户核账交接](accounting-handoff.md)。正式录制仍按[视频脚本](../demo-video-script.md)与[当前收尾条件](../closeout-2026-10-15.md)执行；现有 90 秒实录只能作参考，不能替代 5—8 分钟正式视频或新的现场模型响应。

真实成员信息、评审权限选择、正式成片走查、负责人抽查与赛事平台回执，由负责人完成后填回执。所有字段初始为 pending/null，模板不是验收结果。
