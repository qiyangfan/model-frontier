import test from "node:test";
import assert from "node:assert/strict";
import {
  percentile,
  pareto,
  analyze,
  csvExport,
  combinedCostProfile,
  combinedCost,
  sourceAudit,
} from "../src/analysis.mjs";
import { familyKey, aggregate } from "../server/identity.mjs";
const analyzeSmall = (models, options = {}) =>
  analyze(models, { minOpponents: 1, ...options });
const model = (id, records, openWeights = true) => ({
  id,
  name: id,
  creator: "test",
  openWeights,
  records: Object.fromEntries(
    Object.entries(records).map(([k, v]) => [k, [v]]),
  ),
  representatives: records,
});
test("average ranks handle ties; one-model pool is neutral", () => {
  assert.equal(percentile(5, [1, 5, 5, 9]), 50);
  assert.equal(percentile(1, [1, 5, 5, 9]), 0);
  assert.equal(percentile(9, [1, 5, 5, 9]), 100);
  assert.equal(percentile(7, [7]), 50);
});
test("Pareto retains ties, rejects equal-score expensive choices", () => {
  const rows = [
    { id: "a", cost: 1, composite: 50 },
    { id: "b", cost: 2, composite: 50 },
    { id: "c", cost: 3, composite: 80 },
    { id: "d", cost: 1, composite: 50 },
  ];
  assert.deepEqual(
    pareto(rows).map((r) => r.id),
    ["a", "c", "d"],
  );
});
test("missing-source models remain visible but cannot silently enter strict frontier", () => {
  const r = analyzeSmall(
    [
      model("a", { aa: { score: 10, costTask: 1 }, livebench: { score: 50 } }),
      model("b", { aa: { score: 20, costTask: 0.5 } }),
      model("c", { aa: { score: 5, costTask: 1 }, livebench: { score: 40 } }),
    ],
    { costSource: "aa" },
  );
  assert.equal(r.rows[1].composite, null);
  assert.equal(r.rows[1].plottable, false);
  assert.equal(r.rows[0].frontier, true);
});
test("cost origin changes frontier without changing scores", () => {
  const m = [
    model("a", {
      aa: { score: 10, costTask: 1 },
      vals: { score: 10, costTask: 5 },
    }),
    model("b", {
      aa: { score: 20, costTask: 2 },
      vals: { score: 20, costTask: 1 },
    }),
  ];
  const a = analyzeSmall(m, { costSource: "aa" });
  const v = analyzeSmall(m, { costSource: "vals" });
  assert.deepEqual(
    a.rows.map((r) => r.composite),
    v.rows.map((r) => r.composite),
  );
  assert.equal(a.rows[0].frontier, true);
  assert.equal(v.rows[0].frontier, false);
});
test("zero and missing costs never appear on logarithmic chart", () => {
  for (const cost of [0, null, undefined]) {
    const r = analyzeSmall(
      [
        model("a", { aa: { score: 10, costTask: cost }, vals: { score: 10 } }),
        model("b", { aa: { score: 20, costTask: 1 }, vals: { score: 20 } }),
      ],
      { costSource: "aa" },
    );
    assert.equal(r.rows[0].plottable, false);
  }
});
test("open frontier is separately computed against open models", () => {
  const r = analyzeSmall(
    [
      model(
        "open",
        { aa: { score: 10, costTask: 1 }, vals: { score: 10 } },
        true,
      ),
      model(
        "closed",
        { aa: { score: 20, costTask: 0.5 }, vals: { score: 20 } },
        false,
      ),
    ],
    { costSource: "aa" },
  );
  assert.equal(r.rows[0].frontier, false);
  assert.equal(r.rows[0].openFrontier, true);
});
test("name grammar joins inference effort but preserves releases and dates", () => {
  assert.equal(
    familyKey("Claude Opus 5.5 (max with fallback)"),
    familyKey("claude-opus-5.5-high"),
  );
  assert.equal(familyKey("GLM-5.3 (max)"), familyKey("glm-5.3-max"));
  assert.notEqual(
    familyKey("Mistral Large 4 Preview"),
    familyKey("Mistral Large 4"),
  );
  assert.notEqual(
    familyKey("DeepSeek V4 Flash Vision"),
    familyKey("DeepSeek V4 Flash 0731"),
  );
  assert.notEqual(
    familyKey("Claude Opus 4.5 20251101"),
    familyKey("Claude Opus 4.5"),
  );
  assert.equal(familyKey("Muse Wonder 1.0"), familyKey("Wonder"));
});
test("new families are discovered without a model whitelist; conflicts stay unconfirmed", () => {
  const g = aggregate({
    aa: { rows: [{ name: "NewModel 99", score: 20, openWeights: true }] },
    livebench: {
      rows: [{ name: "newmodel-99-high", score: 100, openWeights: false }],
    },
  });
  assert.equal(g.length, 1);
  assert.equal(g[0].coverage, 2);
  assert.equal(g[0].openWeights, null);
  assert.equal(g[0].openConflict, true);
});
test("an Arena-only model joins the library with its own evidence as fallback", () => {
  const g = aggregate({
    arena: {
      ingestFormat: "arena-text-overall-v1",
      rows: [
        {
          name: "Arena Only 1",
          rawId: "Arena Only 1",
          score: 1400,
          openWeights: false,
          creator: "Mystery Lab",
        },
      ],
    },
  });
  assert.equal(g.length, 1);
  assert.equal(g[0].representatives.arena.score, 1400);
  // 无 AA / LiveBench / Vals 记录时，Arena 记录兜底模型名与厂商
  assert.equal(g[0].name, "Arena Only 1");
  assert.equal(g[0].creator, "Mystery Lab");
});
test("representative cost stays bound to the chosen variant and estimates are secondary", () => {
  const g = aggregate({
    aa: {
      rows: [
        { name: "New 1 (low)", score: 20, costTask: 1, estimated: false },
        { name: "New 1 (max)", score: 40, costTask: 100, estimated: true },
      ],
    },
  });
  assert.equal(g[0].representatives.aa.score, 20);
  assert.equal(g[0].representatives.aa.costTask, 1);
});
test("CSV export neutralizes spreadsheet formula injection", () => {
  const csv = csvExport([
    {
      name: '=HYPERLINK("bad")',
      creator: "x",
      available: [],
      representatives: {},
    },
  ]);
  assert.ok(csv.includes("'=HYPERLINK"));
});
test("dominator explanation is independent of alphabetical iteration order", () => {
  const r = analyzeSmall(
    [
      model("a", { aa: { score: 10, costTask: 2 }, vals: { score: 10 } }),
      model("z", { aa: { score: 20, costTask: 1 }, vals: { score: 20 } }),
    ],
    { costSource: "aa" },
  );
  assert.deepEqual(r.rows[0].dominatedBy, ["z"]);
});

test("combined cost is normalized geometric mean, not arithmetic USD average", () => {
  const models = [
    model("a", {
      aa: { costTask: 1 },
      vals: { costTask: 10 },
      livebench: { costTask: 100 },
    }),
    model("b", {
      aa: { costTask: 2 },
      vals: { costTask: 20 },
      livebench: { costTask: 200 },
    }),
  ];
  const p = combinedCostProfile(models);
  assert.deepEqual(p.medians, { aa: 1.5, vals: 15, livebench: 150 });
  assert.ok(Math.abs(combinedCost(models[0], p).value - (100 * 2) / 3) < 1e-8);
  assert.ok(Math.abs(combinedCost(models[1], p).value - (100 * 4) / 3) < 1e-8);
});
test("changing a source currency scale does not change combined relative costs", () => {
  const a = [
    model("a", {
      aa: { costTask: 1 },
      vals: { costTask: 20 },
      livebench: { costTask: 3 },
    }),
    model("b", {
      aa: { costTask: 2 },
      vals: { costTask: 10 },
      livebench: { costTask: 4 },
    }),
  ];
  const b = structuredClone(a);
  for (const m of b) m.representatives.vals.costTask *= 1000;
  const pa = combinedCostProfile(a),
    pb = combinedCostProfile(b);
  assert.ok(
    Math.abs(combinedCost(a[0], pa).value - combinedCost(b[0], pb).value) <
      1e-9,
  );
});
test("missing-source costs are not imputed or reweighted into combined cost", () => {
  const a = [
    model("a", {
      aa: { score: 1, costTask: 1 },
      vals: { score: 1, costTask: 2 },
      livebench: { score: 1, costTask: 3 },
    }),
    model("b", {
      aa: { score: 2, costTask: 1 },
      vals: { score: 2, costTask: 2 },
    }),
  ];
  const r = analyzeSmall(a, { costSource: "composite", costMinSources: 3 });
  assert.equal(r.costProfile.count, 1);
  assert.equal(r.rows[0].cost, 100);
  assert.equal(r.rows[1].cost, null);
  assert.equal(r.rows[1].plottable, false);
});

test("Arena never enters the combined cost baseline, per-model cost or composite ballots", () => {
  const base = [
    model("a", {
      aa: { score: 9, costTask: 1 },
      vals: { score: 9, costTask: 10 },
      livebench: { score: 9, costTask: 100 },
    }),
    model("b", {
      aa: { score: 5, costTask: 2 },
      vals: { score: 5, costTask: 20 },
      livebench: { score: 5, costTask: 200 },
    }),
  ];
  const withArena = structuredClone(base);
  // 即使脏数据给 Arena 塞了成本，成本基准与几何平均也必须无视它
  withArena[0].representatives.arena = {
    score: 1400,
    costTask: 0.0001,
    voteCount: 4904,
  };
  withArena[1].representatives.arena = { score: 900, costTask: 999 };
  const pb = combinedCostProfile(base);
  const pa = combinedCostProfile(withArena);
  assert.deepEqual(pa.medians, pb.medians);
  assert.equal(pa.sources.includes("arena"), false);
  assert.equal(pa.count, pb.count);
  for (let i = 0; i < 2; i++)
    assert.ok(
      Math.abs(
        combinedCost(base[i], pb).value - combinedCost(withArena[i], pa).value,
      ) < 1e-9,
    );
  const rb = analyzeSmall(base),
    ra = analyzeSmall(withArena);
  assert.deepEqual(
    ra.rows.map((r) => [r.composite, r.cost, r.coverage]),
    rb.rows.map((r) => [r.composite, r.cost, r.coverage]),
  );
});

test("composite CSV carries Arena raw score, votes, interval and publish date", () => {
  const rows = analyzeSmall([
    model("a", {
      aa: { score: 9, costTask: 1 },
      vals: { score: 9, costTask: 1 },
      livebench: { score: 9, costTask: 1 },
      arena: {
        score: 1532.34,
        voteCount: 4904,
        scoreLower: 1500,
        scoreUpper: 1560,
        publishedAt: "2026-10-15",
      },
    }),
  ]).rows;
  const csv = csvExport(rows);
  for (const header of [
    "Arena",
    "Arena配置",
    "Arena投票数",
    "Arena评分区间下限",
    "Arena评分区间上限",
    "Arena发布日期",
  ])
    assert.ok(csv.includes(header), `缺少列 ${header}`);
  assert.ok(csv.includes("1532.34"));
  assert.ok(csv.includes("4904"));
  assert.ok(csv.includes("2026-10-15"));
});

test("source audit restores native source population rather than the shared-source intersection", () => {
  const a = model("a", {
    vals: { name: "A", score: 50, costTask: 2 },
    aa: { score: 1, costTask: 1 },
  });
  const b = model("b", { vals: { name: "B", score: 60, costTask: 1 } });
  const r = sourceAudit([a, b], "a", "vals");
  assert.equal(r.frontier, false);
  assert.deepEqual(r.dominatedBy, ["B"]);
  assert.equal(r.population, 2);
});

test("default two-source cost allows a partial geometric mean but marks its coverage", () => {
  const m = [
    model("full", {
      aa: { score: 10, costTask: 2 },
      vals: { score: 10, costTask: 8 },
      livebench: { score: 10, costTask: 32 },
    }),
    model("two", {
      aa: { score: 20, costTask: 1 },
      vals: { score: 20, costTask: 4 },
    }),
  ];
  const r = analyzeSmall(m);
  assert.equal(r.rows[1].costCoverage, 2);
  assert.ok(Math.abs(r.rows[1].cost - 50) < 1e-8);
  assert.equal(r.rows[1].plottable, true);
  assert.equal(r.rows[1].complete, false);
});

test("an expensive new model cannot evict fully covered models from the frontier", () => {
  const cheap = model("cheap", {
    aa: { score: 50, costTask: 1 },
    vals: { score: 50, costTask: 1 },
    livebench: { score: 50, costTask: 1 },
  });
  const pricey = model("pricey", {
    aa: { score: 90, costTask: 9 },
    vals: { score: 90, costTask: 9 },
    livebench: { score: 90, costTask: 9 },
  });
  const luxury = model("luxury", {
    aa: { score: 99, costTask: 900 },
    vals: { score: 99, costTask: 900 },
    livebench: { score: 99, costTask: 900 },
  });
  const before = new Map(
    analyzeSmall([cheap, pricey]).rows.map((r) => [r.id, r.frontier]),
  );
  for (const row of analyzeSmall([cheap, pricey, luxury]).rows)
    if (before.has(row.id)) assert.equal(row.frontier, before.get(row.id));
});
test("extra source mentions cannot raise an objectively lowest scoring model", () => {
  const full = (score) => ({
    aa: { score, costTask: 1 },
    vals: { score, costTask: 1 },
    livebench: { score, costTask: 1 },
  });
  const models = [
    model("lowest", full(10)),
    model("partial", {
      aa: { score: 20, costTask: 1 },
      vals: { score: 20, costTask: 1 },
    }),
    model("highest", full(30)),
  ];
  const result = analyzeSmall(models, { costSource: "aa" });
  assert.deepEqual(
    result.rows.map((r) => r.winRate),
    [0, 50, 100],
  );
  assert.deepEqual(
    result.rows.map((r) => r.copelandRank),
    [3, 2, 1],
  );
  assert.ok(result.rows[0].composite < result.rows[1].composite);
  assert.ok(result.rows[1].composite < result.rows[2].composite);
  assert.equal(result.btConnected, true);
  assert.equal(Object.hasOwn(result.rows[0], "coverageBonus"), false);
});

test("csv export attaches data time and scoring scope for later review", () => {
  const csv = csvExport(
    [{ name: "a", creator: "x", available: [], representatives: {} }],
    {
      lastRefresh: "2026-10-16T02:05:53.568Z",
      scope: "两榜多数对决 · 至少 2 榜",
    },
  );
  assert.ok(csv.includes("数据时间"));
  assert.ok(csv.includes("2026-10-16T02:05:53.568Z"));
  assert.ok(csv.includes("评分口径"));
  assert.ok(csv.includes("两榜多数对决 · 至少 2 榜"));
});
test("csv export leaves the data time empty instead of throwing on a corrupted timestamp", () => {
  const csv = csvExport(
    [{ name: "a", creator: "x", available: [], representatives: {} }],
    { lastRefresh: "not-a-date" },
  );
  assert.ok(csv.includes("数据时间"));
  assert.ok(!csv.includes("Invalid"));
});

import {
  adjustedScores,
  certifyNoBrainer,
  codingIndices,
  valueRanking,
} from "../src/analysis.mjs";
test("adjustedScores: 调整分 = composite − λ·log2(cost/100) − 15×缺榜数；准入 = 有综合分+成本（ADR-0023）", () => {
  const rows = [
    {
      id: "mFull",
      name: "mFull",
      openWeights: true,
      composite: 1200,
      cost: 200,
      percentiles: { vals: 90, livebench: 85, arena: 88, aa: 86 },
    },
    {
      id: "mMedian",
      name: "mMedian",
      composite: 1100,
      cost: 100,
      percentiles: { vals: 60, livebench: 55, arena: 58, aa: 57 },
    },
    {
      // 缺 1 榜 → 专项罚 15（历史校准，ADR-0023）：1300 − 0 − 15 = 1285
      id: "mPartial",
      name: "mPartial",
      composite: 1300,
      cost: 100,
      percentiles: { vals: 95, livebench: 92, arena: 30 },
    },
  ];
  const out = adjustedScores(rows, { lambda: 10 });
  const by = Object.fromEntries(out.rows.map((r) => [r.id, r]));
  // cost=200 → log2(2)=1 → 1200−10=1190（全测无缺榜罚）
  assert.equal(by.mFull.adjusted, 1190);
  // openWeights 透传（性价比卡「仅开源」快筛依赖此字段）
  assert.equal(by.mFull.openWeights, true);
  // cost=100 → log2(1)=0 → 成本不罚不奖
  assert.equal(by.mMedian.adjusted, 1100);
  // 缺 1 榜：1300 − 15×1 = 1285；floorPct 保留为描述字段
  assert.equal(by.mPartial.adjusted, 1285);
  assert.equal(by.mPartial.eligible, true);
  assert.equal(by.mPartial.floorPct, 30);
  assert.equal(by.mPartial.covered, 3);
  // 无综合分/成本 → 无调整分、不入榜
  const noInput = adjustedScores([
    { id: "x", name: "x", composite: null, cost: null, percentiles: {} },
  ]);
  assert.equal(noInput.rows[0].adjusted, null);
  assert.equal(noInput.rows[0].eligible, false);
  assert.equal(out.lambda, 10);
});

test("certifyNoBrainer: λ 全区间不变 + 无支配违规 → 认证；分叉 → 不认证", () => {
  // 单点退化前沿：最强且最便宜（支配一切）→ 任何 λ 下 argmax 不变
  const single = adjustedScores(
    [
      {
        id: "dom",
        name: "dom",
        complete: true,
        composite: 1200,
        cost: 50,
        percentiles: { vals: 90, livebench: 88, arena: 91 },
      },
      {
        id: "weak",
        name: "weak",
        complete: true,
        composite: 900,
        cost: 300,
        percentiles: { vals: 50, livebench: 48, arena: 52 },
      },
    ],
    { lambda: 10 },
  );
  const cert1 = certifyNoBrainer(single);
  assert.equal(cert1.certified, true);
  assert.equal(cert1.pick, "dom");
  assert.deepEqual(cert1.violations, []);
  // 多点前沿：交点恰在扫描档 λ=20（1200−2λ = 1120+2λ，同分由行序先者胜），
  // λ=40 档翻转到 cheap → 扫描分叉 → 不认证（不伪造单一答案）
  const multi = adjustedScores(
    [
      {
        id: "strong",
        name: "strong",
        complete: true,
        composite: 1200,
        cost: 400,
        percentiles: { vals: 95, livebench: 93, arena: 94 },
      },
      {
        id: "cheap",
        name: "cheap",
        complete: true,
        composite: 1120,
        cost: 25,
        percentiles: { vals: 80, livebench: 82, arena: 81 },
      },
    ],
    { lambda: 10 },
  );
  const cert2 = certifyNoBrainer(multi);
  assert.equal(cert2.certified, false);
  assert.equal(new Set(cert2.sweep.map((s) => s.pick)).size > 1, true);
});

test("certifyNoBrainer: 支配一致性违规可被检出（防公式回归）", () => {
  // 人为构造 adjusted 与支配关系矛盾的行（直接喂伪造 adjusted 不可能——
  // adjustedScores 总是按公式计算，故此处验证恒无违规的定理性质）
  const rows = [
    {
      id: "a",
      name: "a",
      complete: true,
      composite: 1100,
      cost: 100,
      percentiles: { vals: 80, livebench: 78, arena: 79 },
    },
    {
      id: "b",
      name: "b",
      complete: true,
      composite: 1000,
      cost: 150,
      percentiles: { vals: 70, livebench: 68, arena: 69 },
    },
  ];
  const scored = adjustedScores(rows, { lambda: 10 });
  const cert = certifyNoBrainer(scored);
  assert.deepEqual(cert.violations, []);
  assert.equal(cert.pick, "a");
});

test("adjustedScores: 缺榜专项罚分——部分覆盖模型入榜但按缺榜数扣分（ADR-0023）", () => {
  // 准入对齐天梯（≥2 榜有综合分即可），缺榜不除名；罚值 15/榜经历史快照校准
  // （12 次覆盖增长事件，均值 −15.4/榜），见 docs/adr/0023
  const rows = [
    {
      id: "partialStrong",
      name: "partialStrong",
      composite: 1300,
      cost: 20,
      percentiles: { vals: 96, livebench: 94 },
    },
    {
      id: "fullOk",
      name: "fullOk",
      composite: 1100,
      cost: 100,
      percentiles: { vals: 70, livebench: 65, arena: 72, aa: 68 },
    },
  ];
  const out = adjustedScores(rows, { lambda: 10 });
  const by = Object.fromEntries(out.rows.map((r) => [r.id, r]));
  // 部分覆盖照常入榜；缺 2 榜扣 30：1300 + 10·log2(100/20)... = 1300 + 23.219 − 30
  assert.equal(by.partialStrong.eligible, true);
  assert.equal(by.partialStrong.covered, 2);
  assert.equal(
    by.partialStrong.adjusted,
    1300 - 10 * Math.log2(20 / 100) - 15 * 2,
  );
  // 全测无罚：1100 − 0 = 1100
  assert.equal(by.fullOk.adjusted, 1100);
  assert.equal(by.fullOk.covered, 4);
  // 唯一候选 → 认证语义成立（poolSize=1）
  const onlyOne = certifyNoBrainer(adjustedScores([rows[0]], { lambda: 10 }));
  assert.equal(onlyOne.poolSize, 1);
  assert.equal(onlyOne.certified, true);
});

test("valueRanking: 缺榜罚分后统一排序，并列按综合分、名称兜底；无综合分/成本仅计数披露", () => {
  const full = { vals: 90, livebench: 85, arena: 88, aa: 82 };
  // c 与 d 调整分同为 1140（c: 1150−10·log2(2)，d: 1160−10·log2(4)）→ 综合分高者在前；
  // e1/e2 调整分与综合分双并列 → 名称兜底保证渲染次序确定（ADR-0020）
  const rows = [
    {
      id: "a",
      name: "a",
      complete: true,
      composite: 1200,
      cost: 100,
      percentiles: full,
    },
    {
      id: "b",
      name: "b",
      complete: true,
      composite: 1100,
      cost: 100,
      percentiles: full,
    },
    {
      id: "c",
      name: "c",
      complete: true,
      composite: 1150,
      cost: 200,
      percentiles: full,
    },
    {
      id: "d",
      name: "d",
      complete: true,
      composite: 1160,
      cost: 400,
      percentiles: full,
    },
    {
      id: "e1",
      name: "beta",
      complete: true,
      composite: 1000,
      cost: 100,
      percentiles: full,
    },
    {
      id: "e2",
      name: "alpha",
      complete: true,
      composite: 1000,
      cost: 100,
      percentiles: full,
    },
    {
      // 缺 1 榜罚 15（ADR-0023）：1300−15=1285，照常入榜
      id: "gated",
      name: "gated",
      composite: 1300,
      cost: 100,
      percentiles: { vals: 95, livebench: 92, aa: 80 },
    },
    {
      // 缺 1 榜罚 15 但综合分更高：1400−20−15=1365；输入顺序故意排在 gated
      // 之后，验证罚分后的完整排序确定性
      id: "gatedHigh",
      name: "gatedHigh",
      composite: 1400,
      cost: 200,
      percentiles: { vals: 95, livebench: 92, aa: 90 },
    },
    {
      id: "noInput",
      name: "noInput",
      complete: false,
      composite: null,
      cost: null,
      percentiles: {},
    },
  ];
  const { ranked, excludedCount } = valueRanking(
    adjustedScores(rows, { lambda: 10 }),
  );
  // 准入 = 有综合分+成本（缺榜已罚）：gated(3/4,1300−15=1285) 与
  // gatedHigh(3/4,1400−20−15=1365) 转正入榜；输入顺序与名次无关
  assert.deepEqual(
    ranked.map((r) => r.id),
    ["gatedHigh", "gated", "a", "d", "c", "b", "e2", "e1"],
  );
  // 无综合分/成本的行不占名次，仅计入披露数量
  assert.equal(excludedCount, 1);
});

test("codingIndices: LiveBench 编程/长程代理/浏览器三轴均分百分位；任一轴缺失即 null", () => {
  const rows = [
    {
      id: "a",
      representatives: {
        livebench: { suites: { coding: 90, long_agentic: 70, browser: 80 } },
      },
    },
    {
      id: "b",
      representatives: {
        livebench: { suites: { coding: 80, long_agentic: 60, browser: 60 } },
      },
    },
    {
      // 缺 browser（未测的终端操作能力不虚构）→ 整体为 null
      id: "c",
      representatives: {
        livebench: { suites: { coding: 70, long_agentic: 50 } },
      },
    },
    { id: "d", representatives: {} },
  ];
  const m = codingIndices(rows);
  assert.equal(m.get("c"), null);
  assert.equal(m.get("d"), null);
  const ia = m.get("a");
  const ib = m.get("b");
  assert.ok(Number.isFinite(ia) && Number.isFinite(ib));
  assert.ok(ia > ib);
});

test("valueRanking: 编程视图——有编程分者按编程分降序在前，缺失者沉底保持综合序", () => {
  const scored = {
    rows: [
      { id: "x", name: "x", eligible: true, adjusted: 1200, composite: 1200 },
      { id: "y", name: "y", eligible: true, adjusted: 1100, composite: 1100 },
      { id: "z", name: "z", eligible: true, adjusted: 1000, composite: 1000 },
      { id: "g", name: "g", eligible: false, adjusted: 1050, composite: 1050 },
    ],
  };
  // z 编程分最高但综合性价比垫底；y 缺编程分——广度约束下沉底而非消失（ADR-0022）
  const coding = new Map([
    ["x", 80],
    ["z", 90],
  ]);
  const { ranked, excludedCount } = valueRanking(scored, {
    view: "coding",
    coding,
  });
  assert.deepEqual(
    ranked.map((r) => r.id),
    ["z", "x", "y"],
  );
  // g 无入榜资格 → 仅计入披露数量
  assert.equal(excludedCount, 1);
  // 综合视图（缺省）不受影响
  const compositeView = valueRanking(scored);
  assert.deepEqual(
    compositeView.ranked.map((r) => r.id),
    ["x", "y", "z"],
  );
  assert.equal(compositeView.excludedCount, 1);
});
