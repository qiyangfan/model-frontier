import { SCORE_SOURCES, COST_SOURCES } from "../shared/sources.mjs";
export { COST_SOURCES } from "../shared/sources.mjs";
// Gamma(2,1) 弱先验等价于各加 1 个伪胜场与 1 个伪对手，保证全胜/全败模型强度有限。
const BT_PRIOR = 1;
const BT_TOLERANCE = 1e-13;
const BT_MAX_ITERATIONS = 2000;
const ELO_SCALE = 400 / Math.LN10;
const DEFAULT_MIN_OPPONENTS = 10;
export function rankBy(rows, valueOf) {
  const sorted = [...rows].sort(
    (a, b) =>
      (valueOf(b) ?? -Infinity) - (valueOf(a) ?? -Infinity) ||
      (b.auxiliary ?? -Infinity) - (a.auxiliary ?? -Infinity) ||
      a.name.localeCompare(b.name),
  );
  let lastValue = null,
    lastAuxiliary = null,
    rank = null;
  return sorted.map((r, i) => {
    const value = valueOf(r);
    if (Number.isFinite(value)) {
      if (lastValue !== value || lastAuxiliary !== (r.auxiliary ?? null))
        rank = i + 1;
      lastValue = value;
      lastAuxiliary = r.auxiliary ?? null;
      return { ...r, rank };
    }
    return { ...r, rank: null };
  });
}
function percentileFraction(score, pool) {
  if (pool.length === 1) return [50n, 1n];
  const less = pool.filter((v) => v < score).length;
  const equal = pool.filter((v) => v === score).length;
  return [100n * BigInt(2 * less + equal - 1), 2n * BigInt(pool.length - 1)];
}
export function percentile(score, pool) {
  const [numerator, denominator] = percentileFraction(score, pool);
  return Number(numerator) / Number(denominator);
}
function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}
function percentileSummary(model, sources, pool) {
  // 先按有理数精确求和再转数值，避免累加顺序将数学同分拆成不同名次。
  let numerator = 0n,
    denominator = 1n;
  const percentiles = {};
  for (const source of sources) {
    const [n, d] = percentileFraction(
      model.representatives[source].score,
      pool[source],
    );
    percentiles[source] = Number(n) / Number(d);
    numerator = numerator * d + n * denominator;
    denominator *= d;
  }
  denominator *= BigInt(sources.length);
  const divisor = gcd(numerator, denominator);
  return {
    percentiles,
    auxiliary: Number(numerator / divisor) / Number(denominator / divisor),
  };
}
export function pareto(rows) {
  return rows.filter(
    (r) =>
      !rows.some(
        (o) =>
          o.id !== r.id &&
          o.cost <= r.cost &&
          o.composite >= r.composite &&
          (o.cost < r.cost || o.composite > r.composite),
      ),
  );
}
function median(values) {
  const a = [...values].sort((a, b) => a - b);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
export function combinedCostProfile(
  models,
  includeEstimated = false,
  costSources = COST_SOURCES,
) {
  const eligible =
    costSources.length < 2
      ? []
      : models.filter((m) =>
          costSources.every((s) => {
            const r = m.representatives[s];
            return (
              Number.isFinite(r?.costTask) &&
              r.costTask > 0 &&
              (includeEstimated || !r.estimated)
            );
          }),
        );
  return {
    count: eligible.length,
    sources: costSources,
    medians: Object.fromEntries(
      COST_SOURCES.map((s) => [
        s,
        eligible.length && costSources.includes(s)
          ? median(eligible.map((m) => m.representatives[s].costTask))
          : null,
      ]),
    ),
  };
}
export function combinedCost(
  model,
  profile,
  includeEstimated = false,
  minSources = 3,
) {
  const components = COST_SOURCES.map((source) => {
    const r = model.representatives[source];
    const cost = r?.costTask;
    const baseline = profile.medians[source];
    return {
      source,
      cost,
      baseline,
      ratio: cost > 0 && baseline > 0 ? cost / baseline : null,
      estimated: !!r?.estimated,
    };
  });
  const available = components.filter(
    (c) =>
      Number.isFinite(c.ratio) &&
      c.ratio > 0 &&
      (includeEstimated || !c.estimated),
  );
  if (available.length < minSources)
    return { value: null, components, coverage: available.length };
  return {
    value:
      100 *
      Math.exp(
        available.reduce((sum, c) => sum + Math.log(c.ratio), 0) /
          available.length,
      ),
    components,
    coverage: available.length,
  };
}
// 每榜只比较该榜原始分；同榜同分平票，缺失或被排除估算不参与。
export function majorityMatch(
  left,
  right,
  { includeEstimated = false, sources = SCORE_SOURCES } = {},
) {
  const ballots = sources.map((source) => {
    const a = left.representatives[source],
      b = right.representatives[source];
    const valid =
      Number.isFinite(a?.score) &&
      Number.isFinite(b?.score) &&
      (includeEstimated || (!a.estimated && !b.estimated));
    const difference = valid ? a.score - b.score : null;
    return { source, difference, vote: valid ? Math.sign(difference) : null };
  });
  const leftWins = ballots.filter((b) => b.vote === 1).length;
  const rightWins = ballots.filter((b) => b.vote === -1).length;
  const tied = ballots.filter((b) => b.vote === 0).length;
  const sharedSources = ballots.filter((b) => b.vote !== null).length;
  const complete = sharedSources >= 2;
  return {
    ballots,
    leftWins,
    rightWins,
    tied,
    complete,
    sharedSources,
    result: complete ? Math.sign(leftWins - rightWins) : null,
  };
}

function majorityRecords(models, includeEstimated, sources = SCORE_SOURCES) {
  const records = new Map(
    models.map((m) => [
      m.id,
      {
        wins: 0,
        draws: 0,
        losses: 0,
        opponents: 0,
        opponentsBySharedSources: Object.fromEntries(
          Array.from({ length: Math.max(0, sources.length - 1) }, (_, i) => [
            i + 2,
            0,
          ]),
        ),
      },
    ]),
  );
  const contests = [];
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const match = majorityMatch(models[i], models[j], {
        includeEstimated,
        sources,
      });
      const { result } = match;
      if (result === null) continue;
      const a = records.get(models[i].id),
        b = records.get(models[j].id);
      a.opponents++;
      b.opponents++;
      a.opponentsBySharedSources[match.sharedSources]++;
      b.opponentsBySharedSources[match.sharedSources]++;
      if (result === 0) {
        a.draws++;
        b.draws++;
      } else if (result > 0) {
        a.wins++;
        b.losses++;
      } else {
        a.losses++;
        b.wins++;
      }
      contests.push({
        left: models[i].id,
        right: models[j].id,
        result,
      });
    }
  }
  return { records, contests };
}

export function fitBradleyTerry(contests) {
  const index = new Map(),
    neighbors = [],
    wins = [];
  const node = (id) => {
    if (!index.has(id)) {
      index.set(id, neighbors.length);
      neighbors.push([]);
      wins.push(0);
    }
    return index.get(id);
  };
  for (const { left, right, result } of contests) {
    const a = node(left),
      b = node(right);
    neighbors[a].push(b);
    neighbors[b].push(a);
    if (result === 0) {
      wins[a] += 0.5;
      wins[b] += 0.5;
    } else if (result > 0) {
      wins[a] += 1;
    } else {
      wins[b] += 1;
    }
  }
  const count = neighbors.length;
  if (!count)
    return {
      connected: true,
      components: 0,
      ratings: new Map(),
      thetas: new Map(),
    };
  const seen = new Uint8Array(count);
  let components = 0;
  for (let start = 0; start < count; start++) {
    if (seen[start]) continue;
    components++;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      for (const next of neighbors[stack.pop()]) {
        if (!seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
  }
  if (components > 1)
    return {
      connected: false,
      components,
      ratings: new Map(),
      thetas: new Map(),
    };
  let strength = new Float64Array(count).fill(1);
  for (let iteration = 0; iteration < BT_MAX_ITERATIONS; iteration++) {
    const next = new Float64Array(count);
    let maxChange = 0;
    for (let i = 0; i < count; i++) {
      const current = strength[i];
      let denominator = 0;
      for (const other of neighbors[i])
        denominator += 1 / (current + strength[other]);
      const value = (wins[i] + BT_PRIOR) / (denominator + BT_PRIOR);
      next[i] = value;
      maxChange = Math.max(maxChange, Math.abs(value - current) / current);
    }
    strength = next;
    if (maxChange < BT_TOLERANCE) break;
  }
  const thetas = new Map(),
    sortedTheta = new Array(count);
  for (const [id, i] of index) {
    const theta = Math.log(strength[i]);
    thetas.set(id, theta);
    sortedTheta[i] = theta;
  }
  sortedTheta.sort((a, b) => a - b);
  const middle = Math.floor(count / 2);
  const medianTheta =
    count % 2
      ? sortedTheta[middle]
      : (sortedTheta[middle - 1] + sortedTheta[middle]) / 2;
  const ratings = new Map();
  for (const [id, theta] of thetas)
    ratings.set(
      id,
      Number((1000 + ELO_SCALE * (theta - medianTheta)).toFixed(6)),
    );
  return { connected: true, components, thetas, ratings };
}

export function analyze(
  models,
  {
    costSource = "composite",
    includeEstimated = false,
    costMinSources = 2,
    costSources = COST_SOURCES,
    minOpponents = DEFAULT_MIN_OPPONENTS,
  } = {},
) {
  const profile = combinedCostProfile(models, includeEstimated, costSources);
  const sources = SCORE_SOURCES;
  const required = 2;
  const eligible = models.filter(
    (m) =>
      sources.filter((s) => {
        const r = m.representatives[s];
        return Number.isFinite(r?.score) && (includeEstimated || !r.estimated);
      }).length >= required,
  );
  const { records: matches, contests } = majorityRecords(
    eligible,
    includeEstimated,
  );
  const bt = fitBradleyTerry(contests);
  const pool = Object.fromEntries(
    sources.map((s) => [
      s,
      eligible
        .map((m) => m.representatives[s])
        .filter(
          (r) =>
            Number.isFinite(r?.score) && (includeEstimated || !r.estimated),
        )
        .map((r) => r.score),
    ]),
  );
  const rows = models.map((m) => {
    const available = sources.filter((s) => {
      const r = m.representatives[s];
      return Number.isFinite(r?.score) && (includeEstimated || !r.estimated);
    });
    const covered = sources.length > 0 && available.length >= required;
    const record = matches.get(m.id) ?? null;
    const valid = covered && record.opponents > 0;
    const rankEligible = valid && record.opponents >= minOpponents;
    let composite = null;
    let winRate = null;
    let theta = null;
    let percentiles = {};
    let auxiliary = null;
    if (valid) {
      ({ percentiles, auxiliary } = percentileSummary(m, available, pool));
      winRate = (100 * (record.wins + 0.5 * record.draws)) / record.opponents;
      if (rankEligible && bt.connected) {
        composite = bt.ratings.get(m.id) ?? null;
        theta = bt.thetas.get(m.id) ?? null;
      }
    }
    const costRecord = m.representatives[costSource];
    const combined = combinedCost(m, profile, includeEstimated, costMinSources);
    const cost =
      costSource === "composite" ? combined.value : costRecord?.costTask;
    const reason = !covered
      ? `需要 ${required} 个有效榜单，目前 ${available.length} 个`
      : !valid
        ? `多数对决至少需要 ${required} 榜共同有效的对手，当前没有对手`
        : !bt.connected
          ? `对局图分为 ${bt.components} 个互不相连的组，无法给出单一全局排名`
          : !rankEligible
            ? `有效对手不足 ${minOpponents}（当前 ${record.opponents}），仅展示原始战绩`
            : !Number.isFinite(cost)
              ? costSource === "composite"
                ? `综合成本至少需要 ${costMinSources} 个来源的有效成本`
                : "所选来源未披露任务成本"
              : cost <= 0
                ? "成本为 0 或低于源站精度，未放入对数图"
                : null;
    return {
      ...m,
      composite,
      winRate,
      theta,
      rankEligible,
      auxiliary,
      record,
      costCoverage: combined.coverage,
      percentiles,
      available,
      complete: available.length === sources.length,
      cost: Number.isFinite(cost) ? cost : null,
      costUnit: costSource === "composite" ? "相对成本指数" : "USD / task",
      costComponents: combined.components,
      plottable: !reason,
      reason,
      frontier: false,
      openFrontier: false,
    };
  });
  const btRanks = new Map(
    rankBy(rows, (r) => r.composite).map((r) => [r.id, r.rank]),
  );
  const copelandRanks = bt.connected
    ? new Map(
        rankBy(
          rows.filter((r) => Number.isFinite(r.composite)),
          (r) => r.winRate,
        ).map((r) => [r.id, r.rank]),
      )
    : new Map();
  for (const row of rows) {
    row.btRank = btRanks.get(row.id) ?? null;
    row.copelandRank = copelandRanks.get(row.id) ?? null;
  }
  const coverageCohorts = [];
  for (let mask = 1; mask < 1 << sources.length; mask++) {
    const selectedSources = sources.filter((_, index) => mask & (1 << index));
    if (selectedSources.length < required) continue;
    const cohort = eligible.filter((m) =>
      selectedSources.every((source) => {
        const score = m.representatives[source];
        return (
          Number.isFinite(score?.score) &&
          (includeEstimated || !score.estimated)
        );
      }),
    );
    if (cohort.length < 2) continue;
    const { records, contests: cohortContests } = majorityRecords(
      cohort,
      includeEstimated,
      selectedSources,
    );
    const cohortBt = fitBradleyTerry(cohortContests);
    const cohortPool = Object.fromEntries(
      selectedSources.map((source) => [
        source,
        cohort.map((m) => m.representatives[source].score),
      ]),
    );
    const cohortRows = cohort.map((m) => {
      const record = records.get(m.id);
      const { auxiliary } = percentileSummary(m, selectedSources, cohortPool);
      return {
        id: m.id,
        name: m.name,
        creator: m.creator,
        openWeights: m.openWeights,
        composite: cohortBt.connected
          ? (cohortBt.ratings.get(m.id) ?? null)
          : null,
        theta: cohortBt.connected ? (cohortBt.thetas.get(m.id) ?? null) : null,
        winRate:
          record.opponents > 0
            ? (100 * (record.wins + 0.5 * record.draws)) / record.opponents
            : null,
        auxiliary,
        record,
      };
    });
    coverageCohorts.push({
      id: selectedSources.join("+"),
      sources: selectedSources,
      count: cohort.length,
      rows: cohortRows,
    });
  }
  coverageCohorts.sort(
    (a, b) => b.sources.length - a.sources.length || b.count - a.count,
  );
  const plotted = rows.filter((r) => r.plottable);
  const front = new Set(pareto(plotted).map((r) => r.id));
  const openFront = new Set(
    pareto(plotted.filter((r) => r.openWeights === true)).map((r) => r.id),
  );
  for (const r of rows) {
    r.frontier = front.has(r.id);
    r.openFrontier = openFront.has(r.id);
  }
  for (const r of rows) {
    r.dominatedBy = !Number.isFinite(r.composite)
      ? []
      : plotted
          .filter(
            (o) =>
              o.frontier &&
              o.id !== r.id &&
              o.cost <= r.cost &&
              o.composite >= r.composite &&
              (o.cost < r.cost || o.composite > r.composite),
          )
          .map((o) => o.name);
  }
  return {
    rows,
    sources,
    required,
    requiredOpponents: minOpponents,
    includeEstimated,
    cohort: eligible.length,
    coverageCohorts,
    plotted: plotted.length,
    costProfile: profile,
    btConnected: bt.connected,
    btComponents: bt.components,
  };
}

const isoTime = (value) => {
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
};
export function csvExport(rows, meta = {}) {
  const header = [
    "模型",
    "厂商",
    "开放权重",
    "覆盖榜数",
    "PK主积分",
    "BT强度θ",
    "现行综合分（Copeland）",
    "现行综合分名次",
    "名次差",
    "成本来源数",
    "成本值",
    "成本单位",
    "全球前沿",
    "开放权重前沿",
    "未入图原因",
    "AA",
    "Vals",
    "LiveBench",
    "Arena",
    "AA配置",
    "Vals配置",
    "LiveBench配置",
    "Arena配置",
    "Arena投票数",
    "Arena评分区间下限",
    "Arena评分区间上限",
    "Arena发布日期",
    "数据时间",
    "评分口径",
    "评分公式",
    "胜场",
    "平场",
    "负场",
    "对手数",
    "双方共有2个有效评分榜的对局数",
    "双方共有3个有效评分榜的对局数",
    "双方共有4个有效评分榜的对局数",
    "榜单位次均值（仅PK同分排序）",
  ];
  const scope = typeof meta.scope === "string" ? meta.scope : "";
  const dataTime = isoTime(meta.lastRefresh);
  const minOpponents = Number.isFinite(meta.minOpponents)
    ? meta.minOpponents
    : 10;
  const btRanks = new Map(
    rankBy(rows, (r) => r.composite).map((r) => [r.id, r.rank]),
  );
  const btRank = (r) =>
    Number.isFinite(r.rank)
      ? r.rank
      : Number.isFinite(r.btRank)
        ? r.btRank
        : (btRanks.get(r.id) ?? null);
  const rankDelta = (r) => {
    const current = btRank(r);
    return Number.isFinite(r.copelandRank) && Number.isFinite(current)
      ? r.copelandRank - current
      : null;
  };
  const safe = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\ufeff" +
    [
      header,
      ...rows.map((r) => [
        r.name,
        r.creator,
        r.openWeights === true
          ? "是"
          : r.openWeights === false
            ? "否"
            : "未确认",
        r.available.length,
        r.composite?.toFixed(4),
        r.theta?.toFixed(6),
        r.winRate?.toFixed(4),
        r.copelandRank,
        rankDelta(r),
        r.costCoverage,
        r.costUnit === "相对成本指数" && r.cost != null ? r.cost / 100 : r.cost,
        r.costUnit === "相对成本指数" ? "基准倍数" : r.costUnit,
        r.frontier ? "是" : "否",
        r.openFrontier ? "是" : "否",
        r.reason,
        ...SCORE_SOURCES.map((s) => r.representatives[s]?.score),
        ...SCORE_SOURCES.map((s) => r.representatives[s]?.configuration),
        r.representatives.arena?.voteCount,
        r.representatives.arena?.scoreLower,
        r.representatives.arena?.scoreUpper,
        r.representatives.arena?.publishedAt,
        dataTime,
        scope,
        `四榜多数对决 Bradley-Terry MAP（Gamma(2,1) 先验，平局半胜；PK主积分为 Elo 尺度，主榜至少 ${minOpponents} 个有效对手，位次均值仅同分排序）`,
        r.record?.wins,
        r.record?.draws,
        r.record?.losses,
        r.record?.opponents,
        r.record?.opponentsBySharedSources?.[2],
        r.record?.opponentsBySharedSources?.[3],
        r.record?.opponentsBySharedSources?.[4],
        r.auxiliary?.toFixed(4),
      ]),
    ]
      .map((r) => r.map(safe).join(","))
      .join("\r\n")
  );
}

// Reproduce one source on its own full source population; no common-cohort restriction.
export function sourceAudit(models, modelId, source) {
  const target = models.find((m) => m.id === modelId);
  if (!target) return null;
  const candidates = models
    .flatMap((m) =>
      (m.records[source] ?? [])
        .filter(
          (r) => Number.isFinite(r.score) && !r.estimated && !r.deprecated,
        )
        .map((r, i) => {
          let cost = r.costTask;
          let basis = "每次任务 USD";
          if (source === "livebench") {
            cost = r.costSuccess;
            basis = "每次成功任务 USD";
          }
          return {
            ...r,
            id: m.id + ":" + i,
            modelId: m.id,
            composite: r.score,
            cost,
            basis,
          };
        }),
    )
    .filter((r) => Number.isFinite(r.cost) && r.cost > 0);
  const targets = candidates.filter((r) => r.modelId === modelId);
  const frontIds = new Set(pareto(candidates).map((r) => r.id));
  const preferred = targets.sort((a, b) => b.score - a.score)[0];
  if (!preferred)
    return { source, available: false, reason: "源站缺少有效分数或可用成本" };
  const dominates = candidates
    .filter(
      (o) =>
        o.modelId !== modelId &&
        o.cost <= preferred.cost &&
        o.score >= preferred.score &&
        (o.cost < preferred.cost || o.score > preferred.score),
    )
    .sort((a, b) => b.score - a.score);
  return {
    source,
    available: true,
    name: preferred.name,
    score: preferred.score,
    cost: preferred.cost,
    basis: preferred.basis,
    frontier: frontIds.has(preferred.id),
    anyVariantOnFrontier: targets.some((r) => frontIds.has(r.id)),
    dominatedBy: [...new Set(dominates.map((r) => r.name))].slice(0, 4),
    population: candidates.length,
  };
}

// ══════════ ADR-0019：成本调整综合分与无脑选决策层 ══════════
// 调整分 = composite − λ·log2(costIndex/100)（costIndex: 100=池中位，ADR-0003 口径）。
// 三公理：支配一致性（λ·log2 单调性定理保证，certify 内自检）、短板淘汰（任一榜单百分位
// 低于下限即出局；术语源自 harness-bench「塌方门」，对外文案统一称「短板」——四张第三方
// 榜单即四种测量体系，本门测的是各榜最低百分位的绝对下限而非分化幅度，2026-11-11 裁定
// 见 docs/adr/0019 修订记录；另要求全量榜单覆盖——未测榜单无短板证据也无强度证据，认证的
// 全维度断言必须有完整证据集）、膝盖收敛（λ 扫描 argmax 不变性 = 最小最大遗憾解）。
// 扫描取 6 个格点即精确：调整分对 λ 线性，上包络顶线更替只能发生在交叉点且必改变其所在
// 区间端点的 argmax，故 [0,40] 连续区间内任何 argmax 更替都会在格点上显形，格点认证
// 与连续认证等价、非近似。
// λ=10：经三榜交叉 21 模型实测市场斜率 9.4±2.7/翻倍校准（2026-11-10，详见 docs/adr/0019）。

export function adjustedScores(rows, { lambda = 10, gatePct = 40 } = {}) {
  const out = rows.map((r) => {
    const pct = Number.isFinite(r.composite)
      ? Object.values(r.percentiles ?? {}).filter(Number.isFinite)
      : [];
    const floorPct = pct.length ? Math.min(...pct) : null;
    const hasInput =
      Number.isFinite(r.composite) && Number.isFinite(r.cost) && r.cost > 0;
    const adjusted = hasInput
      ? r.composite - lambda * Math.log2(r.cost / 100)
      : null;
    const complete = r.complete === true; // 缺字段按不完整处理：决策门宁缺毋滥（fail-closed）
    const floorOk =
      hasInput && Number.isFinite(floorPct) && floorPct >= gatePct;
    const eligible = floorOk && complete;
    // reason 按「最具体的失败」优先：已测榜单存在短板比覆盖不足更能说明问题，即使两者同时成立
    const reason = !hasInput
      ? (r.reason ?? "composite 或成本缺失，不入调整分")
      : !Number.isFinite(floorPct)
        ? "无有效榜单百分位，短板无法评估"
        : !floorOk
          ? `最低榜单百分位 ${floorPct.toFixed(0)} 低于短板线 ${gatePct}，存在短板榜单，不入首选池`
          : !complete
            ? `仅 ${pct.length} 榜有效实测分，无法排除未测榜单的短板，不入首选池`
            : null;
    return {
      id: r.id,
      name: r.name,
      creator: r.creator,
      composite: r.composite,
      cost: r.cost,
      floorPct,
      covered: pct.length,
      complete,
      adjusted,
      eligible,
      reason,
    };
  });
  return { lambda, gatePct, rows: out };
}

export function certifyNoBrainer(
  scored,
  { lambdaList = [0, 2.5, 5, 10, 20, 40] } = {},
) {
  const { rows, lambda, gatePct } = scored;
  const pool = rows.filter((r) => r.eligible);
  const violations = [];
  for (const a of pool) {
    for (const b of pool) {
      if (a.id === b.id) continue;
      const dominates =
        a.composite >= b.composite &&
        a.cost <= b.cost &&
        (a.composite > b.composite || a.cost < b.cost);
      if (dominates && a.adjusted <= b.adjusted) violations.push([a.id, b.id]);
    }
  }
  const sweep = lambdaList.map((lam) => {
    let pick = null;
    let value = -Infinity;
    for (const r of pool) {
      const v = r.composite - lam * Math.log2(r.cost / 100);
      if (v > value) {
        value = v;
        pick = r.id;
      }
    }
    return { lambda: lam, pick, value };
  });
  const counts = {};
  for (const s of sweep) counts[s.pick] = (counts[s.pick] ?? 0) + 1;
  const pick =
    pool.length === 0
      ? null
      : Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0];
  const certified =
    pool.length > 0 &&
    violations.length === 0 &&
    new Set(sweep.map((s) => s.pick)).size === 1;
  return {
    certified,
    // 未认证时也返回多数档 pick：卡片明示「未认证」并展示 λ 区间图，由用户自选，
    // 认证与否只改变展示文案，不隐藏答案来源（宪法第 1 条：不伪造单一答案）。
    pick,
    counts,
    sweep,
    violations,
    poolSize: pool.length,
    lambda,
    gatePct,
  };
}

// ADR-0020：完整性价比榜单的排序与池外分组。入池模型按 λ=10 调整分降序占名次；
// 调整分并列时按综合分降序、名称升序，保证渲染次序确定（不随输入顺序漂移）。
// 池外只收有输入（有调整分）的行——缺综合分或成本的模型本卡片无从评估，不在其列。
export function valueRanking(scored) {
  const ranked = scored.rows
    .filter((r) => r.eligible)
    .sort(
      (a, b) =>
        b.adjusted - a.adjusted ||
        b.composite - a.composite ||
        a.name.localeCompare(b.name),
    );
  const gatedOut = scored.rows.filter((r) => !r.eligible && r.adjusted != null);
  return { ranked, gatedOut };
}
