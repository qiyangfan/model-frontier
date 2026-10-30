# AGENTS.md — AI 协作须知

「模型前沿」是一个小型单页分析台：聚合 Artificial Analysis、Vals、LiveBench 三榜公开数据，做融合排名、模型对比与前沿探索。**定位是小工具，不追求长期演化，任何设计以简单优先。**

## 硬约束

- **Node 前后一体单服务，不分离、不换栈、不引入后端框架**（见 `docs/adr/0001`）。
- 量化口径（名次百分位 + 算术平均、成本几何平均）维持现状，改动需先写 ADR（见 `docs/adr/0003`）。
- 诚实性红线见 `CONSTITUTION.md`，违反的改动直接不做。

## 常用命令

```sh
npm ci                # 安装依赖
npm run dev           # 开发模式（127.0.0.1:4317）
npm run build && npm start   # 生产模式（同一端口，二选一）
npm test              # 单元测试（node --test）
npm run test:coverage # 单测 + 覆盖率门禁（行 92 / 分支 85 / 函数 90）
npm run test:e2e && npm run test:portal && npm run test:evidence  # 三套 E2E（需服务已运行，本机 Chrome）
npm run lint          # ESLint（--max-warnings 0）
npm run lint:css      # Stylelint
npm run format:check  # Prettier 检查
```

## 改动后的验证流程（缺一不可）

1. `npm run test:coverage`（含门禁阈值）
2. `npm run build`
3. `npm run test:e2e:fixture`（在仓库内确定性夹具上跑三套 E2E，自起 4318 服务、不访问源站、不受实时数据漂移影响；与 CI 同一条数据路径）
4. 需要看真实数据表现时，再重启 4317 服务手动核对（先 `lsof -ti :4317 -sTCP:LISTEN` 找到旧进程；注意 `kill` 需带 `-sTCP:LISTEN` 才能精确命中）

## E2E 数据纪律

三套 E2E 一律跑在 `tests/fixtures/snapshot.json` 上（CI 用 `prepare-fixture.mjs` + `FRONTIER_DATA_DIR`，本地用 `npm run test:e2e:fixture`）。**禁止把模型 ID、模型名、厂商名或任何随源站变化的数量写进断言**：源站会下架模型、改判估算、重打分，写死的值只会在下次抓取后超时。需要具体模型时，从页面当前状态取（如排行榜前两行的 `data-row-key`、搜索框过滤后的行数）；需要稳定结论时改断言结构（如「搜索命中 \d+ 个模型」容忍 0），不要钉数据。

## 已知坑

- **antd Drawer 竞态**：`HistoryDrawer` 只在打开瞬间重置内容，关闭时清空会让抽屉在滑出动画中闪成空状态。改这块前先读该文件注释。
- **ECharts 滚轮**：ECharts 6 的共享 RoamController 滚轮一到绘图区就先 `stop()` 再按 per-zoom 标志取舍，因此滚轮分工在 `Chart.jsx` 的边界 capture 监听分流：普通滚轮 `stopPropagation` 保页面原生滚动（绝不 preventDefault）；⌘/Ctrl + 滚轮与触控板捏合（合成 Ctrl 滚轮）`preventDefault` 接管浏览器页面缩放后放行，由 inside dataZoom 的 `zoomOnMouseWheel: true` 双轴缩放。echarts 6.1 的 `'ctrl'` 绑定只映射 `ctrlKey` 不认 ⌘，门控判定在 `src/chartNav.mjs`。
- **x 轴是 log10 编码的 value 轴**：echarts dataZoom 的 percent 域是线性 value 域，而 log 轴的视觉是 log 域——散点直接喂原始成本会让拖拽平移在视觉上变速变宽（比例尺漂移）。因此 `Chart.jsx` 的 `point()` 把成本编码为 `Math.log10(cost)`，轴端点与刻度 formatter 按 `10**v` 反解，斩杀区 markArea 的 `xAxis` 同样取 log10。改图表数据坐标前先理解这层编码，别把原始值直接喂回轴上。
- **exhaustive-deps 豁免**：`qualityStamp` 是 sources excluded 状态的指纹，代替整对象身份；`shareTarget` 的依赖列表逐一枚举其输入。动这些代码前先理解为何豁免。
- **Tailwind 与残余 CSS 层叠**（ADR-0005）：样式在 JSX 工具类 + `src/style.css` 残余层。三条铁律：一，**禁止用工具类覆盖 antd 组件内部样式**——antd 运行时注入的 `.anticon{color:inherit}` 等无层规则恒胜层内工具类，需要覆盖 .ant-* 时写进残余层；二，`@import "tailwindcss/..."` 必须保持字符串形式，stylelint 已强制 `import-notation: "string"`——url() 记法会让 Tailwind 解析器静默不展开，产物里零工具类；三，**响应式断点只用自定义变体 `max-1180` / `max-1000` / `max-760`**（`@custom-variant` 定义为含边界 `width <= Npx`），禁止内置 `max-[Npx]:`——它编译为严格小于，与残余层媒体查询相差 1px 边界。
- **E2E 锚点类**：`budget-note`、`chart-legend`、`chart-stage`、`compare-facts`、`compare-selector`、`configuration-evidence`、`creator-chip`、`leader-row`、`model-link`、`preset-cards`、`ranking-intro`、`ranking-main-table`、`ranking-table`、`scoring-context`、`search-hint`、`source-card` 等类名被三套 E2E 的 `locator()` 直接引用，重构样式时必须原样保留（可与工具类共存）。

## 约定

- 代码注释与技术文档一律简体中文；日志与报错信息面向用户可中文。
- 禁止擅自 `git commit` / `git push`，完成后汇报等待指示。
- 方向性决策（口径、架构、契约）先写 `docs/adr/`，规格变更走 `openspec/`（见 `openspec/AGENTS.md`）。
