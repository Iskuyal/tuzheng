# 非视频材料接管

2026-10-23：用户将视频制作留到稍后，本轮先完成仓库侧检查和材料接管。当前状态见[提交材料页](../README.md)，当日规则见[官网复核](../../competition/official-rules-verification-2026-10-23.md)。

## 已准备的版本与检查

起点 `4d37f74c45862006880edf53b0b19fd6f8b8cc30` 的远端主线、成功 CI 与权限记录已[归档](../../evidence/non-video-closeout-2026-10-23/github-recheck.json)。本机已有该 SHA 的固定交付包，并于本轮重新验证。新文档提交后按[固定包入口](README.md)另建新包，包的 `manifest.json` 是该包源码 SHA、材料指纹及候选哈希的依据。

本轮离线检查见[非视频收尾报告](../../reviews/2026-10-23-non-video-closeout.md)。本机检查、GitHub Windows CI、另一台 Windows 的人工操作及负责人签字应分别记录，不能相互替代。

## 已补齐的信息与剩余输入

收到真实资料后再填写 README 或回执副本，空白模板继续保留。公开材料只写本人确认可公开的信息。

| 事项 | 最少需要的输入 | 完成位置与证据 |
| --- | --- | --- |
| 团队 | 已提供岭南凤翔团队、梁钦健/梁智量、岭南职业技术学院（清远校区）、C组；用户随后确认已报名缴费、联系人已核对 | 根 README 和赛事 PDF 已写入团队资料；[追加进度](progress-2026-10-23.json)保存用户确认，不代替作品提交回执；项目反馈入口为仓库 Issues |
| 评审访问 | 已按用户明确授权设为 PUBLIC，未登录访问通过 | [七项访问证据](../../evidence/non-video-closeout-2026-10-23/anonymous-access.json)绑定当时远端 SHA；后续提交交付后再核对最终材料地址 |
| 第二台 Windows | 用户回复暂无环境，尚无真实机器/操作者 | 执行下方命令的步骤已齐备，待实际环境到位后保留原始报告、四页操作及操作者回执 |
| 未知请求 | 已代查但未取得目标时段明细；用户随后决定“不发送 不用核账了” | 按[处理决定](progress-2026-10-23.json)停止查询、不发邮件；[草稿](accounting-inquiry-draft.md)仅归档，历史用量和收费保持 null，不重发请求，不再作为当前待办 |
| 负责人抽查 | 真实负责人、日期、固定包候选哈希、h01–h12 逐题意见 | 在[签字模板](../../evaluations/holdout-owner-review-template.json)新副本填写；[核对点](../../../samples/holdout-v1/README.md)及原始题面/期望不改写 |
| 赛事提交 | 报名缴费已获用户确认；个人中心所报赛项的上传形式、大小或链接限制仍需核对 | 最终视频补齐后核对完整材料，填 `contestSubmission` 的时间、平台回执及文件哈希；当前不提交缺视频材料 |

本轮已有的信息保存在[非视频记录](non-video-record-2026-10-23.json)。材料工具只读取其中已提供的团队资料和已归档的匿名访问结果。表中的 `team` 等人工字段见[人工回执模板](acceptance-receipt.json)；签字模板的 `candidateHash` 须与所选交付包一致，后续提交改变 SHA 时须重新生成并确认。

## 第二台 Windows 的直接操作

从公开仓库直接克隆，安装标准 Node.js 24（含 npm）及系统 Edge。由真实操作者检出所选包 `manifest.json` 的完整 `sourceSha`。若新提交尚未推送，克隆端无法取得它，应先使用已交付远端版本或等待交付；不能把新包 SHA 换成旧版本冒充。

```powershell
git clone https://github.com/Iskuyal/tuzheng.git
Set-Location tuzheng
# 替换为所选 manifest.json 的 sourceSha
git checkout <完整sourceSha>
node docs/submission/closeout/verify-windows.mjs --install
```

脚本输出在 `.cache/windows-acceptance/<时间>/`；随后按[四页人工操作](README.md#第二台-windows)完成首页、图内样例、来源输入态、设置页检查。记录实际机器、Node/Windows/Edge 版本、命令结果和真实操作者。脚本不调用模型；来源页保持输入态，不点连接测试或运行来源核验。

## 最终冻结

视频延期期间，固定包仍标为 `picture-complete-voiceover-pending`，人工字段保留各自实际状态。普通话成片、团队信息、访问和回执补齐后，更新 `materials.json` 及索引，运行材料检查；提交干净版本，再生成新候选/包，最终提交平台并保存回执。历史视频、PDF、题集、账本和旧包全部保留。
