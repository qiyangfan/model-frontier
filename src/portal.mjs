import { rankBy } from "./analysis.mjs";
import { NAMES } from "./presentation.mjs";
export const SOURCE_IDS = Object.keys(NAMES);

// AntD 在 descend 时对比较结果取反；缺失值必须在两个方向都排在最后。
export function compareNullableScores(valueOf) {
  return (a, b, sortOrder) => {
    const aValue = valueOf(a),
      bValue = valueOf(b);
    const aMissing = !Number.isFinite(aValue),
      bMissing = !Number.isFinite(bValue);
    if (aMissing || bMissing) {
      if (aMissing && bMissing) return 0;
      const missingLast = sortOrder === "descend" ? -1 : 1;
      return aMissing ? missingLast : -missingLast;
    }
    return aValue - bValue;
  };
}

// 并列同名次；没有综合分的模型保留在列表中，但不赋予名次。
export function rankedModels(rows) {
  return rankBy(rows, (r) => r.composite);
}
// 搜索按紧凑形式比对（忽略空白、连字符与下划线差异）：用户打「gpt 6.2」或「gpt6.2」
// 也能命中源站写法「GPT-6.2」。支持单字符串、'|' 分隔多词或词条数组（任一命中即保留）；
// 仅影响显示筛选，不改变分数、名次与前沿成员。
const searchKey = (value) => value.toLowerCase().replace(/[\s\-_]+/g, "");
export function splitSearchTerms(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split("|");
  const seen = new Set();
  const terms = [];
  for (const part of raw) {
    const trimmed = String(part ?? "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    terms.push(trimmed);
  }
  return terms;
}
export function effectiveSearchTerms(terms = [], draft = "") {
  return splitSearchTerms([
    ...splitSearchTerms(terms),
    ...splitSearchTerms(draft),
  ]);
}
export function emptySearch(initial = "") {
  return { terms: splitSearchTerms(initial), draft: "" };
}
export function searchTermsOf(search) {
  return effectiveSearchTerms(search?.terms, search?.draft);
}
export function encodeSearchTerms(search) {
  return searchTermsOf(search).join("|");
}
export function matchesSearchText(haystack, query) {
  const needles = splitSearchTerms(query).map(searchKey).filter(Boolean);
  if (!needles.length) return true;
  const target = searchKey(String(haystack ?? ""));
  return needles.some((needle) => target.includes(needle));
}
export function searchOptions(rows = [], { includeCreator = true } = {}) {
  const seen = new Set();
  const models = [];
  const creators = [];
  for (const row of rows) {
    const primary = String(row?.configuration ?? row?.name ?? "").trim();
    const creator = String(row?.creator ?? "").trim();
    if (primary && !seen.has(primary)) {
      seen.add(primary);
      models.push({
        value: primary,
        label:
          creator && creator !== primary ? `${primary} · ${creator}` : primary,
        searchText: `${row?.name ?? ""} ${row?.configuration ?? ""} ${creator}`,
      });
    }
  }
  if (includeCreator) {
    for (const row of rows) {
      const creator = String(row?.creator ?? "").trim();
      if (creator && !seen.has(creator)) {
        seen.add(creator);
        creators.push({
          value: creator,
          label: `厂商 · ${creator}`,
          searchText: creator,
        });
      }
    }
    creators.sort((a, b) => a.value.localeCompare(b.value));
  }
  return [...models, ...creators];
}
export function filterModels(
  rows,
  { query = "", creators = [], openness = "all", scoredOnly = false } = {},
) {
  return rows.filter(
    (r) =>
      matchesSearchText(
        `${r.name} ${r.configuration ?? ""} ${r.creator}`,
        query,
      ) &&
      (creators.length === 0 || creators.includes(r.creator)) &&
      (openness === "all" ||
        (openness === "open" && r.openWeights === true) ||
        (openness === "closed" && r.openWeights === false) ||
        (openness === "unknown" && r.openWeights == null)) &&
      (!scoredOnly || Number.isFinite(r.composite)),
  );
}
// 厂商快捷入口同时支持帕累托搜索和表格筛选：与「全部厂商」下拉同源于厂商集合（多选，可叠加反选），不参与评分。
// 固定编辑口径（非数据宣称）：全局基准 + 中国前沿各取最佳综合分领先的厂商，
// 覆盖帕累托前沿与顶尖性能两条线；标签用常见品牌名，note 只补充品牌名看不出的事实
// （tooltip 首段已给出源站 creator 字符串，note 不重复它）。
// 顺序按当前快照各厂商最佳综合分降序固定排布，不随筛选变化；搜索经 pq、表格筛选经 cr 参数入分享链接。
// 完整 61 家始终保留在厂商下拉与文本搜索中，chip 只是快捷入口，不是白名单。
export const VENDOR_CHIPS = [
  { value: "Anthropic", label: "Anthropic" },
  { value: "Google", label: "Gemini" },
  { value: "Meta", label: "Meta", note: "Llama / Muse 系列" },
  { value: "OpenAI", label: "OpenAI" },
  { value: "Xiaomi", label: "MiMo" },
  { value: "DeepSeek", label: "DeepSeek" },
  { value: "Z AI", label: "GLM" },
  { value: "Kimi", label: "Kimi" },
  { value: "StepFun", label: "Step" },
  { value: "Alibaba", label: "Qwen" },
];
// 计数口径与相邻的厂商下拉一致：统计当前视图的完整行池，不被搜索 / 开放状态提前裁剪；
// count 为 0 表示该视图没有对应厂商配置，chip 置灰，避免选出空结果。
export function vendorChipCounts(rows, chips = VENDOR_CHIPS) {
  const counts = new Map();
  for (const row of rows) {
    const creator = row?.creator;
    if (creator) counts.set(creator, (counts.get(creator) ?? 0) + 1);
  }
  return chips.map((chip) => ({ ...chip, count: counts.get(chip.value) ?? 0 }));
}
export function nativeRanking(
  models,
  source,
  { includeEstimated = false, includeHistorical = false } = {},
) {
  const rows = models
    .flatMap((m) =>
      (m.records[source] ?? []).map((r, i) => ({
        ...r,
        id: `${m.id}:${source}:${i}`,
        modelId: m.id,
        creator: r.creator ?? m.creator,
        openWeights: m.openWeights,
        openConflict: !!m.openConflict,
        configuration: r.configuration ?? r.name,
      })),
    )
    .filter(
      (r) =>
        (includeEstimated || !r.estimated) &&
        (includeHistorical || !r.deprecated),
    );
  rows.sort(
    (a, b) =>
      (Number.isFinite(b.score) ? b.score : -Infinity) -
        (Number.isFinite(a.score) ? a.score : -Infinity) ||
      a.name.localeCompare(b.name),
  );
  let previous = null,
    rank = null;
  return rows.map((r, i) => {
    if (!Number.isFinite(r.score)) return { ...r, rank: null };
    if (previous !== r.score) rank = i + 1;
    previous = r.score;
    return { ...r, rank };
  });
}
export function sanitizeSelection(ids, models) {
  return [...new Set(Array.isArray(ids) ? ids : [])]
    .filter((id) => models.some((m) => m.id === id))
    .slice(0, 4);
}

// 预算约束：按单一来源的真实美元任务成本筛选显示。未披露该来源成本或成本为零的模型无法核对预算，一并隐藏；
// 只影响显示范围，不改变综合分、名次与前沿。综合相对成本是跨源观察，不充当美元预算。
// 行形状锁定为聚合后的模型族（representatives 按来源取成本），禁止回退到顶层 costTask 造成跨源归因。
const budgetCostOf = (row, source) => {
  const cost = row.representatives?.[source]?.costTask;
  return Number.isFinite(cost) && cost > 0 ? cost : null;
};
export function applyBudget(rows, { budgetSource, budgetLimit } = {}) {
  if (
    !budgetSource ||
    budgetSource === "none" ||
    !Number.isFinite(budgetLimit) ||
    budgetLimit <= 0
  )
    return rows;
  return rows.filter((r) => {
    const cost = budgetCostOf(r, budgetSource);
    return cost != null && cost <= budgetLimit;
  });
}
export function budgetSummary(rows, options = {}) {
  const kept = applyBudget(rows, options);
  if (kept.length === rows.length) return null;
  return {
    hidden: rows.length - kept.length,
    missing: rows.filter((r) => budgetCostOf(r, options.budgetSource) == null)
      .length,
  };
}
// LiveBench 分类分是唯一带能力维度的来源；其他榜单没有对应维度，保持缺失。
export function livebenchSuiteKeys(models) {
  const counts = new Map();
  for (const m of models)
    for (const key of Object.keys(m.representatives?.livebench?.suites ?? {}))
      counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key]) => key);
}
export function coverageSummary(models, { includeEstimated = false } = {}) {
  const groups = Array(SOURCE_IDS.length + 1).fill(0);
  const counts = Object.fromEntries(SOURCE_IDS.map((s) => [s, 0]));
  for (const m of models) {
    let count = 0;
    for (const s of SOURCE_IDS) {
      const r = m.representatives[s];
      if (Number.isFinite(r?.score) && (includeEstimated || !r.estimated)) {
        counts[s]++;
        count++;
      }
    }
    groups[count]++;
  }
  return { counts, groups };
}
// 证据深度摘要（纯展示衍生，不改变任何分数、名次、前沿或导出）。
// 回答“这个融合排名的两两证据实际有多厚”：多少个模型真正拿到 PK 名次，
// 以及所有计入对决按“共同有效榜数”的分布。每场对决被双方各计一次，
// 因此先把各模型 opponentsBySharedSources 求和，再除以 2 还原真实场次。
// 不能只汇总已排名模型：低样本模型未获名次，但它与上榜模型的比赛仍进入
// BT 拟合，只计一侧会把场次算少。
// 随“允许估算”等质量开关实时变化，供融合排行榜摘要使用。
export function evidenceDepth(rows, totalModels = rows.length) {
  const ranked = rows.filter((r) => Number.isFinite(r.composite));
  const rankedCount = ranked.length;
  const byShared = {};
  let directed = 0;
  for (const r of rows) {
    const observed = r.record?.opponentsBySharedSources;
    if (!observed) continue;
    for (const key of Object.keys(observed)) {
      const value = observed[key] || 0;
      byShared[key] = (byShared[key] || 0) + value;
      directed += value;
    }
  }
  const matches = directed / 2;
  const twoDirected = byShared[2] || 0;
  // 用「有向计数 / 总有向计数」算占比：每场对决双方各计一次，约去相同的 /2，
  // 两个百分比精确互补到 100，避免 100 - x 的浮点尾差。
  const pct = (directedCount) =>
    directed > 0 ? (100 * directedCount) / directed : 0;
  return {
    rankedCount,
    totalModels,
    rankedShare: totalModels > 0 ? rankedCount / totalModels : 0,
    matches,
    twoBoardPct: pct(twoDirected),
    richBoardPct: pct(directed - twoDirected),
  };
}
export function nativeCsvExport(rows, meta = {}) {
  const cell = (v) =>
    '"' +
    (/^[=+\-@\t\r]/.test(String(v ?? "")) ? "'" : "") +
    String(v ?? "").replaceAll('"', '""') +
    '"';
  // 获取时间来自本地可编辑的缓存文件：解析失败留空，不让导出按钮抛异常。
  const fetchedAt = meta.fetchedAt
    ? (() => {
        const t = Date.parse(meta.fetchedAt);
        return Number.isFinite(t) ? new Date(t).toISOString() : "";
      })()
    : "";
  return (
    "\ufeff" +
    [
      [
        "名次",
        "模型配置",
        "厂商",
        "原始总分",
        "每次任务成本 USD",
        "输入单价 USD/百万 token",
        "输出单价 USD/百万 token",
        "估算",
        "历史条目",
        "获取时间",
        "源站版本",
        "投票数",
        "评分区间下限",
        "评分区间上限",
        "发布日期",
      ],
      ...rows.map((r) => [
        r.rank,
        r.configuration,
        r.creator,
        r.score,
        r.costTask,
        r.priceInput,
        r.priceOutput,
        r.estimated ? "是" : "否",
        r.deprecated ? "是" : "否",
        fetchedAt,
        meta.sourceDate ?? "",
        r.voteCount,
        r.scoreLower,
        r.scoreUpper,
        r.publishedAt,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
