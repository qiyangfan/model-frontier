# Handoff

最后更新：2026-10-30。**最新一轮：前沿图新增 ⌘/Ctrl + 滚轮双轴缩放（触控板 / 触屏捏合同路），普通滚轮仍保页面滚动；已完成单测、覆盖率、构建与夹具三套 E2E，尚未提交，4317 仍是旧构建。** 以下“最新一轮”优先于后面的历史记录。

## 最新一轮：前沿图修饰键滚轮缩放（2026-10-30）

### 决策与证据

- 普通滚轮在 `Chart.jsx` 边界 capture 监听里 `stopPropagation`（页面原生滚动，绝不 preventDefault）；⌘/Ctrl + 滚轮与触控板捏合（合成 Ctrl 滚轮）`preventDefault` 接管浏览器页面缩放后放行给 ECharts。门控纯函数在 `src/chartNav.mjs` 的 `wheelZoomGate`——echarts 6.1 的 `'ctrl'` 绑定只映射 `ctrlKey` 不认 ⌘，分流只能在边界自己做。
- 源码核实（echarts 6.1 `roams.js`）：共享 RoamController 只要存在 inside dataZoom 就挂 wheel/pinch 监听，且合并 opt 硬编码 `zoomOnMouseWheel: true`，per-zoom 标志是回调里逐模型检查的——旧代码注释「consumes wheel events before per-zoom flags are checked」与源码吻合。
- 滚轮缩放双轴联动（横轴对数 / 纵轴 Elo 各加一个 inside 条目）；拖拽平移扩展为双轴；放大/缩小/重置按钮作用于双轴；横轴滑块保持不变，刻意不加纵轴滑块（简单优先）。规格已并入 `openspec/specs/ranking/spec.md`（Requirement: 前沿图修饰键滚轮缩放），变更归档于 `openspec/archive/2026-10-30-chart-modifier-wheel-zoom/`。属交互层改动，不涉口径/契约/架构，无 ADR。
- 起草时「触屏端无变化」的预判被源码推翻：触屏双指捏合此前被 per-zoom 标志关闭而无动作，本次随 `zoomOnMouseWheel: true` 一并启用缩放；提案已按实际行为勘误后归档。

### 实现位置

- `src/chartNav.mjs`（新）：`wheelZoomGate` / `isZoomed` / `scaledRange` 纯函数；`tests/chartnav.test.mjs`（新）覆盖四种滚轮形态、任一轴已缩放判定与夹取边界。
- `src/Chart.jsx`：边界监听改门控（`passive: false` 才能preventDefault）；dataZoom 增纵轴 inside 条目，窗口经 `previousY`（`dataZoom[1]`）跨重绘保存；`zoomed` 状态按任一轴判断；放大/缩小按钮 batch 逐轴派发；重置沿用「不带 dataZoomIndex 命中全部组件」语义零改动；说明文案更新；tooltip 去「横轴」字样。
- `AGENTS.md`「ECharts 滚轮」条目与 `README.md` 图表交互节改写为新契约；`docs/three-board-workbench.md`、`docs/selection-efficiency.md` 是历史轮次验收记录，不改写历史。

### 验证证据（2026-10-30 本机）

- 单测 145/145；覆盖率行 98.80 / 分支 91.89 / 函数 97.38（门禁 92 / 85 / 90）；ESLint、Stylelint、Prettier、`vite build` 全绿。
- 夹具三套 E2E（`npm run test:e2e:fixture`，自起 4318）全部通过，pageErrors / errors 为空；既有断言「普通滚轮必须滚动页面而非缩放图表」原样通过。
- 返工两轮：scaledRange 期望值算错（1.5+2.1≠4.8）与浮点逐位比较（`3*1.4` 不精确）均由单测抓出并改为容差断言。

### 给下一棒的坑

- **`dispatchAction` dataZoom 不带 `dataZoomIndex` 命中全部组件**（`findEffectedDataZooms` 无 index 时查询全部，再按同轴联动补齐）——重置靠这个零改动覆盖纵轴；放大/缩小按钮则显式 batch `dataZoomIndex: 0/1` 逐轴以各自中点缩放，不能共用无 index 派发（否则纵轴会被横轴窗口覆盖）。
- **边界监听必须 `passive: false`**：修饰键分支要 `preventDefault` 接管浏览器页面缩放；元素级 wheel 监听默认非 passive，改回 true 会让捏合/⌘滚轮叠加页面缩放。
- **纵轴窗口存在 `dataZoom[1]`**，滑块移到 `[2]`：按 index 取窗口的代码（`dataZoom[0]` 横轴、`[1]` 纵轴）与数组顺序耦合，改 dataZoom 数组顺序必须同步这两处读取。
- **窗口计算有浮点乘法**：`scaledRange` 的测试用容差断言（`assertClose`），新增用例不要写 `deepStrictEqual` 逐位比较。
- **4317 服务仍是旧构建**：本次验证走 fixture 路径（4318），要看真实数据表现需按 `AGENTS.md` 流程重启 4317。

## 上一轮：主榜最低有效对手门槛（2026-10-20）

### 决策与证据

- 主榜全局排名要求 `record.opponents >= 10`；低于门槛的模型保留原始分、配置、胜平负、`winRate`、对手数和辅助位次均值，但 `composite`/`theta`/`btRank`/`copelandRank` 为空，不参与前沿，`reason` 说明“有效对手不足 10（当前 N）”。
- BT 拟合仍使用低样本模型的比赛，不从对局图删除；低样本模型只是不获得主榜名次。连通性门槛仍优先。
- 来源组合对照是诊断层，不套用主榜 10 对手门槛；组内对手数保留，页面/README/规格明确说明。
- 10 的依据：当前 87 个有分模型、3141 场、14% 平局的参数化模拟，中位真实强度模型进入前 20 的概率 k=1 约 7.6–8.9%、k=2 约 12.2–13.2%、k=5 约 6.0–6.1%、k=7 约 3.4–4.9%、k=10 约 2.0–3.3%、k=20 约 0.3–0.8%；前 10 概率在所有 k 下为 0%。7 是首个接近 5% 的值但区间跨 5%，10 取保守余量。
- 当前快照所有有分模型至少 20 个对手，因此现有 87 个模型的名次、分数和前沿成员不变。
- ADR-0016 接受；`openspec/changes/2026-10-20-min-opponent-gate` 的规格已并入 `openspec/specs/ranking/spec.md`，变更目录归档到 `openspec/archive/2026-10-20-min-opponent-gate/`。

### 实现位置

- `src/analysis.mjs`：`minOpponents`（默认 10）、`requiredOpponents`、每行 `rankEligible`、门槛 reason；`copelandRank` 只在主榜可排名模型内计算。
- `src/main.jsx` / `src/Portal.jsx`：概览、排名、对比、详情、证据深度、FAQ 与 CSV 口径显示门槛；排行榜主表、对比页与详情对低样本行显示“证据不足 / 未获主榜名次”，保留胜平负与对手数。
- `src/portal.mjs` 的 `evidenceDepth`：汇总所有有效战绩行（含低样本端点）的有向对局数，避免跨门槛比赛只计一侧。
- `src/analysis.mjs` 的 `csvExport`：公式带 `主榜至少 ${minOpponents} 个有效对手`，低样本行主积分/θ/名次差留空。
- `tests/majority.test.mjs` 新增门槛回归；小图测试显式 `minOpponents: 1`。

### 审查修复（2026-10-20）

- 证据深度原先把低样本模型与上榜模型之间的比赛只计一侧，门槛夹具会少算场次；改为汇总全部有效战绩行，并新增回归测试。
- 排行榜主表原先对低样本行只显示“未评分”且隐藏战绩；对比页“PK 战绩”原先显示“未参加正式排名”；详情成本场景表原先显示“缺分 / 缺成本”。现均保留胜平负/对手数并标明证据不足，避免把“未获名次”误读为“没有数据”。
- 总览“有效 PK 主积分”副标题补上有效对手门槛，计数与说明一致。
- 主榜与探索表的 PK 同分排序改用方向感知的辅助分比较器，避免低样本行（有辅助分）与未评分行（无辅助分）在升序时把空值排到前面。

### 验证证据（2026-10-20 本机）

- 单测 128/128；覆盖率行 98.72 / 分支 92.47 / 函数 96.45（门禁 92 / 85 / 90）；ESLint、Stylelint、Prettier、build 全绿。
- 三套 E2E 全绿（真实数据，服务以 `FRONTIER_AUTO_REFRESH=0` 启动）：`test:e2e` / `test:portal` / `test:evidence`；pageErrors / errors 为空。
- 当前快照回归：`requiredOpponents=10`、87 个模型全部 `rankEligible`，最少 20 个对手，榜首仍为 Claude Opus 5.5（本轮快照 Elo 1616.0）；gated 与 `minOpponents:1` 的分数、前沿逐行一致。
- 1 场 1 胜的回归夹具：`rankEligible=false`、主积分/θ/BT 名次/Copeland 名次为空、前沿为否、CSV 原因可见；其比赛仍影响对手 BT 强度。
- 浏览器注入 1 对手夹具：排行榜显示“证据不足 + 1 胜 / 0 平 / 0 负 · 1 个对手”，对比页“PK 战绩”显示原始战绩并标注未获主榜名次，详情提示门槛；pageErrors 为空。

### 给下一棒的坑

- **`minOpponents` 是主榜准入，不是 BT 估计器**：不要把低样本模型从 `contests` 里删掉，否则会改变对手强度。
- **小图单测要显式 `minOpponents: 1`**：默认 10 会让 2–3 个模型的小夹具全部失去名次。
- **来源组合对照不套主榜门槛**：它是诊断层，保留组内名次与对手数；不要把 `rankEligible` 误用于 cohort 行。
- **证据深度必须汇总全部有效战绩行**：只汇总已排名模型会让跨门槛比赛只计一侧，场次出现 0.5 的偏差。
- **门槛只控制中位模型的误入率**：10 胜 0 负若赢的是强敌仍可高位；这是证据，不是 1 场噪声。时间回测仍未执行，不宣称准确率提升。
- **默认阈值变化需同步 ADR/规格/README/CSV 口径**：`requiredOpponents` 和 `minOpponents` 是同一政策的两处表达。
- **本地跑 evidence E2E 时禁用自动刷新**：自动刷新会改变 revision/历史，干扰历史抽屉与分享开关的时序断言；CI 夹具路径本来就禁用。

## 上一轮：PK 主积分改用 Bradley-Terry（2026-10-20）

### 决策与变更

- 单一全局总榜保持不变；`analyze` 用现有 `majorityMatch` 对局拟合 BT MAP（Gamma(2,1) 先验，平局半胜，MM 1e-13 / 2000 轮），`composite` 改为 Elo 等级分 `1000 + 400/ln10 × (θ − 中位θ)`，新增 `theta` / `winRate` / `btRank` / `copelandRank`。
- 对局图连通性门槛：多于一个非孤立组件时不赋全局 `composite` / 名次，页面明确提示；不回退旧公式。
- `coverageCohorts` 改用 BT；主榜单一全局，`auxiliary` 仍只在同分时排序；Copeland 胜率 / 名次只进对比页与 CSV。
- 对比页新增 `.method-comparison`（BT 名次 / 等级分、Copeland 名次 / 胜率、名次差、对手数、覆盖）；榜单 / 前沿 / 详情 / FAQ / README 文案更新；图表纵轴改为动态 Elo 区间，tooltip 去掉 `/100`。
- CSV 新增 `BT强度θ`、`现行综合分（Copeland）`、`现行综合分名次`、`名次差`；`PK主积分` 改为 Elo。
- ADR-0015 接受；`openspec` 变更归档到 `openspec/archive/2026-10-20-bradley-terry-ranking/`，规格并入 `openspec/specs/ranking/spec.md`。
- 先验文档修正为 Gamma(2,1)：MM 更新式 `s_i=(W_i+1)/(Σ1/(s_i+s_j)+1)` 对应 shape 2、rate 1；Gamma(1,1) 会让全败模型强度为 0。
- 审查修复：Elo 可为负，移除图表 0 硬下界与 PK 列 0–100 进度条；排序空值统一走 `compareNullableScores`，避免负分与未评分行错序；来源组合对照补充“各组 Elo 以组内中位为 1000、不可与主榜直接相减”。

### 验证证据（2026-10-20 本机）

- 单测 125/125；覆盖率行 98.71 / 分支 92.23 / 函数 96.44（门禁 92 / 85 / 90）；ESLint、Stylelint、Prettier、build 全绿。
- 真实快照：771 模型族 / 87 个有对局 / 1 个连通组件 / 46 个可绘点；BT 拟合约 60–130ms/次（数组实现）。
- 三套 E2E 全绿（真实数据）：`test:e2e` / `test:portal` / `test:evidence`；pageErrors / errors 为空。
- 留一榜 AUC 回归基线：BT 0.732 vs Copeland 0.728（混合结果，不宣称更准）；时间回测仍是“更准”的验收门槛。
- 浏览器实测：排行榜 `PK 主积分` 为 1609.0 等 Elo 值；对比页 `.method-comparison` 显示 BT / Copeland 名次与名次差；探索页纵轴 200–1750、tooltip 标注中位 1000。

### 给下一棒的坑

- **BT 先验不是 Gamma(1,1)**：`+1` 分子对应 Gamma(2,1)；若改成 Gamma(1,1)，全败模型 `s=0`、θ=-∞。ADR 已修正。
- **不要按覆盖分榜或混合 BT / Copeland**：单一全局榜是硬需求；Copeland 只作诊断，不进入主分、先验、前沿、同分排序或分享参数。
- **连通性门槛必须先于成本原因**：组件不连通时即使成本齐全也不可绘；`plottable=false`，reason 指向不连通。
- **Elo 不是 0–100**：图表纵轴必须动态；`markArea` 底边用 `context.yMin`，不要退回 0。CSV / UI 的 `/100` 已移除。Elo 可以为负，不能把 0 当硬下界；模型表的 PK 列已去掉 0–100 进度条。
- **缺失分排序用 `compareNullableScores`**：AntD 在 descend 时会取反比较结果，空值要在两个方向都排最后；不要再用 `composite ?? -1` 兜底（负 Elo 会与空值错序）。
- **`rankBy` 是唯一并列口径**：主榜、Copeland 诊断、CSV 名次差共用；改 tie 规则要同时改测试。
- **详情页四个成本场景已缓存**：`costScenarios` 复用主 `analysis`，不要改回渲染时四次 `analyze`。
- **`btRank` 与 `rank` 不同**：`btRank` 是全样本 BT 名次（导出用），`rank` 是当前视图（如开放子集）重排名次；不要混用。

## 上一轮：CI 解耦、轮询收敛与单源重试（2026-10-20，已交付）

### 决策与变更

- CI 不再执行 `npm run refresh`。E2E 使用 `tests/fixtures/snapshot.json`，由 `tests/prepare-fixture.mjs` 把缓存时间刷新到运行时刻并写入临时 `FRONTIER_DATA_DIR`，服务以 `FRONTIER_AUTO_REFRESH=0` 启动；PR 门禁不发出源站请求（ADR-0014）。
- 新增 `.github/workflows/source-health.yml`：每日 02:23 UTC + 手动触发，执行 `npm run refresh`，失败只标记巡检工作流，不阻塞代码门禁。
- 页面轮询从每 5 秒拉约 932 KB 的 `/api/data` 改为：空闲 30 秒打 `/api/status`（约 0.2 KB），仅当 `revision` 变化时拉整包；刷新进行中 2 秒轮询状态。`/api/data` 与 `/api/status` 均带 `revision`。
- 失败来源独立重试：15 分钟起步、逐次翻倍、上限为正常刷新周期；只重试 `stale` 来源，不推动 `lastFullRefresh`（全量周期时钟）。来源卡片的失败提示旁新增「重试此来源」，POST `/api/refresh` 支持 `{sources:[id]}`，非法来源返回 400。
- 生产静态资源：`/assets/*` 一年 immutable 缓存（文件名带内容 hash），`index.html` 等 no-cache。
- ADR-0014 新增；ADR-0004 / 0007 标注 CI 范围被取代；ROADMAP 的「E2E 进 CI」从待办移到已交付。
- 评审修复：`revision` 改为进程内 UUID（服务重启也会换新）；状态轮询串行化、整包加载改为最后发起的请求生效；手动刷新/单源重试失败复位 `busy`，状态轮询不再无条件清除用户操作错误；`prepare-fixture` 拒绝写入运行时 `data/`。
- 归档：本轮未改动 `ranking` / `share-link` 规格，`openspec` 无变更提案；架构决策归档于 ADR-0014，本文件记录运行假设与坑位。

### 给下一棒的坑

- `lastRefresh` 是「最后尝试」时间（含单源重试），`lastFullRefresh` 才是全量刷新调度时钟；不要把两者合并。
- `retryDelayMs` 只存在缓存里，`view()` 会剥掉；不要把它当页面字段。
- 客户端只有 `loadedRevision !== status.revision` 才拉 `/api/data`；任何改变数据或设置的服务端路径都必须更换 `revision`，否则页面不会更新（进度由 `/api/status` 实时返回，不依赖 revision）。`revision` 是进程内 opaque token（重启即换新），不是可比较大小的版本号，页面只做相等判断。
- 状态轮询在请求在途时排队，不要并发发起；整包加载以最后发起的请求为准，旧响应不得写入状态。否则旧状态会覆盖新状态，或轮询被拖慢。
- 状态轮询成功不能无条件 `setError(null)`：只在轮询自身从失败恢复时清错；用户操作错误由成功的整包加载或用户关闭来清除。
- 手动刷新 / 单源重试请求失败时必须复位 `busy`；不要只依赖下一次状态轮询。
- `prepare-fixture.mjs` 会删除目标目录的 `history.json`，已显式拒绝仓库 `data/`；不要移除该保护。
- E2E 夹具数据固定、缓存时间运行时刷新。页面断言若依赖新数据，先成功刷新一次，再用 `data/snapshot.json` 覆盖 `tests/fixtures/snapshot.json`。
- `FRONTIER_AUTO_REFRESH=0` 只关闭自动抓取，手动 `/api/refresh` 仍可用。
- 窄屏下顶部页签会被横向滚出视口；E2E 从来源页回到总览时用 hash 导航，不要依赖页签点击。

### 验证证据（2026-10-20 本机）

- 单测 120/120；覆盖率行 98.60 / 分支 92.63 / 函数 96.24（门禁 92 / 85 / 90）；ESLint、Stylelint、Prettier、build 全绿。
- 4317 生产服务按最终构建重启；三套 E2E 全绿（真实数据），含新增的「失败刷新复位」断言。
- 夹具服务（4318，`FRONTIER_AUTO_REFRESH=0`）三套 E2E 全绿，含单源重试请求与 375px 来源页；`lastRefresh` 与历史记录数保持不变，确认未抓取源站。
- `curl` 验证：`/api/status` 与 `/api/data` 的 revision 一致（UUID）；非法与重复来源 400；`/assets/*` immutable、`/` no-cache。
- 审查循环：5 个问题（revision 重启失效、轮询/加载竞态、失败态 busy 卡死、错误被立即清除、夹具误写风险）全部修复并复验，无剩余缺陷。

## 上一轮交付：排行榜展示与抓取重试加固（2026-10-20，历史）

### 规则与决策

- 排行榜展示三组变更同批交付，提案归档于 `openspec/archive/2026-10-20-*/`（其中 PK 表述澄清与来源组合对照两份 proposal 为归档时按已实现行为补记）：
  1. **PK 主积分表述澄清**：全站「综合分 / 融合积分」改名「PK 主积分」，辅助分统一表述为「榜单位次均值（仅 PK 同分排序）」——不作第五票、不与主积分再次合并、不参与帕累托与支配判断。数值计算零变化。
  2. **证据深度摘要**：融合榜评分说明处一行摘要（进入排名的模型数 / 占比，仅 2 榜裁决与 3 榜以上裁决的占比），`evidenceDepth` 在 `src/portal.mjs`，纯展示衍生，不进分享链接。
  3. **固定来源组合对照**：融合榜新增来源组合选择器（`coverageCohorts`，每队列只用所选来源计票）与对局覆盖明细（双方共有 2 / 3 / 4 榜对局数，进悬浮战绩、对比页与 CSV）；分享链接新增 `cm` 参数，ADR-0002 已补记。
- 主榜计票、成本口径、前沿判定均不变；三组都属展示与对照层。
- **源站抓取重试加固**（同批一并交付）：`requestSource` 超时提高到 45 秒，超时 / 网络错误 / 408 / 425 / 429 / 5xx 自动重试一次，响应体读取纳入重试范围；LiveBench 候选文件 404 仍按「换下一布局」处理，仅可重试错误才向上抛失败整站；`fetchArena` 保留重试。

### 上一轮验证证据（2026-10-20 本机）

- 单测 118/118；覆盖率行 98.39 / 分支 92.58 / 函数 96.14（门禁 92 / 85 / 90）；ESLint、Stylelint、Prettier、build 全绿。
- 4317 生产服务按最终构建重启；真实刷新四源全部成功（arena 416 / aa 706 / vals 50 / livebench 48）。
- 三套 E2E 全绿（`test:e2e` / `test:portal` / `test:evidence`），pageErrors / errors 均空。

### 给下一棒的坑（上一轮新增）

- **hyparquet 的 `parquetReadObjects` 只收真 ArrayBuffer**：`getBuffer` 返回 Node Buffer，喂给 Arena Parquet 解析会抛 "First argument to DataView constructor must be an ArrayBuffer"；`crypto.subtle` 路径（AA 加密数据）可以吃 Buffer——两条路径别混用返回类型，`fetchArena` 必须经 `response.arrayBuffer()`。

- **`cm` 合法性硬编码在 `src/share.mjs` 的 `validCoverageMask`**：来源须属 `shared/sources.mjs` 白名单、按白名单顺序 `+` 连接、至少两个且不重复。`analysis.coverageCohorts` 的排序（来源数降序、其次覆盖模型数降序）决定「不带 `cm` 的分享」默认恢复到哪个对照——改排序即改默认组合。
- **`evidenceDepth` 的两个占比用「有向计数 ÷ 总有向计数」计算**：每场对决双方各计一次，先求和再除 2 还原场次；两个占比因此精确互补到 100，不要改成 `100 - x` 的浮点写法。
- **`coverageCohorts` 按 2^来源数 − 1 个掩码枚举队列并逐队列两两对决**：四来源下开销可忽略；未来若加第五个评分来源，需重新评估组合数与计算成本。
- 上一轮 Arena 的坑仍然全部有效，见下方历史记录。

## 上一轮交付：Arena 第四评分来源（2026-10-19，历史）

- 规则要点：四榜各一票、2∶2 平局、Arena 只取 `overall`、不引入新权重或原始分混算（ADR-0013）；额外权威榜单调研结案均不纳入（`docs/source-assessment.md`），后续纳入新来源需 owner 点名并更新 ADR。
- 摄取要点：官方单文件 Parquet + `hyparquet`（仅服务端依赖，不进前端 bundle）；`store.mjs` 只认 `ingestFormat: arena-text-overall-v1` 的新缓存，旧 Arena 缓存清理重取；`history.mjs` 归档票数 / 区间 / 发布日期。

### 给下一棒的坑（Arena 摄取与展示）

- **V8 `Date.parse("2026-02-30")` 返回合法时间戳（滚动进位）**：Arena 发布日期用 `isValidArenaDate` 做正则 + `Date.parse` + UTC 分量回读三重校验，不要退回只查正则和 parse。
- Arena 快照共 29 个 category，只有 `overall` 是全量聚合（416 条），其余是语言 / 难度 / 领域切片；取多档会重复计票同一批对话。
- `source-card` 内 metric 与 notes 都含「人类盲测偏好」字样，E2E 定位用完整 metric 文本避免 strict 冲突。
- 详情抽屉单榜区标题带「源数据」链接，可访问名以来源名开头而不是完全相等。

### 临时证据（仅本机，可能被清理）

- `/tmp/model-frontier-arena-latest.parquet`：真实下载快照；`/tmp/model-frontier-arena-overall.json`：筛选后 416 配置。
- HELM / Epoch 调研原件：`/tmp/model-frontier-extra-*`、`/tmp/model-frontier-helm-*`。

## 上次已推送交付（历史记录）

本次按用户授权将全部变更提交到 main 并推送 origin/main。本文记录提交前已完成的本地验证；远端 Actions 结果以对应提交的 CI 终态为准，交付回复提供提交和运行链接。

- 唯一评分规则：至少两榜有效分准入；双方至少两榜重合才对决，三榜各一票，按各榜原始分比较胜负。对决积分为 `100 × (胜场 + 0.5 × 平局) / 实际对手数`；没有实际对手时无积分与名次。最终积分相同，再按可用榜单名次百分位的等权平均辅助排序；两分均相同则并列。辅助分以精确分数求和，避免浮点加法误拆并列。
- 主图帕累托与综合榜使用同一分析结果，以主积分和所选成本判断支配关系，辅助分不参与帕累托；成本敏感性单独使用评分和成本齐全的样本。不同模型的对手集合可能不同，页面披露实际对手数，只有单榜重合的对决不计战绩。
- 移除旧评分公式、权重配置、最低覆盖选择与兼容迁移；旧链接的评分参数不再恢复旧算法。完整默认分享也输出带问号的状态链接，避免继承接收者本机偏好。
- 删除覆盖口径差异面板和数据提示列；详情仍保留证据。闭源与未知散点及图例改为不透明蓝色。
- LiveBench 支持紧凑日期与虚线日期发布、多种 CSV 布局、HTML 空壳识别；保留发布 ID 和独立显示日期映射。
- 数据文件退出 Git（ADR-0007），本机缓存仍保留；CI 显式刷新真实数据后执行 E2E，任一来源失败即失败。
- 六个提案归档到 `openspec/archive/2026-10-19-*/`；早期等权和三榜准入提案属于历史过程，当前规格以 ranking、share-link 与 ADR-0011 / ADR-0012 为准。

## 上次已推送版本验证证据

完成两轮评审并修复默认分享状态、辅助分浮点并列与 LiveBench 日期标签三个已证实缺陷。92 个单测全过；覆盖率行 97.80%、分支 92.12%、函数 95.85%（门禁 92 / 85 / 90）；build、ESLint、Stylelint、Prettier、三套 E2E 全绿。额外随机核验 80 组、5654 次模型对决通过。生产服务已按新构建重启于 4317。源码修改后必须重新执行 AGENTS.md 的完整验证流程。

## 上一轮清理（承接后可选阅读）

AA 修复交付后又做了一轮针对性清理，均已验证：`getText` / `getBuffer` 两份重复的 fetch 收敛为共用的 `requestSource`（只差 `Accept`，按各自原值参数化，行为零变化）；`lbMetadata` 的四个键改用预编译正则表，既免去每条模型解析都重编正则，也去掉动态构造正则的告警；`fetchLivebench` 与 `history.mjs` 的 `.reverse()` 改 `.toReversed()`（Node ≥ 20，项目要求 ≥ 22.12）；`history.mjs` 两处嵌套三元分别提取为 `view()` 里的 `items` / `visibleItems` 与 `diffSnapshots` 用的具名 `changeType(old, next)`；`pnpm-lock.yaml` 加入 `.gitignore`（项目用 npm，该文件是 pnpm 实验残留）。清理后 `server/adapters.mjs`、`server/history.mjs`、`server/store.mjs` 三个文件零诊断。

**未做**：全院约 40 处 `nested-ternary-js` 与 `no-console-except-error-js` / `hardcoded-url-js` 告警。前者遍布 `src/*.jsx` 与 `src/analysis.mjs`（评分代码，嵌套三元是承重逻辑），纯风格重写、零功能收益且回归风险高；后两者分别是服务启动横幅 / CLI 输出与「只监听 127.0.0.1:4317」的既定设计，均非缺陷。这些规则也不在仓库门禁内（`npm run lint` 是 ESLint）。

## 前次 AA 摄取交付（历史背景）

1. **AA 摄取改用页面 manifest 加密端点**（`docs/adr/0006`）：源站改版后全量 704 行不再随页面下发，原 Flight `models` 数组解析稳定失败（报「找不到含开放权重元数据的模型数据」，而 Vals / LiveBench 同时成功、AA 页面 HTTP 200 正常返回 1.9MB——是摄取契约失效，非网络波动）。新链路为「页面取 manifest → 拉 `/data/<hash>.txt` → AES-256-GCM 解密 → gunzip → JSON」，密钥写在同一个 Flight 分片里。字段映射与旧解析逐字段一致，**口径不变**（不涉及 ADR-0003），三站仍无 key 运行。
2. **两道完整性闸门**，针对「不完整但格式合法」的静默退化：
   - 契约闸门（`server/adapters.mjs`）：少于 100 条、或超过 10% 行缺少布尔型 `isOpenWeights` 即拒绝。
   - 跌幅闸门（`server/store.mjs`，三站通用）：上次成功缓存有效分 ≥ 200 条而本次不足一半即拒绝，并说明条数。
3. **`tests/evidence-e2e.mjs` 去掉对本机设置的隐式依赖**：原先硬编码 `assert.equal(refreshHours, 1)`，改由测试自行 PUT 设定前提并在 `finally` 还原原值。换机器或改过刷新间隔不再莫名红掉（该值此前为 24，导致这套在本地必挂）。

官方 Data API 已评估但不采用：本机 key 为 Free 档，`/api/v2/language/models` 需 Pro；`free` 端点可取 704 条却按规范排除 licensing 等字段——没有 `isOpenWeights` / `deprecated` / 估算标记，且分数只给 1 位小数（相邻并列从 21 处增至 392 处）。manifest 端点是其严格超集且不需要 key。

## 运行与验证

```bash
npm start            # 生产服务，http://localhost:4317（dist/ 为构建产物目录）
npm run build        # 改 src/ 后必须重建并重启服务才生效
npm test             # 单测（node --test）
npm run test:coverage # 带门禁的覆盖率
npm run lint && npm run format:check && npm run lint:css
npm run test:e2e && npm run test:portal && npm run test:evidence
```

浏览器实测必须用 `chromium.launch({ channel: "chrome", headless: true })`——playwright 自带的 headless shell 未安装。E2E 默认打 `http://localhost:4317`，可用 `FRONTIER_URL` 覆盖。

注意：`node:test` 的 `mock.restore` 在本机 Node（v24）不存在，测试里改用显式保存 / 还原 `globalThis.fetch`。

## CI（`.github/workflows/ci.yml`）

单 job 顺序执行：`npm ci` → lint / lint:css / format:check → test:coverage → build → `npm run refresh` → 启动生产服务（`npm start` + 轮询 `/api/status` 就绪，上限 30 秒）→ 三套 E2E → 失败时上传 `test-artifacts/` 截图。另有 concurrency 取消上一轮、`contents: read` 最小权限、15 分钟超时。

约定与坑：

- runner 固定 `ubuntu-26.04`（GitHub 托管镜像，`actions/runner-images` 已发布；`ubuntu-latest` 会随官方迁移漂移，故显式钉版本）。actionlint 内置标签库滞后于镜像发布，`.github/actionlint.yaml` 登记了该标签——删掉该配置会重现 "unknown label" 误报。
- 三个第三方 action（checkout / setup-node / upload-artifact）钉完整提交 SHA 防供应链改写，版本号写在行尾或上方注释；升级 action 时 SHA 与注释必须一起改。checkout 关了 `persist-credentials`（CI 不需要 git 凭据）。
- 本地没有 actionlint / yamllint，改完工作流至少跑 `npx prettier --check .github/`；YAML 行宽按 80 字符（CJK 按字符计，不按字节），`uses:` 行放长 SHA 时把版本注释移到上方独立行。
- CI 上 AA 单站刷新约 14–21 秒（见下），仍在 15 分钟总预算内。数据文件退出版本控制后（ADR-0007），CI 在构建后显式执行 `npm run refresh` 落数据再跑 E2E：任一站失败步骤即红，不再有「读仓库快照」的隐式兜底。

## 实现要点与坑（改 `server/adapters.mjs` 的 AA 链路前必读）

- **manifest 在原始 HTML 里是转义形态**：Flight 分片是 JS 字符串字面量，引号全部写成 `\"`，因此 `MANIFEST_RE` 必须容忍 `\\?"` 而不是直接匹配 `"manifest":{"path":...}`；否则在浏览器 DevTools 里看着对、代码里永远匹配不上。
- **解密后还有一层 gzip**：`crypto.subtle.decrypt` 出来的是 gzip 字节，漏掉 `gunzipSync` 会得到乱码且不报错——要到 `JSON.parse` 才失败，容易误判成加密方案变更（错误信息已区分「解密失败」与「解压或解析失败」）。
- **`initialModels` 只有 273 条且 0 条 deprecated**：拿它当全量用不会崩，只会安静少掉六成模型和全部历史 / 估算配置，属于最难发现的一类回归——这正是跌幅闸门存在的原因。
- **官方免费 API 的 1 位小数是服务端行为**，不是显示层四舍五入，客户端无法恢复精度。
- **AA 单站耗时几乎全是网络**：本地实测三轮，页面约 5–9 秒、数据文件（约 140 KB）约 8–12 秒，而解密 + gunzip + 解析合计仅约 25 毫秒。ADR 里若再出现「0.3–0.7 秒」一类数字，那是只量了本地计算，属失实。
- **开放权重闸门的分母是可评估的对象行数**，不是 `models.length`：否则载荷里混进 `null` 会把「全都有标记」误判成缺失，报错信息也会指错方向。
- **三站抓取统一走 `requestSource`**：`getText` / `getBuffer` 只差 `Accept`（前者按原值传 `text/html,application/json,text/csv,*/*`，后者用默认 `*/*`），改抓取行为只改这一处。`lbMetadata` 的 `scalar` 查预编译正则表 `LB_SCALAR_RE`，**未登记的键返回 null**——不要图省事改成 `match(undefined)`，那会命中整个 body。
- **`parseAA` 的行过滤必须防非对象条目**：`null.name` 会抛 TypeError，该函数上方闸门本就写了 `m && typeof m === "object"`，两处标准要一致。

## 实现要点与坑（改 `src/Chart.jsx` 前必读）

- **驱动事件用 `mousemove` 不是 `mouseover`**：zrender 的 `_hovered` 在指针离开画布时不重置，重新进入并停在同一元素上不会补发 `mouseover`，区域会「消失后不回来」。
- **单次 mousemove 内的派发顺序是 `mouseout`(旧点) → `mousemove`(新点) → `mouseover`(新点)**：撤下用 60ms 延迟定时器，因此 `paintZone` 必须先 `clearTimeout(retract)` 再绘制，否则点对点迁移后新区域会被旧点的待执行撤下抹掉（这个 bug 出现过一次，回归测试请覆盖「A→B 静止后区域仍在」）。
- **markArea 按系列 `id` 合并**：第二个特效用 `notMerge` 整表重建会抹掉区域，故 `paintedZone.current` 每次重算时置 null；区域用轴坐标（`xAxis`/`yAxis`）而非像素，平移缩放自动跟随。
- **E2E 锚点类名**（`AGENTS.md` 有清单）：`evidence-badges` 已无 E2E 引用（`evidence-e2e` 改定位 `.ranking-main-table tr[data-row-key]`），但类与 CSS 仍保留；新增锚点是 `creator-chip`。
- **Tailwind 残余层三条铁律与 exhaustive-deps 豁免**见 `AGENTS.md`，动图表特效前先读。

## 待办与已知取舍

- **跌幅闸门无人工 override**：若 AA 合法地永久缩水（有效分从 ≥200 条掉到不足一半），闸门会一直拒收并把源站标 stale，只能人工介入。这是刻意的 fail-safe 取舍（宪法诚实性优先：宁可显式报错，不静默少数据），加 override 属新功能，未做。
- **AA 的 `sourceDate` 仍为 `null`**：官方免费 API 的 `intelligence_index_version`（实测 4.3）在 manifest 载荷里没有对应字段，页面「数据时间」对这一栏继续不可用。
- **Pro 档升级路径**：若升级，可把官方 `/api/v2/language/models` 提为首选源、manifest 端点降级为兜底；届时需另立 ADR，因为免费档字段缺口正是本次不选它的原因。
- **既有 lint 告警已清理**（承接时登记的两条）：`scalar()` 的动态正则改为预编译正则表、`fetchLivebench` 的 `.reverse()` 改 `.toReversed()`。全院剩余的 `nested-ternary-js` / `no-console-except-error-js` / `hardcoded-url-js` 见上一节「未做」的说明，均非缺陷且不在仓库门禁内。
- **诊断噪声**：pi-lens 的嵌套三元（`nested-ternary-js`，全院既有风格）、antd 弃用提示为既有；knip 的「Unused export」是误报（项目未装 knip，`fetchAA` 根本没导出，`aaManifest` / `decryptAAGzip` 被 `fetchAA` 与测试引用）。
- **chip 计数口径**：取当前视图完整行池（与厂商下拉选项池一致），不被搜索 / 开放状态裁剪；因此在「仅开放权重」等筛选下可能出现 chip 计数大于可见行数——与既有下拉行为相同，属既定取舍。
- **斩杀区在口径切换后不自动重绘**：切成本口径 / 图例 / 聚焦会整表重建并抹掉区域，需移动鼠标才会重新出现（tooltip 同样等到下次移动才刷新，行为一致）。

## 文件地图

- `src/Chart.jsx` 前沿散点 / 斩杀区；`src/main.jsx` 探索页（应用外壳、分享状态、模型全景表）；`src/Portal.jsx` 门户六页（排行榜 / 对比 / chip）。
- `src/analysis.mjs` 评分、帕累托与来源组合队列（`coverageCohorts`；`dominatedBy` 在此计算，供斩杀区与 tooltip 共用）；`src/portal.mjs` 榜单行池、证据深度摘要与导出；`src/share.mjs` 分享链接编解码；`src/Evidence.jsx` 证据徽标。
- `server/adapters.mjs` 三站摄取（AA 走 manifest 加密链路，见上）；`server/store.mjs` 抓取编排与落库闸门；`server/index.mjs` 单服务前后一体 + 定时抓取；`data/snapshot.json` 为聚合产物（已退出版本控制，ADR-0007）。
- 规格在 `openspec/specs/<能力>/spec.md`；ADR 在 `docs/adr/`。
