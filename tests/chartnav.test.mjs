import test from "node:test";
import assert from "node:assert/strict";
import { isZoomed, scaledRange, wheelZoomGate } from "../src/chartNav.mjs";

test("wheelZoomGate：普通滚轮归页面滚动，⌘/Ctrl/合成捏合归图表缩放", () => {
  assert.equal(wheelZoomGate({ ctrlKey: false, metaKey: false }), "scroll");
  assert.equal(wheelZoomGate({ ctrlKey: true, metaKey: false }), "zoom");
  assert.equal(wheelZoomGate({ ctrlKey: false, metaKey: true }), "zoom");
  assert.equal(wheelZoomGate({ ctrlKey: true, metaKey: true }), "zoom");
  // macOS 触控板捏合的合成滚轮事件带 ctrlKey，与真实 Ctrl 同路
  assert.equal(
    wheelZoomGate({ ctrlKey: true, metaKey: false, altKey: true }),
    "zoom",
  );
});

test("isZoomed：任一轴偏离全范围即为已缩放", () => {
  assert.equal(isZoomed(undefined), false);
  assert.equal(isZoomed([]), false);
  assert.equal(
    isZoomed([
      { start: 0, end: 100 },
      { start: 0, end: 100 },
    ]),
    false,
  );
  assert.equal(
    isZoomed([
      { start: 0, end: 100 },
      { start: 0, end: 90 },
    ]),
    true,
  );
  assert.equal(
    isZoomed([
      { start: 5, end: 100 },
      { start: 0, end: 100 },
    ]),
    true,
  );
  // 缺失范围的条目（未初始化）按全范围处理
  assert.equal(isZoomed([{}, { start: 0, end: 100 }]), false);
});

// 窗口计算带浮点乘法，逐位相等不可靠，用容差断言
const assertClose = (actual, [lo, hi], eps = 1e-9) => {
  assert.ok(
    Math.abs(actual[0] - lo) < eps && Math.abs(actual[1] - hi) < eps,
    `expected [${actual[0]}, ${actual[1]}] ≈ [${lo}, ${hi}]`,
  );
};

test("scaledRange：以中点为中心缩放并夹取边界", () => {
  assertClose(scaledRange(0, 100, 0.7), [15, 85]);
  assertClose(scaledRange(15, 85, 1.4), [1, 99]);
  assertClose(scaledRange(40, 60, 1.4), [36, 64]);
  // 缩小越过下界时起点夹到 0
  assertClose(scaledRange(0, 3, 1.4), [0, 3.6]);
  // 已到最小窗口时不再收缩
  assertClose(scaledRange(50, 52, 0.7), [50, 52]);
  // 放大越过上界时终点夹到 100
  assertClose(scaledRange(97, 100, 1.4), [96.4, 100]);
});
