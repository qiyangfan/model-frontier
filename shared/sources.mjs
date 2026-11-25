// 评分来源与成本来源分开：Arena 只披露人类偏好评分，不提供任务成本。
// ModelDial 计入评分票，但其成本是「跑它自己那套私有编程题库的开耗」，
// 与另三源「干一个任务花多少钱」不是同一种口径，故不进 COST_SOURCES。
export const SCORE_SOURCES = ["aa", "vals", "livebench", "arena", "modeldial"];
export const COST_SOURCES = ["aa", "vals", "livebench"];
// 界面展示名。放这里而不是各模块各写一份，是为了加票时只有一处要改——
// 前端 NAMES 与服务端 SOURCE_INFO 都从它派生，避免出现「名单加了、名字没加」的半截状态。
export const SOURCE_NAMES = {
  aa: "Artificial Analysis",
  vals: "Vals",
  livebench: "LiveBench",
  arena: "Arena",
  modeldial: "ModelDial",
};
