# Handoff

最后更新：2026-11-26。**最新一轮完成：SuperCLUE 成为第六评分来源，ModelDial 成为第四个综合成本来源（ADR-0028/0029）。** 以下历史记录保留决策背景；本节记录当前行为。

## 最新一轮：SuperCLUE 第六评分来源与四源综合成本（2026-11-26）

- **当前规则**：评分来源为 AA、Vals、LiveBench、Arena、ModelDial、SuperCLUE，六榜各一票，双方至少共有两榜才比赛。综合成本使用 AA、Vals、LiveBench、ModelDial；ModelDial 成本是最高分完整配置的整轮后端评测美元估算费用。每次任务成本和预算筛选仍只使用 AA、Vals、LiveBench。SuperCLUE 成本不进入综合成本。
- **来源接入**：SuperCLUE 适配器只读取月度通用榜文件中的「模型名称」和「总分」，当月文件不可用时回退上一月；缺列、坏分数和异常载荷均明确报错。身份继续按现有 `familyKey` 规则归一，不增加人工别名。
- **决策依据**：SuperCLUE 定位为中文模型补充票；实测加入后有排名模型 61→65、推翻旧裁决 0 场、打破平局 9 场。ModelDial 成本按预先确定的偏差和排序一致性门槛复测后通过；SuperCLUE 成本未通过排序一致性门槛，继续排除。完整证据见 [ADR-0028](adr/0028-SuperCLUE-成为第六评分来源.md)、[ADR-0029](adr/0029-ModelDial-进入成本来源与成本候选实证门槛.md) 与 [source assessment](source-assessment.md)。
- **实现与规格**：代码、夹具、浏览器测试和说明已同步；当前行为已并入 `openspec/specs/ranking/spec.md` 与 `openspec/specs/share-link/spec.md`，提案已归档至 `openspec/archive/2026-11-26-superclue-sixth-vote-modeldial-cost/`。
- **验证**：覆盖率测试 186/186，行覆盖率 98.62%、分支覆盖率 91.03%、函数覆盖率 96.79%；代码检查、样式检查、格式检查、构建和三套固定数据浏览器测试均通过。构建有资源包超过 500 KB 的提醒，不影响构建。
- **本机数据**：2026-11-26 重启 4317 后，`/api/status` 中 AA、Vals、LiveBench、Arena、ModelDial、SuperCLUE 均为 `success`。服务已启动并保持运行。
- **未决事项**：SuperCLUE 站方实际换月日期会变化，无法预先固定；当月失败回退上一月的行为已由测试覆盖，不影响当前完成状态。

## 上一轮：退役死质量开关（2026-11-25 第四轮）

- **背景与决策**：经核查，AA 回归内联 `initialModels`（ADR-0027）后五源均无 `estimated` 字段（0/290），且 766 条历史档案下线后当前内联 290 条 `deprecated` 全为 `false`；同时 `shared/representatives.mjs` 本就按 `!deprecated` 优先选取，仅「排除过期 / 失败缓存」（`excludeStale`）在刷新失败或超 24 小时时真实生效。按「不留存永不触发的假控件、不为想象的将来预建死分支」原则，直接删除前两套开关与参数，不采用条件隐藏。
- **改动**：
  - 核心层：`src/analysis.mjs`（`combinedCostProfile` / `combinedCost` / `majorityMatch` / `majorityRecords` / `analyze`）、`src/portal.mjs`（`nativeRanking` / `coverageSummary`）、`src/evidence.mjs`（`applyEvidencePolicy` 收敛为只处理 `excludeStale`）、`src/share.mjs`（退役 `est` / `eh` / `ne` / `nh`，旧链接按退役参数静默忽略）。
  - 界面层：`src/main.jsx` 与 `src/Portal.jsx` 移除侧边栏「允许 AA 估算分数」「排除历史配置」与单榜「包含估算配置」「包含历史配置」控件及状态/文案。
  - **保留不删**：`excludeStale`（「排除过期 / 失败缓存」）全链路、`shared/representatives.mjs` 与 `server/identity.mjs` 的 `!deprecated` 兜底排序、`src/HistoryDrawer.jsx` 对旧历史快照 `estimated`/`deprecated` 字段的中文字典翻译、被动只读证据标签。
  - 文档与归档：修订 ADR-0002、ADR-0027、`openspec/specs/ranking/spec.md`、`openspec/specs/share-link/spec.md`，归档 `openspec/archive/2026-11-25-retire-dead-quality-switches/proposal.md`。
- **验证**：`npm run test:coverage`（180/180，行 98.67 / 分支 91.10 / 函数 96.99）、`npm run lint`、`npm run lint:css`、`npm run format:check`、`npm run build`、`npm run test:e2e:fixture`（三套 E2E 全绿）全部通过；重启 `4317` 后五源全部 `success`。

## 上一轮：多选 chip 搜索统一与「榜单覆盖」列重叠修复（2026-11-25 第三轮）

- **需求与实现**：
  - 探索页帕累托搜索、模型全景表过滤、排行榜搜索与历史快照配置搜索统一替换为 `src/SearchChipInput.jsx`（AntD `Select mode="tags"` + 自由词条/候选点选 + 实时草稿预览 + 多 chip 按 OR 并集匹配）。纯逻辑抽进 `src/portal.mjs`（`splitSearchTerms`、`matchesSearchText`、`searchOptions` 等），帕累托搜索同步并入 `searchKey` 归一化，与排行榜保持同口径。
  - 分享链接 `q` / `pq` / `rq` 以 `|` 拼接多词条，兼容单词旧链接（ADR-0002 修订记录 + `share-link` / `ranking` spec 同步，归档 `openspec/archive/2026-11-25-unified-chip-search-and-coverage-layout/`）。
  - 修复探索页「模型全景」表「榜单覆盖」列溢出重叠：接入第五源后 `MODELDIAL` 9 字母在 `width: 140` 下越界遮挡右侧「前沿 / 状态」列。改为 `MD` 缩写（与总览 `SOURCE_SYMBOL` / `LB` 一致，tooltip 仍标 `ModelDial`）、加 `flex-wrap` 与 `whitespace-nowrap`，列宽调至 `195`（`scroll.x: 1050`）。
- **代码评审闭环（修复 4 项）**：① `SearchChipInput` 用 `latestRef`（在 `useEffect` 与 `emit` 更新）消除带草稿粘贴分隔符时 `onSearchSplit` 后紧跟的 `onSearch("")` 用旧闭包覆盖 chip；② `HistoryDrawer` 下拉候选去除 `creator: NAMES[i.source]`，与下方仅按名称/配置过滤的口径对齐；③ `SearchChipInput` 加 `filterSort` 将精确匹配项（如输入 `"DeepSeek"`）置顶，防止回车误选第一条具体模型，并把帕累托搜索框桌面宽度由 `260px` 放宽至 `280px`；④ `tests/e2e.mjs` / `tests/portal-e2e.mjs` 补齐三处搜索多 chip OR 并集验证，且按 E2E 数据纪律从当前表格行动态取厂商词条而非硬编码模型名。
- **验证**：`npm run test:coverage`（行 98.69 / 分支 91.18 / 函数 97.00）、`npm run lint`、`npm run lint:css`、`npm run format:check`、`npm run build`、`npm run test:e2e:fixture`（三套 E2E 全绿，含「榜单覆盖」列零重叠边界盒断言）全部通过。
- **本机网络排查与工具配置（非代码改动）**：实测公司出口直连外网但内网 DNS `10.3.114.2` 将 `huggingface.co` 污染解析至 `104.244.46.63` 导致 Arena `fetch failed`（`ECONNRESET`）；已在 owner 授权下通过 Homebrew 安装 Clash Verge Rev（2.5.10）并配置零节点直连 + 纯 IP DoH（`1.1.1.1` / `8.8.8.8`）分流（`direct-nameserver-follow-policy: true`，不开 TUN、关闭界面 DNS 覆写开关），重启 `4317` 后五源全部 `success`。

## 上一轮：AA 行链接死链风险预防（2026-11-25 第二轮）

- **处置（owner 问「有预防方案吗，或干脆不做」后的裁定落地）**：`parseAA` 的行链接在 `release.slug` 缺失时回落 `SOURCE_INFO.aa.url` 榜单页，不再拼 `/models/undefined` 死链。**方案依据是仓库现成先例**：Vals 与 ModelDial 的行链接本来就是「无按模型地址时指向榜单页」；否决了「url 置空 + 界面隐藏按钮」路径——三处渲染点（对比卡「源数据」、Portal「源站」列）都无条件渲染锚元素，置空会产生死控件，多改三处还引入分支。
- **同轮裁定不做**：ModelDial `sourceDate` 严格校验维持不做——纯展示字段不参与准入、失败形态可见不隐蔽（异常文本直接显示而非错数据）、与 Vals 同类字段先例一致；触发条件登记：该日期将来参与逻辑判断时，再按 Arena 的 isValidArenaDate 模式补校验。
- **验证**：单测 179/179（缺失 sentinel 用例新增「release 缺失 → url = 榜单页」断言）、build、ESLint、Prettier、夹具三套 E2E 全绿。

## 上一轮：AA 内联切割器加固（评审批次，2026-11-25）

- **评审范围与结论**：owner 授权对 229d272（ModelDial 第五源）+ c9d4173（AA 内联载荷适配）做全维度代码评审。无行为破坏级缺陷；1 个风险修复（见下）、2 个观察登记、3 个候选核验后撤销。
- **修复（风险）**：`aaInlineModels` 原实现用 `indexOf("[")` 找数组起点——若源站把 `initialModels` 的值改成非数组（null/对象），会向前吞掉载荷里无关的数组当模型数据，报错也指错方向。修复：跳过空白后校验紧邻字符必须是 `[`，否则抛「initialModels 的值不是数组」。回归测试先红后绿（修复前实测确实错误返回 `[1,2]`）；真实页面载荷过新守卫解析 290 条与修复前逐字段一致（行为等价实证）。
- **登记不修**：① AA 行 url 在 `release.slug` 缺失时会拼出 `/models/undefined` 死链（当前源站 290/290 全有该字段，无触发路径；修复需连带核实展示层空链接处理，待源站字段变化时处理）；② ModelDial `sourceDate` 只做 `slice(0,10)` 无严格日历校验（展示层有容错，与 AA 同路径一致；Arena 严格校验是因日期参与准入）。
- **候选撤销（核验记录）**：① ModelDial「配置」列只存档位（xhigh/default）——与 LiveBench「整列只剩档位」形似但不同：专属列 + 行内模型名上下文 + ADR-0026 有意取舍且有测试钉住；② 界面文案写死「五榜」13 处——ADR-0026 记录的文案替换决策（数据结构已全派生自 SCORE_SOURCES）；③ ModelDial 每行链接指向榜单页——实测 overview.json 条目无按模型深链字段（只有 candidate_id/model_id/分数），构造地址违反诚实性红线。
- **评审确认的好改动**：Overview 徽标缩写从数组下标取值改按键名映射（消除加第五源渲染 undefined 的既有隐患）；E2E 新增 CSV 表头/行列数一致守卫（引号感知切列，防配置标签含逗号错位）。
- **验证**：单测 179/179、覆盖率 98.66/91.50/97.21 过门禁、build、ESLint、Prettier、夹具三套 E2E 全绿；真实载荷活验 + `git diff --stat` 确认修复仅 2 文件 12 行无顺手改动。

## 上一轮：ModelDial 第五源落地与 AA 内联载荷适配（2026-11-25）

- **ModelDial 成为第五评分源（已推送 229d272，ADR-0026）**：只进评分不进成本源（其成本是私有题库计费，与「干一个任务花多少钱」不同单位，不污染三源成本几何平均）；适配器只取 Coding 榜、五轴分按站点 weights 加权自算总分；缺榜罚分（ADR-0023 每榜 15 分）三种独立方法均无法复现原依据，经 owner 授权重校后移除（罚分 0/10/15/20 性价比前 15 几乎不变）；有综合分模型 58→65，性价比榜 42 个无新进；源数写死两处收敛到 `SOURCE_NAMES` 派生，CSV 追加 ModelDial 两列。
- **AA 摄取通道死亡与适配（ADR-0027）**：源站 2026-11-25 删除全部 `/data/*.txt`（7 个 hash 全 404，带完整浏览器标头与 cookie 仍 404，排除反爬），ADR-0006 的「manifest → 加密文件」链路第二步死亡且不会自愈。**官网对访客完全正常**——无头 Chrome 实测表格 205 行、全程不请求数据文件，数据已回到页面 Flight 内联（`initialModels`，290 条当前榜配置）。摄取改为「拼分片 → 字符串感知括号配对切数组 → parseAA」，删 manifest 正则与 AES 解密管道；字段随载荷改名（速度 `outputSpeed`、延迟 `timeToFirstToken`、代号 `release.slug`）；估算标记源站不再披露，行级恒 false（「纳入估算」开关默认关，不受影响）；载荷收缩 766→290 记录在案，`AA_MIN_ROWS` 100→200，跌幅闸门豁免 AA（相对比对会把契约迁移永久拒绝），其余四源闸门不变。
- **诊断教训（本轮新增）**：「源站报 404 ≠ 官网崩了」——访客视角与机器通道可以一个正常一个死亡，诊断要先起无头浏览器对照真实访客路径（看它请求什么、渲染什么），再下结论；本例第一版「源站事故论」即因此修正。
- **验证（2026-11-25 本机）**：单测 179/179、覆盖率 98.65/91.55/97.21 过门禁、build、ESLint、Prettier 全绿；夹具三套 E2E 全过；4317 实机核对五源全 success，AA 条数 290、版本 v5.0、来源卡新文案，Claude Fable 5.2 覆盖 5 榜。
- **遗留**：CI 因 GitHub billing 锁连续数批未真跑（229d272、5bf1579 等，任务 3 秒即败「account is locked due to a billing issue」），锁解锁后需统一 rerun。

## 上一轮：Arena 覆盖核查、LiveBench 配置标签与搜索修复（2026-11-24）

- **Arena「缺 6.2 系列」核查（结论：不成立，不改抓取）**：单榜 427 条为官方 HF `text/latest` overall 全量（实测该文件 29 个分类共 11,320 行，单一发布日期 2026-11-22；`text/full` 是 2023 年以来 131 万行 / 280 期历史档案，不是更大的当前榜）。GPT-6.2 Astra / Sol 均在榜（Elo 1413.3 / 1413.7、票数 5,268 / 5,526、第 141 / 142 名）——「没有」的印象来自排名深 + 搜索字面匹配。覆盖判断：AA 766 载荷仅 158 条有 v5 分（当期 127 条 / 70 家族，ADR-0018），Arena 408 家族反而是融合里覆盖最广的榜（58 个两榜家族中 45 个由 Arena 提供第二榜）；缺榜罚分对头部无影响（前 12 名四榜齐全、缺榜 0；Claude Fable 5.1 缺 Vals −15、Wonder Full 缺 Arena/LB −30，与本次疑点无关）。
- **LiveBench 单榜「模型配置」列修复**：源站把模型名与档位分字段披露（displayName + effort），而单榜列 / 对比页「配置」行 / CSV 只读 `configuration`，导致整列只剩 xhigh/max/high。修复在适配器层把模型名并入配置标签（`Name (max)`）；displayName 已自带档位后缀（带空格 `Name (xhigh)` 与无空格 `Name(xhigh)` 两种写法）时不重复追加；缺 effort 回落为模型名（不再显示无名称的「未确认」）。一次性影响：历史抽屉下一次快照把 41 条 LB 记成配置指纹变更。
- **搜索分隔符不敏感**：查询与行文本统一归一化（忽略空白 / 连字符 / 下划线）再比对，`gpt 6.2` / `gpt6.2` / `GPT-6.2` 均命中；仅影响显示筛选，不改分数、名次与前沿。退化输入（只含分隔符）等价空查询命中全部，接受。
- **跨源身份口径入档（ADR-0025，维持现状）**：AA「Claude Opus 4.5」与 Arena「Claude Opus 4.5 (20251101)」按源站标签保留为两个家族。实机证据：Arena 独有 260 家族中 99 对可与 AA 行「松匹配」，其中 97 对 AA 侧无分；2 对有分（1 对假配对 Command A+/A，1 对历史 6.2 分 Gemini 3.1 Flash-Lite Preview）；AA 当期有分且无 Arena 的 35 个家族无合法配对。合并计分收益为零，且会引入产品面假合并（GPT-5.2 Chat vs API、Llama Instruct FP8 vs 基础），否决；触发重审：官方统一模型 id，或「+」碰撞的双边同时带当期分。
- **工程**：`.prettierignore` 补 `.qoder/`（IDE 生成的 repowiki 文档，git 已忽略但 prettier 未忽略），`npm run format:check` 整仓恢复绿灯。
- **验证（2026-11-24 本机）**：单测 173/173、覆盖率 98.96/92.18/97.39、lint、build、format、夹具 E2E 三套全绿；4317 实机核对 Arena 搜索三种写法均命中 2 条、LB 榜配置列显示 `Gemini 4 Neon (xhigh)` 等。

## 上一轮：配色二轮与命中名牌归属修复（2026-11-17 第二轮）

- **配色二轮（owner 驳「橙红 vs 深红还是太近」，裁定纯区分用途不考虑品牌调性）**：VENDOR_COLORS 十色重算——OKLCH 色域内按色相铺候选（明度按色相自适应取最显彩档，黄色系天生需要更高明度才可读），最远点采样 + 模拟退火最大化组内最小 CIEDE2000。**组内最小感知距离 15.7 → 23.3（Kimi/Qwen 两个红系原约 11）**，对前沿线 ≥14.6。新映射：Anthropic 蓝 #3796f0 / Google 橄榄金 #7e5d08 / Meta 橙 #da7308 / OpenAI 深青 #05707d / Xiaomi 珊瑚 #e36271 / DeepSeek 黄绿 #949b0a / Z AI 砖红 #ab3419 / Kimi 浅紫 #ae73dc / StepFun 绿 #1b780b / Alibaba 梅红 #a13171（chip 行相邻取距最远排列）。
- **二十色库防新黑马撞色**：FALLBACK_COLORS 十色专供非固定厂商散列取色（与固定十色、前沿线最小感知距离 13.8），新厂商永远不撞现有厂商；新厂商之间仍可能同槽撞色，变得重要就提拔进固定表（守卫测试强制核验距离）。`presentation.mjs` 导出 FALLBACK_COLORS 供测试。
- **命中名牌归属修复**：owner 实测「点 Qwen 厂商后以为是 Kimi 被高亮」——重叠簇里命中模型的标注牌被邻居前沿名牌压住（labelLayout hideOverlap 跨系列全局生效），唯一可读名字成了非命中邻居。修复：①环层标注牌对全部命中模型显示（含前沿命中——其底层名牌让位，point() 按 highlightedIds 抑制；point 定义在前、调用在后无时序问题）；②环层 labelLayout 改 `hideOverlap: false`（标注牌永不隐藏，相撞时 shiftY 垂直挪开）。
- **大坑教训（色彩工具链）**：①色彩脚本两次把线性 RGB 直接当 sRGB 打印（漏 gamma 编码），方案明明可行却被「又黑又闷」的假象否决——hex 落地前必须过 sRGB gamma；②ΔE2000 在近黑低饱和区会虚高区分度（黑三角陷阱），必须约束饱和度下限 + 明度按色相自适应，否则优化器专挑深色骗分。
- **启动器退役**：owner 手动删除 `启动模型前沿.command`（代理自动探测 2026-11-15 落地后失去用途）。README 使用说明改 `npm start`、删「双击启动器固定 4317」注脚；handoff 历史节保留原记录不改写。with-proxy 包装器即启动入口。
- **国产线常驻全部视图 + 线色重选（owner 反馈「图例放了开放/闭源没放国产线，那范围切换是不是重复了」）**：图例只列实际绘制的线——旧逻辑国产线只在仅国产视图绘制，而国产前沿模型的点名牌在全部视图本来就显示，「有标记无线」自相矛盾。修复：三条前沿线在全部模型视图常驻、图例五项全列、均可开关（全球前沿虚线蓝 #3267b8、开放权重前沿实线青绿 #128574、国产前沿实线酒红 #9a1c36）。**国产线色 #b0653a → #9a1c36**：厂商二十色库落位后旧赭橙与 Meta 厂商色感知距离仅 12.3，常驻必撞；新酒红与全部二十二参考色最小距离 14.5（同一算法选色）。**范围切换（Segmented）与图例不重复**：范围管「谁在视图里」（图+模型全景表联动筛选+子集口径权威线），图例管「显隐」（不改范围与名次）——仅国产/仅开放权重保留。约束视图里全球前沿线仍不绘制（对其余点算前沿不成立），图例相应不列。坑：图例过滤写 `focus === "all"` 会漏掉默认 focus `openFirst`（图表口径等同全部模型），必须写 `focus !== "openOnly" && focus !== "cnOnly"`（E2E 逮住）。ADR-0024 修订记录入档（同日图例二轮改为三选一，见下条）。
- **图例二轮重构（owner 反馈「三条线同屏太丑」）**：图例拆成两组。点类三开关（开放权重 / 闭源·未确认 / 国产）默认全开、单击独立隐藏；国产是叠加筛选（国产模型保留开/闭形状，关掉隐藏全部国产点；仅国产范围下不列，且残留状态不生效——否则切进该范围后图会空掉且无控件恢复）。前沿线改三选一：同一时刻只画一条（默认全球前沿），约束视图只列成立的那条并自动选中；名牌只宣示所选线成员；支配区域随全球前沿线门控，切到其他线即撤下。图例标记统一空心（国产为虚线空心圆环——实心会被读作「已选中」）。E2E 断言互斥选中态、国产开关的实际可见点位数（`data-chart-visible`）与残留状态回归；ranking spec 增补「前沿图图例」Requirement，提案归档 `openspec/archive/2026-11-17-chart-legend-lens/`。
- **评审补漏（同日）**：①图例过滤补回「仅开放权重视图不列闭源 / 未确认」——改写时丢了该分支，留下无数据的空开关，E2E 断言计数 0；②斩杀区门控抽成 `chartNav.dominationZoneVisible(focus)`——原 `focus !== "all"` 把默认 `openFirst` 误判为约束视图，默认视图悬浮前沿不画支配区域（3bad306 引入），单测覆盖四种 focus；③`npm run format:check` 整仓恢复（4 个归档 proposal 过 Prettier、`.zcode/` 进忽略清单、`.prettierignore` 删已退役启动器条目）；handoff 代理 runbook 改指 `FRONTIER_PROXY_PORTS` / 环境变量，不再指向已删除的启动器。
- **验证**：单测 171/171（守卫测试扩到兜底色库：库内两两 ≥12、与固定十色/前沿线 ≥12，固定十色门槛不变）、覆盖率 98.96/91.99/97.38、build、lint、format、夹具 E2E 三套全绿；4317 手工核验 pv=Alibaba 时重叠簇里「Qwen 4 Max」标注牌清晰可见、Kimi 浅紫菱 vs Qwen 梅红圆一眼可辨。

## 上一轮：厂商多选与图上厂商色、点位重叠可见性（2026-11-17）

- **动机**：①图上点位贴近互相遮挡——实证 2026-11-17 LiveBench 收录 Qwen 4 Max（2/4 榜→3/4），落点 1.19 倍/1345.4 分与 Kimi K3.1 Pro（1.24 倍/1324.7）屏上仅差约 5px 而点宽 10–13px，开放权重系列 z:4 压闭源 z:3，Qwen 被盖掉八成「看似数据消失」；②owner 要求厂商 chip 多选反选 + 每供应商一色，且明确**点身也要厂商色**（第一版只改 chip 与描边圈被追问「点自身的颜色，好像没改啊」）。
- **实现**：`presentation.mjs` 新增 `colorFor`（固定 10 家=VENDOR_CHIPS 全集手工挑色互不撞色，避开前沿虚线蓝/实线青绿；表外 FNV-1a 散列兜底）；`share.mjs` 增 `pv` 参数（快选集合，`|` 连接、去重截 12）+ `cr` 多厂商管道编码（旧单值链接兼容，消费端 `splitCreators` 统一拆）；`portal.mjs` filterModels 改 creators 数组（任一命中保留）；`Portal.jsx` CreatorChips 增 `multiple` 模式（性价比卡快筛保持单选）+ 厂商色点/激活态描边浅底（文字恒深色避对比度问题）；`main.jsx` 探索页 creators/paretoVendors 双状态、两厂商下拉多选、VendorSearchChips 多选独立于搜索框（命中=文本与快选并集，合并计数）；`Chart.jsx` 三件套——①浮层点名同位置重叠模型（convertToPixel 圆心距<两半径和+2px，缩放随动，图例关闭系列不列，cap 5）②搜索描边厂商色（z:10 silent）+ 顶层实心补点系列（z:11 可点击开详情/可悬浮出卡片，被盖点复活）③点身厂商色、开放/闭源改形状编码（图例改中性空心描边形状，系列层 color 与 emphasis 变色全删——**不删 emphasis 色的话悬浮一下就把点改回旧语义色**）。
- **坑（本轮实证）**：①ECharts `labelLayout hideOverlap` 是跨系列全局布局——命中名牌与前沿名牌同挂点位上方会互相顶掉，命中名牌改挂右侧错开；②顶层补点展开 point() 会带出底层名牌，前沿模型出现双名牌叠放，补点 label 强制 show:false；③**dev 服务旧模块坑再次踩实**：改完 Chart.jsx 在 4317 看不到点色变化，重启 dev 服务才生效（handoff 下方 2026-11-11 已记录，本轮再次实证——改图表代码后核验前先重启 dev）；④antd 多选下拉选完不自动收起，E2E 选完选项要 `Escape` 收起再继续，否则下拉遮挡后续点击；⑤`npm test` 计数与提案/汇报数字要对表——本轮 170 项（新增 chips 色两两不同守卫测试）。
- **诚实性边界**：点的真实坐标零改动（抖动错位方案明确否决——伪造坐标）；重叠只影响可见性，不改分数/名次/前沿成员；筛选与快选只改变显示。
- **归档**：`openspec/archive/2026-11-17-vendor-multiselect-chart-visibility/`（按已实现行为补记）；share-link spec 增 Scenario（cr 多厂商管道往返/旧链接兼容/pv 快选集合）；ADR-0002 修订记录补记契约扩展；无新 ADR（分享契约扩展是既有「新增口径必须同步编解码+往返测试」规则的执行，非口径反转）。
- **验证**：单测 170/170、覆盖率 98.95/91.98/97.38 过门禁、构建、ESLint、Stylelint、Prettier 全绿；夹具三套 E2E 全过（排行榜/探索页多选断言重写）；4317 真实数据手工核验（Qwen/Kimi 重叠点浮层双向点名、点补点开详情抽屉、chips 多选反选、点身厂商色与图例形状标记）。评审核验按 ai-code-review 流程全维度过一遍：候选问题逐条溯源，浮层闭包新鲜度、注入面（esc+内部调色板）、pv 无白名单（垃圾词零匹配不点亮 chip，诚实空命中文案）均核验排除。

## 上一轮：Arena 源代理自动探测（2026-11-15）

- **根因**：owner 手动刷新时 shell 无代理环境变量，Arena（Hugging Face parquet）`fetch failed` 停在 11-13 快照，其余三站正常。此前方案是启动器写死导出 15732，裸跑必挂（owner 两次踩坑后裁定：不许写死端口、不许「必须走启动器」，要自动探测）。
- **实证**：Node 24 三种时机对照——启动前有变量 200；启动后再设 `process.env` 超时（EnvHttpProxyAgent 只在进程启动时读一次环境）；直连超时。⇒ 探测必须在子进程启动前完成，包装器方案由此成立。
- **实现**：`server/proxyEnv.mjs` 纯逻辑（`parseScutilOutput` 只认启用中的通道、HTTPS 优先；`probePort` 仅 TCP 探活 400ms；`resolveProxyEnv` 依赖可注入供测试；`applyProxyEnv` 大小写变量都写 + 回环豁免只补缺不覆盖）+ `scripts/with-proxy.mjs` 薄壳（探测 → 注入 → `spawnSync` 真入口，日志打「已启用代理（来源：…）/未发现可用代理」）。`package.json` 三脚本改走包装器；启动器删 15732 写死段（保留 `no_proxy` 豁免保自家探活 curl）；README / AGENTS.md 已知坑同步。
- **坑**：scutil 输出行首有缩进，锚定字段名的正则须容 `^\s*`（首版单测即红，一次修正）。
- **运维语义**：Arena 失败而其余三站正常时，第一嫌疑从「忘了走启动器」变为「代理没找到」——看启动日志首行即可定位；端口非常见且系统设置未登记时用 `FRONTIER_PROXY_PORTS` 指定，无需改代码。
- **归档**：运维/基建改动，不触及量化口径、分享契约、架构（无 ADR）；`openspec/changes/` 无在途提案，specs（仅 ranking、share-link）不覆盖代理发现能力——本轮无可归档变更。
- **验证与评审**：单测 167/167（含代理探测 13 项）、覆盖率 98.93/91.97/97.35 过门禁、构建、lint 零告警、新文件 prettier 全过、夹具 E2E `errors: []`；裸跑实测两发——`npm start` 与 `npm run refresh`（环境 0 个代理变量）均「已启用代理（来源：系统代理设置）」+ 四源 success。评审循环全量溯源零缺陷：CI ubuntu 裸跑 `npm start` 行为等价（linux 短路跳过 scutil、探测端口全 refused 毫秒级、直连同旧）、探活劫持三处闭合（applyProxyEnv 恒补豁免 / 启动器 curl 保留豁免 / 服务端零本地自请求）、死端口残留与空串变量均有防御。

## 上一轮：移除 source-health 每日定时巡检（2026-11-14，ADR-0014 修订）

owner 指示「干掉它」。删除 `.github/workflows/source-health.yml`（每日 02:23 UTC `npm run refresh` 巡检 + 手动触发），同步改 `ci.yml` 注释、README、ROADMAP；理由与裁定归档于 ADR-0014 修订记录：巡检信号无消费者（单 owner 下 GitHub 失败标记无告警通道）、owner 每日启动即全量刷新使云端巡检「最长一天」的发现延迟反而更慢、Actions billing 锁定期间该工作流从未成功运行纯噪音。ADR-0007「后续修订」补记。纯 CI 元数据/文档改动，src 与测试零改动，未跑验证电池（无代码路径受影响）。**注意：删除尚在本地工作区，随下次提交推送 main 后 GitHub 侧定时触发才真正停止。**

## 上一轮：编程分轴选型修订——browser 换 data_analysis（2026-11-11，ADR-0022 修订）

owner 连环质询（「编程维度为什么需要浏览器操作？无浏览器操作的模型不公平？后端代码需要浏览器吗？」「coding 是前端还是后端？感觉 coding 榜多指前端，agent/长任务/推理/数学才代表后端」）。实证三层：①LiveBench suites 整包发布，7 轴在池内覆盖恒 29——轴选择从不产生额外置 null，浏览器缺失「不公平」无现实受害者；②失真方向相反：browser 分位高×编码分位低的模型被抬进编程榜（MiniMax-M3.1-Flash coding36/browser76、Kimi K3 coding15/browser64），「强编码×未接浏览器」当前 0 例；③LiveBench coding 轴是 Python/算法类任务非前端榜（前端形态在 design 轴），另有 data_analysis（SQL/表格）轴是现成的后端栈证据。裁定（ADR-0022 修订记录）：**编程分 = 编程 + 长程代理 + 数据分析三轴均分**；browser 删（锚错专项，双向失真）；reasoning 拒（与 coding 秩相关 0.448——通用轴非后端代理，混入即镜头漂移回综合，且 owner 早前明言不在乎数学推理）；research/design 同理非后端。覆盖零损失、头部成员不变仅序微调（Carbon 升 #1）。改动：codingIndices AXES、编程视图 intro 文案、spec 编程 Scenario、codingIndices 单测重写。**坑：审计脚本两次踩同一盲区——valueRanking 返回行是裁剪对象（无 representatives），按 id 回联原始 rows 才能取 suites。**

## 上一轮：审查修复 + 四问体验裁定（2026-11-11，ADR-0024）

### 决策与证据

- **审查循环（范围 b838dfe+c99de05）三轮收敛修 10 项**：唯一候选/认证态/未认证态三处 ADR-0019 时代恒等式文案在罚分语义下已假（λ=0 argmax = max(composite−罚) ≠ composite 最高者；violations>0 而 sweep 同选使「取值不同首选不同」单因断言失真）、披露行因果穷举不完备（低样本/不连通路径）、ADR Fable 1541→1536（快照 mtime 早于提交，写 ADR 时数据已是 1536）、spec 同步、Empty 死分支+hasInput 字段删除、本文件两条已成假的坑（恒等式、complete fail-closed）在位修正。
- **① 编程口径「成绩低」= 刻度错位感知**（编程分是 0-100 百分位，94=超越 94% 同测；综合口径是 ~1500 BT 分）——保留视图（owner 唯一在乎的专项锚点，池内 29/36 有编程分），行内 small 行加「编程百分位」前缀标注刻度。
- **② 未认证标记块自适应**：sweep 全区间同选时区间表恒指向排序键第 1 名（键与 λ=10 档同构）零信息量 → 压缩为单行「未认证：缺榜罚分下证据不全」；分叉时才展开区间表（`sweepUnified` 判定）。
- **③ 性价比卡快速筛选**：`CreatorChips` 泛化（label/chipPrefix/hint/chipClass/emptyNote props，默认值=主榜原行为；title 保持用 chip.value——主榜 label≠value 如 Google→Gemini）、`value-filter-chip` 锚类（`creator-chip` 被页级定位占用，混用必撞 strict）、`presentation.mjs` 国产厂商静态映射（小写归一；归属存疑如 Trillion Labs 不入表——保守偏差优于错误归类）+ `valueFilterPredicate`（open 严格 true，null 不算开源）、**adjustedScores 透传 openWeights**（原裁剪行缺此字段，chip 计数会恒 0——夹具审计逮住）、名次徽章保持全榜口径（筛后跳号是诚实呈现）、筛选空态文案指向真实交互。
- **④ 帕累托探索范围配齐裁定（数据驱动）**：国产子集前沿有 3/4 成员为全球前沿独有（Kimi K3.1 Pro、MiMo V2.6 系）→ 配「仅国产」（focus 新增 `cnOnly` 值，share 白名单同步；`cnFrontierIds` 展示层派生自 pareto(plotted 国产)，不进 API/CSV——csvExport 固定列白名单实证不泄漏；Chart 加国产前沿线/图例/tooltip 态，斩杀区在子集视图禁绘）；**闭源前沿实证 4 成员全部在全球前沿上（独有 0）、国外榜同理与全球图重复 → 不配**。
- **Muse Ember 质询裁定**（owner 联网查证配合）：发布于 2026-11-09 的新模型（TechCrunch/Meta 官方），本地数据（AA 36.02@$0.136 / Vals 60.48）与公开报道逐项吻合；历史重放自记录起点恒 frontier=true——全场最便宜端点（0.047 倍）不可被支配是 Pareto 几何必然，「廉价端点」非野鸡非黑马，前沿标签语义不改。

### 实现位置与验证

- `src/Portal.jsx`（CreatorChips 泛化 + 快筛 + sweepUnified + 百分位标注）、`src/main.jsx`/`src/Chart.jsx`（cnOnly + 国产前沿线）、`src/share.mjs`（FOCUS_VALUES + cnOnly）、`src/presentation.mjs`（国产映射 + valueFilterPredicate）、`src/analysis.mjs`（openWeights 透传）。
- E2E 竞态修复（实证 1/3 概率触发）：①新 chips/cnOnly 断言点击后立即 count() 读到 React 提交前 DOM → waitForFunction 等定态；②既有 evidence-e2e 开关断言 reload 后立即 isChecked 读到偏好恢复前 false → 同法修复。**验证管道教训：`npm run … | grep -c; echo $?` 的 `$?` 是 grep 的退出码不是 npm 的——验收必须以 npm 自身退出码判定**（连跑 7×3/3 全绿）。
- 归档：`openspec/archive/2026-11-11-value-quick-filter-cn-frontier/`；规格并入 ranking spec（快速筛选只改显示 / 未认证自适应 / 编程百分位 / 探索范围三值）；ADR 见 `docs/adr/0024`。

## 上一轮：性价比首选改为完整榜单（2026-11-11，ADR-0020）

### 决策与证据

- **owner 需求**：ADR-0019 卡片认证态只出单条推荐，「我要的是一整个榜单，不是单条数据」。三个设计点由 owner 授权代理裁定（书面准则：单结论 + 根因优先 + 最小结构）：
  1. **池外模型灰显列榜单尾部**，行内标注原因——原脚注文字列举在榜单形态下不成立（池外常 20+ 不可扫读）；池外不占名次编号（池是资格门槛，混排暗示跨门槛可比）。
  2. **榜单始终展示，认证才加冕**——「未认证不设单一榜首」裁决禁止的是加冕宣称，不是排序信息本身；同一输入两种卡片形态（认证出榜单、未认证塌缩成分档表）才是真不一致。未认证时第 1 名不加冕、保留 λ 分档区间表，诚实性完整保留。
  3. **主排行榜不加调整分列**——主表契约是综合口径融合排名（规格「纯增量不改既有口径」保护它），塞入大多为空的门槛列是把两个决策层混进一张表；卡片内嵌完整榜单后「完整榜单」跳转按钮（指向综合口径主表）语义失效，删除。
- **认证 × 排序的一致性定理**：认证要求含 λ=0 全区间 argmax 唯一 ⇒ 认证态下调整分（λ=10）榜首 ≡ 综合分榜首，加冕行与排序天然一致，无需额外对齐逻辑。
- **算法零改动**：`adjustedScores` / `certifyNoBrainer`、λ 与短板线、融合排名、CSV、分享链接、服务端 API 完全不动；只新增展示层排序纯函数。

### 实现位置

- `src/analysis.mjs`：新增 `valueRanking(scored)`——入池行按调整分降序（并列按综合分降序、名称升序兜底保证确定性），`gatedOut` 只收有输入（有调整分）的池外行。
- `src/Portal.jsx`：卡片重写（锚点 `value-pick-card`，整卡 `col-span-2 max-760:col-span-1` 占满一行）——完整榜单复用 `.leader-row` 视觉（大数字=调整分，小字=综合分+成本倍数）、第 1 名认证态加「首选」徽章、未入池灰显尾表（名称 opacity-70 + 原因）、删除「完整榜单」Button。
- `tests/analysis.test.mjs`：`valueRanking` 排序/并列/分组用例（28 用例）。
- `tests/portal-e2e.mjs`：卡片结构断言（标题、榜单 ≥1 行、名次从 1 起、夹具有未入池尾表；不写模型名不钉行数不钉认证态）。
- 归档：`openspec/archive/2026-11-11-value-ranking/proposal.md`，规格并入 `openspec/specs/ranking/spec.md`（认证态加冕 / 未认证展示榜单但不加冕 / 榜单完整排序与确定性等 Scenario）；ADR 见 `docs/adr/0020`；`AGENTS.md` E2E 锚点类清单登记 `value-pick-card`。

### 审查修复（评审循环两轮）

- 未认证文案语义错误：「取值不同，排序就会不同」→ 排序固定按 λ=10 不随 λ 变，随 λ 变的是首选——改回「首选就会不同」并保留「榜单第 1 名不加首选标记」。
- 375px 隐式轨道：无条件 `col-span-2` 落在单列网格上撑出 0px 隐式轨道（实测 `grid-cols: "0px 327px"`，靠内容可收缩才没溢出）——补 `max-760:col-span-1`，复测单轨 `343px`。
- 「灰显」文档承诺未落地：ADR/spec/计划三处写灰显而实现是全色名称——名称包 `opacity-70`（只压名称不叠原因文字，12px 弱化色小字再叠 opacity 对比度不足）。

### 追加迭代：未入池段升格为续排名 + 池资格改纯综合锚（2026-11-11 晚，ADR-0020 修订记录 + ADR-0021）

owner 质疑入池结果（Wonder 入池、Fable 5.2/GLM 5.3 等缺榜优等生未入池）后离线审计实证：被拒模型无冤枉（短板 8~23 全是某体系垫底 1/4~1/5，非压线被刷；覆盖缺失与估算开关无关）；短板线 25–40 区间池完全不变（9 个），覆盖门 3/4 才是认证塌方分水岭（池 16、认证 ✗）。第一轮裁定：**榜冕分离**——未入池段按同一排序键续排、逐行显示调整分与原因（段头「无加冕资格」），`valueRanking` 两段收敛共用比较函数。关键展示事实：Claude Fable 5.2 调整分 1551 与榜首 1557 仅差 6 分，续排首位灰显可见。

owner 随后三点追问（40 取值多方认证 / 认真评估 2/4 / 锚点不得偏错专项）触发第二轮口径变更（ADR-0021）：**移除每榜短板线**。证据：floor 取值 0~50 时认证与 pick 恒为 gemini4carbon（短板线从未影响首选，只改池名单）；每榜否决权含 Vals 经济任务、LiveBench 分类均分等与场景无关的专项轴（owner 关心编程/终端，不在乎数学/写作/哲学/经济/法律）——任何取值都是错锚。移除后池（4/4 全测）9→18，GLM 5.3 Flash、GPT-6 Luna、Kimi K3 等此前被否决的模型全部获得正式名次；**4/4 覆盖门维持**（认证塌方只由覆盖放宽引起；2/4 选择性偏差——Muse Ember/Qwen 仅 [aa,vals]——使部分覆盖 composite 虚高不可比；2/4 会使该层退化为带成本罚的主榜翻版，失去「无脑选」差异化）。用户可见文案三处「（ADR-0019）」内部文档编号引用同步清除（评审循环漏检项：黑话清单未覆盖文档编号泄漏）。owner 的编程专项诉求已登记：四榜仅 LiveBench 有 coding suites（34 模型，已在主表列展示），「编程性价比」层待立项，未实施。

### 验证证据（2026-11-11 本机）

- 单测 149+ 项全绿（含 valueRanking 新用例）；覆盖率行 98.86 / 分支 91.89 / 函数 97.47（门禁 92 / 85 / 90）；ESLint（--max-warnings 0）、Stylelint、Prettier、`vite build` 全绿（Prettier 仅剩 `.zcode/` harness 计划目录的环境噪音，未跟踪不入库）。
- 夹具三套 E2E（`npm run test:e2e:fixture`）全部 `passed: true`、errors 为空；夹具池 17 入池 / 未认证 / 35 池外（不加冕路径）。
- 真实数据 4317 核对：重启后启动刷新 18 秒四源全 success；卡片截图认证通过态——9 入池完整排序、第 1 名 Gemini 4 Carbon 加「首选」徽章且综合分 1571.2 = 池内最高（恒等式实证）、26 个池外模型灰显尾表。
- **坑（本轮新实证）**：`--dev` 模式走 Vite middleware 服务源码实时转译、**不是** dist 产物；dev 服务进程启动后再改源码，模块缓存可能不失效，页面会继续跑旧代码——改动后核对必须重启 dev 服务（或用 `npm start` 走 dist）。dist 产物路径由夹具 E2E（4318 跑 build 产物）覆盖。

## 上一轮：成本调整综合分与性价比首选决策层（2026-11-11）

### 决策与证据

- **公式与校准**：调整分 = composite − λ·log2(costIndex/100)（costIndex 即 ADR-0003 综合相对成本指数，100=池中位）；λ=10 经 harness-bench 三榜交叉 21 模型实测市场斜率 9.4±2.7/翻倍校准（owner 授权，ADR-0019）。三公理：支配一致性（λ·log2 单调性定理，运行时自检）、短板淘汰（任一榜单百分位 <40 出局）、膝盖收敛（λ∈{0,2.5,5,10,20,40} 分档扫描首选不变）。**6 格点认证对 [0,40] 连续区间精确等价**：调整分对 λ 线性，顶线更替只能发生在交叉点且必改变区间端点 argmax，格点间藏不住更替。
- **全量覆盖裁定（2026-11-11，owner 授权代理裁定，ADR-0019 修订记录）**：池成员资格要求 4/4 榜有效实测分（`complete`，fail-closed）。实证（2026-11-10 快照，783 模型 / 50 个 composite）：放行部分覆盖时池 18、λ=10 起分叉、未认证；要求全量覆盖后池 8（Opus 5.5、Sonnet 5.5、Gemini 4 Argon、GPT-6.1 Sol 等前沿级）、λ∈[0,40] 全区间同选、认证通过——证据不全的最强模型恰是认证无法收敛的根源。与评分层「默认纳入实测、覆盖不加分」不冲突：决策层不改任何分数名次，只设默认推荐的证据标准。
- **认证榜首的恒等式**：认证要求含 λ=0 在内全区间 argmax 不变，而 λ=0 的 argmax 即池内 composite 最高者——认证榜首恒等于「通过筛选候选中综合能力最强者」。由此四类市场形态（前沿分近 / 便宜前沿登顶 / 顶级最贵登顶 / 中庸偏高）盲选均不踩坑：中庸模型数学上不可能认证登顶，只可能出现在未认证高 λ 档。
- **更名与术语白话化（owner 要求）**：卡片「无脑选 / NO-BRAINER PICK」→「性价比首选 / PERFORMANCE × COST」；用户可见文案弃用「塌方门 / λ 扫描 / argmax」等 harness-bench 黑话，统一为「短板线（任一榜单百分位 <40 即出局）／每贵一倍扣几分／分档复核」。概念澄清：harness-bench 的塌方测分化幅度，本门测绝对下限，「短板」才准确；四张第三方榜单即四种测量体系，概念同构成立。

### 实现位置

- `src/analysis.mjs`：`adjustedScores`（公式 + 全量覆盖门 + 短板线 + covered/complete/floorPct/eligible/reason 字段）、`certifyNoBrainer`（支配一致性自检 + 分档扫描 + 认证判定；多数决 pick 保留为内部字段）。
- `src/Portal.jsx`：总览卡片三态（认证 / 唯一候选 / 未认证分档不设榜首）+ 单站口径门 + 未入池逐行诚实标注 + 成本倍数展示（复用 `costFormat` composite）。
- `src/main.jsx`：`Overview` 新增 `costSource` prop（与 Rankings 既有模式一致）。
- `tests/analysis.test.mjs`：公式/认证/覆盖门回归 4 个用例（27 用例）。
- 归档：`openspec/archive/2026-11-11-cost-adjusted-pick/proposal.md`（补记），规格并入 `openspec/specs/ranking/spec.md`（Requirement: 性价比首选卡片）；口径决策见 `docs/adr/0019`（含三条修订记录）。

### 审查修复（评审循环两轮）

- 单站成本口径量纲缺陷：`analyze` 的 `costSource` 可切 aa/vals/livebench，此时 `r.cost` 是原始美元价，`log2(cost/100)` 量纲错误——卡片加口径门，仅综合口径出结论。
- 未认证多数决榜首陷阱：交叉点靠近低 λ 时多数决把中庸便宜模型顶上带名次徽章的榜首位——未认证态不再展示单一榜首，分档区间表（连续同选档合并）升为主角。
- 空态诚实归因：零输入（缺综合分/成本）与无合格候选（有调整分但被门挡）分开表述。
- 死三元 `pick: certified ? pick : pick`、重复 import、verdictPick/pickRow 双查（`creator` 带出后单查即可）。
- 测试注释与夹具事实不符（交点恰在扫描档 λ=20 而非档间）。

### 验证证据（2026-11-11 本机）

- 单测 149/149；覆盖率行 98.85 / 分支 91.42 / 函数 97.44（门禁 92 / 85 / 90）；ESLint、Prettier、`vite build` 全绿。
- 夹具三套 E2E（`npm run test:e2e:fixture`，自起 4318）全部 `passed: true`、errors 为空。
- 真实快照离线审计（`work/pool-audit.mjs`，只读 `data/snapshot.json` 不出网）：池 8、认证通过、全 λ 档首选 Claude Opus 5.5；未入池列表诚实标注「Claude Fable 5.2 仅 3/4 榜实测」。
- 4317 已在服务本批构建（服务端零改动，静态产物按请求读盘，`index-DA5toiTQ.js` 与 dist 一致）。

### 给下一棒的坑

- **非综合成本口径下 `r.cost` 是原始美元价**：任何新派生列都不得直接 `log2(cost/100)`；需要成本指数必须走综合口径或显式归一化（后者属口径变更须先写 ADR）。
- **percentiles 是 0–100 刻度**：`percentileFraction` 分子含 `100n` 因子；别按 0–1 处理。
- **认证态才有榜首，恒等式别破坏**：认证条件含 λ=0 档——去掉 λ=0 或改扫描起点，榜首恒等式就破坏（ADR-0023 起排序键含缺榜罚分，恒等式为「λ=0 档调整分最高者」，不再等于 composite 最高者）。
- **`sweepRuns` 区间行按 pick 天然唯一**：上包络顶线更替随 λ 单调（凸包络斜率非降），同一模型不会两次登顶；若扫描结构改动需重证此性质。
- **术语纪律**：用户可见文案禁「塌方 / λ / argmax」与内部文档编号引用（如「ADR-0019」，2026-11-11 实证泄漏三处已清）；代码注释与内部参数名（`lambda`）保留。审查文案时对照本清单全查，含文档编号。
- **`adjustedScores` 的 `complete` 只是描述字段（ADR-0023 起不再 gating）**：准入只看 composite+cost；自造行无需补 `complete: true`（旧版 fail-closed 行为已随覆盖门删除）。字段仍透传供其他卡片展示。

## 上一轮：Arena 源走本地代理 + 服务启动即全量刷新（2026-11-07）

### 决策与证据

- **根因**：Arena 数据源是 Hugging Face 官方 parquet 快照（`lmarena-ai/leaderboard-dataset`），本机直连 HF 不通而其余三站（AA / Vals / LiveBench）直连正常；Node 24 内置 `fetch()` 默认不读 `http_proxy`/`https_proxy`，所以即便 shell export 了代理，`fetchArena` 仍裸连报 `fetch failed`。经本地代理（`http://127.0.0.1:15732`）curl 与整套刷新均通。
- **修法走环境开关、不加服务端代码**：`NODE_USE_ENV_PROXY=1`（Node ≥ 24 的 EnvHttpProxyAgent）让内置 fetch 尊重代理环境变量。`package.json` 的 `dev` / `start` / `refresh` 三脚本内置该开关（未设代理变量时行为与原来完全一致）；`启动模型前沿.command` 导出代理地址 + 开关 + `no_proxy`/`NO_PROXY=localhost,127.0.0.1`——回环豁免必须显式设，否则启动器里的 `/api/status` 探活 curl 会被代理劫持。用 `${http_proxy:-…}` 写法，shell 已有代理变量优先于脚本默认值。
- **启动即刷新**：`server/index.mjs` 启动监听回调由「到期才刷」`refreshDue() ? refreshAll() : retryFailed()` 改为无条件 `refreshAll()`，日志打「正在执行启动刷新…」。仍受 `FRONTIER_AUTO_REFRESH=0` 闸门保护（夹具 E2E 与 CI 自起的 4318 服务用的正是它，确定性夹具路径零源站请求）；并发由 `runRefresh` 单飞守卫兜底（`running` 期间 60 秒定时器直接跳过）；单源失败走 `refreshSource` 既有缓存保留 + 退避重试，不污染数据。
- **归档**：本轮为运维/基建改动，不触及量化口径、分享契约、架构（无 ADR）；刷新调度在 `openspec/specs/`（仅 ranking、share-link）无对应规格，`openspec/changes/` 无在途提案——本轮无可归档变更。

### 实现位置

- `package.json`：三脚本加 `NODE_USE_ENV_PROXY=1`。
- `启动模型前沿.command`：导出代理与回环豁免（文件内中文注释说明缘由）。
- `server/index.mjs`：启动无条件 `refreshAll()`。
- `README.md`：自动更新语义改为「每次启动先全量刷一次」、新增 Arena 代理要求说明；`AGENTS.md` 已知坑新增 HF 代理条目、验证流程第 4 步注明重启即触发启动刷新。

### 验证证据（2026-11-07 本机）

- `NODE_USE_ENV_PROXY=1` + 代理环境下 `npm run refresh` 四站全绿（arena 419 / aa 726 / vals 34 / livebench 32）。
- 单测 145/145；覆盖率行 98.80 / 分支 91.89 / 函数 97.38（门禁 92 / 85 / 90）；ESLint、Prettier、`vite build` 全绿；启动器 `zsh -n` 语法通过。
- 夹具三套 E2E（`npm run test:e2e:fixture`，自起 4318、`FRONTIER_AUTO_REFRESH=0`）零错误，确认启动刷新不影响确定性夹具路径。
- 4317 重启实测：日志出现「正在执行启动刷新…」，约 4 秒后 `/api/status` 四源全 `success`，`/api/data` 四源 fresh（arena 419，sourceDate 2026-10-28）。

### 给下一棒的坑

- **Node 内置 fetch 不读代理变量是版本行为**：`NODE_USE_ENV_PROXY=1` 需 Node ≥ 24；engines 只要求 ≥ 22.12，老 Node 机器上该开关不生效——届时要么升级 Node，要么在服务代码显式 `setGlobalDispatcher(new EnvHttpProxyAgent())`（未做，简单优先）。
- **`no_proxy` 回环豁免别删**：启动器先 export 代理再跑 `/api/status` 探活，不豁免 127.0.0.1 的话探活请求会进代理，「已经运行」复用判断失效。
- **启动刷新只看 `FRONTIER_AUTO_REFRESH`、不看刷新间隔设置**：「每次启动都刷」是 owner 点名语义；刷新间隔只管运行期 60 秒定时器的 `refreshDue()` 节奏。彻底关自动抓取仍用 `FRONTIER_AUTO_REFRESH=0`（手动 `/api/refresh` 仍可用）。
- **代理地址变化时**：启动前自行 export `http_proxy` / `https_proxy`（环境变量优先于自动探测）；代理端口非常见值时用 `FRONTIER_PROXY_PORTS` 指定，探测顺序见 `AGENTS.md`。
- **真实抓取与 CI 已彻底解耦**：runner 网络可直连 HF 曾让定时巡检工作流可行，但该工作流已于 2026-11-14 移除（ADR-0014 修订）；PR 门禁仍走夹具（ADR-0014），`npm run refresh` 只在本地跑。

## 上一轮：前沿图修饰键滚轮缩放（2026-10-30）

> 后记（2026-11-07）：本轮已随 524a21c / 0fbda67 提交并推送，4317 现运行新构建；下文「尚未提交 / 4317 仍是旧构建」的表述已过时。

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
- **x 轴数据是 log10 编码 + value 轴（推 524a21c 后的缺陷修复）**：echarts dataZoom 的 percent 域是线性 value 域，log 轴视觉是 log 域——散点/前沿线/markArea 直接喂原始成本会让拖拽平移在视觉上变速变宽（owner 实测反馈「拖动时比例尺也变了」；旧代码同样存在，窗口大时感知剧烈）。修复：`point()` 编码 `Math.log10(cost)`、轴端点/刻度 formatter 按 `10**v` 反解、markArea xAxis 取 log10；修复后平移端点比值恒定（截图实证 143→143）。判据：拖拽前后「右端点值 ÷ 左端点值」不变。
- **拖拽/滚轮链路的浏览器取证必须用受信任输入**（`keyboard.down("Control")` + `mouse.wheel`）：合成 `dispatchEvent(new WheelEvent(...))` 在该链路不生效（zrender 监听挂 canvas，RoamController 在 target 相位 stop() 终止传播）；元素坐标要先 `scrollIntoViewIfNeeded` 再取 `boundingBox`，否则探索页 canvas 在视口下方、鼠标事件全部落空（第一轮复现被这个污染过）。
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

- **当前链路（ADR-0027，2026-11-25 起）**：抓页面 → `aaFlightText` 拼 `self.__next_f.push` 分片 → `aaInlineModels` 切 `initialModels` 数组 → `parseAA`。单请求，无解密。
- **Flight 分片是 JS 字符串字面量**，引号在原始 HTML 里呈转义形态；`JSON.parse` 恰好能还原其转义，不要自己写正则去反转义。
- **括号配对必须感知字符串字面量**：模型名、厂商名里会出现 `[]`、`{}`、引号与反斜杠，盲数括号会切错位置；`aaInlineModels` 的 `inStr`/`esc` 状态机就是为此。
- **`initialModels` 只含当前榜配置（290 条左右）**：历史条目与估算标记（`intelligenceIndexIsEstimated`）源站不再提供，行级 `estimated` 恒 false——不要把它当 bug 修；全量 766 条的通道已死，别试图「找回」。
- **结构变化的报错阶梯**：找不到 Flight 分片 → 找不到 `initialModels` → 数组不完整 → JSON 不合法，全部保留缓存不静默；诊断时按这个顺序对号。
- **跌幅闸门豁免 AA**：store 的相对跌幅比对（上次 ≥200 且这次 <一半）会把「全量基线 → 内联基线」这类契约迁移永久拒绝；AA 的完整性由适配器 `AA_MIN_ROWS`（200）把守，其余四源闸门不变（ADR-0027）。
- **官方免费 API 的 1 位小数是服务端行为**，不是显示层四舍五入，客户端无法恢复精度；且无 `isOpenWeights`，仍是备选里的下策（Pro 档字段更全，届时另立 ADR）。
- **AA 单站耗时几乎全是网络**：单请求抓 1.3 MB 级页面，本地解析合计毫秒级。
- **开放权重闸门的分母是可评估的对象行数**，不是 `models.length`：否则载荷里混进 `null` 会把「全都有标记」误判成缺失，报错信息也会指错方向。
- **抓取统一走 `requestSource`**：`getText` 只差 `Accept` 按原值传 `text/html,application/json,text/csv,*/*`，改抓取行为只改这一处。`lbMetadata` 的 `scalar` 查预编译正则表 `LB_SCALAR_RE`，**未登记的键返回 null**——不要图省事改成 `match(undefined)`，那会命中整个 body。
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
- **家族身份触发重审（ADR-0025）**：跨源同名异写不合并、维持源站标签口径；若源站出现官方统一模型 id，或仅差「+」的名字（如 Command A+ 与 Command A，当前被键误并、暂无计分影响）双边同时带当期有效分，再按官方 id / 保留「+」修复，并处理分享链接旧 id 兼容。

## 文件地图

- `src/Chart.jsx` 前沿散点 / 斩杀区；`src/main.jsx` 探索页（应用外壳、分享状态、模型全景表）；`src/Portal.jsx` 门户六页（排行榜 / 对比 / chip）。
- `src/analysis.mjs` 评分、帕累托与来源组合队列（`coverageCohorts`；`dominatedBy` 在此计算，供斩杀区与 tooltip 共用）；`src/portal.mjs` 榜单行池、证据深度摘要与导出；`src/share.mjs` 分享链接编解码；`src/Evidence.jsx` 证据徽标。
- `server/adapters.mjs` 五站摄取（AA 走页面内联载荷，见上）；`server/store.mjs` 抓取编排与落库闸门；`server/index.mjs` 单服务前后一体 + 定时抓取；`data/snapshot.json` 为聚合产物（已退出版本控制，ADR-0007）。
- 规格在 `openspec/specs/<能力>/spec.md`；ADR 在 `docs/adr/`。

### 追加迭代：编程优先排序视图（2026-11-11 深夜，ADR-0022）

owner 授权「做任何有必要做的事」并给出约束「尽量以 coding 为准，但不能牺牲榜单广度」。数据事实：四榜仅 LiveBench 有能力分项（suites），代表行已随 aggregate 透传（API 零改动）；编程数据天然不全（池内也可能缺分项，缺 LiveBench 整榜者无编程数据——含综合分最高的 Fable 5.2）。设计（ADR-0022）：**同一榜单双排序切换**（「综合性价比 / 编程优先」Segmented，不持久化）——编程分 = LiveBench 编程/长程代理/浏览器操作三轴均分百分位（owner 场景：后端编码 + 长程代理 + 终端/浏览器操作）；**缺编程分沉底以「—」标注不消失**（广度硬约束的落地规则）；**不产出调整分、不加冕**（λ=10 校准对象是 composite 刻度不可平移，伪造校准违诚实性红线），「首选」徽章仅在综合排序显示。实测信息分化：编程第 1 = GPT-6 Astra（94），综合首选 Gemini 4 Carbon 编程轴第 3（87）。新增 `codingIndices`/`valueRanking` view 参数 + 单测两处 + portal-e2e 切换断言（exact 匹配段控标签——编程说明文案含「综合性价比」字样，子串匹配 strict 撞车，又一处文案-断言耦合教训）。扩摄取（AA 分项/Vals 编程基准）登记为未来选项未做。

### 追加迭代：准入对齐天梯 + 历史校准缺榜罚分（2026-11-11 深夜，ADR-0023）

owner 二次否决覆盖门形态：「怎么还有 4 榜全测这回事？……哪怕只有单榜在榜，可以适当加惩罚分……新出的模型也可以有一席之地」，并点名要求 ① 罚分独立成项不折进成本轴 ② 用历史快照校准让新模型首测即在位 ③ 天梯/帕累托同理不剔除。落地（ADR-0023）：**准入 = 有综合分（≥2 榜）+ 综合成本（4/4 门删除，续排段消失）**；**专项缺榜罚分 15 分/榜**（`MISSING_BOARD_PENALTY`，独立于成本轴）。罚值校准：34 条四源历史记录重放 aggregate+analyze，12 次覆盖增长事件，每补一榜 composite 漂移均值 −15.4/中位 ≈−3/|漂移| 中位 23.4——中位近乎零证实 owner「首测即在位」直觉；取校准均值绝对值并诚实披露 n=12、标准误 ±32（CI 含 0）。敏感性平台 [10,23] 整表稳定（N=15≡23），榜首恒 Carbon。混合覆盖认证如实转 ✗（violations/sweep 分叉）→ 无首选徽章常态（owner 两次接受）。单榜模型 385 个（多为 Nova 实验快照等长尾）：天梯/帕累托核实**本就不剔除**（展示原始分无名次），单榜→名次映射无历史校准（1→2 事件=0）不强行排位，登记待数据。无综合分模型（747 个）卡片尾部数量披露不逐个列。15 的取值面对 owner「调研还是拍脑袋」质询：校准均值 + 诚实披露 CI 含 0 + 敏感性平台 [10,23] 兜底——校准/披露/敏感性三件套成为罚值取值的标准范式。实现：adjustedScores（MISSING_BOARD_PENALTY×缺榜数）、certifyNoBrainer sweep 同构含罚、valueRanking excludedCount 替代 gatedOut、Portal 单列表+行内 N/4 标注+尾部披露行、测试四处重写（30 项）、E2E 改「暂无法评估」披露行断言。
