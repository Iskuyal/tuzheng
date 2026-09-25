# 阶段一新会话提示词

复制下面整段到以 `F:\VibeCoding\web-match` 为工作目录的新会话：

```text
你现在接手 F:\VibeCoding\web-match 私有仓库的阶段一开发。先阅读 F:\VibeCoding\web-match\AGENTS.md、F:\VibeCoding\web-match\README.md、F:\VibeCoding\web-match\PLAN.md、F:\VibeCoding\web-match\docs\PHASES.md、F:\VibeCoding\web-match\docs\STAGE-1.md，再检查实际工作区状态。目标用户已确定：只有图表截图、没有原始数据文件的普通读者。请完成阶段一文档中的“单图图内审计闭环”，不要提前实现后续阶段。

开始编码前，简短写出你的理解、关键假设、实现顺序和每一步的可验证结果。若文档与实际环境冲突，指出冲突并选择能完成用户路径的最小改动，不要默默扩大范围。

实现 Vue 3 + Vue Router + Vite + TypeScript 前端与 Windows 可运行的 Node.js + Express + TypeScript 服务端。提供三个团队自制样例和图片上传；真实云端视觉模型的服务端适配；对模型结构化观察值的校验；用户确认或更正数字；纯程序增长率计算；显示证据、公式、图内结论及不确定性。提供着陆页、审计台、模型设置页；一个根目录 npm install、npm run dev 能同时启动前后端。API Key 由设置页发送给本机服务端，保存在当前 Windows 用户的 LocalAppData 配置文件；远程 Responses API Base URL 使用 HTTPS，本机回环服务可用 HTTP；不从环境变量读取密钥，也不保存到浏览器存储。若当前没有可用密钥，先完成预置示例路径和模型适配器，明确标记实时调用尚未验证；不得以预置结果冒充真实 AI。

用 F:\VibeCoding\web-match\docs\STAGE-1.md 的验收清单逐条验证。针对计算边界、结果分级和缺证据情形写必要的行为测试；实际运行构建与测试，并人工走一遍三个样例。完成后更新 F:\VibeCoding\web-match\README.md 与阶段一验收记录，清楚区分已实现、已验证和未验证的能力。不要把仅凭截图的判断写成对真实数据的事实核验。不要使用 Docker、WSL、Linux 专属工具或本地 GPU。

若所有可在当前环境验证的验收项完成，在独立的 feat/stage-1 分支用中文提交说明提交并推送到私有仓库，创建草稿 PR 供查看；不要自行合并。最终用中文报告提交内容、测试证据、PR 地址、未验证项和下一阶段真正需要处理的风险。
```
