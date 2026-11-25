import test from "node:test";
import assert from "node:assert/strict";
import { analyze, majorityMatch, csvExport } from "../src/analysis.mjs";
import { rankedModels } from "../src/portal.mjs";
import { applyEvidencePolicy } from "../src/evidence.mjs";
import { SCORE_SOURCES } from "../shared/sources.mjs";
// 来源清单跟着 SCORE_SOURCES 走，新增一票时这些夹具不必逐个改。
const model = (id, scores) => ({
  id,
  name: id,
  openWeights: true,
  representatives: Object.fromEntries(
    SCORE_SOURCES.flatMap((s, i) =>
      scores[i] == null ? [] : [[s, { score: scores[i], costTask: 1 }]],
    ),
  ),
});
const run = (models, options = {}) =>
  analyze(models, { minOpponents: 1, ...options });
const record = (wins, draws, losses, opponents, shared = {}) => ({
  wins,
  draws,
  losses,
  opponents,
  opponentsBySharedSources: Object.fromEntries(
    Array.from({ length: SCORE_SOURCES.length - 1 }, (_, i) => [
      i + 2,
      shared[i + 2] ?? 0,
    ]),
  ),
});
// 两模型一胜一负、Gamma(2,1) 先验下的已知 BT 解：强度比 2，Elo 围绕 1000 对称。
const oneWinGap = (400 / Math.LN10) * (Math.log(2) / 2);

test("two of three ballots win irrespective of score margins", () => {
  const a = model("a", [51, 51, 0]),
    b = model("b", [50, 50, 100]);
  const match = majorityMatch(a, b);
  assert.equal(match.result, 1);
  assert.deepEqual([match.leftWins, match.rightWins, match.tied], [2, 1, 0]);
  assert.equal(match.ballots[2].difference, -100);
  const result = analyze([a, b], { minOpponents: 1 });
  assert.equal(result.required, 2);
  assert.ok(Math.abs(result.rows[0].composite - (1000 + oneWinGap)) < 1e-6);
  assert.ok(Math.abs(result.rows[1].composite - (1000 - oneWinGap)) < 1e-6);
  assert.deepEqual(
    result.rows.map((r) => r.winRate),
    [100, 0],
  );
  assert.deepEqual(
    result.rows.map((r) => r.copelandRank),
    [1, 2],
  );
  assert.deepEqual(result.rows[0].record, record(1, 0, 0, 1, { 3: 1 }));
});

test("majority cycles produce tied scores with deterministic competition ranks", () => {
  const models = [
    model("a", [3, 1, 2]),
    model("b", [2, 3, 1]),
    model("c", [1, 2, 3]),
  ];
  const result = run(models);
  for (const r of result.rows) {
    assert.equal(r.composite, 1000);
    assert.equal(r.winRate, 50);
    assert.equal(r.copelandRank, 1);
    assert.deepEqual(r.record, record(1, 0, 1, 2, { 3: 2 }));
  }
  assert.deepEqual(
    rankedModels(result.rows).map((r) => r.rank),
    [1, 1, 1],
  );
  assert.deepEqual(
    run([...models].reverse()).rows.map((r) => r.composite),
    [1000, 1000, 1000],
  );
});

test("opponent records group matches by the number of shared valid score sources", () => {
  const result = run([
    model("full-a", [5, 5, 5, 5, 5]),
    model("full-b", [4, 4, 4, 4, 4]),
    model("three", [3, 3, 3, null, null]),
    model("two", [2, 2, null, null, null]),
  ]);
  // 按来源总数推导期望，加票不必回来改数字
  const buckets = (counts) =>
    Object.fromEntries(
      Array.from({ length: SCORE_SOURCES.length - 1 }, (_, i) => [
        i + 2,
        counts[i + 2] ?? 0,
      ]),
    );
  assert.deepEqual(
    result.rows.map((row) => row.record.opponentsBySharedSources),
    [
      buckets({ 2: 1, 3: 1, 5: 1 }),
      buckets({ 2: 1, 3: 1, 5: 1 }),
      buckets({ 2: 1, 3: 2 }),
      buckets({ 2: 3 }),
    ],
  );
  for (const row of result.rows) {
    assert.equal(
      Object.values(row.record.opponentsBySharedSources).reduce(
        (total, count) => total + count,
        0,
      ),
      row.record.opponents,
    );
  }
});

test("tied ballots and tied contests count half a match, never raw-score tiebreaks", () => {
  const a = model("a", [1, 10, 5]),
    b = model("b", [2, 9, 5]);
  assert.equal(majorityMatch(a, b).result, 0);
  for (const r of run([a, b]).rows) {
    assert.equal(r.composite, 1000);
    assert.equal(r.winRate, 50);
    assert.deepEqual(r.record, record(0, 1, 0, 1, { 3: 1 }));
  }
  assert.equal(majorityMatch(a, model("c", [1, 10, 4])).result, 1);
  assert.equal(majorityMatch(a, a).tied, 3);
});

test("missing scores and disallowed estimates never enter the formal cohort", () => {
  const a = model("a", [3, 3, 3]),
    b = model("b", [2, 2, 2]),
    partial = model("partial", [100]);
  const estimate = model("estimate", [4, 4, 4]);
  estimate.representatives.aa.estimated = true;
  estimate.representatives.vals.estimated = true;
  const result = run([a, b, partial, estimate]);
  assert.equal(result.cohort, 2);
  for (const r of result.rows.slice(2)) {
    assert.equal(r.composite, null);
    assert.equal(r.record, null);
    assert.equal(r.plottable, false);
    assert.equal(r.frontier, false);
  }
  assert.equal(majorityMatch(a, partial).result, null);
  assert.equal(majorityMatch(a, estimate).result, null);
  assert.equal(
    majorityMatch(a, estimate, { includeEstimated: true }).result,
    -1,
  );
  assert.equal(
    run([a, b, partial, estimate], { includeEstimated: true }).cohort,
    3,
  );
  const withRecords = [a, b].map((m) => ({
    ...m,
    records: Object.fromEntries(
      Object.entries(m.representatives).map(([s, r]) => [s, [r]]),
    ),
  }));
  const removed = applyEvidencePolicy(
    withRecords,
    { vals: { stale: true } },
    { excludeStale: true },
  );
  assert.equal(run(removed).cohort, 2);
});

test("zero or one eligible model never gets an invented neutral score", () => {
  assert.equal(run([]).cohort, 0);
  const a = run([model("a", [1, 1, 1]), model("b", [2, null])]);
  assert.equal(a.rows[0].composite, null);
  assert.match(a.rows[0].reason, /没有对手/);
  assert.equal(a.rows[0].record.opponents, 0);
  assert.equal(rankedModels(a.rows)[0].rank, null);
});

test("costs do not change ballots, ranks or opponents; exports include exact results", () => {
  const models = [
    model("a", [3, 3, 3]),
    model("b", [2, 2, 2]),
    model("c", [1, 1, 1]),
  ];
  models[1].representatives.aa.costTask = null;
  const a = run(models),
    b = run(models, { costSource: "aa" });
  assert.deepEqual(
    a.rows.map((r) => r.composite),
    b.rows.map((r) => r.composite),
  );
  assert.equal(b.rows[1].plottable, false);
  assert.deepEqual(
    a.rows.map((r) => r.record.opponents),
    [2, 2, 2],
  );
  assert.deepEqual(
    rankedModels(a.rows)
      .filter((r) => r.id === "b")
      .map((r) => r.rank),
    [2],
  );
  const csv = csvExport(a.rows, { scope: "多数对决 v1" });
  assert.match(csv, /PK主积分/);
  assert.match(csv, /榜单位次均值（仅PK同分排序）/);
  assert.match(csv, /评分公式/);
  assert.match(csv, /对手数/);
  assert.match(csv, /双方共有2个有效评分榜的对局数/);
  assert.match(csv, /双方共有3个有效评分榜的对局数/);
  assert.match(csv, /双方共有4个有效评分榜的对局数/);
  // 档位上限跟着来源数走，加票时自动多一列
  for (let n = 2; n <= SCORE_SOURCES.length; n += 1)
    assert.match(csv, new RegExp(`双方共有${n}个有效评分榜的对局数`));
  assert.match(csv, /五榜多数对决/);
});

test("two-source rule admits two-source models but never counts a one-source overlap", () => {
  const rows = [
    model("a", [3, 3, 3]),
    model("b", [2, 2]),
    model("c", [null, 1, 1]),
  ];
  const result = run(rows, {});
  assert.equal(result.required, 2);
  assert.equal(result.cohort, 3);
  assert.deepEqual(
    result.rows.map((r) => r.record.opponents),
    [2, 1, 1],
  );
  assert.deepEqual(
    result.rows.map((r) => r.winRate),
    [100, 0, 0],
  );
  assert.ok(result.rows[0].composite > result.rows[1].composite);
  assert.equal(result.rows[1].composite, result.rows[2].composite);
  assert.equal(majorityMatch(rows[1], rows[2]).result, null);
  assert.equal(majorityMatch(rows[0], rows[1]).result, 1);
  assert.deepEqual(
    rankedModels(result.rows).map((r) => [r.id, r.rank]),
    [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ],
  );
  assert.equal(run(rows.slice(1), {}).rows[0].composite, null);
});

test("coverage cohorts use a fixed source mask and ignore extra model scores", () => {
  const a = model("a", [10, 10, 0, 0]);
  const b = model("b", [0, 0, 10, 10]);
  const c = model("c", [9, 9]);
  const d = model("d", [1, null, 100, 100]);
  const result = run([a, b, c, d]);
  const aaVals = result.coverageCohorts.find(({ id }) => id === "aa+vals");

  assert.deepEqual(aaVals.sources, ["aa", "vals"]);
  assert.equal(aaVals.count, 3);
  assert.deepEqual(
    aaVals.rows.map(({ id }) => id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    aaVals.rows.map(({ record, winRate }) => [record.opponents, winRate]),
    [
      [2, 100],
      [2, 0],
      [2, 50],
    ],
  );
  assert.ok(aaVals.rows[0].composite > aaVals.rows[2].composite);
  assert.ok(aaVals.rows[2].composite > aaVals.rows[1].composite);
  assert.ok(
    Number.isFinite(result.rows.find(({ id }) => id === "a").composite),
  );
});

test("coverage cohorts prefer more sources before larger sample size", () => {
  const a = model("a", [3, 3, 3]);
  const b = model("b", [2, 2, 2]);
  const c = model("c", [4, 4]);
  const { coverageCohorts } = run([a, b, c]);

  assert.deepEqual(coverageCohorts[0].sources, ["aa", "vals", "livebench"]);
  assert.equal(coverageCohorts[0].count, 2);
  assert.equal(coverageCohorts.find(({ id }) => id === "aa+vals").count, 3);
});

test("coverage cohorts omit single-model and non-shared source combinations", () => {
  const single = run([model("only", [1, 1, 1, 1])]);
  const split = run([
    model("left", [1, 1]),
    model("right", [null, null, 1, 1]),
  ]);

  assert.deepEqual(single.coverageCohorts, []);
  assert.deepEqual(split.coverageCohorts, []);
});

test("auxiliary tiebreak sorts final standings without altering matches or Pareto membership", () => {
  const models = [
    model("a", [4, 1, 3]),
    model("b", [3, 4, 1]),
    model("c", [1, 3, 4]),
    model("d", [0, 2, 2]),
  ];
  const result = run(models, {});
  assert.equal(result.rows[0].composite, result.rows[2].composite);
  assert.ok(result.rows[2].auxiliary > result.rows[0].auxiliary);
  assert.deepEqual(
    rankedModels(result.rows).map((r) => [r.id, r.rank]),
    [
      ["c", 1],
      ["a", 2],
      ["b", 2],
      ["d", 4],
    ],
  );
  for (const r of result.rows.slice(0, 3))
    assert.equal(
      r.frontier,
      true,
      "辅助分不应参与相同主积分与相同成本下的支配判定",
    );
  assert.equal(majorityMatch(models[0], models[2]).result, -1);
  const two = [model("a", [4, 2]), model("b", [3, 3])];
  const tied = run(two, {});
  assert.deepEqual(
    tied.rows.map((r) => r.record.draws),
    [1, 1],
  );
  assert.deepEqual(
    tied.rows.map((r) => r.composite),
    [1000, 1000],
  );
  assert.deepEqual(
    tied.rows.map((r) => r.winRate),
    [50, 50],
  );
});

test("mathematically equal auxiliary averages remain tied across summation orders", () => {
  const scores = [
    [6, 5, 2],
    [2, 4, 4],
    [7, 6, 1],
    [5, 1, 3],
    [3, 7, 6],
    [4, 2, 7],
    [1, 3, 5],
  ];
  const rows = run(scores.map((scores, i) => model(String(i), scores))).rows;
  assert.equal(rows[0].composite, rows[5].composite);
  assert.equal(
    rows[0].auxiliary,
    rows[5].auxiliary,
    "两个模型排名分的精确平均均为 500/9，不应被浮点加法次序拆成不同名次",
  );
  const ranks = rankedModels(rows);
  assert.equal(
    ranks.find((r) => r.id === "0").rank,
    ranks.find((r) => r.id === "5").rank,
  );
});

// ─── Arena 第四票：每榜一票，四票 2∶2 判平，不引入新权重 ───

test("four ballots: a 2-2 split is a draw, a 3-1 split follows the majority", () => {
  const a = model("a", [51, 51, 0, 10]),
    b = model("b", [50, 50, 100, 20]);
  const match = majorityMatch(a, b);
  assert.deepEqual([match.leftWins, match.rightWins, match.tied], [2, 2, 0]);
  assert.equal(match.result, 0, "四票 2∶2 为该场平局");
  for (const row of run([a, b]).rows) {
    assert.equal(row.composite, 1000);
    assert.equal(row.winRate, 50);
    assert.deepEqual(row.record, {
      wins: 0,
      draws: 1,
      losses: 0,
      opponents: 1,
      opponentsBySharedSources: Object.fromEntries(
        Array.from({ length: SCORE_SOURCES.length - 1 }, (_, i) => [
          i + 2,
          i + 2 === 4 ? 1 : 0,
        ]),
      ),
    });
  }
  const c = model("c", [51, 51, 51, 0]),
    d = model("d", [50, 50, 50, 100]);
  const decided = majorityMatch(c, d);
  assert.deepEqual([decided.leftWins, decided.rightWins], [3, 1]);
  assert.equal(decided.result, 1);
  const decidedResult = run([c, d]);
  assert.deepEqual(
    decidedResult.rows.map((r) => r.winRate),
    [100, 0],
  );
  assert.ok(decidedResult.rows[0].composite > decidedResult.rows[1].composite);
});

test("a missing Arena ballot leaves the original three-ballot rule intact", () => {
  const a = model("a", [51, 51, 0, null]),
    b = model("b", [50, 50, 100, null]);
  const match = majorityMatch(a, b);
  assert.equal(match.sharedSources, 3);
  assert.deepEqual([match.leftWins, match.rightWins, match.tied], [2, 1, 0]);
  assert.equal(match.result, 1);
  assert.equal(match.ballots.find((x) => x.source === "arena").vote, null);
});

test("one shared source never stages a contest even when Arena joins it", () => {
  const a = model("a", [5, 5, null, null]),
    b = model("b", [1, null, 1, 1]);
  // a 只有 aa/vals，b 有 livebench/arena——零个共同有效榜
  assert.equal(majorityMatch(a, b).result, null);
  // 仅在 Arena 一榜重合仍不计
  const c = model("c", [5, 5, 5, 5]),
    d = model("d", [null, null, null, 1]);
  const match = majorityMatch(c, d);
  assert.deepEqual(
    match.ballots.filter((x) => x.vote !== null).map((x) => x.source),
    ["arena"],
  );
  assert.equal(match.sharedSources, 1);
  assert.equal(match.result, null);
});

test("a stale Arena source is excluded like any other stale source", () => {
  const a = model("a", [3, 3, 3, 3]),
    b = model("b", [2, 2, 2, 2]);
  const withRecords = [a, b].map((m) => ({
    ...m,
    records: Object.fromEntries(
      Object.entries(m.representatives).map(([s, r]) => [s, [r]]),
    ),
  }));
  const removed = applyEvidencePolicy(
    withRecords,
    { arena: { stale: true } },
    { excludeStale: true },
  );
  assert.equal(removed[0].representatives.arena, undefined);
  const match = majorityMatch(removed[0], removed[1]);
  assert.equal(match.sharedSources, 3);
  assert.equal(match.result, 1);
});

test("the auxiliary average spans all four sources with Arena included", () => {
  // a-b 四票 2∶2 平，b 3∶1 胜 c，c 3∶1 胜 a；辅助分为四源百分位精确平均。
  const models = [
    model("a", [9, 1, 5, 1]),
    model("b", [5, 9, 1, 9]),
    model("c", [1, 5, 9, 5]),
  ];
  const result = run(models);
  assert.deepEqual(
    result.rows.map((r) => [r.id, r.auxiliary]),
    [
      ["a", 37.5],
      ["b", 62.5],
      ["c", 50],
    ],
  );
  assert.deepEqual(
    result.rows.map((r) => r.winRate),
    [25, 75, 50],
  );
  assert.ok(result.rows[1].composite > result.rows[2].composite);
  assert.ok(result.rows[2].composite > result.rows[0].composite);
  // 撤掉 Arena 后三源辅助分同为 50，证明第四票真实进入辅助平均
  const withoutArena = run(
    models.map((m) => ({
      ...m,
      representatives: Object.fromEntries(
        Object.entries(m.representatives).filter(([s]) => s !== "arena"),
      ),
    })),
  );
  assert.deepEqual(
    withoutArena.rows.map((r) => r.auxiliary),
    [50, 50, 50],
  );
});

// ─── Bradley-Terry：赛程校正、有限性、顺序不变与连通性门槛 ───

const sourceModel = (id, score, sources) => ({
  id,
  name: id,
  openWeights: true,
  representatives: Object.fromEntries(
    sources.map((source) => [source, { score, costTask: 1 }]),
  ),
});

test("BT corrects a soft schedule that inflates Copeland win rate", () => {
  const all = ["aa", "vals", "livebench", "arena"];
  const narrow = ["aa", "vals"];
  const strong = ["livebench", "arena"];
  const models = [
    sourceModel("a", 100, strong),
    sourceModel("b", 90, strong),
    sourceModel("s", 80, all),
    sourceModel("w", 70, narrow),
    sourceModel("c", 60, narrow),
    sourceModel("d", 50, narrow),
    sourceModel("e", 40, narrow),
  ];
  const result = run(models);
  const row = (id) => result.rows.find((r) => r.id === id);
  // 软赛程：w 只打 weak 组，Copeland 胜率高于 s；但 s 直接击败 w，且只输给更强的 a/b。
  assert.ok(row("w").winRate > row("s").winRate);
  assert.ok(row("s").composite > row("w").composite);
  assert.equal(row("a").copelandRank, 1);
  assert.equal(row("e").record.wins, 0);
  assert.ok(Number.isFinite(row("a").composite));
  assert.ok(Number.isFinite(row("e").composite));
});

test("BT ratings are finite for undefeated and winless models and keep input order irrelevant", () => {
  const models = [
    sourceModel("top", 30, ["aa", "vals"]),
    sourceModel("mid", 20, ["aa", "vals"]),
    sourceModel("bottom", 10, ["aa", "vals"]),
  ];
  const forward = run(models),
    backward = run([...models].reverse());
  const ratings = (result) =>
    Object.fromEntries(result.rows.map((r) => [r.id, r.composite]));
  assert.deepEqual(ratings(forward), ratings(backward));
  assert.ok(ratings(forward).top > ratings(forward).mid);
  assert.ok(ratings(forward).mid > ratings(forward).bottom);
  assert.ok(Object.values(ratings(forward)).every(Number.isFinite));
});

test("a disconnected match graph yields no global ranking instead of prior-connected components", () => {
  const result = run([
    sourceModel("a", 20, ["aa", "vals"]),
    sourceModel("b", 10, ["aa", "vals"]),
    sourceModel("c", 20, ["livebench", "arena"]),
    sourceModel("d", 10, ["livebench", "arena"]),
  ]);
  assert.equal(result.btConnected, false);
  assert.equal(result.btComponents, 2);
  for (const row of result.rows) {
    assert.equal(row.composite, null);
    assert.equal(row.theta, null);
    assert.equal(row.copelandRank, null);
    assert.equal(row.plottable, false);
    assert.match(row.reason, /互不相连/);
  }
  assert.deepEqual(
    result.rows.map((r) => r.winRate),
    [100, 0, 100, 0],
  );
  assert.deepEqual(
    rankedModels(result.rows).map((r) => r.rank),
    [null, null, null, null],
  );
});

test("CSV exports BT strength and the Copeland diagnostic beside the Elo main score", () => {
  const a = model("a", [3, 3, 3]),
    b = model("b", [2, 2, 2]);
  const rows = analyze([a, b], { minOpponents: 1 }).rows;
  const csv = csvExport(rows);
  for (const header of [
    "PK主积分",
    "BT强度θ",
    "现行综合分（Copeland）",
    "现行综合分名次",
    "名次差",
  ])
    assert.ok(csv.includes(header), `缺少列 ${header}`);
  assert.match(csv, /Bradley-Terry/);
  assert.match(csv, /1060\.2060/);
  assert.match(csv, /100\.0000/);
  assert.match(csv, /"0"/);
});

test("main ranking requires ten effective opponents while low-sample matches still inform the fit", () => {
  const models = [
    model("x", [100, 100, null, null]),
    model("c", [90, 90, 100, 100]),
    ...Array.from({ length: 11 }, (_, i) => model("o" + i, [null, null, 0, 0])),
  ];
  const gated = analyze(models);
  const x = gated.rows.find((r) => r.id === "x");
  const c = gated.rows.find((r) => r.id === "c");
  assert.equal(gated.requiredOpponents, 10);
  assert.equal(x.record.opponents, 1);
  assert.equal(x.winRate, 100);
  assert.equal(x.rankEligible, false);
  assert.equal(x.composite, null);
  assert.equal(x.theta, null);
  assert.equal(x.btRank, null);
  assert.equal(x.copelandRank, null);
  assert.equal(x.plottable, false);
  assert.equal(x.frontier, false);
  assert.match(x.reason, /有效对手不足 10（当前 1）/);
  assert.equal(c.record.opponents, 12);
  assert.equal(c.rankEligible, true);
  assert.ok(Number.isFinite(c.composite));
  assert.ok(c.btRank >= 1);
  assert.equal(gated.rows.filter((r) => r.composite != null).length, 12);

  const ungated = analyze(models, { minOpponents: 1 });
  const x2 = ungated.rows.find((r) => r.id === "x");
  assert.equal(x2.rankEligible, true);
  assert.ok(Number.isFinite(x2.composite));
  assert.ok(x2.btRank >= 1);
  assert.equal(
    ungated.rows.find((r) => r.id === "c").composite,
    c.composite,
    "门槛只影响展示资格，不改变拟合结果",
  );

  const xLoses = models.map((m) =>
    m.id === "x"
      ? {
          ...m,
          representatives: {
            aa: { score: 0, costTask: 1 },
            vals: { score: 0, costTask: 1 },
          },
        }
      : m,
  );
  const cWins = analyze(xLoses).rows.find((r) => r.id === "c");
  assert.equal(cWins.record.losses, 0);
  assert.ok(cWins.theta > c.theta, "低样本模型的对局仍进入 BT 拟合");

  const csv = csvExport(gated.rows, { minOpponents: 10 });
  assert.ok(csv.includes("主榜至少 10 个有效对手"));
  assert.ok(csv.includes("有效对手不足 10（当前 1）"));
});
