// 前沿图导航交互的纯函数：滚轮分流、缩放窗口判定与按钮缩放范围。

// 滚轮分流判定。⌘（metaKey）与 Ctrl 同等视为缩放意图；macOS 触控板捏合以合成
// Ctrl 滚轮事件到达，无需单独识别。echarts 6.1 自带的 `'ctrl'` 绑定只映射原生
// ctrlKey 不认 ⌘，因此分流只能在 Chart.jsx 的边界监听里自己做：
// 返回 "zoom" → preventDefault 接管浏览器页面缩放并放行给 ECharts；
// 返回 "scroll" → stopPropagation 保页面原生滚动。
export const wheelZoomGate = (e) =>
  e.ctrlKey || e.metaKey ? "zoom" : "scroll";

// 任一缩放窗口偏离全范围即视为已缩放（重置按钮可用性）；缺失范围的条目按全范围处理。
export const isZoomed = (entries) =>
  (entries ?? []).some((z) => z?.start > 0 || z?.end < 100);

// 以当前窗口中点为中心按 factor 缩放；窗口最小 2、上限 100，出界部分夹取到 [0,100]。
export const scaledRange = (start, end, factor) => {
  const middle = (start + end) / 2;
  const range = Math.min(100, Math.max(2, (end - start) * factor));
  return [Math.max(0, middle - range / 2), Math.min(100, middle + range / 2)];
};
