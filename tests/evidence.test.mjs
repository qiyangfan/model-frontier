import test from "node:test";
import assert from "node:assert/strict";
import {
  applyEvidencePolicy,
  configurationAssessment,
  evidenceFlags,
  sourceHealth,
} from "../src/evidence.mjs";
import { analyze } from "../src/analysis.mjs";
const row = (name, score = 50, more = {}) => ({
  name,
  configuration: name,
  score,
  costTask: 1,
  ...more,
});
const model = (records) => ({
  id: "test",
  name: "Test",
  records,
  representatives: Object.fromEntries(
    Object.entries(records).map(([s, rs]) => [s, rs[0]]),
  ),
});
test("configuration differences require explicit effort or reasoning mode evidence", () => {
  assert.equal(
    configurationAssessment(
      model({
        aa: [row("Test (high)")],
        vals: [row("Test")],
        livebench: [row("max")],
      }),
    ).status,
    "different",
  );
  assert.equal(
    configurationAssessment(
      model({
        aa: [row("Test (non-reasoning)")],
        livebench: [row("Test (reasoning)")],
      }),
    ).status,
    "different",
  );
});
test("matching labels do not imply a matching experimental protocol; absent labels stay unknown", () => {
  const r = configurationAssessment(
    model({ aa: [row("Test (max with fallback)")], livebench: [row("max")] }),
  );
  assert.equal(r.status, "matched");
  assert.ok(r.reason.includes("不代表统一实验"));
  assert.equal(r.entries[0].fallback, true);
  assert.equal(
    configurationAssessment(
      model({ aa: [row("Test (max)")], vals: [row("Test")] }),
    ).status,
    "unknown",
  );
  assert.equal(
    configurationAssessment(model({ aa: [row("Test")] })).status,
    "unknown",
  );
});
test("unknown source release date does not make a fresh cache stale", () => {
  const now = Date.parse("2026-10-16T10:00:00Z");
  assert.equal(
    sourceHealth({ fetchedAt: "2026-10-16T09:00:00Z", sourceDate: null }, now)
      .excluded,
    false,
  );
  assert.equal(
    sourceHealth({ fetchedAt: "2026-10-14T09:00:00Z" }, now).overdue,
    true,
  );
  assert.equal(
    sourceHealth({ fetchedAt: "2026-10-16T09:00:00Z", stale: true }, now)
      .failed,
    true,
  );
});
test("quality defaults preserve models and scoring exactly", () => {
  const models = [model({ aa: [row("Test")], vals: [row("Test")] })];
  assert.equal(applyEvidencePolicy(models, {}), models);
  assert.equal(
    applyEvidencePolicy(
      models,
      { aa: { stale: false } },
      { excludeStale: true },
    ),
    models,
  );
  assert.deepEqual(analyze(applyEvidencePolicy(models, {})), analyze(models));
});
test("failed source removal applies equally to ability and task costs; models remain discoverable", () => {
  const m = model({
    aa: [row("Test")],
    vals: [row("Test")],
    livebench: [row("Test")],
  });
  const sources = { livebench: { stale: true } };
  const filtered = applyEvidencePolicy([m], sources, { excludeStale: true })[0];
  assert.equal(filtered.representatives.livebench, undefined);
  assert.equal(filtered.representatives.aa.score, 50);
  const a = analyze([filtered, { ...filtered, id: "peer", name: "peer" }], {
    costSources: ["aa", "vals"],
    minOpponents: 1,
  });
  assert.equal(a.rows[0].costCoverage, 2);
  assert.equal(a.rows[0].plottable, true);
  assert.equal(a.rows[0].cost, 100);
  assert.equal(a.rows[0].available.includes("livebench"), false);
  assert.ok(
    evidenceFlags(filtered, sources).some((f) => f.label.includes("已排除")),
  );
});

test("model branding words are not invented effort or reasoning labels", () => {
  const result = configurationAssessment(
    model({
      aa: [row("High Performance Model")],
      vals: [row("Thinking Machines Model")],
    }),
  );
  assert.equal(result.status, "unknown");
  assert.ok(result.entries.every((r) => r.effort === null && r.mode === null));
});
