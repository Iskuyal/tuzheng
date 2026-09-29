# 01：CPI 图文主张的公开来源核验闭环

**What to build:** 从团队自制 CPI 图表 PNG 与配文出发，经真实模型读取和受限工具选择，检索固定官方资料库，在页面展示可复查的来源结论与调用轨迹。

**Blocked by:** 无

**Status:** 已实现、已在线验收（2026-09-29）

## 闸门验证：模型能否自行选择工具（2026-09-29 实测通过）

用 `.cache/probe-tool-choice.mjs` 对已保存的 Anthropic 协议配置（`https://api.deepseek.com/anthropic/v1` + `deepseek-flash`）发一次「只给工具声明、不指定工具」的请求，输入是 CPI 图文主张与配文，工具为 `search_source_library` 与 `compare_values`。三种 thinking 组合的实际结果：

| 变体 | HTTP | 耗时 | stop_reason | 实际选择 |
| --- | --- | --- | --- | --- |
| `tool_choice: auto` + `thinking: disabled` | 200 | 322 ms | `tool_use` | `search_source_library{metric:"全国居民消费价格", period:"2025-12", scope:"全国"}` |
| `tool_choice: auto`，不带 thinking 字段 | 200 | 204 ms | `tool_use` | 两个 `search_source_library`（`scope:"全国"` 与 `scope:"环比"`） |
| `tool_choice: auto` + `thinking: enabled` | 200 | 202 ms | `tool_use` | 两个 `search_source_library`（`scope:"全国"` 与 `scope:"同比与环比"`） |

结论：当前模型支持**自动工具选择**，不需要强制 `tool_choice: {type:"tool"}`，且不带思考字段也成立。闸门通过，继续实现多轮编排。第三种变体一次返回两个 `tool_use`，说明单轮可能超过一次调用，预算法必须按轮与总计双重限制。此结果只覆盖当前模型与当前端点，不代表其他提供方。

- [x] 固定官方资料的原始 URL、发布机构、发布日期、适用月份／范围／比较方式、短摘录与内容指纹；加入至少一个错月份或错口径的干扰片段。自制图片和配文与官方原图、官方原文清楚区分。
  - 三条资料在 `shared/source-library.ts` 写死：2025-12 发布（同比 0.8%／环比 0.2%）、同比与环比解释页、以及 2026-08 发布作为干扰项（同比同为 0.8%、环比 0.4%）。每条记录 `url`、`publisher`、`publishedAt`、`basis`、`aliases`、`excerpt`、逐句 `measures` 与 `fingerprint`；`verifySourceLibrary()` 有单测，改动摘录即报错。
  - 自制图 `web/public/samples/cpi-2025-12.png` 与 `.svg` 带「团队自制」「不是国家统计局原图」标识；样例接口的 `note` 同样写明。
- [x] 新图文观察结构接受没有明确增长率标题、但有 CPI 数值和配文比较方式的输入；缺失信息保留为空，旧 `claims[]` 路径与样例保持原有行为。
  - 新增 `SourceClaim`：`claimText`／`metric`／`scope`／`period`／`value`／`basis`／`kind`／`fromImage`／`imageExcerpt`，缺什么就填 `null`。旧的 `claims[]`、单图、多主张、跨图与纵轴路径未改动，`npm run test:e2e` 60/60 仍通过。
- [x] 本机服务端声明受限 `function` 工具，模型可选择检索、预定义数值比较或请求确认；校验工具名、参数、调用次数、超时和返回体。记录模型实际调用与程序执行结果，不用固定顺序或预设案例 ID 伪装模型决策。
  - 四个工具：`search_source_library`、`compare_values`、`request_clarification`、`report_source_finding`。Anthropic 协议自动选择工具并由服务端逐轮回传 `tool_result`；Responses 协议按 `function_call`／`function_call_output` 累积 `input`。
  - 工具名未知、参数不合 schema 一律不执行并记入轨迹；每轮上限 3 次、单次调查上限 6 次（汇总工具是出口，不计入），追问上限 1 次，轮数上限 4 轮，单次调查整体时限 150 秒，单请求 60 秒超时。检索结果按指标／月份／范围真实排序，不按案例 ID 返回预设答案（单测用同一资料库换月份即反转排序）。
- [x] 图文主张按指标、月份、地域／人群、同比／环比与来源片段对齐；只把适用的官方发布用于数值核对，定义页只用于解释术语。引用不存在或不适用时降级为「来源待核对」。
  - `evaluateApplicability` 要求指标、月份、范围都对上才 `applicableForValue`；术语页只 `applicableForTerm`。`validateCitations` 拒绝不在本次命中内、口径不符、以及拿术语页当数值依据的引用。图内主张还要能**在图内抄录里看到**它所填的比较方式，否则一律降级——这条规则是实测发现模型会给图上数值补「同比」后补上的。
- [x] 页面可从上传图与填写配文走到结果，分别展示图内观察、配文、官方来源、工具轨迹、引用和未解决项；没有密钥时给出可操作提示。保留现有单图与跨图路径。
  - 新增路由 `/source-audit` 与导航项「来源核验」。展示：模型／耗时／轮数／调用次数／tokens、停止原因、图内观察（含图上抄录）、配文主张、引用与检索命中（原始链接、发布日期、摘录、指纹、引用角色）、本次排除的材料及原因、被拒绝的引用、工具轨迹、未解决项、可展开的固定资料库清单。无密钥时提示并附「前往模型设置并测试连接」链接。
- [x] 本地行为测试和浏览器端到端测试覆盖完整路径与一个来源不适用分支；`npm test`、`npm run test:e2e`、`npm run build` 通过。
  - `npm test` **185/185**、`npm run test:e2e` **60/60**（320／390／1280px，新增 3 个用例 × 3 视口）、`npm run build` 通过。替身覆盖：预算上限与拒绝、未知工具、非法参数、追问上限、汇总与工具同轮、引用不存在、无适用来源、汇总结构非法后的重报、超时分类。
- [x] 用当前真实模型单独验证图片读取、真实工具调用和检索结果；若具体模型不支持工具调用，记录证据并调整可配置模型或保持任务未验收，不把替身通过计为在线通过。
  - 见[在线验收记录](../../../docs/evidence/stage-4-source-audit-2026-09-29.md)：闸门验证三种 thinking 变体均返回 `tool_use`；页面路径 10 次运行中 8 次成功（4.3—6.5 秒、2—4 次调用、3 轮），2 次上游请求失败并如实降级。Responses 协议的工具循环仅有替身测试，未做在线验证。
- [x] 按实际验证更新阶段四任务、路线图和 README 的能力状态，不提前标为已交付。
  - 本文件、[`docs/PHASES.md`](../../../docs/PHASES.md) 阶段四一节与 `README.md` 按实测结果更新；任务 02—06 仍标注为未实现。
- [x] 工具轨迹展示实际事件及简短行动理由，每轮最多三次、单次调查总计最多六次调用；所有失败与停止可见。首片完成单主张，后续拆解、恢复和修改建议按依赖顺序加入。
  - 轨迹每条记录轮次、序号、工具、状态（已执行／未执行／失败）、耗时、简短行动理由、输入摘要与结果摘要；行动理由只取模型说明的第一句，最多 80 字，不展示思维全文。被拒绝的调用同样显示原因。
