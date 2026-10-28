import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FETCHERS, parseVals } from "../server/adapters.mjs";
const directory = await mkdtemp(join(tmpdir(), "frontier-store-"));
process.env.FRONTIER_DATA_DIR = directory;
const store = await import("../server/store.mjs");
test("legacy cache drops retired sources and preserves hourly refresh", async () => {
  await writeFile(
    join(directory, "snapshot.json"),
    JSON.stringify({
      schemaVersion: 1,
      sources: {
        arena: { rows: [{ name: "Retired only", score: 99 }] },
        aa: { rows: [{ name: "Current", score: 10, openWeights: true }] },
      },
      settings: { refreshHours: 1 },
      lastRefresh: null,
    }),
  );
  await store.loadState();
  const data = store.view();
  // 接口总是披露全部来源；旧格式 Arena 不算已获取，count 为 0。
  assert.deepEqual(Object.keys(data.sources).sort(), [
    "aa",
    "arena",
    "livebench",
    "vals",
  ]);
  assert.equal(data.sources.arena.count, 0);
  assert.equal(data.settings.refreshHours, 1);
  assert.equal(data.models.length, 1);
  assert.equal(data.models[0].name, "Current");
  const saved = JSON.parse(
    await readFile(join(directory, "snapshot.json"), "utf8"),
  );
  assert.equal(Object.hasOwn(saved.sources, "arena"), false);
});
test("new-format Arena cache is kept as an acquired source and mixed into models", async () => {
  await writeFile(
    join(directory, "snapshot.json"),
    JSON.stringify({
      schemaVersion: 1,
      sources: {
        arena: {
          ingestFormat: "arena-text-overall-v1",
          sourceDate: "2026-10-15",
          fetchedAt: "2026-10-16T02:05:52.769Z",
          rows: [
            {
              name: "Arena Model",
              rawId: "Arena Model",
              score: 1400,
              voteCount: 4904,
              scoreLower: 1500,
              scoreUpper: 1550,
              publishedAt: "2026-10-15",
            },
          ],
        },
        aa: { rows: [{ name: "Current", score: 10, openWeights: true }] },
      },
      settings: { refreshHours: 1 },
      lastRefresh: null,
    }),
  );
  await store.loadState();
  const data = store.view();
  assert.equal(data.sources.arena.count, 1);
  assert.equal(data.sources.arena.sourceDate, "2026-10-15");
  const arenaModel = data.models.find((m) => m.name === "Arena Model");
  assert.ok(arenaModel, "Arena-only 模型应进入模型库");
  assert.equal(arenaModel.representatives.arena.score, 1400);
  const saved = JSON.parse(
    await readFile(join(directory, "snapshot.json"), "utf8"),
  );
  assert.equal(saved.sources.arena.ingestFormat, "arena-text-overall-v1");
});
test("a failed Arena refresh keeps the last good cache and marks it stale", async () => {
  await store.loadState();
  const good = store.view().sources.arena.fetchedAt;
  await store.refreshAll({
    arena: async () => {
      throw new Error("arena outage");
    },
  });
  const data = store.view();
  assert.equal(data.sources.arena.count, 1);
  assert.equal(data.sources.arena.sourceDate, "2026-10-15");
  assert.equal(data.sources.arena.stale, true);
  assert.equal(data.sources.arena.error, "arena outage");
  assert.equal(data.sources.arena.fetchedAt, good);
  assert.ok(data.sources.arena.attemptedAt);
});
test("concurrent refreshes coalesce; failed sources preserve last good snapshot and timestamps", async () => {
  await store.loadState();
  let calls = 0;
  const rows = Array.from({ length: 6 }, (_, i) => ({
    name: "Future " + i,
    score: i,
  }));
  let release;
  const gate = new Promise((r) => (release = r));
  const fetchers = {
    aa: async () => {
      calls++;
      await gate;
      return { rows, sourceDate: "2026-10-16" };
    },
  };
  const first = store.refreshAll(fetchers);
  const second = store.refreshAll(fetchers);
  assert.equal(first, second);
  release();
  await first;
  assert.equal(calls, 1);
  const good = store.view().sources.aa.fetchedAt;
  await store.refreshAll({
    aa: async () => {
      throw new Error("temporary outage");
    },
  });
  const snapshot = JSON.parse(
    await readFile(join(directory, "snapshot.json"), "utf8"),
  );
  assert.equal(snapshot.sources.aa.rows.length, 6);
  assert.equal(snapshot.sources.aa.fetchedAt, good);
  assert.equal(snapshot.sources.aa.stale, true);
  assert.equal(snapshot.sources.aa.error, "temporary outage");
  assert.equal(store.progress.running, false);
});
test("invalid source updates are rejected and automatic refresh may be disabled", async () => {
  await store.refreshAll({ aa: async () => ({ rows: [] }) });
  assert.equal(store.view().sources.aa.count, 6);
  await store.setRefreshHours(0);
  assert.equal(store.refreshDue(), false);
  await assert.rejects(() => store.setRefreshHours(7));
});
test("a suspicious collapse in row count is rejected instead of silently replacing the cache", async () => {
  const rows = Array.from({ length: 240 }, (_, i) => ({
    name: "Model " + i,
    score: i,
  }));
  await store.refreshAll({ aa: async () => ({ rows }) });
  assert.equal(store.view().sources.aa.count, 240);
  // 源站只下发部分数据时格式完全合法，必须按上次成功缓存比对后拒绝
  await store.refreshAll({ aa: async () => ({ rows: rows.slice(0, 100) }) });
  assert.equal(store.view().sources.aa.count, 240);
  assert.match(store.view().sources.aa.error, /疑似不完整/);
  assert.equal(store.view().sources.aa.stale, true);
  // 正常幅度的波动仍然接受
  await store.refreshAll({ aa: async () => ({ rows: rows.slice(0, 200) }) });
  assert.equal(store.view().sources.aa.count, 200);
  assert.equal(store.view().sources.aa.error, null);
  // 小体量来源不受该闸门影响
  await store.refreshAll({ vals: async () => ({ rows: rows.slice(0, 40) }) });
  assert.equal(store.view().sources.vals.count, 40);
  assert.equal(store.view().sources.vals.error, null);
});
test("a source narrowing its own scoring coverage is accepted, not treated as a partial download", async () => {
  // AA 自 v5.0 起只对覆盖新基准套件的配置发布 Intelligence Index：载荷仍是 715 条，
  // 有分的从 704 塌到 77。这是源站口径收缩，不是抓取不完整。
  const roster = Array.from({ length: 715 }, (_, i) => ({
    name: "Model " + i,
    score: i < 704 ? 10 + i * 0.25 : null,
  }));
  await store.refreshAll({ aa: async () => ({ rows: roster }) });
  assert.equal(store.view().sources.aa.count, 715);
  const narrowed = roster.map((r, i) => (i < 77 ? r : { ...r, score: null }));
  await store.refreshAll({ aa: async () => ({ rows: narrowed }) });
  assert.equal(store.view().sources.aa.count, 715);
  assert.equal(store.view().sources.aa.stale, false);
  assert.equal(store.view().sources.aa.error, null);
});
test("Vals refresh accepts the current table and clears a previous failure", async () => {
  await store.refreshSources(["vals"], {
    vals: async () => {
      throw new Error("previous failure");
    },
  });
  assert.equal(store.view().sources.vals.stale, true);
  const rows = Array.from(
    { length: 6 },
    (_, i) =>
      `<tr><td>${i + 1}</td><th scope="row">Model ${i}</th><td>${50 + i}%</td><td>$1.25</td><td>2m</td><td>3m</td></tr>`,
  ).join("");
  const html = `<table><thead><tr><th>Rank</th><th>Model</th><th>Accuracy</th><th>Cost / Test</th><th>Tokens / Test</th><th>Duration / Test</th></tr></thead><tbody>${rows}</tbody></table>`;
  await store.refreshSources(["vals"], { vals: async () => parseVals(html) });
  const source = store.view().sources.vals;
  assert.equal(source.count, 6);
  assert.equal(source.stale, false);
  assert.equal(source.error, null);
  const saved = JSON.parse(
    await readFile(join(directory, "snapshot.json"), "utf8"),
  );
  assert.equal(saved.sources.vals.rows[0].priceInput, null);
  assert.equal(saved.sources.vals.rows[0].duration, "3m");
});
test("failed Vals price lookup keeps the previous scores and prices", async () => {
  const previous = Array.from({ length: 6 }, (_, i) => ({
    name: `Model ${i}`,
    score: 50 + i,
    priceInput: 0.435,
    priceOutput: 0.87,
  }));
  await store.refreshSources(["vals"], {
    vals: async () => ({ rows: previous }),
  });
  const before = store.view().sources.vals.fetchedAt;
  const rows = previous
    .map(
      (row, i) =>
        `<tr><td>${i + 1}</td><th><a href="/models/lab_model-${i}">${row.name}</a></th><td>90%</td><td>$1</td><td>2m</td><td>3m</td></tr>`,
    )
    .join("");
  const html = `<table><thead><tr><th>Rank</th><th>Model</th><th>Accuracy</th><th>Cost / Test</th><th>Tokens / Test</th><th>Duration / Test</th></tr></thead><tbody>${rows}</tbody></table>`;
  const original = globalThis.fetch;
  globalThis.fetch = async (input) =>
    new URL(input).pathname === "/benchmarks/vals_index"
      ? new Response(html)
      : new Response("unavailable", { status: 503 });
  try {
    await store.refreshSources(["vals"], { vals: FETCHERS.vals });
  } finally {
    globalThis.fetch = original;
  }
  const source = store.view().sources.vals;
  const saved = JSON.parse(
    await readFile(join(directory, "snapshot.json"), "utf8"),
  ).sources.vals;
  assert.equal(source.stale, true);
  assert.match(source.error, /参考单价.*未能获取/);
  assert.equal(source.fetchedAt, before);
  assert.deepEqual(saved.rows, previous);
});
after(() => rm(directory, { recursive: true, force: true }));
