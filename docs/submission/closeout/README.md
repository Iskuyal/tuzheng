# 固定版本交付与人工验收入口

这里提供固定版本、材料哈希和离线检查入口，供接管者核对。它不代替正式视频、评审账号访问、账户核账或赛事提交。

当前材料选择与人工事项见[提交材料页](../README.md)，团队与权限证明见[非视频记录](non-video-record-2026-10-23.json)，有声视频和第二环境用户确认见[2026-10-28 交付更新](delivery-update-2026-10-28.json)。先执行 `npm run verify:materials`，检查所选视频、讲稿、时间轴、PDF 与交付说明；此预检不要求工作区干净，不生成版本包，也不调用模型。等价入口为 `node --import tsx docs/submission/closeout/prepare-package.mjs --check-materials`，加 `--json` 可读出完整文件指纹。

## 固定交付包

在仓库根目录、工作区干净且依赖已安装时执行：

```powershell
node --import tsx docs/submission/closeout/prepare-package.mjs --prepare
```

产物保存到 `.cache/closeout-packages/<完整提交SHA>/`：

- `source.zip`：由 `git archive` 导出该提交的已跟踪源码、证据与材料；不包含忽略的本机配置、依赖、缓存，也不包含 `.git` 历史。历史继续保留在原 GitHub 仓库。
- `materials/`：由 [materials.json](../materials.json)选择的说明、赛事 PDF/源稿、当前有声视频、原母版、讲稿、时间轴、检查证明及用户确认，逐项从同一提交读取。旧短片继续保存在源码归档中。
- `candidate.json`：基于干净 HEAD 的新候选预检锁；不是负责人签字或模型成绩。
- `manifest.json`：完整源码 SHA、候选哈希、每个产物的大小和 SHA-256，以及尚未完成的人工验收状态。

同一 SHA 已有目录时拒绝覆盖，包括上次失败留下的目录。保留原目录并排查原因；不要覆盖历史候选。可在对应的干净源码检出中核验：

```powershell
node --import tsx docs/submission/closeout/prepare-package.mjs --verify .cache/closeout-packages/<完整提交SHA>
```

验证会检查材料字节是否与 Git 提交一致、预检锁是否有效，以及工作区是否干净。交付包只保存在本机缓存，不会自动上传或提交 ZIP。PDF 中旧的“代码参考”仍指向原材料基线；生成新包并不表示正文已经覆盖新版本的全部验收。

新包使用 schema 2。当前视频为 `approved-by-user`：技术检查通过，用户确认已完整检查、可作为提交版，确认记录须与视频哈希匹配；旧无声母版和未获最终确认的有声文件状态继续可核验。`acceptanceRecord` 保存团队及指定 SHA 的公开访问证明；`deliveryUpdateRecord` 同时将第二环境标为 `confirmed-by-user`，注明这是用户转述、原报告未提供。负责人签字和赛事提交仍待完成。未知请求保留未核实状态，停止核账的决定见[此前进度](progress-2026-10-23.json)。旧包保留原文件与哈希，在对应干净源码版本上核验。

## 第二台 Windows

2026-10-28 用户确认该项已由另一位开发者验收，见[交付更新](delivery-update-2026-10-28.json)。本轮不要求重验；开发者姓名、环境、测试版本与原报告未提供。以下流程保留供追溯或未来版本复验，不表示该开发者逐项执行了这些命令。

使用标准 Node 24 安装（含 npm）与系统 Edge。在第二台机器从有访问权限的 GitHub 仓库克隆，检出交付 manifest 的完整 SHA，确认工作区干净后执行：

```powershell
node docs/submission/closeout/verify-windows.mjs --install
```

`--install` 使用现有锁文件执行 `npm ci`，需要 npm registry 网络；去掉该参数可复用已安装依赖。脚本只运行文档、行为/API、录屏预算、固定样例、题集冻结、构建、配置矩阵及三视口浏览器测试，不运行模型评测或连接测试。3001/5173/3107/5187 端口被占用时先报错，不终止他人进程，也不复用未知实例。任一命令失败就停止，保留已执行步骤及失败；输出位于 `.cache/windows-acceptance/<时间>/`。

在当前机器演练时加 `--local-rehearsal`。离线检查全部通过后，仍须由操作者提供环境回执和人工操作结果，才能确认是在“第二台机器”完成了验证。

脚本结束后由团队在该机器执行 `npm run dev`，逐项记录：

1. 首页可打开，来源入口只载入 CPI 样例，不自动调用模型。
2. 图内核对页选择“预置示例”，确认数字后得到公式与图内结论；明确记录使用预置值。
3. 来源页载入 CPI 图片与配文、展开资料库；本次离线验收停在输入态，不点运行。
4. 设置页可打开，密钥不回显；本轮不点“测试连接”，也不更改已有配置。

将原始脚本报告、环境版本、四页截图/操作结果和真实操作者的确认，填入[验收回执模板](acceptance-receipt.json)的新副本。不要把本机演练改名当作第二环境，不在模板或仓库填写 API Key。

## 账户、视频与最终验收

中断请求按用户决定停止核账，见[账户交接](accounting-handoff.md)。[当前有声视频](../tuzheng-competition-demo-2026-10-28.mp4)已通过[技术检查](../../evidence/final-video-2026-10-28/README.md)，并获用户完整看听后的最终确认。原[无声工程及讲稿](../demo-2026-10-18/README.md)和旧[录制方案](../demo-video-script.md)保留供对照。

团队、公开访问、报名及停止核账的决定见[此前进度](progress-2026-10-23.json)与归档证明。视频最终接受和第二环境用户确认另作追加，不覆盖历史记录或空白模板。当前待办为负责人抽查、最终材料冻结及赛事作品提交。
