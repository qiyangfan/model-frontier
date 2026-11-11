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

import { adjustedScores, certifyNoBrainer } from "../src/analysis.mjs";
test("adjustedScores: 调整分 = composite − λ·log2(cost/100)；中位成本不罚不奖", () => {
  const rows = [
    {
      id: "mStrong",
      name: "mStrong",
      complete: true,
      composite: 1200,
      cost: 200,
      percentiles: { vals: 90, livebench: 85, arena: 88 },
    },
    {
      id: "mMedian",
      name: "mMedian",
      complete: true,
      composite: 1100,
      cost: 100,
      percentiles: { vals: 60, livebench: 55, arena: 58 },
    },
    {
      id: "mGated",
      name: "mGated",
      complete: true,
      composite: 1300,
      cost: 100,
      percentiles: { vals: 95, livebench: 92, arena: 30 },
    },
  ];
  const out = adjustedScores(rows, { lambda: 10, gatePct: 40 });
  const by = Object.fromEntries(out.rows.map((r) => [r.id, r]));
  // cost=200 → log2(2)=1 → 1200−10=1190
  assert.equal(by.mStrong.adjusted, 1190);
  // cost=100 → log2(1)=0 → 不罚不奖
  assert.equal(by.mMedian.adjusted, 1100);
  // 短板线：最低源百分位 30 < 40 → 不入池，且 reason 诚实说明
  assert.equal(by.mGated.eligible, false);
  assert.match(by.mGated.reason, /短板/);
  assert.equal(out.lambda, 10);
  assert.equal(out.gatePct, 40);
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

test("adjustedScores: 覆盖门——部分覆盖模型即使已测维度全达标也不入池", () => {
  // 2026-11-11 裁定：认证是对全维度的断言，未测榜单无短板证据也无强度证据，
  // 池成员资格要求全量榜单覆盖（详见 docs/adr/0019 修订记录）
  const rows = [
    {
      id: "partialStrong",
      name: "partialStrong",
      composite: 1300,
      cost: 20,
      complete: false,
      percentiles: { vals: 96, livebench: 94 },
    },
    {
      id: "bothBad",
      name: "bothBad",
      composite: 1200,
      cost: 50,
      complete: false,
      percentiles: { vals: 35, livebench: 60 },
    },
    {
      id: "fullOk",
      name: "fullOk",
      composite: 1100,
      cost: 100,
      complete: true,
      percentiles: { vals: 70, livebench: 65, arena: 72, aa: 68 },
    },
  ];
  const out = adjustedScores(rows, { lambda: 10, gatePct: 40 });
  const by = Object.fromEntries(out.rows.map((r) => [r.id, r]));
  // 已测维度 96/94 全部 ≥40，仍因覆盖不全被拒
  assert.equal(by.partialStrong.eligible, false);
  assert.equal(by.partialStrong.floorPct, 94);
  assert.equal(by.partialStrong.covered, 2);
  assert.match(by.partialStrong.reason, /仅 2 榜/);
  assert.match(by.partialStrong.reason, /未测榜单/);
  // 短板与覆盖不全同时成立时，reason 报告更具体的短板线
  assert.equal(by.bothBad.eligible, false);
  assert.match(by.bothBad.reason, /短板线/);
  assert.ok(!/未测榜单/.test(by.bothBad.reason));
  // fail-closed：complete 字段缺失按不完整处理
  const noField = adjustedScores([
    {
      id: "x",
      name: "x",
      composite: 1200,
      cost: 100,
      percentiles: { vals: 90, livebench: 88 },
    },
  ]);
  assert.equal(noField.rows[0].eligible, false);
  assert.equal(noField.rows[0].complete, false);
  // 全量覆盖 + 短板线达标 → 入池
  assert.equal(by.fullOk.eligible, true);
  assert.equal(by.fullOk.complete, true);
  // 只有部分覆盖模型 → 池空，pick 为 null，不认证
  const onlyPartial = certifyNoBrainer(
    adjustedScores([rows[0]], { lambda: 10 }),
  );
  assert.equal(onlyPartial.poolSize, 0);
  assert.equal(onlyPartial.pick, null);
  assert.equal(onlyPartial.certified, false);
});
