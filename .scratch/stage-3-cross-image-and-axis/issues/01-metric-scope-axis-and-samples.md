# 01：口径字段、坐标轴字段与阶段三样例

**What to build:** 主张能带上指标名与范围／人群，图表能带上柱状图的轴范围；六个团队自制样例（跨图三对、纵轴三张）连同预期结果一起进仓库。

**Blocked by:** 无

**Status:** completed

- [x] `claims[]` 新增 `metric`（指标名）与 `scope`（范围／人群），两点观察沿用现有 `period`／`unit`；`ChartObservation` 新增可空的 `axis`（`label`／`min`／`max`／`unit`）。
- [x] 结构化输出校验接受这些字段并拒绝形状错误；旧的三张单主张样例与三主张样例继续可用，字段可为空。
- [x] 视觉模型提示词要求抄录图上可见的指标名与范围／人群，读不清则填 null，不推断。
- [x] 新增跨图样例三对（一致、冲突、待核对）与纵轴样例三张（从零起点、截断纵轴、起点不明），SVG 与同名 PNG 栅格齐备，标题文字与预置摘录逐字一致。
- [x] `samples/expectations.json` 为每个新样例写明独立预期结果（口径要素、跨图判定或纵轴风险等级），与图片内容一致。
- [x] 自动化测试覆盖：字段校验、样例标题与图片一致、新增样例的预期结果。

## Comments

**2026-09-26 实现与实测：**`GrowthClaimObservation` 新增 `metric`（指标名）与 `scope`（范围／人群），`ChartObservation` 新增可空 `axis`（`label`／`min`／`max`／`unit`）。结构化校验按同一套规则接受这些字段：三者都可为 null（读不清），`axis` 整体可缺省；形状错误仍然拒绝。视觉提示词要求抄录图上可见的指标名、范围与坐标轴刻度，读不清填 null、不推断；模型契约里 `axis` 是必填但可为 null。视觉路径把 `parsed.axis` 透传给观察值。

样例：新增 7 张团队自制图，凑成跨图三对与纵轴三张——`cross-a-revenue`（基准：全国门店 80→100，标题 25%）、`cross-b-consistent`（同口径同数值，标题写成 +25%）、`cross-b-conflict`（同口径但 80→120，标题 50%）、`cross-b-scope-mismatch`（数值相同但范围是直营门店）、`axis-zero-based`（0—120）、`axis-truncated`（80—100，柱高差被放大）、`axis-unknown-start`（刻度模糊、柱顶数字可读）。四张跨图样例共用同一基准图，三对的差别只在对照图，便于演示时逐张替换。样例总数从 4 张增至 11 张。

为了让风格不漂移，新增 `samples/make-chart.mjs` 作为样例图生成器（统一画布、配色与柱状图几何，把轴 min..max 映射到柱高），以及 `samples/render-chart-png.mjs`（把 SVG 渲染成同尺寸 PNG，供上传与模型读取）。`samples/expectations.json` 新增 `crossImage.pairs`（三对的预期判定）与 `axis`（三张的预期风险等级）。

测试：`npm test` 58/58 通过，新增「阶段三样例的口径与坐标轴」两条用例，断言跨图三对的四要素关系与预期判定、三张纵轴样例的轴读数（含刻度看不清时 min／max 为 null）；原有的「预置标题摘录与图片逐字一致」检查自动覆盖了 7 张新图。`npm run test:e2e` 6/6、`npm run typecheck`、`npm run build` 通过；浏览器确认首页 11 张样例卡各自的角色标签正确、1707px 与 320px 均无横向溢出。

未在本任务内：跨图判定与纵轴风险的规则（任务 03、04），因此界面暂时只把新样例当作普通单图展示。
