# h09修订、两入口核对与预指导材料准备

2026-10-29按用户要求立即处理h09，并核对正式赛道和金山预指导表单。当前步骤是准备可检查的材料与提交指导，没有登录表单、上传网盘/视频平台或提交作品。

## h09处理

另建[samples/holdout-v2](../../samples/holdout-v2/README.md)，只改h09的配文、逐字期望及理由，明确“按季节调整口径”。v1及2026-10-28未批准记录不改写；12张图片、其余11题、资料库、提示词、工具声明与运行代码不变。两包完整性核验通过，v2代理复核12项通过，具体哈希和角色见[修订记录](../evidence/submission-prep-2026-10-29/v2-revision.json)及[v2代理复核](../evidence/submission-prep-2026-10-29/h09-v2-review.json)。

现有默认CLI和候选预检仍读取历史v1。v2已通过显式`loadBundle("samples/holdout-v2")`验证；本轮不声称收费入口已迁移，也不将代理复核当成新源码候选的人工签字、人员盲审或在线模型成绩。后续真实评测必须明确输入版本和授权。

## 网页核对与材料

[两入口要求对照](../competition/submission-requirements-2026-10-29.md)基于赛道页实时正文和本机Edge只读读取的金山表单。表单是预指导，截止10月31日15:00；正式省赛仍须在11月18日前通过个人中心另行提交。第5项为完整作品网盘链接，第6项为单个100MB以内的介绍文档，第7项必须用公开视频平台链接，不能用百度网盘视频链接。未发现统一ZIP名称或完整网盘包总大小上限。

已按表单七项制作[4页作品介绍PDF](../submission/tuzheng-project-introduction.pdf)，含实际视频抽帧。此前未发表/未获奖、团队原创且仅使用开源依赖的说明由用户明确确认，见[声明记录](../evidence/submission-prep-2026-10-29/team-declaration.json)。[提交指南](../submission/pre-guidance-submit-guide.md)给出七项填写内容、两种分享链接的用途、截止时间和回执保存步骤；UID、手机号、实际网盘和视频URL由提交者填写，不编造。

## 验证与打包

本轮456项测试、类型检查通过；file/env × 默认/自定义端口四组实际进程验证通过，模型调用0次。介绍PDF4页、约1.4MB，七项文字及四页渲染均已检查；原技术报告仍17页。v1和v2均只读核验，没有改动v1运行代码或刷新旧锁。验证记录见[validation.json](../evidence/submission-prep-2026-10-29/validation.json)。

同一干净提交先生成[固定内部交付包](../submission/closeout/README.md)，再用`create-pre-guidance-package.py`制作方便上传网盘的七文件ZIP，核对文件哈希与ZIP CRC。具体完整SHA、ZIP大小及SHA-256以本机生成清单为准，旧目录拒绝覆盖。源代码ZIP不含`.git`历史，完整历史继续通过公开GitHub仓库提供。

生成的材料包不等于平台已接收。仍需指定一名成员生成实际网盘和公开视频链接、核对UID/手机号、登录WPS并提交预指导；随后按正式省赛入口要求另交作品，分别保存回执。
