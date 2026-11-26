// 评分来源与成本来源分开：Arena 只披露人类偏好评分，不提供任务成本。
// ModelDial 既计评分票，其整轮后端评测的美元估算费用也进入几何平均（ADR-0029）。
// 计算时各源成本先除以自身中位数，再比较相对倍数。
// 其相对成本与在籍三源的一致性（ρ 0.80–0.92）优于在籍成员彼此（0.71–0.88）。
// SuperCLUE 是第六票，只取通用中文测评的「模型名称/总分」两列（分轴列每月漂移，不读）。
export const SCORE_SOURCES = [
  "aa",
  "vals",
  "livebench",
  "arena",
  "modeldial",
  "superclue",
];
export const COST_SOURCES = ["aa", "vals", "livebench", "modeldial"];
// 单站成本视图与预算筛选只使用每次任务的美元成本。ModelDial 披露的是整轮费用（ADR-0029）。
export const SINGLE_COST_SOURCES = ["aa", "vals", "livebench"];
// 各成本来源的原始计价币种，供成本明细和基准中位数展示。
export const COST_CURRENCY = {
  aa: "USD",
  vals: "USD",
  livebench: "USD",
  modeldial: "USD",
};
// 界面展示名。放这里而不是各模块各写一份，是为了加票时只有一处要改——
// 前端 NAMES 与服务端 SOURCE_INFO 都从它派生，避免出现「名单加了、名字没加」的半截状态。
export const SOURCE_NAMES = {
  aa: "Artificial Analysis",
  vals: "Vals",
  livebench: "LiveBench",
  arena: "Arena",
  modeldial: "ModelDial",
  superclue: "SuperCLUE",
};
