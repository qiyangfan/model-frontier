import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/analysis.mjs";
import { colorFor, FALLBACK_COLORS } from "../src/presentation.mjs";
import { SCORE_SOURCES } from "../shared/sources.mjs";
import {
  VENDOR_CHIPS,
  compareNullableScores,
  coverageSummary,
  evidenceDepth,
  filterModels,
  nativeCsvExport,
  nativeRanking,
  rankedModels,
  sanitizeSelection,
  vendorChipCounts,
} from "../src/portal.mjs";

// ---- 厂商配色感知距离守卫用的色彩数学（sRGB -> CIELAB -> CIEDE2000） ----
const labOfHex = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const lin = [
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
  ].map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const X = 0.4124564 * lin[0] + 0.3575761 * lin[1] + 0.1804375 * lin[2];
  const Y = 0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.072175 * lin[2];
  const Z = 0.0193339 * lin[0] + 0.119192 * lin[1] + 0.9503041 * lin[2];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const fx = f(X / 0.95047),
    fy = f(Y),
    fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const dE2000 = (a, b) => {
  const [L1, A1, B1] = a,
    [L2, A2, B2] = b;
  const Cp = (Math.hypot(A1, B1) + Math.hypot(A2, B2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cp ** 7 / (Cp ** 7 + 25 ** 7)));
  const ap = (1 + G) * A1,
    ap2 = (1 + G) * A2;
  const Cp1 = Math.hypot(ap, B1),
    Cp2 = Math.hypot(ap2, B2);
  const hp1 = ((Math.atan2(B1, ap) * 180) / Math.PI + 360) % 360;
  const hp2 = ((Math.atan2(B2, ap2) * 180) / Math.PI + 360) % 360;
  const dLp = L2 - L1,
    dCp = Cp2 - Cp1;
  let dhp;
  if (Cp1 * Cp2 === 0) dhp = 0;
  else if (Math.abs(hp2 - hp1) <= 180) dhp = hp2 - hp1;
  else dhp = hp2 - hp1 > 0 ? hp2 - hp1 - 360 : hp2 - hp1 + 360;
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp * Math.PI) / 360);
  const Lbp = (L1 + L2) / 2,
    Cbp = (Cp1 + Cp2) / 2;
  let hbp;
  if (Cp1 * Cp2 === 0) hbp = hp1 + hp2;
  else if (Math.abs(hp1 - hp2) <= 180) hbp = (hp1 + hp2) / 2;
  else hbp = hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2;
  const T =
    1 -
    0.17 * Math.cos(((hbp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hbp - 63) * Math.PI) / 180);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin((2 * dTheta * Math.PI) / 180) * RC;
  return Math.sqrt(
    (dLp / SL) ** 2 +
      (dCp / SC) ** 2 +
      (dHp / SH) ** 2 +
      RT * (dCp / SC) * (dHp / SH),
  );
};
const model = (id, representatives, extra = {}) => ({
  id,
  name: id,
  creator: "Lab",
  representatives,
  records: Object.fromEntries(
    Object.entries(representatives).map(([s, r]) => [s, [{ name: id, ...r }]]),
  ),
  ...extra,
});
test("fusion ranking includes scored models without costs and preserves ties and unscored records", () => {
  const a = analyze(
    [
      model("a", { aa: { score: 20 }, vals: { score: 20 } }),
      model("b", { aa: { score: 20, costTask: 1 }, vals: { score: 20 } }),
      model("c", { aa: { score: 10, costTask: 1 }, vals: { score: 10 } }),
      model("unscored", {}),
    ],
    { costSource: "aa", minOpponents: 1 },
  );
  const ranked = rankedModels(a.rows);
  assert.deepEqual(
    ranked.map((r) => r.rank),
    [1, 1, 3, null],
  );
  assert.equal(ranked[0].plottable, false);
  assert.equal(ranked[0].composite, 1000);
  assert.equal(ranked.length, 4);
});
test("display filters preserve original rank and scores", () => {
  const rows = [
    {
      id: "a",
      name: "A",
      creator: "Lab",
      rank: 1,
      composite: 80,
      openWeights: false,
    },
    {
      id: "b",
      name: "B",
      creator: "Lab",
      rank: 2,
      composite: 70,
      openWeights: true,
    },
    {
      id: "c",
      name: "C",
      creator: "Other",
      rank: null,
      composite: null,
      openWeights: null,
    },
  ];
  assert.deepEqual(
    filterModels(rows, { query: " b ", openness: "open", scoredOnly: true }),
    [rows[1]],
  );
  assert.equal(filterModels(rows, { openness: "unknown" })[0].id, "c");
  // 厂商多选：空集合等于全部，非空集合按任一命中保留（叠加筛选语义）
  assert.equal(filterModels(rows, { creators: ["Other"] }).length, 1);
  assert.deepEqual(
    filterModels(rows, { creators: ["Lab", "Other"] }).length,
    3,
  );
  assert.equal(filterModels(rows, { creators: [] }).length, 3);
  assert.equal(rows[1].rank, 2);
});
test("search treats spaces, hyphens and underscores as the same separator", () => {
  const rows = [
    { id: "g1", name: "GPT-6.2 Astra (Max)", creator: "OpenAI" },
    { id: "g2", name: "GPT-6.1 Sol (Max)", creator: "OpenAI" },
    { id: "q", name: "Qwen3.8-Max", creator: "Alibaba" },
  ];
  for (const query of ["GPT-6.2", "gpt 6.2", "gpt6.2", " gpt_6.2 "])
    assert.deepEqual(
      filterModels(rows, { query }).map((r) => r.id),
      ["g1"],
    );
  assert.equal(filterModels(rows, { query: "qwen 3.8" }).length, 1);
  // 多词 chip 检索：数组或 '|' 串按任一命中（OR）匹配，且支持草稿实时并入与候选项生成
  assert.deepEqual(
    filterModels(rows, { query: ["gpt 6.2", "qwen 3.8"] }).map((r) => r.id),
    ["g1", "q"],
  );
  assert.deepEqual(
    filterModels(rows, { query: "gpt 6.2|qwen 3.8" }).map((r) => r.id),
    ["g1", "q"],
  );
});
test("multi-chip search helpers split, encode, match, and build deduplicated options", async () => {
  const {
    emptySearch,
    searchTermsOf,
    encodeSearchTerms,
    matchesSearchText,
    searchOptions,
  } = await import("../src/portal.mjs");
  const s = emptySearch(" GPT-6.2 | | GPT-6.2 | qwen ");
  assert.deepEqual(s, { terms: ["GPT-6.2", "qwen"], draft: "" });
  assert.deepEqual(searchTermsOf({ terms: ["GPT-6.2"], draft: "qwen" }), [
    "GPT-6.2",
    "qwen",
  ]);
  assert.equal(
    encodeSearchTerms({ terms: ["GPT-6.2"], draft: "qwen" }),
    "GPT-6.2|qwen",
  );
  assert.equal(matchesSearchText("GPT-6.2 Astra", "-"), true);
  assert.equal(matchesSearchText("Qwen3.8-Max", ["gpt6.2", "qwen 3.8"]), true);
  assert.equal(matchesSearchText("Claude", ["gpt6.2", "qwen 3.8"]), false);
  const opts = searchOptions([
    { name: "Model A", configuration: "Model A (High)", creator: "Zeta" },
    { name: "Model A", configuration: "Model A (High)", creator: "Zeta" },
    { name: "Alpha", creator: "Alpha" },
  ]);
  assert.deepEqual(
    opts.map((o) => o.value),
    ["Model A (High)", "Alpha", "Zeta"],
  );
  assert.equal(opts[0].label, "Model A (High) · Zeta");
  assert.equal(opts[1].label, "Alpha");
  assert.equal(opts[2].label, "厂商 · Zeta");
});
test("single source ranking keeps active configurations and no cost requirement, excluding estimates and history", () => {
  const models = [
    model(
      "family",
      { aa: { score: 40 } },
      {
        records: {
          aa: [
            { name: "Family low", score: 40, costTask: null },
            { name: "Family high", score: 50, costTask: 2 },
            { name: "Family old", score: 60, deprecated: true },
            { name: "Family estimated", score: 80, estimated: true },
          ],
        },
      },
    ),
  ];
  const rows = nativeRanking(models, "aa");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Family high");
  assert.equal(rows[1].rank, 2);
  assert.equal(rows[1].costTask, null);
  assert.equal(rows[0].modelId, "family");
});
test("native ranking gives ties the same position and no position for missing total score", () => {
  const rows = nativeRanking(
    [
      model("a", { aa: { score: 12 } }),
      model("b", { aa: { score: 12 } }),
      model("c", { aa: { score: 0 } }),
      model("d", { aa: { score: null } }),
    ],
    "aa",
  );
  assert.deepEqual(
    rows.map((r) => r.rank),
    [1, 1, 3, null],
  );
});
test("comparison selection rejects stale ids, duplicates and more than four choices", () => {
  const models = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  assert.deepEqual(
    sanitizeSelection(["x", "a", "a", "b", "c", "d", "e"], models),
    ["a", "b", "c", "d"],
  );
  assert.deepEqual(sanitizeSelection({}, models), []);
});
test("coverage counts evidence across active sources and excludes estimated scores", () => {
  const models = [
    model("a", {
      aa: { score: 1 },
      vals: { score: 2 },
      livebench: { score: 3 },
    }),
    model("b", { aa: { score: 4, estimated: true } }),
    model("c", { vals: { score: 2 } }),
  ];
  // 分组数组长度 = 来源数 + 1（0 榜那一档也在里面），按来源清单推导，加票不必回来改
  const buckets = (counts) =>
    Array.from({ length: SCORE_SOURCES.length + 1 }, (_, i) => counts[i] ?? 0);
  assert.deepEqual(coverageSummary(models), {
    counts: {
      aa: 1,
      vals: 2,
      livebench: 1,
      arena: 0,
      modeldial: 0,
      superclue: 0,
    },
    groups: buckets({ 0: 1, 1: 1, 3: 1 }),
  });
});
test("coverage counts Arena scores into the distribution and never lets them raise task-cost coverage", () => {
  const models = [
    model("a", {
      aa: { score: 1 },
      vals: { score: 2 },
      livebench: { score: 3 },
      arena: { score: 1400 },
    }),
    model("b", { arena: { score: 900 } }),
  ];
  const summary = coverageSummary(models);
  assert.equal(summary.counts.arena, 2);
  // a 有五榜有效分进最高档；b 只有 Arena 一榜，Arena 不提供成本也不能抬高档位统计。
  assert.deepEqual(
    summary.groups,
    Array.from({ length: SCORE_SOURCES.length + 1 }, (_, i) =>
      i === 1 || i === 4 ? 1 : 0,
    ),
  );
});
test("native CSV exports raw score and cost with spreadsheet injection protection", () => {
  const csv = nativeCsvExport([
    {
      rank: 1,
      configuration: "=formula",
      creator: "Lab",
      score: 12.34,
      costTask: 0.1,
      estimated: false,
      deprecated: false,
    },
  ]);
  assert.ok(csv.includes("'=formula"));
  assert.ok(csv.includes("12.34"));
  assert.ok(csv.includes("0.1"));
  assert.ok(csv.includes("原始总分"));
});
test("open leader ranks preserve ties within the open subset without recalculating scores", () => {
  const rows = [
    { id: "closed", name: "Closed", composite: 100, openWeights: false },
    { id: "a", name: "A", composite: 90, openWeights: true },
    { id: "b", name: "B", composite: 90, openWeights: true },
    { id: "c", name: "C", composite: 80, openWeights: true },
  ];
  const open = rankedModels(rows.filter((r) => r.openWeights === true));
  assert.deepEqual(
    open.map((r) => r.rank),
    [1, 1, 3],
  );
  assert.deepEqual(
    open.map((r) => r.composite),
    [90, 90, 80],
  );
});
test("native rows preserve conflicting openness evidence from the model family", () => {
  const models = [
    model(
      "a",
      { aa: { score: 10, openWeights: true } },
      { openWeights: null, openConflict: true },
    ),
  ];
  const row = nativeRanking(models, "aa")[0];
  assert.equal(row.openConflict, true);
  assert.equal(row.openWeights, null);
});

import {
  applyBudget,
  budgetSummary,
  livebenchSuiteKeys,
} from "../src/portal.mjs";
test("budget filter uses one source USD cost, hides unverifiable models and never mutates rows", () => {
  const rows = [
    {
      id: "a",
      representatives: { aa: { costTask: 1 }, vals: { costTask: 9 } },
    },
    { id: "b", representatives: { aa: { costTask: 3 } } },
    { id: "c", representatives: { aa: { costTask: null } } },
    { id: "d", representatives: {} },
  ];
  const filtered = applyBudget(rows, { budgetSource: "aa", budgetLimit: 2 });
  assert.deepEqual(
    filtered.map((r) => r.id),
    ["a"],
  );
  assert.equal(rows.length, 4);
  assert.equal(applyBudget(rows, {}).length, 4);
  assert.equal(
    applyBudget(rows, { budgetSource: "none", budgetLimit: 2 }).length,
    4,
  );
  assert.equal(
    applyBudget(rows, { budgetSource: "aa", budgetLimit: 0 }).length,
    4,
  );
});
test("budget summary reports hidden and unverifiable counts", () => {
  const rows = [
    { id: "a", representatives: { aa: { costTask: 1 } } },
    { id: "b", representatives: { aa: { costTask: 9 } } },
    { id: "c", representatives: {} },
  ];
  assert.deepEqual(
    budgetSummary(rows, { budgetSource: "aa", budgetLimit: 2 }),
    { hidden: 2, missing: 1 },
  );
  assert.deepEqual(
    budgetSummary(rows, { budgetSource: "aa", budgetLimit: 9 }),
    { hidden: 1, missing: 1 },
  );
  assert.equal(budgetSummary(rows, {}), null);
});
test("livebench suite keys come only from livebench representatives and stay sorted", () => {
  const models = [
    {
      representatives: { livebench: { suites: { reasoning: 1, coding: 2 } } },
      records: {},
    },
    {
      representatives: { livebench: { suites: { coding: 3, research: 4 } } },
      records: {},
    },
    { representatives: { aa: { suites: { phantom: 1 } } }, records: {} },
  ];
  assert.deepEqual(livebenchSuiteKeys(models), [
    "coding",
    "reasoning",
    "research",
  ]);
  assert.deepEqual(livebenchSuiteKeys([]), []);
});
test("native CSV carries fetch time and release label for reproducibility", () => {
  const csv = nativeCsvExport(
    [
      {
        rank: 1,
        configuration: "A",
        creator: "Lab",
        score: 1,
        costTask: 1,
        priceInput: 1,
        priceOutput: 1,
        estimated: false,
        deprecated: false,
      },
    ],
    { fetchedAt: "2026-10-16T02:05:52.769Z", sourceDate: "10/13/2026" },
  );
  assert.ok(csv.includes("获取时间"));
  assert.ok(csv.includes("2026-10-16T02:05:52.769Z"));
  assert.ok(csv.includes("源站版本"));
  assert.ok(csv.includes("10/13/2026"));
});
test("native CSV exports Arena votes, interval and publish date for single-board review", () => {
  const csv = nativeCsvExport([
    {
      rank: 1,
      configuration: "Gemini 4 Argon (High)",
      creator: "Google",
      score: 1532.34,
      costTask: null,
      voteCount: 4904,
      scoreLower: 1500,
      scoreUpper: 1560,
      publishedAt: "2026-10-15",
      estimated: false,
      deprecated: false,
    },
  ]);
  assert.ok(csv.includes("投票数"));
  assert.ok(csv.includes("评分区间下限"));
  assert.ok(csv.includes("发布日期"));
  assert.ok(csv.includes("4904"));
  assert.ok(csv.includes("2026-10-15"));
});
test("native CSV leaves fetch time empty instead of throwing on a corrupted timestamp", () => {
  const csv = nativeCsvExport(
    [
      {
        rank: 1,
        configuration: "A",
        creator: "Lab",
        score: 1,
        costTask: 1,
        estimated: false,
        deprecated: false,
      },
    ],
    { fetchedAt: "garbage" },
  );
  assert.ok(csv.includes("获取时间"));
  assert.ok(!csv.includes("Invalid"));
});
test("budget never attributes another source cost through a top-level fallback", () => {
  assert.equal(
    applyBudget([{ id: "x", costTask: 1, representatives: {} }], {
      budgetSource: "aa",
      budgetLimit: 2,
    }).length,
    0,
  );
});
test("vendor chips are a fixed unique quick-filter set over disclosed creators", () => {
  const values = VENDOR_CHIPS.map((c) => c.value);
  assert.equal(new Set(values).size, values.length);
  for (const chip of VENDOR_CHIPS) {
    assert.ok(chip.value, "chip 缺少 creator 值");
    assert.ok(chip.label, "chip 缺少展示名");
  }
  // 固定编辑口径：全局基准与中国前沿各半，顺序不随数据筛选变化
  assert.ok(VENDOR_CHIPS.length >= 8);
});
test("vendor chip counts use the full pool, skip creator-less rows, and keep chip order", () => {
  const rows = [
    { id: "a", creator: "OpenAI" },
    { id: "b", creator: "OpenAI" },
    { id: "c", creator: "Kimi" },
    { id: "d", creator: "" },
    { id: "e" },
  ];
  const chips = vendorChipCounts(rows);
  assert.deepEqual(
    chips.map((c) => c.value),
    VENDOR_CHIPS.map((c) => c.value),
  );
  const byValue = Object.fromEntries(chips.map((c) => [c.value, c.count]));
  assert.equal(byValue.OpenAI, 2);
  assert.equal(byValue.Kimi, 1);
  assert.equal(byValue.Anthropic, 0);
  assert.equal(byValue["Z AI"], 0);
});
test("vendor chip creators get pairwise-distinct vendor colors (chip dots, chart dots, rings share the mapping)", () => {
  // 点身/chip/描边/浮层共用 colorFor：固定厂商撞色=图上两个厂商无法区分。
  // VENDOR_CHIPS 增删时此测试强制重新核对手工配色表。
  const colors = VENDOR_CHIPS.map((chip) => colorFor(chip.value));
  assert.equal(new Set(colors).size, VENDOR_CHIPS.length, "厂商色出现撞色");
  for (const color of colors) assert.match(color, /^#[0-9a-f]{6}$/);
  // 感知距离硬门槛（CIEDE2000）：当前方案组内最小 23.3、对前沿线最小 14.6。
  // 2026-11-17 曾发生 Kimi/Qwen 两个红系近到不可辨的回归，此测试防再犯。
  const labs = colors.map(labOfHex);
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      const d = dE2000(labs[i], labs[j]);
      assert.ok(
        d >= 20,
        `厂商色 ${colors[i]} 与 ${colors[j]} 感知距离 ${d.toFixed(1)} 低于门槛 20`,
      );
    }
  }
  // 点位会落在前沿线附近，点身与三条前沿线（虚线蓝/实线青绿/国产酒红）也要拉开
  for (const color of colors) {
    for (const line of ["#3267b8", "#128574", "#9a1c36"]) {
      const d = dE2000(labOfHex(color), labOfHex(line));
      assert.ok(
        d >= 13,
        `厂商色 ${color} 与前沿线 ${line} 感知距离 ${d.toFixed(1)} 低于门槛 13`,
      );
    }
  }
  // 兜底色库（新黑马厂商散列取色专用）：库内两两、与固定十色、与前沿线都须拉开，
  // 保证新厂商永远不会撞现有厂商的颜色（门槛比固定十色宽松：兜底色服务低频厂商）
  for (let i = 0; i < FALLBACK_COLORS.length; i++) {
    for (let j = i + 1; j < FALLBACK_COLORS.length; j++) {
      const d = dE2000(
        labOfHex(FALLBACK_COLORS[i]),
        labOfHex(FALLBACK_COLORS[j]),
      );
      assert.ok(
        d >= 12,
        `兜底色 ${FALLBACK_COLORS[i]} 与 ${FALLBACK_COLORS[j]} 感知距离 ${d.toFixed(1)} 低于门槛 12`,
      );
    }
    for (const fixed of colors) {
      const d = dE2000(labOfHex(FALLBACK_COLORS[i]), labOfHex(fixed));
      assert.ok(
        d >= 12,
        `兜底色 ${FALLBACK_COLORS[i]} 与厂商色 ${fixed} 感知距离 ${d.toFixed(1)} 低于门槛 12`,
      );
    }
    for (const line of ["#3267b8", "#128574", "#9a1c36"]) {
      const d = dE2000(labOfHex(FALLBACK_COLORS[i]), labOfHex(line));
      assert.ok(
        d >= 12,
        `兜底色 ${FALLBACK_COLORS[i]} 与前沿线 ${line} 感知距离 ${d.toFixed(1)} 低于门槛 12`,
      );
    }
  }
});
test("evidence depth summarizes ranked count and shared-board match distribution", () => {
  const rows = [
    {
      id: "a",
      composite: 80,
      record: { opponentsBySharedSources: { 2: 1, 3: 1 } },
    },
    {
      id: "b",
      composite: 70,
      record: { opponentsBySharedSources: { 2: 1, 3: 1 } },
    },
    { id: "c", composite: 60, record: { opponentsBySharedSources: { 3: 2 } } },
    { id: "d", composite: null, record: null },
  ];
  const depth = evidenceDepth(rows, 4);
  assert.equal(depth.rankedCount, 3);
  assert.equal(depth.totalModels, 4);
  assert.equal(depth.rankedShare, 0.75);
  // 有向计数：2 榜 = 1+1 = 2 → 1 场；3 榜 = 1+1+2 = 4 → 2 场；共 3 场。
  assert.equal(depth.matches, 3);
  assert.ok(Math.abs(depth.twoBoardPct - 100 / 3) < 1e-9);
  assert.ok(Math.abs(depth.richBoardPct - 200 / 3) < 1e-9);
  assert.ok(Math.abs(depth.twoBoardPct + depth.richBoardPct - 100) < 1e-9);
});
test("evidence depth handles no ranked models without dividing by zero", () => {
  const depth = evidenceDepth([{ id: "x", composite: null, record: null }], 1);
  assert.equal(depth.rankedCount, 0);
  assert.equal(depth.matches, 0);
  assert.equal(depth.twoBoardPct, 0);
  assert.equal(depth.richBoardPct, 0);
  assert.equal(depth.rankedShare, 0);
});
test("evidence depth counts only models that earned a PK score", () => {
  const a = analyze(
    [
      model("a", { aa: { score: 20 }, vals: { score: 20 } }),
      model("b", { aa: { score: 20 }, vals: { score: 20 } }),
      model("single", { aa: { score: 5 } }),
    ],
    { minOpponents: 1 },
  );
  const depth = evidenceDepth(a.rows, 3);
  assert.equal(a.cohort, 2);
  assert.equal(depth.rankedCount, 2);
  assert.equal(depth.totalModels, 3);
  // a、b 仅共同 aa+vals 两榜且都平票 → 唯一一场为 2 榜裁决；单榜模型不计。
  assert.equal(depth.matches, 1);
  assert.equal(depth.twoBoardPct, 100);
  assert.equal(depth.richBoardPct, 0);
});
test("evidence depth counts low-sample matches on both sides", () => {
  const reps = (scores) =>
    Object.fromEntries(
      ["aa", "vals", "livebench", "arena"].map((source, i) => [
        source,
        { score: scores[i], costTask: 1 },
      ]),
    );
  const models = [
    model("x", reps([100, 100, null, null])),
    model("c", reps([90, 90, 100, 100])),
    ...Array.from({ length: 11 }, (_, i) =>
      model("o" + i, reps([null, null, 0, 0])),
    ),
  ];
  const a = analyze(models);
  const depth = evidenceDepth(a.rows, models.length);
  // c 对 x 与 11 个 o，共 12 场；11 个 o 两两平局 55 场；x 未获名次但比赛仍计入。
  assert.equal(depth.rankedCount, 12);
  assert.equal(depth.matches, 67);
  assert.equal(depth.twoBoardPct, 100);
});

test("negative Elo stays sortable and unscored rows stay last in both directions", () => {
  const sources = ["aa", "vals", "livebench", "arena"];
  const all = (score) =>
    Object.fromEntries(
      sources.map((source) => [source, { score, costTask: 1 }]),
    );
  const strong = [...Array(40)].map((_, i) => model("s" + i, all(100 - i)));
  const rows = analyze([...strong, model("weak", all(0))], {
    minOpponents: 1,
  }).rows;
  const weak = rows.find((r) => r.id === "weak");
  assert.ok(weak.composite < 0, "弱到一定程度时 Elo 可以为负");
  const compare = compareNullableScores((r) => r.composite);
  const data = [
    { id: "neg", composite: weak.composite },
    { id: "none", composite: null },
    { id: "pos", composite: 1000 },
  ];
  assert.deepEqual(
    [...data].sort((a, b) => compare(a, b, "ascend")).map((r) => r.id),
    ["neg", "pos", "none"],
  );
  assert.deepEqual(
    [...data].sort((a, b) => -compare(a, b, "descend")).map((r) => r.id),
    ["pos", "neg", "none"],
  );
});
test("nullable auxiliary tiebreak keeps missing values last in both directions", () => {
  const compare = compareNullableScores((r) => r.auxiliary);
  const data = [
    { id: "none", auxiliary: null },
    { id: "value", auxiliary: 12 },
  ];
  assert.deepEqual(
    [...data].sort((a, b) => compare(a, b, "ascend")).map((r) => r.id),
    ["value", "none"],
  );
  assert.deepEqual(
    [...data].sort((a, b) => -compare(a, b, "descend")).map((r) => r.id),
    ["value", "none"],
  );
});
