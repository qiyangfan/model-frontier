// 可分享、可复现的比较：把评分口径、显示筛选与对比选择编码进页面锚点。
// 编码只覆盖「影响结论口径」的状态；打开同一链接即可复核同一结论，不通过链接传递任何数据本身。
import {
  SCORE_SOURCES as SOURCES,
  COST_SOURCES as TASK_COST_SOURCES,
} from "../shared/sources.mjs";
const COST_SOURCES = [...TASK_COST_SOURCES, "composite"];
const FOCUS_VALUES = ["openFirst", "all", "openOnly", "cnOnly"];
const OPENNESS_VALUES = ["all", "open", "closed", "unknown"];
const VIEWS = ["fusion", ...SOURCES];
const BUDGET_SOURCES = ["none", ...TASK_COST_SOURCES];
const MAX_TEXT = 120;
// 默认值不写入链接，保持分享地址尽量短；带参数的链接是完整口径状态，缺省字段一律取默认值（与 reload 恢复语义一致）。
// 无参数的地址不视为分享链接，由应用沿用本地偏好。
const DEFAULTS = {
  includeEstimated: false,
  excludeHistorical: false,
  excludeStale: false,
  costSource: "composite",
  focus: "openFirst",
  onlyFront: false,
  query: "",
  paretoQuery: "",
  view: "fusion",
  rankingQuery: "",
  creator: "",
  openness: "all",
  scoredOnly: false,
  coverageMaskId: "",
  nativeEstimated: false,
  nativeHistorical: false,
  budgetSource: "none",
  budgetLimit: null,
  selection: [],
};
function validCoverageMask(value) {
  if (typeof value !== "string") return null;
  const selected = value.split("+");
  if (selected.length < 2 || new Set(selected).size !== selected.length)
    return null;
  const canonical = SOURCES.filter((source) => selected.includes(source));
  return canonical.length === selected.length && canonical.join("+") === value
    ? value
    : null;
}
const BOOL_KEYS = {
  includeEstimated: "est",
  excludeHistorical: "eh",
  excludeStale: "es",
  scoredOnly: "sf",
  nativeEstimated: "ne",
  nativeHistorical: "nh",
  onlyFront: "of",
};
const ENUM_KEYS = {
  costSource: ["cs", COST_SOURCES],
  focus: ["f", FOCUS_VALUES],
  view: ["v", VIEWS],
  openness: ["op", OPENNESS_VALUES],
};
const TEXT_KEYS = {
  query: "q",
  paretoQuery: "pq",
  rankingQuery: "rq",
  creator: "cr",
};
const numberIn = (value, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};
const cleanText = (value) => {
  const s = String(value ?? "");
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s;
};
export function encodeShareState(state = {}) {
  const params = new URLSearchParams();
  for (const [key, short] of Object.entries(TEXT_KEYS)) {
    const value = cleanText(state[key]);
    if (value) params.set(short, value);
  }
  for (const [key, [short, values]] of Object.entries(ENUM_KEYS)) {
    const value = state[key] ?? DEFAULTS[key];
    if (value !== DEFAULTS[key] && values.includes(value))
      params.set(short, value);
  }
  for (const [key, short] of Object.entries(BOOL_KEYS)) {
    if (state[key] === true) params.set(short, "1");
  }
  const coverageMaskId = validCoverageMask(state.coverageMaskId);
  if (coverageMaskId) params.set("cm", coverageMaskId);
  // 没有有效上限的预算来源不编码：解码端会把缺 bl 的 bs 折叠为不限制，保持往返一致。
  if (
    state.budgetSource &&
    state.budgetSource !== "none" &&
    Number.isFinite(state.budgetLimit) &&
    state.budgetLimit > 0
  ) {
    const limit = numberIn(state.budgetLimit, 1e-6, 1e6);
    if (limit != null) {
      params.set("bs", state.budgetSource);
      params.set("bl", String(Number(limit.toPrecision(6))));
    }
  }
  const selection = (Array.isArray(state.selection) ? state.selection : [])
    .filter((id) => typeof id === "string" && id)
    .map((id) => (id.length > MAX_TEXT ? id.slice(0, MAX_TEXT) : id))
    .slice(0, 4);
  if (selection.length) params.set("sel", selection.join(","));
  return params.toString();
}
export function decodeShareState(hash = "") {
  // 只在第一个 '?' 处切分页面与参数：query 等文本参数本身可能包含 '?'。
  const trimmed = hash.replace(/^#/, "");
  const split = trimmed.indexOf("?");
  const rawPage = split < 0 ? trimmed : trimmed.slice(0, split);
  const rawQuery = split < 0 ? "" : trimmed.slice(split + 1);
  const state = {};
  if (!rawQuery) return { page: rawPage, state };
  const params = new URLSearchParams(rawQuery);
  const readEnum = (key) => {
    const [short, values] = ENUM_KEYS[key];
    const value = params.get(short);
    return value != null && values.includes(value) ? value : null;
  };
  for (const key of Object.keys(TEXT_KEYS)) {
    const value = params.get(TEXT_KEYS[key]);
    if (value != null) state[key] = cleanText(value);
  }
  for (const key of Object.keys(ENUM_KEYS)) {
    const value = readEnum(key);
    if (value != null) state[key] = value;
  }
  for (const [key, short] of Object.entries(BOOL_KEYS)) {
    if (params.get(short) === "1") state[key] = true;
  }
  const coverageMaskId = validCoverageMask(params.get("cm"));
  if (coverageMaskId) state.coverageMaskId = coverageMaskId;
  const rawBudget = params.get("bs");
  if (rawBudget != null && BUDGET_SOURCES.includes(rawBudget))
    state.budgetSource = rawBudget;
  if (state.budgetSource && state.budgetSource !== "none") {
    const raw = params.get("bl");
    const n = Number(raw);
    const limit =
      raw != null && raw !== "" && Number.isFinite(n) && n >= 1e-6 && n <= 1e6
        ? n
        : null;
    if (limit != null) state.budgetLimit = limit;
    else state.budgetSource = "none";
  }
  const selection = [
    ...new Set(
      String(params.get("sel") ?? "")
        .split(",")
        .filter(Boolean)
        .map((id) => (id.length > MAX_TEXT ? id.slice(0, MAX_TEXT) : id)),
    ),
  ].slice(0, 4);
  if (selection.length) state.selection = selection;
  return { page: rawPage, state };
}
export function shareHash(page, state = {}) {
  const query = encodeShareState(state);
  // 保留空查询标记，默认设置也必须按完整分享恢复，不能沿用接收方偏好。
  return "#" + page + "?" + query;
}
export { DEFAULTS as SHARE_DEFAULTS };
