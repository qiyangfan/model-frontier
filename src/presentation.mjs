export const NAMES = {
  aa: "Artificial Analysis",
  vals: "Vals",
  livebench: "LiveBench",
  arena: "Arena",
};
export const COSTS = {
  composite: "综合相对成本（基准 1 倍）",
  aa: "AA 每次任务成本",
  vals: "Vals 每次测试成本",
  livebench: "LiveBench 每次任务成本",
};
export const money = (v) =>
  !Number.isFinite(v)
    ? "未披露"
    : v < 0.01
      ? `$${v.toPrecision(3)}`
      : v < 1
        ? `$${v.toFixed(3)}`
        : `$${v.toFixed(2)}`;
export function relativeCost(v) {
  if (v == null) return "未披露";
  const ratio = v / 100;
  return `${ratio < 0.01 ? Number(ratio.toPrecision(2)) : Number(ratio.toFixed(2))} 倍`;
}
export const costFormat = (v, source) =>
  source === "composite" ? relativeCost(v) : money(v);
export const formatTime = (s) =>
  s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "尚未获取";

// ══════════ 厂商专属色（编辑策划数据，仅区分身份，不承载评测语义） ══════════
// 图上点身、chip 色点、搜索描边、悬浮浮层共用同一映射，保证同一厂商在任何视图恒同色。
// owner 裁定：这组颜色纯为区分而设，不考虑品牌调性与和谐性，区分度越大越好。
// 生成方式：OKLCH 色域内按色相铺候选点（明度按色相自适应取最显彩档），
// 以 CIEDE2000 感知距离做最远点搜索挑 10 色（组内最小感知距离 23.3，
// 旧配色 15.7——Kimi 与 Qwen 两个红系曾近到 11）；并保证对三条前沿线
// （虚线蓝 #3267b8 / 实线青绿 #128574 / 国产线酒红 #9a1c36）的最小感知
// 距离 ≥14，避免点被误读成线。
// 分配按 chip 行相邻取色距最远的一组排列。表外厂商走 FNV-1a 散列从专属兜底
// 色库（FALLBACK_COLORS，十色与固定十色、前沿线全部拉开）取色——新厂商永远
// 不会撞现有厂商的颜色；新厂商之间仍可能撞，哪个变得重要就提拔进固定表。
const VENDOR_COLORS = {
  Anthropic: "#3796f0",
  Google: "#7e5d08",
  Meta: "#da7308",
  OpenAI: "#05707d",
  Xiaomi: "#e36271",
  DeepSeek: "#949b0a",
  "Z AI": "#ab3419",
  Kimi: "#ae73dc",
  StepFun: "#1b780b",
  Alibaba: "#a13171",
};
// 兜底色库：非固定厂商（新黑马）散列取色专用，与固定十色、前沿线全部拉开——
// 新厂商永远不会撞现有厂商的颜色。新厂商之间仍可能撞（散列同槽），
// 但两个新厂商同时够着有效 PK 分的概率低；哪个新厂商变得重要了，
// 就提拔进固定表（占用其兜底色并重算兜底库），守卫测试会强制核验距离。
const FALLBACK_COLORS = [
  "#3ec478",
  "#05bdd0",
  "#7347af",
  "#d49e00",
  "#ed7abd",
  "#fb7e5d",
  "#979cfe",
  "#0eb09e",
  "#569b2b",
  "#616a0b",
];
const FALLBACK_PALETTE = FALLBACK_COLORS;
export { FALLBACK_COLORS };
export function colorFor(creator) {
  const s = String(creator ?? "");
  if (VENDOR_COLORS[s]) return VENDOR_COLORS[s];
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
}

// ══════════ 快速筛选：国产厂商映射（编辑策划数据，非源站字段） ══════════
// 源站不提供厂商地区属性；此表按可确证的归属手工维护，键为小写 creator（源站
// 大小写漂移：MiniMax/minimax、Tencent/tencent 等）。只收确证的国产厂商——归属
// 存疑的（如 Trillion Labs、Nex AGI）不入表，标错属性是事实错误。新厂商入榜
// 而表未收录时表现为「不在国产筛选中」，属可见的保守偏差而非错误归类。
const DOMESTIC_CREATOR_KEYS = new Set([
  "alibaba",
  "deepseek",
  "z ai",
  "inclusionai",
  "kimi",
  "xiaomi",
  "stepfun",
  "minimax",
  "tencent",
  "baidu",
  "meituan",
  "openbmb",
  "bytedance seed",
  "bytedance",
  "china mobile",
  "nanbeige",
  "kwaikat",
  "longcat",
]);
export const isDomesticCreator = (creator) =>
  typeof creator === "string" &&
  DOMESTIC_CREATOR_KEYS.has(creator.toLowerCase());

// 性价比榜快速筛选谓词：仅开源按源站 openWeights 严格 true（null=未确认，
// 不得算开源）；仅国产走映射表；all 恒真。纯展示层过滤，不改任何分数名次。
export function valueFilterPredicate(mode) {
  if (mode === "open") return (r) => r.openWeights === true;
  if (mode === "cn") return (r) => isDomesticCreator(r.creator);
  return () => true;
}
