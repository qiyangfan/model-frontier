import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeShareState,
  encodeShareState,
  shareHash,
} from "../src/share.mjs";
test("full share state survives an encode/decode round trip", () => {
  const state = {
    includeEstimated: true,
    excludeHistorical: true,
    excludeStale: true,
    costSource: "vals",
    focus: "openOnly",
    query: "claude",
    paretoQuery: "gemini",
    view: "livebench",
    rankingQuery: "opus",
    creator: "Anthropic",
    openness: "open",
    scoredOnly: true,
    coverageMaskId: "aa+vals",
    nativeEstimated: true,
    nativeHistorical: true,
    budgetSource: "aa",
    budgetLimit: 1.5,
    selection: ["a", "b"],
  };
  const round = decodeShareState(shareHash("rankings", state));
  assert.equal(round.page, "rankings");
  assert.deepEqual(round.state, {
    ...state,
    budgetLimit: 1.5,
  });
});
test("defaults stay out of the link so addresses remain short", () => {
  assert.equal(encodeShareState({}), "");
  assert.equal(
    encodeShareState({
      preset: "capability",
      minSources: 2,
      costSource: "composite",
      budgetSource: "none",
    }),
    "",
  );
  assert.deepEqual(decodeShareState("#overview").state, {});
});
test("invalid values are dropped instead of breaking the page", () => {
  const { state } = decodeShareState(
    "#rankings?p=hack&ms=99&bl=-5&bs=aa&cs=nope&f=sideways&op=weird&w=9-9&sel=a,a,,b,c,d,e,f",
  );
  assert.equal(state.preset, undefined);
  assert.equal(state.minSources, undefined);
  assert.equal(state.budgetSource, "none");
  assert.equal(state.budgetLimit, undefined);
  assert.equal(state.costSource, undefined);
  assert.equal(state.focus, undefined);
  assert.equal(state.openness, undefined);
  assert.equal(state.weights, undefined);
  assert.deepEqual(state.selection, ["a", "b", "c", "d"]);
});
test("only canonical supported source combinations are shareable", () => {
  assert.equal(encodeShareState({ coverageMaskId: "aa+vals" }), "cm=aa%2Bvals");
  assert.equal(encodeShareState({ coverageMaskId: "vals+aa" }), "");
  assert.equal(encodeShareState({ coverageMaskId: "aa+aa" }), "");
  assert.equal(encodeShareState({ coverageMaskId: "aa+unknown" }), "");
  assert.equal(
    decodeShareState("#rankings?cm=aa%2Bvals").state.coverageMaskId,
    "aa+vals",
  );
  assert.equal(
    decodeShareState("#rankings?cm=vals%2Baa").state.coverageMaskId,
    undefined,
  );
  assert.equal(
    decodeShareState("#rankings?cm=aa%2Baa").state.coverageMaskId,
    undefined,
  );
});
test("budget without a usable limit falls back to no budget", () => {
  const parsed = decodeShareState("#rankings?bs=vals");
  assert.deepEqual(parsed.state, { budgetSource: "none" });
  assert.deepEqual(decodeShareState("#rankings?bs=vals&bl=2.5").state, {
    budgetSource: "vals",
    budgetLimit: 2.5,
  });
});
test("long text is truncated and page split tolerates missing query", () => {
  const parsed = decodeShareState("#explore?q=" + "x".repeat(300));
  assert.equal(parsed.state.query.length, 120);
  assert.equal(decodeShareState("#rankings").page, "rankings");
});
test("budget source without a finite positive limit stays out of the link", () => {
  assert.equal(encodeShareState({ budgetSource: "aa", budgetLimit: null }), "");
  assert.equal(encodeShareState({ budgetSource: "aa", budgetLimit: 0 }), "");
  assert.equal(
    encodeShareState({ budgetSource: "aa", budgetLimit: 2 }),
    "bs=aa&bl=2",
  );
});
test("only the first question mark splits the page, and spaces survive a round trip", () => {
  const parsed = decodeShareState("#rankings?q=a?b&cs=vals");
  assert.equal(parsed.page, "rankings");
  assert.equal(parsed.state.query, "a?b");
  assert.equal(parsed.state.costSource, "vals");
  assert.equal(
    decodeShareState(shareHash("explore", { query: "a b?c" })).state.query,
    "a b?c",
  );
});
test("explore display state (creator, onlyFront) round trips and defaults stay out", () => {
  assert.equal(encodeShareState({ creator: "", onlyFront: false }), "");
  const round = decodeShareState(
    shareHash("explore", { creator: "Z AI", onlyFront: true }),
  );
  assert.equal(round.page, "explore");
  assert.equal(round.state.creator, "Z AI");
  assert.equal(round.state.onlyFront, true);
});
test("multi-vendor state: cr pipe joins stay intact, pv chip set round trips", () => {
  // cr 多选以「|」连接原样透传（拆分由消费端负责），单选旧链接不受影响
  const multi = decodeShareState(
    shareHash("explore", { creator: "Z AI|Alibaba" }),
  ).state;
  assert.equal(multi.creator, "Z AI|Alibaba");
  assert.equal(
    encodeShareState({ creator: "Z AI|Alibaba" }),
    "cr=Z+AI%7CAlibaba",
  );
  // 帕累托厂商快选 chips：数组去重入链，空数组不占参数
  assert.equal(encodeShareState({ paretoVendors: [] }), "");
  const pv = decodeShareState(
    shareHash("explore", { paretoVendors: ["Alibaba", "Kimi", "Alibaba"] }),
  ).state;
  assert.deepEqual(pv.paretoVendors, ["Alibaba", "Kimi"]);
  assert.equal(
    encodeShareState({ paretoVendors: ["Alibaba", "Kimi"] }),
    "pv=Alibaba%7CKimi",
  );
  // 手编链接：无 pv 即无快选；空段与重复段清洗
  assert.deepEqual(
    decodeShareState("#explore?pv=Alibaba%7C%7CKimi").state.paretoVendors,
    ["Alibaba", "Kimi"],
  );
  assert.equal(
    decodeShareState("#explore?q=glm").state.paretoVendors,
    undefined,
  );
});

test("retired formula and weight parameters no longer select any scoring path", () => {
  assert.deepEqual(
    decodeShareState("#rankings?score=majority&p=custom&w=80-10-10&ms=3&q=glm")
      .state,
    { query: "glm" },
  );
  assert.equal(
    encodeShareState({
      scoring: "majority2",
      preset: "custom",
      weights: { aa: 80, vals: 10, livebench: 10 },
      minSources: 3,
    }),
    "",
  );
});

test("a fully default share still marks a complete shared state", () => {
  assert.equal(shareHash("rankings"), "#rankings?");
  assert.deepEqual(decodeShareState(shareHash("rankings")).state, {});
});

test("Arena single-board views are shareable while Arena cost and budget are rejected", () => {
  assert.equal(encodeShareState({ view: "arena" }), "v=arena");
  assert.deepEqual(
    decodeShareState(shareHash("rankings", { view: "arena" })).state,
    { view: "arena" },
  );
  // 成本口径与预算来源仍只接受三个任务成本来源；Arena 无成本，不得混入
  assert.deepEqual(decodeShareState("#rankings?cs=arena").state, {});
  assert.deepEqual(decodeShareState("#rankings?bs=arena&bl=2").state, {});
});
