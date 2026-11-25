# 提案：退役无效「估算」与「历史配置」质量开关，保留过期/失败缓存开关

- 日期：2026-11-25（按已确认方案执行并归档）
- 状态：已实现并验收
- 涉及能力：ranking（质量控件与分析口径）、share-link（`est`/`eh`/`ne`/`nh` 参数退役）

## 动机

AA 2026-11-25 撤掉加密文件通道并回归页面内联 `initialModels`（ADR-0027）后：

1. 五源均不再提供 `estimated` 估算字段（`0/290`）；「允许 AA 估算分数」及单榜「包含估算配置」成为永不触发的假交互，违背诚实性红线。
2. 766 条历史归档通道下线后，AA 当前内联 290 条 `deprecated` 全为 `false`（`0/290`），其余四源无此字段，且代表选取本就按 `!deprecated` 优先；「排除历史配置」及单榜「包含历史配置」同样沦为空转。
3. 与之相对，「排除过期 / 失败缓存」（`excludeStale`）在任意来源抓取失败或超 24 小时未获取时真实生效，是必须保留的数据质量风控开关。

## 行为前后差异

- 前：侧边栏提供 3 个质量开关（「允许 AA 估算分数」「排除历史配置」「排除过期 / 失败缓存」），单榜提供「包含估算配置」「包含历史配置」；`analysis.mjs`、`portal.mjs`、`evidence.mjs`、`share.mjs` 维护全套 `includeEstimated`/`excludeHistorical` 与 `est`/`eh`/`ne`/`nh` 参数。
- 后：
  - 移除「允许 AA 估算分数」「排除历史配置」与单榜「包含估算配置」「包含历史配置」控件及状态/分析分支；默认口径固定排除估算与历史条目，仅保留「排除过期 / 失败缓存」（`excludeStale` / `es`）。
  - `share.mjs` 不再编码 `est`/`eh`/`ne`/`nh`，`decodeShareState` 对含这些参数的旧链接按已退役参数规范静默忽略、不破坏页面。
  - **保留不删**：`excludeStale` 全链路、`shared/representatives.mjs` 与 `server/identity.mjs` 的 `!deprecated` 排序兜底、`src/HistoryDrawer.jsx` 对旧历史快照 `estimated`/`deprecated` 字段的中文字典翻译、被动只读证据标签。

## 验证

- `npm run test:coverage`、`npm run lint`、`npm run lint:css`、`npm run format:check`、`npm run build`、`npm run test:e2e:fixture`（三套 E2E）全绿。
