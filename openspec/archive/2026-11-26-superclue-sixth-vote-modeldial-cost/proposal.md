# 提案：SuperCLUE 第六评分票与 ModelDial 进入成本来源

- 日期：2026-11-26
- 状态：已实现并验收（2026-11-26）
- 决策依据：[ADR-0028](../../docs/adr/0028-SuperCLUE-成为第六评分来源.md)（评分票）、[ADR-0029](../../docs/adr/0029-ModelDial-进入成本来源与成本候选实证门槛.md)（成本源与实证门槛）
- 涉及能力：ranking（评分票数与成本来源）、share-link（`cm` 来源组合白名单）

## 动机

1. **第六评分票**：SuperCLUE（月更中文通用测评）治疗已知痛点——单源国产模型因不足两榜无法进入主榜（Qwen3.8-Flash-Next 先例）。注入实验（2026-11-25 快照）：有排名模型 61→65，前 7 名不动，对既有裁决推翻 0、破平票 9、造平票 1（由既有辅助分决胜兜底），定位为国产中档补充票。
2. **成本源翻案**：owner 质询成本候选门槛过苛后实证复核，ModelDial 相对成本与在籍三源的一致性（ρ 0.80–0.92）优于在籍成员彼此（0.71–0.88），ADR-0026 的「题量无平均效应」理论被推翻（平均化单位是任务内部 API 调用次数而非题数）。

## 行为前后差异

### 评分票数（ranking）

- 前：`SCORE_SOURCES = ["aa", "vals", "livebench", "arena", "modeldial"]` 五票；主榜文案「五榜」；对局共同榜明细 2–5 档。
- 后：`SCORE_SOURCES` 增 `superclue` 六票；文案改「六榜」；共同榜明细档位从 `SCORE_SOURCES.length` 派生（现有代码已派生，验证不回归即可）。SuperCLUE 摄取只读通用榜「模型名称」「总分」两列（分轴列每月漂移，不读）；月度文件地址按当前年月拼、失败回退上一月；`sourceDate` 记文件月份；来源说明如实标注「国外模型站方仅作参考不参与排名，本项目同权投票」「站方无数据许可声明」「月更、旧月文件即删」。不做人工别名（ADR-0025），`familyKey` 归一落不进既有族的自然成为单源条目。

### 成本来源（ranking）

- 前：`COST_SOURCES = ["aa", "vals", "livebench"]`，modeldial 行无 `costTask`；单站成本口径与预算来源可选 AA / Vals / LiveBench。
- 后：`COST_SOURCES` 增 `modeldial` 四源；从最高分完整配置读取 `costTask = metrics.backend.estimated_api_cost_usd`，展示为整轮后端评测的美元估算费用，按该来源中位数计算比值后参与综合相对成本。单站成本与预算均使用每次任务的美元成本，来源仍为 AA / Vals / LiveBench。`cs=modeldial` / `bs=modeldial` 按既有规则回落默认。

### 分享链接（share-link）

- 前：`cm` 来源组合白名单枚举五票组合。
- 后：白名单扩至六票组合；`cs` / `bs` 合法值集合不变（不含 modeldial），未知枚举回落默认的既有 Scenario 覆盖新字符串。

## 预期影响（2026-11-25 快照实测）

- 主榜：有排名 61 → 65（Qwen 3.8 Max 0902 #26、Doubao Seed 2.1 Pro (260915) #38、Hy4 Preview #43、Qwen3.8-Flash #48 首次获得名次）；Gemini 4 Argon 11→8；Qwen 4 Max 16→15 与 Kimi K3.1 Pro 15→16 互换；其余多为 ±1 连坐顺移。
- 性价比体系：6 个模型族新获成本资格（minimaxm3、hy4preview、claudefable51、gpt56terra、grok46、qwen38）；其余有成本模型指数被四源几何平均重算，榜单数值整体变化属口径演进而非缺陷。

## 实现与规格归档

- 六个评分来源为 AA、Vals、LiveBench、Arena、ModelDial、SuperCLUE；ModelDial 进入四源综合成本，单次任务成本和预算仍只使用 AA、Vals、LiveBench。
- SuperCLUE 适配器、ModelDial 成本读取、页面说明、CSV、分享来源组合、历史记录及固定数据夹具均已实现并补齐测试。
- 当前行为已并入 `openspec/specs/ranking/spec.md` 和 `openspec/specs/share-link/spec.md`；原进行中提案移至本归档目录。

## 验收

1. `tests/adapters.test.mjs` 新增 SuperCLUE 摄取用例：两列读取、月度地址发现与回退、非法/缺列报错不静默（宪法红线：解析失败明确报错）；modeldial `costTask` 摄取与代表行跟随。
2. `shared/sources.mjs` 的 `SOURCE_NAMES`、界面文案、CSV 列（SuperCLUE 分列追加在六源列位；对局共同榜档位派生验证）同步。
3. 夹具 `tests/fixtures/snapshot.json` 补 `superclue` 键与 modeldial 成本字段；E2E 断言不钉模型名与数量（数据纪律）。
4. 全量验证：`npm run test:coverage`、`npm run lint`、`npm run lint:css`、`npm run format:check`、`npm run build`、`npm run test:e2e:fixture` 均通过；覆盖率 186/186，夹具 E2E 三套通过。
5. 重启 4317 后核对 `/api/status` 六个来源均为 `success`，记录于本轮 handoff。
