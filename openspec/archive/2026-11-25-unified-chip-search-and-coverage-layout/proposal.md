# 提案：四处搜索框统一多选 chip 与模型全景表「榜单覆盖」列重叠修复

- 日期：2026-11-25（按已实现并评审闭环的行为归档）
- 状态：已实现并验收
- 涉及能力：ranking（搜索交互与模型全景表展示层）、share-link（搜索参数多词条 `|` 编码）

## 动机

1. **多选 chip 搜索需求**：原有帕累托搜索、模型全景表过滤、排行榜搜索与历史配置搜索均只支持单文本关键字，无法同时输入或点选多个模型、配置或厂商做联合对比/高亮。
2. **「榜单覆盖」列越界重叠**：接入第五评分源 ModelDial 后，模型全景表「榜单覆盖」列仍维持 `width: 140` 且直接渲染 `MODELDIAL`（9 字母）与 `flex-nowrap`，导致右侧溢出覆盖到相邻「前沿 / 状态」列。

## 行为前后差异

### 四处搜索框（统一接入 `SearchChipInput`）

- 前：各自使用普通 `<Input>` 单框文本过滤，互不提供候选项；帕累托搜索（`main.jsx`）未忽略空格/连字符/下划线差异，与排行榜 `filterModels` 口径不一致。
- 后：
  - 统一复用 `src/SearchChipInput.jsx`（Ant Design `Select mode="tags"` + `SearchOutlined` 前缀 + `allowClear` + `maxTagCount="responsive"` + `tokenSeparators={["|", ",", "，"]}`）。
  - 支持自由输入关键词实时预览（未提交草稿态立即参与过滤/高亮）、回车/分隔符/失焦转为 chip，以及从下拉候选中点选模型、配置或厂商；多个 chip 与草稿按「任一命中（OR）」联合匹配，并统一使用 `searchKey` 归一化（忽略空白、连字符与下划线差异）。
  - 下拉排序经 `filterSort` 让精确匹配的选项（如输入精确厂商名）置顶，避免回车误选排在首位的具体模型；`latestRef` 同步维护 `terms` 与 `draft`，避免同帧多回调链丢失粘贴词条。

### 分享链接契约（share-link）

- 前：`q`、`pq`、`rq` 仅作单关键词透传。
- 后：多词条以 `|` 连接（如 `pq=MiMo|Anthropic`），消费端 `splitSearchTerms` 统一拆解；单词旧分享链接无分隔符，保持向后兼容，编码字段名与既有 `MAX_TEXT` 规则不变（见 `docs/adr/0002` 2026-11-25 修订记录）。

### 模型全景表「榜单覆盖」列

- 前：`width: 140` + `flex` 不换行 + `modeldial` 渲染为 `MODELDIAL`，横向越界重叠到「前沿 / 状态」列。
- 后：`modeldial` 徽章缩写为 `MD`（与总览 `SOURCE_SYMBOL` 及 `livebench` 的 `LB` 对齐，tooltip 仍保留完整名称 `ModelDial` 与原始分），容器加 `flex-wrap` 与 `whitespace-nowrap`，列宽增至 `195`（表格 `scroll.x` 增至 `1050`）。

### 不变量（诚实性边界）

- 搜索筛选只改变显示与图上高亮，不改变任何评分、名次、前沿成员或 CSV 导出口径。

## 实现

`src/portal.mjs`（`splitSearchTerms` / `effectiveSearchTerms` / `emptySearch` / `searchTermsOf` / `encodeSearchTerms` / `matchesSearchText` / `searchOptions`）、`src/SearchChipInput.jsx`、`src/main.jsx`（帕累托搜索、模型全景表过滤与「榜单覆盖」列宽/徽章修复）、`src/Portal.jsx`（排行榜搜索）、`src/HistoryDrawer.jsx`（历史配置搜索）、`src/style.css`（`.search-chip-select` 响应式规则替代原 `.ant-input-affix-wrapper`）。

## 规格与文档

- `docs/adr/0002-分享链接完整口径编码.md`（修订记录增补 `q`/`pq`/`rq` 多词条 `|` 编码）
- `openspec/specs/share-link/spec.md`（新增「搜索词条多选 chip 编码」Scenario）
- `openspec/specs/ranking/spec.md`（新增「统一多选 chip 搜索与表格覆盖徽章展示」Requirement）

## 验证

- `npm run test:coverage`：全部单测通过（覆盖率行 98.69% / 分支 91.18% / 函数 97.00%，含 `tests/portal.test.mjs` 与 `tests/share.test.mjs` 新增用例）。
- `npm run lint`、`npm run lint:css`、`npm run format:check`、`npm run build` 全绿。
- `npm run test:e2e:fixture`：三套夹具 E2E 全绿（覆盖帕累托/排行榜/全景表多选 chip OR 并集、历史搜索控件、以及「榜单覆盖」列五枚徽章与「前沿 / 状态」列零重叠边界盒校验）。
- 本机 `4317` 服务配合 Clash Verge Rev（零节点直连 + 纯 IP DoH 防污染）启动，五源全 `success`。
