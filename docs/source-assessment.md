# 额外来源调研（2026-10-19）

来源数量不等于独立证据数量。标准是公开可复核、适合综合比较、仍在更新、配置可识别、自动获取可验证；同一机构子榜、托管平台和二次聚合不重复计票。不同评测仍可能共享任务，不宣称四票统计独立。

| 来源                                                                                                                          | 核验结果                                                                                                             | 本次处理                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [Arena 官方数据](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset)                                              | text/latest/overall，416 配置，2026-10-15；后台下载及解码成功                                                        | 纳入一票，保留票数、源区间与配置；不提供成本   |
| [Hugging Face Open LLM Leaderboard](https://huggingface.co/spaces/open-llm-leaderboard/open_llm_leaderboard/discussions/1135) | 官方在 2025-03-13 宣布结束维护；Hugging Face 本身是托管平台                                                          | 不作为当前综合榜的一票                         |
| [Stanford HELM Capabilities](https://crfm.stanford.edu/helm/capabilities/latest/)                                             | 实测 config.js 为 v1.15.0；公开 summary.json 的 date 为 2025-11-24，缺乏当前前沿模型的同期可比覆盖                   | 不接入当前投票；不能用最近抓取时间掩盖发布陈旧 |
| [Epoch ECI](https://epoch.ai/eci)                                                                                             | 官方 eci_scores.csv 可下载，但 eci_benchmarks.csv 的 source 含厂商技术报告、Stanford CRFM、Vals 等，属于多方二次聚合 | 不作为额外独立票，避免重复放大相同结果         |

**结论（owner 2026-10-19 裁定）**：Arena 之外，HF Open LLM、HELM、Epoch ECI 三来源均不纳入，本项调研结案。当前评分固定为 AA、Vals、LiveBench、Arena 四票；后续纳入任何新来源需 owner 点名并更新 ADR（与 ROADMAP「明确不做」一致）。

HELM 核验文件：[config.js](https://crfm.stanford.edu/helm/capabilities/latest/config.js)、[summary.json](https://storage.googleapis.com/crfm-helm-public/capabilities/benchmark_output/releases/v1.15.0/summary.json)。Epoch 核验：[scores](https://epoch.ai/data/eci_scores.csv)、[底层来源](https://epoch.ai/data/eci_benchmarks.csv)。这些结论是本次获取时观察，不宣称源站永久停止更新。

代码、数学等专项榜有价值，但本工具当前融合目标是通用模型选择；直接把多项代码专项榜各算一票会隐式增加代码权重，因此本次不扩展专项投票。

# ModelDial 调研（2026-11-24，已结案：纳入为第五评分来源）

调研对象 https://modeldial.com/en，含三个榜：Coding Rankings、Text Capability Rankings、Harness Rankings。

## 可获取性与许可

Coding 榜公开只读 JSON，无需登录：`/data/overview.json`（`snapshot.entries` 137 条扁平快照，按站点规则收敛后 120 条 / 56 个模型；另有 `qualityScores.entries` 129 条覆盖 64 个模型）、`/api/v1/radar/latest.json`、`/data/reference-snapshots/latest.json`（588KB 逐题明细）、`/api/v1/radar/index.json`（历史批次索引）、`/openapi-v1.json`。`/en/data-license` 明确 ModelDial Public Radar 数据按 CC BY 4.0 发布，覆盖配置标识、推理档位、分数、耗时、参考成本、排名与批次元数据，不含题目本身。provenance 强于现有四源：批次 id、revision、questionPackVersion（coding-fast-v4.12）、graderVersion（sha256）、pricingSnapshotId、批次 sha256、score_policy_id、逐题 evidence。

Overall 口径 = backend 30% + visual aesthetics 15% + knowledge & reasoning 25% + frontend engineering 15% + maintainability 15%。已用页面数值反算核对（GPT-6.2 Astra 65.6 / 36.0 / 95.0 / 83.8 / 75.0 → 72.7），与站方一致。

## 独立性核验

ModelDial 方法论独立于 Artificial Analysis：自有私有测试集、自有 rubric、自有 graderVersion（sha256）、自有 pricingSnapshotId、批次 sha256、逐题 evidence；对 `/en/method` 全文检索 "artificial analysis / artificialanalysis / vals.ai / livebench" 零命中。**不是 AA 的二次聚合，也不是同一托管平台上的重复子榜。**

在本地快照 2026-11-24 上把 ModelDial overall 作为第五票注入现有 majority / Bradley-Terry 管线复跑：58 个候选模型中 34 个能按族名对上，1482 个有裁决对局里 ModelDial 投非平票的 406 个。同向率：AA 380/406 = 93.6%，LiveBench 85.8%，Vals 83.8%，Arena 60.3%。对现有四票多数，ModelDial 推翻 29 次、附和 312 次、打破 2:2 平票 61 次。

**同向率高的正确读法（已更正一处错误论证）**：曾据 93.6% 同向率主张「ModelDial 不是独立票、加它等于放大 AA 权重」。该论证不成立——两源底层评分不同即两次独立测量，结论一致是互相验证，不是重复计数。93.6% 真正说明的是「AA 的智能指数能代表真实工程能力」，是给 AA 背书，不是给 ModelDial 判冗余。该论点已撤回，不作为不纳入的理由。

## 结论（owner 2026-11-24 裁定，见 [ADR-0026](adr/0026-ModelDial-成为第五评分来源.md)）

**纳入，成为第五个评分来源；不进成本源。** 已落地：`shared/sources.mjs` 的 `SCORE_SOURCES` 增加 `modeldial`，`server/adapters.mjs` 新增适配器与端点，界面 / CSV 文案「四榜」改「五榜」。

**纳入理由**：

- **独有轴**：ModelDial 是五个来源里唯一有独立后端轴（30%，最大单项）与唯一有可维护性轴（15%，测改造成本 / 重构 / 调试诊断）的。owner 的需求口径是「工程能力为主、后端重于前端，另需工具调用、分析、出方案、debug、重构、终端操作」；AA 把这些全折成一个「智能指数」，Vals 只测业务流程，Arena 只测人类偏好，都答不了这道题。
- **真测量**：发布分与自算分的排名差异平均 0.9 位、最大 4 位、64 个模型中 0 个挪动 ≥5 位——不是调出来的数。
- **许可干净**：CC BY 4.0 明确覆盖分数、排名、批次元数据。
- **provenance 强于现有四源**：批次 id、revision、questionPackVersion、graderVersion（sha256）、pricingSnapshotId、批次 sha256、逐题 evidence。

**纳入后的实测影响**（2026-11-24 快照）：有综合分的模型 58 → 65；性价比榜入榜数 42 → 42，无新进（ModelDial 独有的 12 个模型没有成本，进不了性价比榜）；名次上升 12、下降 11、不变 19。最大移动：GPT-6.2 Sol 12→6、GPT-6.1 Sol 11→8、Gemini 4 Argon 5→11、Gemini 4 Hydrogen 7→12、Grok 4.7 25→22、Kimi K3 33→29、MiniMax-M3.1-Flash 30→27。五源覆盖度分布：5 榜 22 个、4 榜 14、3 榜 9、2 榜 20。

**同时裁定 Vals 与 Arena 不动**：不降权（加权即拿不可审计的数字改排名，owner 2026-11 已因「操纵榜单嫌疑」退回平权，ADR-0009 同源教训）；也不摘除——实测摘除会使有排名模型从 58 个掉到 43 个，且掉出的 20 个全是便宜档（Granite 4.2 3B/8B/30B、Gemini 3.5 Flash-Lite、gpt-oss-120b、Mistral Medium 3.5、Solar Pro 4、Qwen 3.8 Max 各档等），等于让榜只剩前沿模型，毁掉工具「省钱选型」的核心价值。Arena 在四源中话语权本就仅 3.8%，摘除几乎不改排名。

**缺榜罚分重校结论：删除，不是换数。** owner 2026-11-24 授权用五榜数据重校（「可能变 10，也可能变 20，也可能删掉」）。跑了留一榜法、历史覆盖增长事件法、横截面三种互相独立的方法，没有一种能复现 ADR-0023 的「每补一榜综合分漂移均值 −15.4」：留一榜法 n=110 得均值 −7.43 / 中位 −5.23；历史事件法 n=70 得均值 +87.9 / 中位 +44.4（对照组 n=3422 为 −1.9 / 0.0，差值真实）。测不出稳定常数的机制原因是设计使然：`src/analysis.mjs:170` 的对局成立条件是 `sharedSources >= 2`，一榜不只是多一票，它决定模型能不能跟某个对手比赛，所以「缺一榜的影响」取决于缺哪一榜、模型原本覆盖几榜。

更重要的是罚分本身无效：五源下性价比榜前 15 名在罚分 0 与 15 之间只差 1 个条目；覆盖 ≤3 榜的模型名次移动 ≤3 位，且始终在第 17 名以后。而它要防的事（缺榜高估）已由拟合本身承担——缺一榜直接减少可比对手，低覆盖模型天然落到榜尾（五榜全齐的前几名综合分 1548/1532/1516，覆盖最少的模型最高 1303，差 200 多分）。故 `MISSING_BOARD_PENALTY` 整个删除，调整分公式回到 `composite − λ·log2(cost/100)`；λ=10 仍可追溯（ADR-0019）。覆盖面改为直接展示，不再折成分数里的暗项。

## 另两榜

- **Harness Rankings**：排 harness 工具（23 个：Claude Code、Codex、Kimi Code、OpenCode、Cline CLI 等），统一配底座模型 DeepSeek Flash 1017，与「选哪个模型」不同题。Overall = 任务表现 70% + 稳定完成率 20% + 时间效率 5% + 成本效率 5%。且页面无结构化端点（`harness-snapshots/current.json` 等均 404），只能解析 HTML，快照 11/22。
- **Text Capability Rankings**：数据在 `reference.modeldial.com/writing-snapshots/current.json`，39 个模型各 1 配置，维度为 output / understanding 加 8 个中文写作子轴（中文表达、内容完成度等）。无成本、无 license 声明、无历史索引，覆盖窄。

## 适配器已定死的规则（ADR-0026）

只取 Coding 榜；同一模型多条 route / candidate_id（27 种 route）按站点声明取最高分的完整配置；`hiddenModelIds` 9 个 id（命中 14 条快照条目）与 `product_kind === "bot"` 的外部产品评测（2 条）剔除；被 `listing_replaces` 顶掉的旧 route 剔除（该字段的语义是「本条顶掉被声明的那条」，要剔的是后者）；成本口径不进 `COST_SOURCES`——它是「跑自家私有套件的参考成本」（版本化 `pricingSnapshotId`），与另三源的「干一个任务花多少钱」不是同一单位语义；总分按 `qualityScores.weights` 五轴加权自算（120 条有站点总分的条目全部对上，中位差 0.003 分、最大 0.29 分），不直读 `overall_score`，以便权重变化能被明确发现。

**已知局限**：ModelDial 的 `aesthetic` 轴（15%）测界面美观，对「全栈开发」视角是偏靶轴。本 ADR 不为此重设权重（自设权重即不可审计），该信号以原始五轴之一进入投票，与其他四票同权。若将来要收窄，须另立 ADR。

## 若将来重新评估需先解决的问题

模型命名需别名映射（如 `anthropic/claude-sonnet-5.5`、`k3`、`meta/muse-wonder`、`qwen3.8-flash`、`gpt-6.2-astra`、`google/gemini-4-neon`）——ModelDial 用 `model_id` + `candidate_id` 双标识，与现有四源的命名体系不同，`familyKey()` 目前靠显示名归一。
