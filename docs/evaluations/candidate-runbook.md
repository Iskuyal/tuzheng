# 候选版本预检与真实评测接管

2026-10-07：HTTP传输、共享请求数硬限制与候选锁已实现并离线验收；**本轮没有在线结果，也没有收费运行授权**。原holdout-v1所有字节与原运行代码锁保持不变，扩展传输通过新的候选锁单独绑定。

## 先冻结，再核验

```powershell
npm run eval:holdout -- --verify
npm run eval:source-audit -- --check-only
npm run eval:preflight -- --prepare .cache/final-candidate/新轮次.json
npm run eval:preflight -- --verify .cache/final-candidate/新轮次.json
```

以上命令不读取模型密钥、不发模型请求。候选锁包含Git SHA、脏工作区说明/diff指纹、未跟踪文件哈希、server/shared/scripts/web/config/tests/e2e与CI代码、依赖锁、来源题图文/期望/提示词/资料哈希，以及原预留题manifest。原题集/期望不刷新；任何代码或输入变化要另开候选锁，不绕过验证。允许记录当前脏工作区，但必须明确它不是仅由HEAD重现的已提交版本。后续提交改变SHA，也需重新冻结。

本次 [最终候选锁](../evidence/final-candidate-2026-10-07-round2.json) 是本地工作区预检证据；它的blockers是待办说明，不是已通过清单。[初版锁](../evidence/final-candidate-2026-10-07.json)保留，随后补齐未完成配对的标记，因此初版不用于当前运行。

## 三臂负责人抽查与接管

先用 [签字模板](holdout-owner-review-template.json) 核对h01—h12；填写prepare命令打印的candidateHash、真实复核人、日期和逐题依据，确认全部题的原页、数值、图文口径、版本关系、预留状态。模板默认全部approved=false，不能通过执行检查；agent没有代签。人工意见另存新文件，不能改冻结期望。

负责人明确接受实际HTTP次数上限之后，才执行单独的在线入口。**下列命令会真实调用模型并产生费用，示意中的360不是当前授权**：

```powershell
npm run eval:holdout:http -- --execute --lock .cache/final-candidate/已签候选.json --review .cache/final-candidate/负责人签字.json --max-requests 360 --output docs/evidence/holdout-live-新轮次
```

所有路径用同一有效模型配置与协议：默认file或显式env整份选择；仍使用设置页/环境配置，命令行不接收密钥。输出目录须全新，已有目录被拒。计划为108路径、126阶段，串行轮换ABC；A/B直接结构响应，C使用生产编排/工具/确定性判断，统一4096输出上限、60秒单请求超时。Responses格式依据 [OpenAI官方结构输出文档](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)，Messages的配对依据 [官方tool_result文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)。这些文档不证明当前兼容提供方在线可用。

HTTP计数在唯一fetch接缝执行，无SDK自动重试，禁止自动跟随重定向。C现有Messages协议的400兼容回退同样计数并受上限约束；A/B不做自动纠错或兼容重试。首选thinking设置相同，C回退后的字段缺失如实留档；若当前提供方依赖该差异，不能宣称三臂实际请求参数完全相同，须另列协议不兼容失败，不用成功结果掩盖差异。

请求数是**实际可执行硬限制**，不是金额封顶。缺少核实费率时amount=null，不调用余额API、不编造费用；如果负责人只接受金额封顶且未接受请求数限制，此入口不满足该授权，不能运行。SDK请求计数、工具调用数、调查阶段数与HTTP次数分开。

- 每次发送前预占预算并fsync写running日志，发送后写原始脱敏响应、usage、实际模型、HTTP状态与时间；失败响应可获得的usage同样保留。headers不归档，已知密钥从响应/错误/参数中清除。
- 请求上限、401/403/429、连续三次HTTP失败、成功响应usage缺失/无效、落盘失败都会停止。400/网络失败usage未知保留null，不能记为免费；仅成功HTTP的usage未知触发会计停止。单请求超时是一次失败，不重试。
- 到上限时，剩余行保持planned；初查失败/没追问/问错配文目标时恢复blocked。HTTP日志与阶段快照保留，失败、不增益、退化都在分母里。
- 发送前写入失败不发HTTP，attempted=false；有终态的attempted=true才计已执行请求。崩溃只留下running时，是否送达/计费未知，需先核对提供方记录，不能自动补零或接着跑。
- 中断后不自动续跑；保留整个目录，先核对journal最后完整行、report快照与提供方账单。HTTP已落盘但阶段未完成时，不能把该尝试从分母/费用中删掉。另开轮次前由负责人处理预算与复核。

`report.json`保存全部计划行、分项、配对、raw/trace、真实HTTP账本和候选哈希；`events.jsonl`逐HTTP/阶段fsync归档。临时文件原子替换快照。测试注入fetch时mode=offline-fixture、transport.kind=injected-http-fixture，不冒充实际模型。比较使用外层 `comparisons`：存在planned阶段的配对标为not-completed；原冻结 `summary.pairs` 留作兼容重算，其false比较不能解释成尚未执行模型的无增益。

## 五题最终演示复验预检

候选锁另列q04/q05/q13/q18/q20检索臂，每题3次：15次初查、最多3次恢复。**18个调查阶段不等于18次HTTP**。本轮只准备并核验了计划，未执行。

现有eval:source-audit筛题命令仍保留，可见 [收尾方案第06项](../reviews/2026-10-02-remediation-agent-prompts.md)。该旧CLI不使用本次新增的传输请求硬上限，不能把这里的HTTP预算证明套到旧CLI。后续批准这5题时，使用已经离线验收的独立受控入口，复用新传输接缝与原独立评分器；不以运行108路径的三臂整组代替5题授权。

```powershell
npm run eval:demo:http -- --execute --lock .cache/final-candidate/已确认候选.json --max-requests 80 --output docs/evidence/final-demo-live-新轮次
```

此命令会收费，80只是示意而非授权额度。题号/检索臂/3次重复固定，输出预分配18阶段，传输日志中的C-tools表示复用工具传输，最终评分臂是retrieval。不需要预留题12题签字，但仍须负责人确认代码版本、配置和本批实际HTTP上限。

录制之前确认对应在线记录引用这个候选版本，重新核对视频脚本的历史结果、配置和费用；当前脚本在 [演示脚本](../submission/demo-video-script.md)。团队信息、评审访问、视频成品、另一台Windows回执和赛事最终提交仍待人工。访问/交接步骤见 [人工接管清单](../submission/final-handoff-2026-10-07.md)。
