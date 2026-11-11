import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isDomesticCreator,
  valueFilterPredicate,
} from "../src/presentation.mjs";

test("isDomesticCreator：小写归一匹配 creator 大小写漂移；非字符串与归属存疑厂商归 false", () => {
  assert.equal(isDomesticCreator("DeepSeek"), true);
  assert.equal(isDomesticCreator("MiniMax"), true);
  assert.equal(isDomesticCreator("minimax"), true);
  assert.equal(isDomesticCreator("ByteDance Seed"), true);
  assert.equal(isDomesticCreator("Z AI"), true);
  assert.equal(isDomesticCreator("OpenAI"), false);
  assert.equal(isDomesticCreator("Meta"), false);
  // 归属存疑厂商不入表（保守偏差优于错误归类，见 presentation.mjs 注释）
  assert.equal(isDomesticCreator("Trillion Labs"), false);
  assert.equal(isDomesticCreator("Nex AGI"), false);
  assert.equal(isDomesticCreator(null), false);
  assert.equal(isDomesticCreator(undefined), false);
});

test("valueFilterPredicate：open 严格 true（null=未确认不算开源）、cn 走映射表、all/未设恒真", () => {
  const pool = [
    { creator: "DeepSeek", openWeights: true },
    { creator: "OpenAI", openWeights: false },
    { creator: "StepFun", openWeights: null },
    { creator: "Kimi", openWeights: true },
    { creator: "Anthropic", openWeights: true },
  ];
  // open 只收源站标记严格 true；StepFun 国产但 openWeights=null → 不在开源筛
  assert.deepEqual(
    pool.filter(valueFilterPredicate("open")).map((r) => r.creator),
    ["DeepSeek", "Kimi", "Anthropic"],
  );
  // cn 按 creator 映射，与 openWeights 无关
  assert.deepEqual(
    pool.filter(valueFilterPredicate("cn")).map((r) => r.creator),
    ["DeepSeek", "StepFun", "Kimi"],
  );
  // all 与未设值恒真（默认视图不过滤）
  assert.equal(pool.filter(valueFilterPredicate("all")).length, pool.length);
  assert.equal(
    pool.filter(valueFilterPredicate(undefined)).length,
    pool.length,
  );
});
