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
// 固定 10 家（VENDOR_CHIPS 全集）手工挑色：互不撞色，且避开全球前沿虚线蓝 #3267b8 /
// 开放前沿实线青绿 #128574——散点落在前沿线附近，点身撞上线的颜色会被误读成线；
// 深浅均按白底可辨取值。表外厂商走 FNV-1a 散列兜底取色，仅保证稳定不保证不撞
// （表外厂商只出现在「全部厂商」下拉与文本标签旁，文字始终在场，撞色无害）。
const VENDOR_COLORS = {
  Anthropic: "#b0653a",
  Google: "#0f6f9e",
  Meta: "#7a4fb0",
  OpenAI: "#2f7d3b",
  Xiaomi: "#c2447c",
  DeepSeek: "#4a5480",
  "Z AI": "#9a6210",
  Kimi: "#a83a3a",
  StepFun: "#526e0f",
  Alibaba: "#b5482a",
};
const FALLBACK_PALETTE = Object.values(VENDOR_COLORS);
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
