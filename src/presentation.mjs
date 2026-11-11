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
