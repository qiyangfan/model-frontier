import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { SOURCE_INFO, FETCHERS, ARENA_FORMAT } from "./adapters.mjs";
import { aggregate } from "./identity.mjs";
import { createHistoryStore } from "./history.mjs";
export const DATA_DIR =
  process.env.FRONTIER_DATA_DIR ??
  fileURLToPath(new URL("../data/", import.meta.url));
const history = createHistoryStore(DATA_DIR);
let state = {
  schemaVersion: 1,
  sources: {},
  settings: { refreshHours: 6 },
  lastRefresh: null,
  lastFullRefresh: null,
};
let running = null;
// 不透明版本而非自增计数：进程重启也会换新，旧页面不会把重启后的数据当成同一版本。
let revision = randomUUID();
const RETRY_BASE_MS = 15 * 60 * 1000;
const activeSources = (sources) =>
  Object.fromEntries(
    Object.entries(sources ?? {}).filter(
      ([id, snapshot]) =>
        Object.hasOwn(SOURCE_INFO, id) &&
        (id !== "arena" || snapshot?.ingestFormat === ARENA_FORMAT),
    ),
  );
export const progress = {
  running: false,
  startedAt: null,
  finishedAt: null,
  sources: {},
};
export async function loadState() {
  try {
    const saved = JSON.parse(
      await readFile(join(DATA_DIR, "snapshot.json"), "utf8"),
    );
    if (saved.schemaVersion === 1) {
      state = {
        ...saved,
        lastFullRefresh: saved.lastFullRefresh ?? saved.lastRefresh ?? null,
        sources: activeSources(saved.sources),
      };
      await persist();
    }
  } catch (e) {
    if (e.code !== "ENOENT") console.error("无法读取缓存：", e.message);
  }
  await history.load(activeSources(state.sources));
  return state;
}
let saving = Promise.resolve();
function persist() {
  const serialized = JSON.stringify(state, null, 2);
  saving = saving
    .catch(() => {})
    .then(async () => {
      await mkdir(DATA_DIR, { recursive: true });
      const path = join(DATA_DIR, "snapshot.json");
      const temporary = path + ".tmp-" + process.pid;
      await writeFile(temporary, serialized);
      await rename(temporary, path);
    });
  return saving;
}
export function view() {
  return {
    schemaVersion: 1,
    revision,
    sources: Object.fromEntries(
      Object.entries(SOURCE_INFO).map(([id, info]) => [
        id,
        {
          ...info,
          ...state.sources[id],
          rows: undefined,
          retryDelayMs: undefined,
          count: state.sources[id]?.rows?.length ?? 0,
        },
      ]),
    ),
    models: aggregate(activeSources(state.sources)),
    settings: state.settings,
    lastRefresh: state.lastRefresh,
    history: history.summary(),
    progress,
  };
}
export const statusView = () => ({ revision, progress });
export async function setRefreshHours(hours) {
  if (![0, 1, 6, 24].includes(hours))
    throw new Error("刷新间隔必须为 0、1、6 或 24 小时");
  state.settings.refreshHours = hours;
  await persist();
  revision = randomUUID();
  return state.settings;
}
function validScores(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) =>
    Number.isFinite(r.score),
  ).length;
}
// 抓取结果先过闸门再落库：格式合法但载荷不完整的响应（例如源站只下发部分数据）不会
// 报错，静默收下会让榜单少掉一大批模型，因此按上次成功缓存的载荷条数比对。
async function refreshSource(id, fetcher) {
  progress.sources[id] = "loading";
  const attemptedAt = new Date().toISOString();
  try {
    const result = await fetcher();
    const valid = validScores(result.rows);
    if (valid < 5)
      throw new Error("源站数据异常：有效模型不足 5 条，拒绝替换缓存");
    const before = state.sources[id]?.rows?.length ?? 0;
    // 完整性按「源站下了多少条」比对，不按「其中有分的多少条」：AA 自 v5.0 起只对
    // 覆盖新基准套件的配置发布 Intelligence Index，载荷本身仍然完整，用有分条数比对
    // 会把这种源站口径收缩误判成抓取不完整。见 docs/adr/0018。
    const rows = result.rows?.length ?? 0;
    if (before >= 200 && rows < before / 2)
      throw new Error(
        `源站数据疑似不完整：模型配置从 ${before} 条降为 ${rows} 条，拒绝替换缓存`,
      );
    state.sources[id] = {
      ...result,
      fetchedAt: new Date().toISOString(),
      attemptedAt,
      error: null,
      stale: false,
    };
    progress.sources[id] = "success";
  } catch (e) {
    const previous = state.sources[id] ?? {};
    // 失败来源单独退避：15 分钟起步，每次失败翻倍，最长不超过正常刷新周期。
    const maxDelay = Math.max(
      RETRY_BASE_MS,
      (state.settings.refreshHours || 6) * 3600000,
    );
    state.sources[id] = {
      ...previous,
      attemptedAt,
      error: e.message,
      stale: true,
      retryDelayMs: Math.min(
        previous.retryDelayMs ? previous.retryDelayMs * 2 : RETRY_BASE_MS,
        maxDelay,
      ),
    };
    progress.sources[id] = "failed";
  }
}
function runRefresh(ids, fetchers, full) {
  if (!Array.isArray(ids) || !ids.length) throw new Error("刷新来源不合法");
  const targets = [...new Set(ids)];
  if (
    targets.length !== ids.length ||
    targets.some((id) => typeof id !== "string" || !Object.hasOwn(fetchers, id))
  )
    throw new Error("刷新来源不合法");
  if (running) return running;
  progress.running = true;
  progress.startedAt = new Date().toISOString();
  progress.sources = Object.fromEntries(targets.map((id) => [id, "loading"]));
  running = (async () => {
    await Promise.allSettled(
      targets.map((id) => refreshSource(id, fetchers[id])),
    );
    const finishedAt = new Date().toISOString();
    state.lastRefresh = finishedAt;
    if (full) state.lastFullRefresh = finishedAt;
    await persist();
    await history.capture(activeSources(state.sources));
    revision = randomUUID();
    return view();
  })().finally(() => {
    progress.running = false;
    progress.finishedAt = new Date().toISOString();
    running = null;
  });
  return running;
}
export function refreshAll(fetchers = FETCHERS) {
  return runRefresh(Object.keys(fetchers), fetchers, true);
}
export function refreshSources(ids, fetchers = FETCHERS) {
  return runRefresh(ids, fetchers, false);
}
export function retryFailed(fetchers = FETCHERS, now = Date.now()) {
  if (!(state.settings.refreshHours > 0)) return null;
  const targets = Object.keys(fetchers).filter((id) => {
    const source = state.sources[id];
    if (!source?.stale) return false;
    const attempted = Date.parse(source.attemptedAt ?? "");
    return (
      !Number.isFinite(attempted) ||
      now - attempted >= (source.retryDelayMs ?? RETRY_BASE_MS)
    );
  });
  return targets.length ? runRefresh(targets, fetchers, false) : null;
}
export function refreshDue(now = Date.now()) {
  const hours = state.settings.refreshHours;
  if (!(hours > 0)) return false;
  const last = Date.parse(state.lastFullRefresh ?? "");
  return !Number.isFinite(last) || now - last > hours * 3600000;
}

export const historyView = (options) => history.view(options);
