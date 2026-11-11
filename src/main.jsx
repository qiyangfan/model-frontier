import { COST_SOURCES } from "../shared/sources.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  Button,
  Checkbox,
  ConfigProvider,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Select,
  Segmented,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from "antd";
import {
  ExportOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  AppstoreOutlined,
  UnlockOutlined,
  LockOutlined,
  QuestionCircleOutlined,
  DotChartOutlined,
  RiseOutlined,
  LineChartOutlined,
  DatabaseOutlined,
  TrophyOutlined,
  SwapOutlined,
  DashboardOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import Chart from "./Chart.jsx";
import {
  NAMES,
  COSTS,
  costFormat,
  money,
  formatTime,
  isDomesticCreator,
} from "./presentation.mjs";
import { analyze, csvExport, sourceAudit, pareto } from "./analysis.mjs";
import { Overview, Rankings, Comparison, CreatorChips } from "./Portal.jsx";
import {
  applyBudget,
  compareNullableScores,
  sanitizeSelection,
  vendorChipCounts,
} from "./portal.mjs";
import { applyEvidencePolicy, sourceHealth } from "./evidence.mjs";
import {
  ArenaEvidence,
  ConfigurationDetails,
  EvidenceBadges,
  SourceQuality,
  QualityNote,
} from "./Evidence.jsx";
import HistoryDrawer from "./HistoryDrawer.jsx";
import { decodeShareState, shareHash } from "./share.mjs";
import "./style.css";
const PAGES = ["overview", "rankings", "compare", "explore", "sources"];
const STATUS_IDLE_MS = 30000;
const STATUS_ACTIVE_MS = 2000;
const pageFromHash = () =>
  PAGES.includes(location.hash.slice(1).split("?")[0])
    ? location.hash.slice(1).split("?")[0]
    : "overview";
const stored = (key = "frontier:preferences") => {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
};
const matchesSearch = (row, query) => {
  const needle = query.trim().toLowerCase();
  return !needle || `${row.name} ${row.creator}`.toLowerCase().includes(needle);
};
const compareComposite = compareNullableScores((r) => r.composite);
const compareAuxiliary = compareNullableScores((r) => r.auxiliary);
function VendorSearchChips({ chips, query, onSearch }) {
  const activeQuery = query.trim().toLowerCase();
  return (
    <div
      className="pareto-vendor-search flex flex-wrap items-center gap-[7px]"
      role="group"
      aria-label="帕累托厂商快速搜索"
    >
      <span className="text-[10px] font-[650] tracking-[0.06em] text-[#7b958d]">
        厂商快速搜索
      </span>
      {chips.map((chip) => {
        const active = activeQuery === chip.value.toLowerCase();
        const empty = chip.count === 0;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={active}
            disabled={empty && !active}
            title={
              `搜索 ${chip.value} 并在帕累托图中标记命中模型` +
              (chip.note ? ` · ${chip.note}` : "") +
              (active ? "；再次点击清除搜索" : "")
            }
            className={
              "creator-chip inline-flex items-center gap-[5px] rounded-full border px-[10px] py-[2px] text-[11px] leading-[1.7] transition-colors " +
              (active
                ? "border-[#128574] bg-[#eaf5f1] font-medium text-[#0c6e5e]"
                : "border-[#dce7e3] bg-white text-[#5f7c74] hover:border-[#a8cdc0] hover:text-[#2c6f60]") +
              (empty && !active
                ? " cursor-not-allowed opacity-40"
                : " cursor-pointer")
            }
            onClick={() => onSearch(active ? "" : chip.value)}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
function download(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand("copy");
    } finally {
      area.remove();
    }
  }
}
function App() {
  // 惰性初始化：本地偏好与分享链接参数只在首次渲染解析一次。
  const [bootstrap] = useState(() => {
    const previous = stored();
    return {
      initial: previous ?? {},
      shared: decodeShareState(location.hash).state,
    };
  });
  const { initial, shared } = bootstrap;
  // 带参数的链接定义完整评分口径：缺省字段一律取默认值，与 reload 恢复语义一致，保证同一链接在任何机器上复现同一结论。
  // 判定与下方 hashchange 恢复处理器严格同源（URL 是否含 '?'），仅含无效参数的链接两条路径行为一致；
  // 无参数的地址不视为分享链接，沿用本地偏好；对比选择是本机数据，始终按「链接显式带 sel 才覆盖」处理。
  const hasShare = location.hash.includes("?");
  const prefs = hasShare ? {} : initial;
  const [data, setData] = useState(null),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(null),
    [costSource, setCostSource] = useState(
      shared.costSource ??
        (prefs.costSchemaVersion === 2
          ? (prefs.costSource ?? "composite")
          : "composite"),
    ),
    [focus, setFocus] = useState(shared.focus ?? prefs.focus ?? "openFirst"),
    [query, setQuery] = useState(shared.query ?? ""),
    [paretoQuery, setParetoQuery] = useState(shared.paretoQuery ?? ""),
    [creator, setCreator] = useState(shared.creator || undefined),
    [estimated, setEstimated] = useState(
      shared.includeEstimated ?? prefs.includeEstimated === true,
    ),
    [excludeHistorical, setExcludeHistorical] = useState(
      shared.excludeHistorical ?? prefs.excludeHistorical === true,
    ),
    [excludeStale, setExcludeStale] = useState(
      shared.excludeStale ?? prefs.excludeStale === true,
    ),
    [budgetSource, setBudgetSource] = useState(
      shared.budgetSource ?? prefs.budgetSource ?? "none",
    ),
    [budgetLimit, setBudgetLimit] = useState(
      shared.budgetLimit ?? prefs.budgetLimit ?? null,
    ),
    [ranking, setRanking] = useState(() => ({
      view: shared.view ?? "fusion",
      query: shared.rankingQuery ?? "",
      creator: shared.creator || undefined,
      openness: shared.openness ?? "all",
      scoredOnly: shared.scoredOnly === true,
      coverageMaskId: shared.coverageMaskId ?? "",
      nativeEstimates: false,
      nativeHistorical: false,
      showSuites: false,
    })),
    [historyOpen, setHistoryOpen] = useState(false),
    [historyModel, setHistoryModel] = useState(null),
    [onlyFront, setOnlyFront] = useState(shared.onlyFront === true),
    [selected, setSelected] = useState(null),
    [methodOpen, setMethodOpen] = useState(false),
    [tab, setTab] = useState(pageFromHash),
    [copied, setCopied] = useState(false),
    [selection, setSelection] = useState(() => {
      const ids = shared.selection ?? stored("frontier:comparison");
      return Array.isArray(ids)
        ? ids.filter((id) => typeof id === "string").slice(0, 4)
        : [];
    });
  const skipHashApply = useRef("");
  const loadSeq = useRef(0);
  const loadedRevision = useRef(null);
  const wakePolling = useRef(() => {});
  const navigate = (key) => {
    const target = "#" + key;
    skipHashApply.current = target;
    setTab(key);
    if (location.hash !== target) location.hash = target;
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const chartRef = useRef(null);
  // 同文档打开分享链接（仅 hash 变化、页面不重载）时按链接恢复口径；无参数的页面导航不重置。
  // 口径字段与 reload 一致取「链接定义的完整状态」：缺省参数即默认值，而非本地偏好——保证同一链接在任何机器上复现同一结论；
  // 不入链的本地开关（维度列、单榜估算/历史勾选等）与对比选择保留现值。
  useEffect(() => {
    const handler = () => {
      setTab(pageFromHash());
      if (skipHashApply.current === location.hash) {
        skipHashApply.current = "";
        return;
      }
      if (!location.hash.includes("?")) return;
      const { state } = decodeShareState(location.hash);
      setEstimated(state.includeEstimated === true);
      setExcludeHistorical(state.excludeHistorical === true);
      setExcludeStale(state.excludeStale === true);
      setCostSource(state.costSource ?? "composite");
      setFocus(state.focus ?? "openFirst");
      setQuery(state.query ?? "");
      setParetoQuery(state.paretoQuery ?? "");
      setCreator(state.creator || undefined);
      setOnlyFront(state.onlyFront === true);
      setBudgetSource(state.budgetSource ?? "none");
      setBudgetLimit(state.budgetLimit ?? null);
      // 对比选择与 reload 语义一致：链接显式带 sel 才覆盖，否则保留本机已存选择。
      if (state.selection) setSelection(state.selection);
      // 排行榜筛选是入链口径：缺省即恢复默认视图，与 reload 一致；不入链的单榜开关保留现值。
      setRanking((previous) => ({
        view: state.view ?? "fusion",
        query: state.rankingQuery ?? "",
        creator: state.creator || undefined,
        openness: state.openness ?? "all",
        scoredOnly: state.scoredOnly === true,
        coverageMaskId: state.coverageMaskId ?? "",
        nativeEstimates: previous.nativeEstimates,
        nativeHistorical: previous.nativeHistorical,
        showSuites: previous.showSuites,
      }));
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  useEffect(() => {
    localStorage.setItem("frontier:comparison", JSON.stringify(selection));
  }, [selection]);
  useEffect(() => {
    if (data?.models)
      // 外部模型集合到达后收敛选中项；未变化时返回原引用避免多余渲染
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据到达后的派生修正，非渲染期写入
      setSelection((previous) => {
        const next = sanitizeSelection(previous, data.models);
        return next.length === previous.length &&
          next.every((id, i) => id === previous[i])
          ? previous
          : next;
      });
  }, [data?.models]);
  const updateSelection = (ids) =>
    setSelection(sanitizeSelection(ids, data?.models ?? []));
  const openHistory = (model) => {
    setHistoryModel(model ?? null);
    setHistoryOpen(true);
  };
  const quickCompare = (ids) => {
    updateSelection(ids);
    navigate("compare");
  };
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const r = await fetch("/api/data");
      if (!r.ok) throw new Error("无法连接本地服务");
      const d = await r.json();
      // 只让最后发起的请求写入状态，避免在途旧响应覆盖新 revision 的数据。
      if (seq !== loadSeq.current) return d;
      setData((previous) =>
        previous?.lastRefresh === d.lastRefresh
          ? { ...d, models: previous.models }
          : d,
      );
      loadedRevision.current = d.revision;
      setError(null);
      return d;
    } catch (e) {
      if (seq === loadSeq.current) throw e;
      return null;
    }
  }, []);
  const loadStatus = useCallback(async () => {
    const r = await fetch("/api/status");
    if (!r.ok) throw new Error("无法连接本地服务");
    const status = await r.json();
    setBusy(status.progress.running);
    setProgress(status.progress);
    if (loadedRevision.current !== status.revision) await load();
    return status;
  }, [load]);
  useEffect(() => {
    // 状态轮询只传几十字节；整包数据仅在 revision 变化（抓取、设置变更）时拉取。
    let stopped = false;
    let timer;
    let inFlight = false;
    let wakeQueued = false;
    let statusFailed = false;
    const tick = async () => {
      if (stopped) return;
      // 唤醒可能发生在状态请求在途时；排队等本轮结束，避免旧响应覆盖新状态并拖慢轮询。
      if (inFlight) {
        wakeQueued = true;
        return;
      }
      inFlight = true;
      let running = false;
      try {
        const status = await loadStatus();
        if (statusFailed) setError(null);
        statusFailed = false;
        running = status.progress.running;
      } catch (e) {
        statusFailed = true;
        if (!stopped) setError(e.message);
      } finally {
        inFlight = false;
      }
      if (stopped) return;
      if (wakeQueued) {
        wakeQueued = false;
        clearTimeout(timer);
        tick();
        return;
      }
      timer = setTimeout(tick, running ? STATUS_ACTIVE_MS : STATUS_IDLE_MS);
    };
    wakePolling.current = () => {
      if (stopped) return;
      clearTimeout(timer);
      tick();
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      wakePolling.current = () => {};
    };
  }, [loadStatus]);
  useEffect(() => {
    localStorage.setItem(
      "frontier:preferences",
      JSON.stringify({
        costSource,
        focus,
        costSchemaVersion: 2,
        sourcePolicyVersion: 2,
        includeEstimated: estimated,
        excludeHistorical,
        excludeStale,
        budgetSource,
        budgetLimit,
      }),
    );
  }, [
    costSource,
    focus,
    estimated,
    excludeHistorical,
    excludeStale,
    budgetSource,
    budgetLimit,
  ]);
  const qualityStamp = Object.keys(NAMES)
    .map((s) => (sourceHealth(data?.sources?.[s]).excluded ? "1" : "0"))
    .join("");
  const evaluationModels = useMemo(
    () =>
      applyEvidencePolicy(data?.models ?? [], data?.sources ?? {}, {
        excludeHistorical,
        excludeStale,
      }),
    // qualityStamp 是各源 excluded 状态的指纹，与函数体唯一读取的字段精确对应
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 以质量戳代替 sources 对象身份
    [data?.models, excludeHistorical, excludeStale, qualityStamp],
  );
  const activeCostSources = useMemo(
    () =>
      COST_SOURCES.filter(
        (s) => !excludeStale || !sourceHealth(data?.sources?.[s]).excluded,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 同上，qualityStamp 已覆盖 excluded 变化
    [excludeStale, qualityStamp],
  );
  const analysis = useMemo(
    () =>
      analyze(evaluationModels, {
        costSource,
        includeEstimated: estimated,
        costSources: activeCostSources,
      }),
    [evaluationModels, costSource, estimated, activeCostSources],
  );
  // 国产子集前沿：约束型 lens——被国外模型支配、但在「只考虑国产」约束下仍不被国产
  // 模型支配的模型（如 MiMo V2.6 系）。展示层派生（与 openFrontier 的 analyze 字段不同层：
  // 不进 API/CSV，仅探索页图表消费）；口径与 r.frontier 一致——用 plottable 全集、不随
  // 预算筛选重算（预算滑杆改变的是显示窗口，不是前沿身份，与 spec「切换不重算前沿身份」同理）。
  const cnFrontierIds = useMemo(
    () =>
      new Set(
        pareto(
          analysis.rows.filter(
            (r) => r.plottable && isDomesticCreator(r.creator),
          ),
        ).map((r) => r.id),
      ),
    [analysis.rows],
  );
  const chartRows = useMemo(
    () =>
      applyBudget(analysis.rows, { budgetSource, budgetLimit })
        .filter(
          (r) =>
            (focus !== "openOnly" || r.openWeights === true) &&
            (focus !== "cnOnly" || isDomesticCreator(r.creator)),
        )
        .map((r) => ({ ...r, cnFrontier: cnFrontierIds.has(r.id) }))
        .sort(
          (a, b) =>
            (focus === "openFirst"
              ? Number(b.openWeights === true) - Number(a.openWeights === true)
              : 0) ||
            (b.composite ?? -Infinity) - (a.composite ?? -Infinity) ||
            (b.auxiliary ?? -1) - (a.auxiliary ?? -1) ||
            b.coverage - a.coverage,
        ),
    [analysis, focus, budgetSource, budgetLimit, cnFrontierIds],
  );
  // 表格过滤独立于帕累托图搜索；厂商、文本和前沿条件都只收窄表格行。
  const rows = useMemo(
    () =>
      chartRows.filter(
        (r) =>
          matchesSearch(r, query) &&
          (!creator || r.creator === creator) &&
          (!onlyFront || r.frontier || r.openFrontier || r.cnFrontier),
      ),
    [chartRows, query, creator, onlyFront],
  );
  const searchActive = paretoQuery.trim().length > 0;
  const searchMatches = useMemo(
    () =>
      searchActive
        ? chartRows.filter((r) => matchesSearch(r, paretoQuery))
        : [],
    [chartRows, paretoQuery, searchActive],
  );
  const highlightIds = useMemo(
    () => (searchActive ? new Set(searchMatches.map((r) => r.id)) : null),
    [searchMatches, searchActive],
  );
  const plottedMatches = useMemo(
    () => searchMatches.filter((r) => r.plottable).length,
    [searchMatches],
  );
  // chip 计数与探索页厂商下拉同口径：analysis.rows 全量，不被 focus / 搜索提前裁剪。
  const exploreChips = useMemo(
    () => vendorChipCounts(analysis.rows),
    [analysis.rows],
  );
  // 导出附带数据时间与评分口径，保证日后可复核同一结论。
  const scopeLabel = useMemo(() => {
    const parts = [
      `四榜多数对决 Bradley-Terry（主榜至少 ${analysis.requiredOpponents} 个有效对手，位次均值仅同分排序）`,
      `至少 ${analysis.required} 榜`,
      estimated ? "允许 AA 估算" : "排除 AA 估算",
    ];
    if (excludeHistorical) parts.push("排除历史配置");
    if (excludeStale) parts.push("排除过期 / 失败缓存");
    parts.push(`成本口径：${COSTS[costSource]}`);
    if (budgetSource !== "none" && Number.isFinite(budgetLimit))
      parts.push(`预算筛选：${NAMES[budgetSource]} ≤ $${budgetLimit} / 任务`);
    return parts.join(" · ");
  }, [
    analysis.required,
    analysis.requiredOpponents,
    estimated,
    excludeHistorical,
    excludeStale,
    costSource,
    budgetSource,
    budgetLimit,
  ]);
  const exportMeta = useMemo(
    () => ({
      lastRefresh: data?.lastRefresh,
      scope: scopeLabel,
      minOpponents: analysis.requiredOpponents,
    }),
    [data?.lastRefresh, scopeLabel, analysis.requiredOpponents],
  );
  // 稳定引用，避免 Rankings 内依赖该对象的 useMemo 每次渲染失效。
  const budget = useMemo(
    () => ({ budgetSource, budgetLimit }),
    [budgetSource, budgetLimit],
  );
  // 分享链接同步当前质量排除、成本口径、预算、筛选与对比选择。
  // 搜索输入做 250ms 去抖，避免 replaceState 限流导致地址落后。
  const shareTarget = () =>
    shareHash(tab, {
      includeEstimated: estimated,
      excludeHistorical,
      excludeStale,
      costSource,
      focus,
      query,
      paretoQuery,
      // 探索页表格筛选：厂商与「仅看前沿」的激活态必须入链，才能复现同一列表。
      creator: creator ?? "",
      onlyFront,
      budgetSource,
      budgetLimit,
      selection,
      ...(tab === "rankings"
        ? {
            view: ranking.view,
            rankingQuery: ranking.query,
            creator: ranking.creator ?? "",
            openness: ranking.openness,
            scoredOnly: ranking.scoredOnly,
            coverageMaskId:
              ranking.coverageMaskId || analysis.coverageCohorts[0]?.id || "",
          }
        : {}),
    });
  useEffect(() => {
    const id = setTimeout(() => {
      const hash = shareTarget();
      if (location.hash !== hash) history.replaceState(null, "", hash);
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shareTarget 每次渲染重建，上方已逐一枚举其全部输入
  }, [
    tab,
    estimated,
    excludeHistorical,
    excludeStale,
    costSource,
    focus,
    query,
    paretoQuery,
    creator,
    onlyFront,
    budgetSource,
    budgetLimit,
    selection,
    ranking,
    analysis,
  ]);
  // 复制时按当前状态即时构造，不依赖去抖后的地址栏，避免复制到上一刻的口径。
  const copyLink = async () => {
    const url = location.href.split("#")[0] + shareTarget();
    if (await copyText(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else setError("复制失败：请直接复制浏览器地址栏的链接");
  };
  const current = analysis.rows.find((r) => r.id === selected);
  // 成本来源只改变成本与前沿，不改变 BT 强度；缓存详情页的四个成本场景，
  // 避免无关重渲染重复拟合。
  const costScenarios = useMemo(() => {
    if (!current) return {};
    return Object.fromEntries(
      ["composite", "aa", "vals", "livebench"].map((source) => [
        source,
        source === costSource
          ? current
          : analyze(evaluationModels, {
              costSource: source,
              includeEstimated: estimated,
              costSources: activeCostSources,
            }).rows.find((r) => r.id === current.id),
      ]),
    );
  }, [current, costSource, evaluationModels, estimated, activeCostSources]);
  const stale = Object.values(data?.sources ?? {}).filter((s) => s.stale);
  const refresh = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/refresh", { method: "POST" });
      if (!r.ok) throw new Error("刷新请求失败");
    } catch (e) {
      setError(e.message);
      setBusy(false);
    } finally {
      wakePolling.current();
    }
  };
  const retrySource = async (id) => {
    setBusy(true);
    try {
      const r = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: [id] }),
      });
      if (!r.ok) throw new Error("重试请求失败");
    } catch (e) {
      setError(e.message);
      setBusy(false);
    } finally {
      wakePolling.current();
    }
  };
  const changeInterval = async (refreshHours) => {
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshHours }),
      });
      if (!r.ok) throw new Error("保存刷新设置失败");
      await load();
    } catch (e) {
      setError(e.message);
    }
  };
  const columns = [
    {
      title: "模型",
      dataIndex: "name",
      fixed: "left",
      width: 235,
      render: (v, r) => (
        <button className="model-link" onClick={() => setSelected(r.id)}>
          <span
            className={
              "grid place-items-center w-[29px] h-[29px] shrink-0 rounded-[8px] border text-[14px] max-760:w-[26px] max-760:h-[26px] max-760:rounded-[7px] max-760:text-[12px] " +
              (r.openWeights === true
                ? "bg-[#edf6f1] text-[#4a9a80] border-[#e0eee5]"
                : "bg-[#f0f3f6] text-[#9aabb6] border-[#e7edf1]")
            }
          >
            {r.openWeights === true ? (
              <UnlockOutlined aria-hidden="true" />
            ) : r.openWeights === false ? (
              <LockOutlined aria-hidden="true" />
            ) : (
              <QuestionCircleOutlined aria-hidden="true" />
            )}
          </span>
          <span>
            {v}
            <small className="block text-[10px] font-normal text-[#98a5ae] mt-[2px] max-760:text-[9px]">
              {r.creator}
            </small>
          </span>
        </button>
      ),
    },
    {
      title: "开放状态",
      width: 135,
      render: (_, r) =>
        r.openConflict ? (
          <Tag color="orange">来源有分歧</Tag>
        ) : r.openWeights === true ? (
          <Tag color="green">开放权重</Tag>
        ) : r.openWeights === false ? (
          <Tag color="blue">闭源</Tag>
        ) : (
          <Tag>未确认</Tag>
        ),
    },
    {
      title: (
        <Tooltip title="Bradley-Terry 强度，Elo 尺度：中位模型 1000，400 分差约等于 10∶1 预测胜率；不是实测胜率或能力百分比。">
          <span className="cursor-help underline decoration-dotted">
            PK 主积分
          </span>
        </Tooltip>
      ),
      dataIndex: "composite",
      width: 110,
      sorter: (a, b, sortOrder) =>
        compareComposite(a, b, sortOrder) || compareAuxiliary(a, b, sortOrder),
      render: (v, r) =>
        v == null ? (
          <Tooltip title={r.reason}>
            <span className="muted text-[#6b818f] leading-[1.85]">未评分</span>
          </Tooltip>
        ) : (
          <Tooltip
            title={`Bradley-Terry 强度（Elo 尺度，中位 1000）。${r.record.wins} 胜 / ${r.record.draws} 平 / ${r.record.losses} 负，${r.record.opponents} 个对手；不是实测胜率或能力百分比`}
          >
            <strong className="number text-[12px] tabular-nums whitespace-nowrap">
              {v.toFixed(1)}
              {!r.complete && (
                <InfoCircleOutlined
                  aria-hidden="true"
                  className="partial-indicator"
                />
              )}
            </strong>
          </Tooltip>
        ),
    },
    {
      title: costSource === "composite" ? "相对成本" : "任务成本",
      dataIndex: "cost",
      width: 120,
      sorter: (a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity),
      render: (v, r) => (
        <span className="number text-[12px] tabular-nums whitespace-nowrap">
          {costFormat(v, costSource)}
          {costSource === "composite" && v != null && (
            <Tooltip
              title={
                <div className="min-w-[190px] text-[11px]">
                  {["aa", "vals", "livebench"].map((source) => (
                    <div
                      key={source}
                      className="flex justify-between gap-[25px] py-[5px]"
                    >
                      <span>{NAMES[source]}</span>
                      <b className="font-medium">
                        {money(r.representatives[source]?.costTask)}
                      </b>
                    </div>
                  ))}
                  <small className="block text-[#adbbb7] text-[9px] mt-[7px]">
                    不同任务，分别计价
                  </small>
                </div>
              }
            >
              <small className="block text-[9px] text-[#98aaa3] font-normal mt-[4px] cursor-help">
                {r.costCoverage}/3 价格来源{" "}
                <InfoCircleOutlined aria-hidden="true" />
              </small>
            </Tooltip>
          )}
        </span>
      ),
    },
    {
      title: "榜单覆盖",
      width: 140,
      render: (_, r) => (
        <div className="flex gap-[4px]">
          {Object.keys(NAMES).map((s) => (
            <Tooltip
              key={s}
              title={`${NAMES[s]}：${r.representatives[s]?.score ?? "未覆盖"}`}
            >
              <span
                className={
                  "py-[3px] px-[5px] text-[8px] font-medium rounded-[4px] border " +
                  (Number.isFinite(r.representatives[s]?.score)
                    ? "bg-[#edf6f1] text-[#66927f] border-[#dfebe4]"
                    : "bg-[#f9fafb] text-[#c1cbd2] border-[#edf1f3]")
                }
              >
                {s === "livebench" ? "LB" : s.toUpperCase()}
              </span>
            </Tooltip>
          ))}
        </div>
      ),
    },
    {
      title: "前沿 / 状态",
      width: 210,
      render: (_, r) =>
        r.frontier ? (
          <Tag color="blue">全球前沿</Tag>
        ) : r.openFrontier ? (
          <Tag color="green">开放权重前沿</Tag>
        ) : r.cnFrontier ? (
          <Tag color="orange">国产前沿</Tag>
        ) : (
          <span className="muted text-[#6b818f] leading-[1.85]">
            {r.reason ?? "非前沿"}
          </span>
        ),
    },
  ];
  const controls = (
    <aside className="panel controls pt-[21px] px-[21px] pb-[19px] min-w-0 max-1180:py-[20px] max-1180:px-[18px] max-760:w-full max-760:p-[20px] max-760:grid max-760:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] max-760:gap-y-[9px] max-760:gap-x-[15px]">
      <div className="panel-title flex items-center justify-between mb-[21px] text-[#8a9aa4] max-760:col-span-full max-760:mb-[7px]">
        <h2>比较口径</h2>
        <SettingOutlined aria-hidden="true" />
      </div>
      <p className="control-help text-[11px] leading-[1.9] max-760:col-span-full">
        PK 多数对决：AA、Vals、LiveBench、Arena
        各一票；至少两榜准入，双方共同有效榜单不足两个不比赛；主榜还要求至少{" "}
        {analysis.requiredOpponents} 个有效对手。有效对局拟合 Bradley-Terry
        强度并以 Elo
        尺度显示；同分才按各榜位次均值排序。低样本模型保留原始战绩但不赋名次。实际对手集合可能不同，原始分差不混入积分。
      </p>
      <div className="h-[1px] bg-[#e9eef2] mt-[17px] mb-[20px] max-760:my-[6px] max-760:col-span-full" />
      <label className="block text-[11px] text-[#65808e] font-medium mb-[8px] max-760:mt-[6px] max-760:mb-0 max-760:self-center max-760:text-[10px]">
        成本来源
      </label>
      <Select
        virtual={false}
        aria-label="成本来源"
        value={costSource}
        onChange={setCostSource}
        options={Object.entries(COSTS).map(([value, label]) => ({
          value,
          label,
        }))}
      />
      {costSource === "composite" && (
        <p className="control-help text-[10px] leading-[1.85] text-[#8a9aa4] mt-0 mb-[17px] max-760:col-span-full max-760:mt-[2px] max-760:mb-[10px] max-760:text-[9px]">
          综合指数至少需 2 个成本来源；每个模型标明 2/3 或 3/3。
        </p>
      )}
      <div className="h-[1px] bg-[#e9eef2] mt-[17px] mb-[20px] max-760:my-[6px] max-760:col-span-full" />
      <label className="block text-[11px] text-[#65808e] font-medium mb-[8px] max-760:mt-[6px] max-760:mb-0 max-760:self-center max-760:text-[10px]">
        任务预算筛选
      </label>
      <div className="budget-line flex flex-col gap-[8px] items-stretch">
        <Select
          virtual={false}
          aria-label="预算成本来源"
          value={budgetSource}
          onChange={(v) => {
            setBudgetSource(v);
            if (v === "none") setBudgetLimit(null);
          }}
          options={[
            { value: "none", label: "不限制" },
            ...COST_SOURCES.map((value) => ({
              value,
              label: NAMES[value],
            })),
          ]}
        />
        <InputNumber
          aria-label="预算上限，美元每次任务"
          min={0.0001}
          step={0.5}
          value={budgetLimit ?? undefined}
          placeholder="USD / 任务"
          disabled={budgetSource === "none"}
          onChange={(v) => setBudgetLimit(Number.isFinite(v) ? v : null)}
        />
      </div>
      <p className="control-help text-[10px] leading-[1.85] text-[#8a9aa4] mt-0 mb-[17px] max-760:col-span-full max-760:mt-[2px] max-760:mb-[10px] max-760:text-[9px]">
        按所选来源的真实美元任务成本隐藏超出预算的模型；未披露或不可核对该来源成本的模型一并隐藏。只改变显示，不改变分数与名次；综合相对成本不是美元预算。
      </p>
      <div className="flex items-center justify-between gap-[8px] text-[10px] text-[#718794] my-[17px] max-760:col-span-full max-760:my-[8px]">
        <span>允许 AA 估算分数</span>
        <Switch
          size="small"
          checked={estimated}
          onChange={setEstimated}
          aria-label="允许 AA 估算分数"
        />
      </div>
      <div className="h-[1px] bg-[#e9eef2] mt-[17px] mb-[20px] max-760:my-[6px] max-760:col-span-full" />
      <div className="flex items-center justify-between gap-[8px] text-[10px] text-[#718794] my-[17px] max-760:col-span-full max-760:my-[8px]">
        <span>排除历史配置</span>
        <Switch
          aria-label="排除历史配置"
          size="small"
          checked={excludeHistorical}
          onChange={setExcludeHistorical}
        />
      </div>
      <div className="flex items-center justify-between gap-[8px] text-[10px] text-[#718794] my-[17px] max-760:col-span-full max-760:my-[8px]">
        <span>排除过期 / 失败缓存</span>
        <Switch
          aria-label="排除过期或失败缓存"
          size="small"
          checked={excludeStale}
          onChange={setExcludeStale}
        />
      </div>
      <p className="control-help text-[10px] leading-[1.85] text-[#8a9aa4] mt-0 mb-[17px] max-760:col-span-full max-760:mt-[2px] max-760:mb-[10px] max-760:text-[9px]">
        过期指超过 24
        小时未成功获取。排除同时作用于分数、成本与前沿；原始单榜视图保留自己的配置开关。
      </p>
      <div className="formula flex items-start gap-[8px] py-[11px] px-[12px] bg-[#f5f8fa] rounded-[8px] text-[10px] text-[#81959f] leading-[1.8] max-760:col-span-full max-760:mt-[4px] max-760:text-[9px]">
        <InfoCircleOutlined aria-hidden="true" />
        <span>
          覆盖度只作信息展示，不额外加分。切换口径会重新计算基准样本。
        </span>
      </div>
    </aside>
  );
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#0c806e",
          controlHeight: 34,
          borderRadius: 7,
          fontSize: 12,
          colorText: "#203441",
          colorBorder: "#dce5ea",
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
        },
        components: {
          Table: { headerBg: "#f7f9fa", cellPaddingBlock: 12 },
          Segmented: { trackBg: "#eef2f4" },
          Slider: { trackBg: "#4b9d91", handleColor: "#137f70" },
        },
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <LineChartOutlined aria-hidden="true" />
          </span>
          <b className="text-[18px] font-[650] tracking-[0.025em] max-760:text-[16px]">
            模型观测台
          </b>
          <span className="brand-en">MODEL ATLAS</span>
        </div>
        <div className="header-right">
          <span className="local-label">
            <CheckCircleFilled aria-hidden="true" /> 本地工作台
          </span>
          <Button
            type="text"
            icon={<InfoCircleOutlined aria-hidden="true" />}
            onClick={() => setMethodOpen(true)}
          >
            计算方法
          </Button>
          <Button icon={<LinkOutlined aria-hidden="true" />} onClick={copyLink}>
            {copied ? "已复制链接" : "复制分享链接"}
          </Button>
          <Button
            icon={<DownloadOutlined aria-hidden="true" />}
            onClick={() =>
              download(
                csvExport(tab === "explore" ? rows : analysis.rows, exportMeta),
                "text/csv;charset=utf-8",
                "model-frontier.csv",
              )
            }
          >
            导出 CSV
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-[1640px] pt-[28px] px-[38px] pb-[20px] max-1180:pt-[26px] max-1180:px-[25px] max-760:pt-[24px] max-760:px-[16px]">
        <div className="page-heading">
          <div>
            <div className="eyebrow">AA / VALS / LIVEBENCH / ARENA</div>
            <h1 className="text-[29px] leading-[1.4] font-[650] tracking-[-0.035em] my-[10px] max-1180:text-[26px] max-760:text-[23px] max-760:leading-[1.5]">
              四榜融合，全面认识一个模型
            </h1>
            <p className="text-[12px] leading-[1.8] text-[#657e8d] m-0 max-760:text-[11px] max-760:leading-[1.9]">
              综合排行、单榜证据、模型对比与成本前沿。持续发现新模型，重点关注开放权重。
            </p>
          </div>
          <div className="refresh-control">
            <Button
              type="primary"
              icon={<ReloadOutlined aria-hidden="true" spin={busy} />}
              loading={busy}
              onClick={refresh}
            >
              从源站刷新
            </Button>
            <Select
              virtual={false}
              aria-label="自动刷新间隔"
              value={data?.settings.refreshHours ?? 6}
              onChange={changeInterval}
              options={[
                { value: 0, label: "关闭自动刷新" },
                { value: 1, label: "每小时自动刷新" },
                { value: 6, label: "每 6 小时自动刷新" },
                { value: 24, label: "每天自动刷新" },
              ]}
            />
            <small className="col-span-full flex justify-end items-center gap-[5px] text-right text-[#8b9aa4] text-[10px] max-760:w-full max-760:justify-start max-760:text-[9px] max-760:mt-[2px]">
              <ClockCircleOutlined aria-hidden="true" /> 服务运行期间自动更新
            </small>
          </div>
        </div>
        {error && (
          <Alert
            type="error"
            title={error}
            showIcon
            closable
            onClose={() => setError(null)}
          />
        )}
        {stale.length > 0 && (
          <Alert
            className="notice"
            type="warning"
            showIcon
            title={`${stale.map((s) => s.name).join("、")} 本次刷新失败，正在使用有日期标记的历史缓存。`}
            description="其他来源仍可独立更新；打开数据来源标签页查看具体原因。"
          />
        )}
        <section className="metrics">
          <div className="relative border border-line rounded-[12px] bg-surface shadow-card pt-[20px] px-[21px] pb-[17px] max-1180:py-[18px] max-1180:px-[16px] max-760:pt-[16px] max-760:px-[15px] max-760:pb-[15px] max-760:min-w-0">
            <AppstoreOutlined
              className="metric-icon tone-blue"
              aria-hidden="true"
            />
            <small className="block text-[11px] text-[#718592] max-760:text-[10px]">
              自动发现模型族
            </small>
            <strong className="block text-[31px] font-semibold tracking-[-0.045em] leading-[1.65] tabular-nums max-760:text-[28px] max-760:leading-[1.7]">
              {data?.models.length ?? "—"}
              <em className="text-[11px] not-italic tracking-normal font-normal text-[#9aa7af] ml-[9px] max-760:text-[9px]">
                个
              </em>
            </strong>
            <span className="text-[10px] text-[#8b9aa5] max-1180:text-[9px] max-760:text-[8px] max-760:leading-[1.6] max-760:block">
              来自四站完整数据的并集
            </span>
          </div>
          <div className="relative border border-line rounded-[12px] bg-surface shadow-card pt-[20px] px-[21px] pb-[17px] max-1180:py-[18px] max-1180:px-[16px] max-760:pt-[16px] max-760:px-[15px] max-760:pb-[15px] max-760:min-w-0">
            <UnlockOutlined
              className="metric-icon tone-teal"
              aria-hidden="true"
            />
            <small className="block text-[11px] text-[#718592] max-760:text-[10px]">
              开放权重模型族
            </small>
            <strong className="block text-[31px] font-semibold tracking-[-0.045em] leading-[1.65] tabular-nums max-760:text-[28px] max-760:leading-[1.7]">
              {data?.models.filter((m) => m.openWeights === true).length ?? "—"}
              <em className="text-[11px] not-italic tracking-normal font-normal text-[#9aa7af] ml-[9px] max-760:text-[9px]">
                个
              </em>
            </strong>
            <span className="text-[10px] text-[#8b9aa5] max-1180:text-[9px] max-760:text-[8px] max-760:leading-[1.6] max-760:block">
              按源站元数据与许可证识别
            </span>
          </div>
          <div className="relative border border-line rounded-[12px] bg-surface shadow-card pt-[20px] px-[21px] pb-[17px] max-1180:py-[18px] max-1180:px-[16px] max-760:pt-[16px] max-760:px-[15px] max-760:pb-[15px] max-760:min-w-0">
            <DotChartOutlined
              className="metric-icon tone-violet"
              aria-hidden="true"
            />
            <small className="block text-[11px] text-[#718592] max-760:text-[10px]">
              有效 PK 主积分
            </small>
            <strong className="block text-[31px] font-semibold tracking-[-0.045em] leading-[1.65] tabular-nums max-760:text-[28px] max-760:leading-[1.7]">
              {analysis.rows.filter((r) => r.composite != null).length}
              <em className="text-[11px] not-italic tracking-normal font-normal text-[#9aa7af] ml-[9px] max-760:text-[9px]">
                个
              </em>
            </strong>
            <span className="text-[10px] text-[#8b9aa5] max-1180:text-[9px] max-760:text-[8px] max-760:leading-[1.6] max-760:block">
              至少 {analysis.required} 榜有效分数 · 至少{" "}
              {analysis.requiredOpponents} 个有效对手 · 不要求成本
            </span>
          </div>
          <div className="relative border border-line rounded-[12px] bg-surface shadow-card pt-[20px] px-[21px] pb-[17px] max-1180:py-[18px] max-1180:px-[16px] max-760:pt-[16px] max-760:px-[15px] max-760:pb-[15px] max-760:min-w-0">
            <RiseOutlined
              className="metric-icon tone-amber"
              aria-hidden="true"
            />
            <small className="block text-[11px] text-[#718592] max-760:text-[10px]">
              四榜共同覆盖
            </small>
            <strong className="block text-[31px] font-semibold tracking-[-0.045em] leading-[1.65] tabular-nums text-green max-760:text-[28px] max-760:leading-[1.7]">
              {evaluationModels.filter((m) =>
                Object.keys(NAMES).every(
                  (key) =>
                    Number.isFinite(m.representatives[key]?.score) &&
                    (!m.representatives[key]?.estimated || estimated),
                ),
              ).length ?? 0}
              <em className="text-[11px] not-italic tracking-normal font-normal text-[#9aa7af] ml-[9px] max-760:text-[9px]">
                个
              </em>
            </strong>
            <span className="text-[10px] text-[#8b9aa5] max-1180:text-[9px] max-760:text-[8px] max-760:leading-[1.6] max-760:block">
              四个来源均披露有效总分
            </span>
          </div>
        </section>
        <Tabs
          className="portal-tabs min-w-0"
          activeKey={tab}
          onChange={navigate}
          items={[
            {
              key: "overview",
              label: "综合总览",
              icon: <DashboardOutlined aria-hidden="true" />,
            },
            {
              key: "rankings",
              label: "融合排行榜",
              icon: <TrophyOutlined aria-hidden="true" />,
            },
            {
              key: "explore",
              label: "前沿探索",
              icon: <DotChartOutlined aria-hidden="true" />,
            },
            {
              key: "compare",
              label: "模型对比",
              icon: <SwapOutlined aria-hidden="true" />,
            },
            {
              key: "sources",
              label: "数据来源与刷新",
              icon: <DatabaseOutlined aria-hidden="true" />,
            },
          ]}
        />
        <div className="scoring-context">
          <span className="flex items-center gap-[8px] flex-wrap">
            <SettingOutlined aria-hidden="true" /> PK 主积分 · BT / Elo ·
            四榜各一票 · 至少 {analysis.required} 榜 · 至少{" "}
            {analysis.requiredOpponents} 个有效对手 ·{" "}
            {estimated ? "允许估算" : "排除估算"}
            {excludeHistorical ? " · 排除历史" : ""}
            {excludeStale ? " · 排除过期缓存" : ""}
          </span>
          <Button type="link" size="small" onClick={() => navigate("rankings")}>
            调整评分口径
          </Button>
        </div>
        {!analysis.btConnected && (
          <Alert
            className="notice"
            type="warning"
            showIcon
            title={`对局图分为 ${analysis.btComponents} 个互不相连的组，无法给出单一全局 BT 排名；主榜、对比与前沿暂不可用。请检查来源覆盖或质量排除设置，不回退到旧公式。`}
          />
        )}
        {excludeStale && activeCostSources.length < 3 && (
          <Alert
            className="notice"
            type="info"
            showIcon
            title={
              activeCostSources.length >= 2
                ? `综合成本基准已按 ${activeCostSources.map((s) => NAMES[s]).join("、")} 的共同样本重算；与未排除来源时的倍数不能直接比较。`
                : "有效成本来源不足两个，当前无法计算综合成本；仍可查看综合能力或单站成本。"
            }
          />
        )}
        {tab === "overview" && (
          <Overview
            models={evaluationModels}
            analysis={analysis}
            data={data}
            costSource={costSource}
            onNavigate={navigate}
            onSelect={setSelected}
            onQuickCompare={quickCompare}
            includeEstimated={estimated}
            onOpenHistory={openHistory}
          />
        )}
        {tab === "rankings" && (
          <Rankings
            sources={data?.sources ?? {}}
            models={data?.models ?? []}
            analysis={analysis}
            controls={controls}
            costSource={costSource}
            onSelect={setSelected}
            selection={selection}
            onSelectionChange={updateSelection}
            onExport={(content, name) =>
              download(content, "text/csv;charset=utf-8", name)
            }
            includeEstimated={estimated}
            ranking={ranking}
            onRanking={(patch) =>
              setRanking((previous) => ({ ...previous, ...patch }))
            }
            budget={budget}
            excludeStale={excludeStale}
            exportMeta={exportMeta}
          />
        )}
        {tab === "compare" && (
          <Comparison
            sources={data?.sources ?? {}}
            models={data?.models ?? []}
            analysis={analysis}
            selection={selection}
            onSelectionChange={updateSelection}
            onSelect={setSelected}
            costSource={costSource}
            onNavigate={navigate}
          />
        )}
        {tab === "explore" && (
          <>
            <section className="panel mb-[18px] px-[20px] py-[14px] max-760:px-[13px] max-760:py-[13px]">
              <VendorSearchChips
                chips={exploreChips}
                query={paretoQuery}
                onSearch={setParetoQuery}
              />
              <p className="mt-[7px] mb-0 text-[9px] text-[#8c9ba5]">
                点选厂商可在帕累托图中标记命中模型；完整点位和下方表格过滤保持独立。
              </p>
            </section>
            <section className="grid grid-cols-[254px_minmax(0,1fr)] gap-[19px] mb-[22px] items-start max-1180:grid-cols-[235px_minmax(0,1fr)] max-1180:gap-[16px] max-760:flex max-760:flex-col max-760:gap-[16px]">
              {controls}
              <div className="panel min-w-0 overflow-hidden pt-[23px] px-[23px] pb-[16px] max-1180:pt-[21px] max-1180:px-[18px] max-1180:pb-[15px] max-760:w-full max-760:pt-[20px] max-760:px-[13px] max-760:pb-[14px]">
                <div className="chart-heading flex items-start justify-between gap-[16px] mb-[19px] max-1180:flex-col max-1180:gap-[12px] max-760:mb-[12px] max-760:gap-[12px]">
                  <div>
                    <div className="eyebrow">QUALITY & COST</div>
                    <h2>综合能力 / 成本前沿</h2>
                    <p>在同一视图比较模型能力、成本与证据覆盖</p>
                    {searchActive && (
                      <p className="search-hint">
                        {searchMatches.length
                          ? plottedMatches
                            ? `搜索命中 ${searchMatches.length} 个模型，图中 ${plottedMatches} 个点位已用橙色描边标注；全部点位保留。`
                            : `搜索命中 ${searchMatches.length} 个模型，但它们都缺少图表所需的有效成本；全部点位仍保留。`
                          : "搜索没有命中当前图表中的模型；全部点位仍保留。"}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-[10px] max-760:w-full max-760:flex-col max-760:items-start">
                    <Input
                      className="w-[220px] max-760:w-full"
                      aria-label="帕累托搜索"
                      prefix={<SearchOutlined aria-hidden="true" />}
                      placeholder="搜索模型或厂商"
                      value={paretoQuery}
                      onChange={(e) => setParetoQuery(e.target.value)}
                      allowClear
                    />
                    <Segmented
                      aria-label="模型范围"
                      value={
                        focus === "openOnly"
                          ? "openOnly"
                          : focus === "cnOnly"
                            ? "cnOnly"
                            : "all"
                      }
                      onChange={setFocus}
                      options={[
                        { label: "全部模型", value: "all" },
                        { label: "仅开放权重", value: "openOnly" },
                        { label: "仅国产", value: "cnOnly" },
                      ]}
                    />
                  </div>
                </div>
                {!data ? (
                  <div className="h-[448px] flex flex-col items-center justify-center text-[#8c9ba5] text-[12px]">
                    <Spin />
                    <p>正在读取模型数据…</p>
                  </div>
                ) : chartRows.some((r) => r.plottable) ? (
                  <Chart
                    rows={chartRows}
                    focus={focus}
                    onSelect={setSelected}
                    chartRef={chartRef}
                    costSource={costSource}
                    costProfile={analysis.costProfile}
                    highlightIds={highlightIds}
                    searchActive={searchActive}
                  />
                ) : (
                  <div className="h-[448px] flex flex-col items-center justify-center text-[#8c9ba5] text-[12px]">
                    <Empty
                      description={`正式对决需要至少 ${analysis.required} 榜共同有效的对手及有效成本；票数不足的模型可在排行榜查看原始分。`}
                    />
                  </div>
                )}
              </div>
            </section>
            <section className="panel models-panel overflow-hidden">
              <div className="table-toolbar flex justify-between items-center gap-[20px] py-[22px] px-[24px] max-1180:flex-col max-1180:items-start max-760:py-[20px] max-760:px-[17px] max-760:pb-[18px] max-760:gap-[13px]">
                <div>
                  <h2>
                    模型全景{" "}
                    <span className="text-[10px] font-medium text-[#5d8d7e] border border-[#dfede6] bg-[#f1f8f4] inline-block py-[1px] px-[7px] rounded-[5px] ml-[6px] align-middle">
                      {rows.length}
                    </span>
                  </h2>
                  <p className="text-[10px] leading-[1.8] text-[#8c9ba5] mt-[7px] mb-0 max-760:text-[9px]">
                    未覆盖完整榜单的模型仍保留在表中，缺分和缺成本分别标记。
                  </p>
                </div>
                <div className="table-filters flex items-center gap-[13px] max-1180:w-full max-760:flex-wrap max-760:gap-[10px]">
                  <Checkbox
                    checked={focus === "openFirst"}
                    disabled={focus === "openOnly"}
                    onChange={(e) =>
                      setFocus(e.target.checked ? "openFirst" : "all")
                    }
                  >
                    开放优先排序
                  </Checkbox>
                  <Checkbox
                    checked={onlyFront}
                    onChange={(e) => setOnlyFront(e.target.checked)}
                  >
                    仅看前沿
                  </Checkbox>
                  <Select
                    className="w-[190px]"
                    virtual={false}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="全部厂商"
                    aria-label="表格厂商筛选"
                    value={creator}
                    onChange={setCreator}
                    options={[...new Set(analysis.rows.map((m) => m.creator))]
                      .sort()
                      .map((value) => ({ value, label: value }))}
                  />
                  <Input
                    className="w-[220px]"
                    aria-label="过滤模型表格"
                    prefix={<SearchOutlined aria-hidden="true" />}
                    placeholder="过滤模型或厂商"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    allowClear
                  />
                </div>
              </div>
              <CreatorChips
                chips={exploreChips}
                creator={creator}
                onChange={setCreator}
                className="px-[24px] pb-[14px] max-760:px-[17px]"
              />
              <Table
                rowKey="id"
                columns={columns}
                dataSource={rows}
                pagination={{
                  defaultPageSize: 15,
                  showSizeChanger: true,
                  pageSizeOptions: [15, 30, 60],
                  showTotal: (n) => `${n} 个模型族`,
                }}
                scroll={{ x: 1000 }}
                size="middle"
                rowClassName={(r) => (r.openFrontier ? "frontier-row" : "")}
              />
            </section>
          </>
        )}
        {tab === "sources" && (
          <>
            <SourceQuality sources={data?.sources} />
            <QualityNote />
            <Button
              className="history-source-button"
              onClick={() => openHistory()}
            >
              查看更新记录
            </Button>
            <section className="grid grid-cols-[repeat(2,1fr)] gap-[19px] max-1180:gap-[16px] max-760:grid-cols-[1fr]">
              {Object.entries(data?.sources ?? {}).map(([id, s]) => (
                <div
                  className="panel source-card p-[24px] max-760:p-[21px]"
                  key={id}
                >
                  <div className="source-title flex items-center justify-between">
                    <h2>
                      <DatabaseOutlined aria-hidden="true" /> {s.name}
                    </h2>
                    <Tag
                      color={s.stale ? "orange" : s.count ? "green" : "default"}
                    >
                      {(progress ?? data?.progress)?.sources?.[id] === "loading"
                        ? "正在抓取"
                        : s.stale
                          ? "历史缓存"
                          : s.count
                            ? "已读取"
                            : "未读取"}
                    </Tag>
                  </div>
                  <p className="text-[11px] text-[#8a9da7]">{s.metric}</p>
                  <strong className="text-[32px] font-[550] tabular-nums tracking-[-0.04em]">
                    {s.count}
                    <small className="text-[10px] font-normal text-[#99a8b1] ml-[8px] tracking-normal">
                      {" "}
                      条源站模型配置
                    </small>
                  </strong>
                  <dl className="grid grid-cols-[125px_1fr] gap-[13px] text-[11px] py-[18px] border-t border-b border-[#edf2f4] my-[21px] max-760:grid-cols-[110px_1fr] max-760:text-[10px]">
                    <dt className="text-[#92a3ad]">源站版本 / 更新标签</dt>
                    <dd className="m-0 text-[#5c7684] [overflow-wrap:anywhere]">
                      {s.sourceDate ?? "源站未披露"}
                    </dd>
                    <dt className="text-[#92a3ad]">最后成功获取</dt>
                    <dd className="m-0 text-[#5c7684] [overflow-wrap:anywhere]">
                      {formatTime(s.fetchedAt)}
                    </dd>
                    <dt className="text-[#92a3ad]">最近尝试</dt>
                    <dd className="m-0 text-[#5c7684] [overflow-wrap:anywhere]">
                      {formatTime(s.attemptedAt)}
                    </dd>
                  </dl>
                  {s.error && (
                    <Alert
                      type="warning"
                      title={s.error}
                      action={
                        <Button
                          size="small"
                          disabled={busy}
                          loading={progress?.sources?.[id] === "loading"}
                          onClick={() => retrySource(id)}
                        >
                          重试此来源
                        </Button>
                      }
                    />
                  )}
                  <ul className="text-[11px] leading-[1.9] pl-[16px] text-[#93a2ab]">
                    {s.notes?.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px]"
                  >
                    打开原始榜单 <ExportOutlined aria-hidden="true" />
                  </a>
                </div>
              ))}
              <div className="panel update-notes col-span-full p-[25px] text-[12px] leading-[1.9] text-[#81949f] max-760:p-[21px] max-760:text-[11px]">
                <h2>自动更新如何工作</h2>
                <p className="max-w-[1120px]">
                  本地服务启动后检查缓存，按设置的间隔从三个源站读取。无需 API
                  key，也无需在聊天中指定模型名称。新模型通过名称规则自动加入；无法确认同一发布版本的名称会分别保留。
                </p>
                <p className="max-w-[1120px]">
                  四站均通过后台 HTTP 读取公开页面、结构化接口、内嵌数据和
                  CSV，刷新不会启动浏览器。单站失败会保留该站最后一次成功数据并显示原因；不会用空表覆盖。服务关闭、电脑休眠或断网期间不执行抓取，下次启动补更。源站结构或访问策略变化时，适配器可能需要维护。
                </p>
                <p className="max-w-[1120px]">
                  开放权重来自 AA 的 isOpenWeights 和 LiveBench 的
                  openweight。源站意见冲突时标为“来源有分歧”；未确认的模型不会被自动当作开放模型。开放权重与
                  OSI 开源是不同概念。
                </p>
              </div>
            </section>
          </>
        )}
        <footer className="flex justify-between gap-[20px] pt-[25px] pb-[28px] text-[#a0adb5] text-[9px] leading-[1.9] tracking-[0.025em] max-760:flex-col max-760:gap-[7px] max-760:py-[23px] max-760:text-[8px]">
          <span>MODEL ATLAS / 四榜融合工作台</span>
          <span>
            数据最后刷新尝试：{formatTime(data?.lastRefresh)}
            　·　模型族级比较，跨站配置不完全相同
          </span>
        </footer>
        {selection.length > 0 && tab !== "compare" && (
          <div className="comparison-tray sticky bottom-[16px] z-30 flex justify-between items-center gap-[20px] py-[13px] px-[18px] border border-[#cddfd9] rounded-[11px] bg-[#fffffff5] backdrop-blur-[12px] shadow-[0_6px_30px_#20443b1f] max-760:flex-col max-760:items-stretch max-760:gap-[10px] max-760:p-[12px] max-760:bottom-[10px]">
            <div className="flex items-center gap-[10px] min-w-0 max-760:flex-wrap max-760:gap-[8px]">
              <SwapOutlined aria-hidden="true" />
              <b className="whitespace-nowrap text-[12px]">
                已选 {selection.length}/4
              </b>
              <div className="tray-models flex flex-wrap gap-[5px] max-760:hidden">
                {selection.map((id) => (
                  <Tag
                    key={id}
                    closable
                    onClose={() =>
                      updateSelection(selection.filter((x) => x !== id))
                    }
                  >
                    {data?.models.find((m) => m.id === id)?.name ?? id}
                  </Tag>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-[10px] min-w-0 max-760:flex-wrap max-760:gap-[8px] max-760:justify-end">
              <Button onClick={() => updateSelection([])}>清空</Button>
              <Button
                type="primary"
                disabled={selection.length < 2}
                onClick={() => navigate("compare")}
              >
                对比所选模型
              </Button>
            </div>
          </div>
        )}
      </main>
      <Drawer
        title={current?.name ?? "模型详情"}
        open={!!current}
        onClose={() => setSelected(null)}
        width={650}
      >
        <div className="model-detail">
          <div className="flex flex-wrap gap-[10px] mb-[22px]">
            <Button onClick={() => openHistory(current)}>查看此模型历史</Button>
            <Button
              icon={<SwapOutlined aria-hidden="true" />}
              disabled={
                !selection.includes(current?.id) && selection.length >= 4
              }
              onClick={() =>
                updateSelection(
                  selection.includes(current.id)
                    ? selection.filter((id) => id !== current.id)
                    : [...selection, current.id],
                )
              }
            >
              {selection.includes(current?.id) ? "移出对比" : "加入对比"}
            </Button>
            <Button
              onClick={() => {
                setSelected(null);
                navigate("compare");
              }}
            >
              打开模型对比
            </Button>
          </div>
          <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
            {current?.creator}　
            {current?.openWeights === true ? (
              <Tag color="green">开放权重</Tag>
            ) : (
              <Tag>
                {current?.openConflict
                  ? "开放状态有分歧"
                  : current?.openWeights === false
                    ? "闭源"
                    : "开放状态未确认"}
              </Tag>
            )}
          </p>
          <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
            许可证：{current?.licenses.join(" / ") || "源站未披露"}
          </p>
          <EvidenceBadges model={current ?? {}} sources={data?.sources} />
          {current && <ConfigurationDetails model={current} />}
          <Alert
            type="info"
            title="按模型族归并。这里保留各榜单具体配置；跨站分数不代表同一个推理档位。"
          />
          {current?.dominatedBy.length > 0 && (
            <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
              当前口径下可同时做到成本不高、PK 主积分不低的前沿模型：
              {current.dominatedBy.join("、")}
            </p>
          )}
          {current && (
            <section className="p-[20px] bg-white border border-[#e4ecef] rounded-[11px] mt-[20px] max-760:p-[16px]">
              <h3 className="text-[14px] font-semibold mt-[5px] mb-[14px] text-[#3b5867]">
                为什么在这个口径下是 / 不是前沿？
              </h3>
              <p className="text-[11px] leading-[1.9] text-[#81949d] [overflow-wrap:anywhere]">
                当前 PK 主积分（BT / Elo）{" "}
                <b className="text-[#416775]">
                  {current.composite?.toFixed(2) ?? "未评分"}
                </b>
                （有效覆盖 {current.available.length}{" "}
                个榜单，覆盖度不参与加分），{COSTS[costSource]}{" "}
                <b className="text-[#416775]">
                  {costFormat(current.cost, costSource)}
                </b>
                。以下保持 PK
                主积分不变，只切换成本来源；比较样本仍按当前覆盖门槛选取。
              </p>
              {!current.rankEligible && current.record && (
                <p className="text-[11px] leading-[1.9] text-[#a9635a] [overflow-wrap:anywhere]">
                  主榜要求至少 {analysis.requiredOpponents} 个有效对手；当前{" "}
                  {current.record.opponents}{" "}
                  个，因此不赋主榜名次，仅展示原始战绩。
                </p>
              )}
              <table className="w-full border-collapse text-[10px] mt-[12px] tabular-nums max-760:text-[9px]">
                <thead>
                  <tr>
                    <th className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] bg-[#f6f9fb] font-medium text-[#8197a4] max-760:py-[10px] max-760:px-[5px]">
                      成本来源
                    </th>
                    <th className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] bg-[#f6f9fb] font-medium text-[#8197a4] max-760:py-[10px] max-760:px-[5px]">
                      成本
                    </th>
                    <th className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] bg-[#f6f9fb] font-medium text-[#8197a4] max-760:py-[10px] max-760:px-[5px]">
                      全球前沿
                    </th>
                    <th className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] bg-[#f6f9fb] font-medium text-[#8197a4] max-760:py-[10px] max-760:px-[5px]">
                      开放前沿
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {["composite", "aa", "vals", "livebench"].map((source) => {
                    const a = costScenarios[source];
                    return (
                      <tr key={source}>
                        <td className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] text-[#63818f] max-760:py-[10px] max-760:px-[5px]">
                          {source === "composite" ? "综合指数" : NAMES[source]}
                        </td>
                        <td className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] text-[#63818f] max-760:py-[10px] max-760:px-[5px]">
                          {costFormat(a?.cost, source)}
                        </td>
                        <td className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] text-[#63818f] max-760:py-[10px] max-760:px-[5px]">
                          {!a?.plottable
                            ? a?.rankEligible === false
                              ? "证据不足"
                              : "缺分 / 缺成本"
                            : a.frontier
                              ? "是"
                              : "否"}
                        </td>
                        <td className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] text-[#63818f] max-760:py-[10px] max-760:px-[5px]">
                          {!a?.plottable ? "—" : a.openFrontier ? "是" : "否"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[11px] leading-[1.9] text-[#81949d] [overflow-wrap:anywhere]">
                任务集合和定价快照不同，三个来源的美元任务成本不等价。
              </p>
              <h3 className="text-[14px] font-semibold mt-[26px] mb-[14px] text-[#3b5867]">
                综合成本的可复算明细
              </h3>
              <p className="text-[11px] leading-[1.9] text-[#81949d] [overflow-wrap:anywhere]">
                完整三源时，指数 = 100 × ∛[(AA / AA 中位数) × (Vals / Vals
                中位数) × (LiveBench / LiveBench
                中位数)]。缺一源时，对两个有效比值取平方根；至少需两源。已有成本来源等权，与能力权重独立；主动排除来源时，基准按剩余至少两源的共同样本重算。不同基准的倍数不可直接比较。部分覆盖并非等价实验。
              </p>
              <table className="w-full border-collapse text-[10px] mt-[12px] tabular-nums max-760:text-[9px]">
                <thead>
                  <tr>
                    <th className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] bg-[#f6f9fb] font-medium text-[#8197a4] max-760:py-[10px] max-760:px-[5px]">
                      来源
                    </th>
                    <th className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] bg-[#f6f9fb] font-medium text-[#8197a4] max-760:py-[10px] max-760:px-[5px]">
                      原始任务成本
                    </th>
                    <th className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] bg-[#f6f9fb] font-medium text-[#8197a4] max-760:py-[10px] max-760:px-[5px]">
                      基准中位数
                    </th>
                    <th className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] bg-[#f6f9fb] font-medium text-[#8197a4] max-760:py-[10px] max-760:px-[5px]">
                      相对倍数
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {current.costComponents.map((c) => (
                    <tr key={c.source}>
                      <td className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] text-[#63818f] max-760:py-[10px] max-760:px-[5px]">
                        {NAMES[c.source]}
                      </td>
                      <td className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] text-[#63818f] max-760:py-[10px] max-760:px-[5px]">
                        {money(c.cost)}
                      </td>
                      <td className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] text-[#63818f] max-760:py-[10px] max-760:px-[5px]">
                        {money(c.baseline)}
                      </td>
                      <td className="text-left py-[11px] px-[8px] border-b border-[#edf1f4] text-[#63818f] max-760:py-[10px] max-760:px-[5px]">
                        {c.ratio == null ? "缺失" : c.ratio.toFixed(3) + "×"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3 className="text-[14px] font-semibold mt-[26px] mb-[14px] text-[#3b5867]">
                回到单榜，使用该榜自己的完整样本
              </h3>
              <p className="text-[11px] leading-[1.9] text-[#81949d] [overflow-wrap:anywhere]">
                以下单榜核对独立于综合质量排除开关；原始记录保留，不代表仍参与当前综合计算。
              </p>
              {COST_SOURCES.map((source) => {
                const a = sourceAudit(data?.models ?? [], current.id, source);
                return (
                  <div
                    className="py-[14px] border-b border-[#edf1f4]"
                    key={source}
                  >
                    <b className="text-[12px] text-[#4b6b7a]">
                      {NAMES[source]}
                    </b>
                    {!a?.available ? (
                      <p className="text-[10px] leading-[1.8] my-[7px] text-[#8a9da6]">
                        {a?.reason}
                      </p>
                    ) : (
                      <>
                        <p className="text-[10px] leading-[1.8] my-[7px] text-[#8a9da6]">
                          {a.name} · 原始分 {a.score.toFixed(2)} ·{" "}
                          {money(a.cost)}
                        </p>
                        <p className="text-[10px] leading-[1.8] my-[7px] text-[#8a9da6]">
                          {a.basis} · {a.population} 条有效源配置 ·{" "}
                          {a.frontier
                            ? "该配置在前沿"
                            : a.anyVariantOnFrontier
                              ? "该配置不在前沿，同族其他配置在前沿"
                              : "未进入该口径前沿"}
                        </p>
                        {a.dominatedBy.length > 0 && (
                          <p className="text-[10px] leading-[1.8] my-[7px] text-[#8a9da6]">
                            可支配该配置：{a.dominatedBy.join("、")}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              <p className="text-[11px] leading-[1.9] text-[#81949d] [overflow-wrap:anywhere]">
                这里剔除 AA 历史 / 估算配置。LiveBench
                单榜核对采用每次成功任务成本，并在上方明确标记。
              </p>
            </section>
          )}
          {Object.entries(NAMES).map(([s, name]) => {
            const r = (current?.originalRepresentatives ??
              current?.representatives)?.[s];
            return (
              <section
                className="p-[20px] bg-white border border-[#e4ecef] rounded-[11px] mt-[20px] max-760:p-[16px]"
                key={s}
              >
                <h3 className="flex justify-between items-center text-[14px] font-semibold mt-[5px] mb-[14px] text-[#3b5867]">
                  {name}
                  {r && (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-normal"
                    >
                      源数据 <ExportOutlined aria-hidden="true" />
                    </a>
                  )}
                </h3>
                {!r ? (
                  <p className="text-[11px] leading-[1.9] text-[#81949d] [overflow-wrap:anywhere]">
                    未发现可确认对应的模型，未补分。
                  </p>
                ) : (
                  <>
                    <p className="text-[11px] leading-[1.9] text-[#81949d] [overflow-wrap:anywhere]">
                      <b className="text-[#416775]">
                        {r.score == null ? "无有效总分" : r.score.toFixed(3)}
                      </b>
                      　{r.estimated && <Tag color="orange">估算分</Tag>}
                      {r.deprecated && <Tag>AA 历史条目</Tag>}
                    </p>
                    <p className="text-[11px] leading-[1.9] text-[#81949d] [overflow-wrap:anywhere]">
                      {r.configuration ?? r.name}
                    </p>
                    {s === "arena" && <ArenaEvidence record={r} />}
                    <p className="text-[11px] leading-[1.9] text-[#81949d] [overflow-wrap:anywhere]">
                      任务成本 {money(r.costTask)} · 输入 / 输出
                      {s === "vals" ? "参考单价" : "单价"} {money(r.priceInput)}{" "}
                      / {money(r.priceOutput)} 每百万 token
                      {s === "vals" && r.priceUrl && (
                        <>
                          {" "}
                          <a href={r.priceUrl} target="_blank" rel="noreferrer">
                            价格来源
                          </a>
                        </>
                      )}
                    </p>
                    <p className="text-[11px] leading-[1.9] text-[#81949d] [overflow-wrap:anywhere]">
                      {
                        (current?.originalRecords ?? current?.records)?.[s]
                          ?.length
                      }{" "}
                      个源站配置；选取非估算、非历史配置优先，其后按总分择优。成本始终绑定这条配置。
                    </p>
                    <details>
                      <summary className="text-[10px] text-[#57927c] cursor-pointer leading-[2]">
                        查看该榜全部配置
                      </summary>
                      {(current?.originalRecords ?? current?.records)?.[s]?.map(
                        (v, i) => (
                          <p
                            className="bg-[#f6f9fa] py-[8px] px-[10px] rounded-[6px] text-[10px] leading-[1.9] text-[#81949d] [overflow-wrap:anywhere]"
                            key={i}
                          >
                            {v.name} · {v.score ?? "无分数"} ·{" "}
                            {money(v.costTask)}
                          </p>
                        ),
                      )}
                    </details>
                  </>
                )}
              </section>
            );
          })}
        </div>
      </Drawer>
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        modelId={historyModel?.id}
        modelName={historyModel?.name}
        lastRefresh={data?.lastRefresh}
      />
      <Drawer
        title="计算方法与边界"
        open={methodOpen}
        onClose={() => setMethodOpen(false)}
        width={650}
      >
        <article className="method">
          <h3 className="text-[15px] text-[#3d5a68] mt-[24px]">
            如何确定每榜票数？
          </h3>
          <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
            采用多数对决，四榜各一票，不提供任意权重推荐。所有页面和分享链接统一使用当前规则。
          </p>
          <h3 className="text-[15px] text-[#3d5a68] mt-[24px]">
            如何计算 PK 主积分？
          </h3>
          <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
            默认至少两榜准入。每对模型共同有效榜单不少于两榜才比赛，每榜一票；领先榜数多者胜，相同则平局，四榜
            2∶2 时该场判平。把所有有效对局交给 Bradley-Terry
            模型（平局半胜、Gamma(2,1) 弱先验）拟合相对强度，再以 Elo
            尺度展示：中位模型 1000，400 分差约等于 10∶1
            预测胜率。主榜还要求至少 {analysis.requiredOpponents}{" "}
            个有效对手；不足者保留原始战绩与对手数，但不赋主榜名次、不参与前沿。无有效对手不赋分；对局图不连通时不给出跨组件的单一全局名次。
          </p>
          <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
            BT
            按对手强度校正赛程，强队仍可能互相循环，因此等级分表示当前样本内的相对强度，不是实测胜率、正确率或能力百分比。现行
            Copeland 胜率（100 ×（胜场 + 0.5 × 平场）÷
            实际对手数）和名次只作为诊断保留在模型对比与
            CSV，不进入主榜、前沿、同分排序或分享参数。BT
            主积分相同才按已有榜单排名百分位的等权平均排序；位次均值只作同分排序，不作为第五票，也不与主分再次合并。不足两榜的模型仍展示原始分，但不参加正式排名或前沿。对手集合可能不同，等级分的可比性弱于完整四榜样本；对比页展示共同榜数、票数、原始分与分差。位次均值不参与帕累托纵轴或支配判断。
          </p>
          <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
            帕累托搜索只标注图中命中点并保留全部点位；厂商、文本和前沿条件只过滤下方模型表；预算只改变显示，成本切换不改变积分。估算及质量排除开关会改变参赛样本，因此会重算积分。
          </p>
          <h3 className="text-[15px] text-[#3d5a68] mt-[24px]">
            为何更关注开放权重？
          </h3>
          <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
            全量发现四站模型，按源站披露开放状态识别，未设置中国厂商或模型白名单。既显示全球前沿，也显示仅在开放权重模型中计算的前沿，防止闭源最强模型遮住可部署候选。只看开放权重时，全球参照前沿保持原定义。
          </p>
          <h3 className="text-[15px] text-[#3d5a68] mt-[24px]">成本与前沿</h3>
          <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
            默认使用综合相对成本指数：以三站都有正任务成本、且估算设置允许的固定模型样本为成本基准，各站成本除以该站中位数，再取三源等权几何平均并乘
            100。三源权重各
            1/3，与能力权重独立；页面以基准的多少倍展示（原指数除以
            100），无美元单位，不能作为生产账单预算。成本至少两源才计算；缺失不补值，对已有来源等权平均对数比值，并标记
            2/3 或
            3/3。基准默认用三源完整样本固定计算；主动排除整个来源时，按剩余至少两源的共同样本重新建立基准。详情提供每站原始成本、中位数与相对倍数。也可切换单站的每次任务美元成本。AA、Vals、LiveBench
            任务分布不同，所以成本切换可能改变前沿。API
            任务成本不能替代本地部署的
            GPU、运维和利用率成本。成本缺失、非正或低于显示精度不填零，也不放入对数轴。
          </p>
          <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
            若另一模型成本不高且 PK
            主积分不低，并至少一项严格更优，则该模型被支配。前沿图中悬浮任一全球前沿模型，即标出它支配的区域：该模型右下方整个矩形内的模型，都被它以更低成本、更高
            PK
            主积分同时支配，标签注明其中模型数；被支配模型的悬浮提示会反向列出支配者。连线只是视觉引导，不代表两个模型之间存在可连续插值的选项。标签重叠时会自动隐藏，可通过悬浮或表格查看。
          </p>
          <h3 className="text-[15px] text-[#3d5a68] mt-[24px]">
            数据质量与配置差异
          </h3>
          <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
            配置提示只比较明确披露的 effort
            和推理模式；相同档位标签不代表统一实验。默认保留历史与失败回退缓存，允许主动排除。过期缓存指超过
            24
            小时未成功获取，排除时同时移除其能力与成本证据；不按源站发布日期自动扣分。快照仅记录实际观察的源配置变化，相同数据不重复保存；起始快照可来自已有缓存，不补造过去历史。
          </p>
          <h3 className="text-[15px] text-[#3d5a68] mt-[24px]">
            能力维度与预算筛选
          </h3>
          <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
            融合排行榜可打开「LiveBench
            能力维度」列，按编程、推理、研究等分类原始分排序，减少只看一个融合分的信息损失。仅
            LiveBench 提供能力维度；AA 与 Vals
            没有对应数据，缺失保持空白，也不把分类分外推成综合能力。预算筛选按单一来源的真实美元任务成本隐藏超出上限的模型，未披露该来源成本的模型一并隐藏；它只改变显示范围，不改变分数、名次与前沿，综合相对成本仍只用于跨源观察，不充当美元预算。
          </p>
          <h3 className="text-[15px] text-[#3d5a68] mt-[24px]">分享与复核</h3>
          <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
            「复制分享链接」把当前估算与质量排除开关、成本口径、预算筛选、排行榜筛选、榜单组合对照和对比选择写入页面地址；全默认设置也按完整分享恢复，不沿用接收方偏好。CSV
            导出附带数据时间与完整评分口径，数据本身以快照时间为准。评分固定至少两榜准入；估算或质量排除设置改变样本时会重算排名，不代表模型能力变化。
          </p>
          <h3 className="text-[15px] text-[#3d5a68] mt-[24px]">
            版本与统计边界
          </h3>
          <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
            名称只去除推理 effort 后缀，保留日期、Preview、Vision
            等发布区别。无法确认的名称不会模糊合并。模型族的不同推理配置单独保留；各站采用各自协议，部分
            Anthropic 数据含 fallback。没有为 BT
            等级分伪造置信区间，也不把微小分差解释为统计显著；低覆盖模型的 Elo
            差异应结合对手数与共同榜覆盖阅读。
          </p>
          <p className="text-[12px] leading-[1.95] text-[#78909d] [overflow-wrap:anywhere]">
            <a
              href="https://artificialanalysis.ai/methodology/intelligence-benchmarking"
              target="_blank"
              rel="noreferrer"
            >
              AA 方法
            </a>{" "}
            ·{" "}
            <a
              href="https://www.vals.ai/benchmarks/vals_index"
              target="_blank"
              rel="noreferrer"
            >
              Vals 方法
            </a>{" "}
            ·{" "}
            <a
              href="https://livebench.ai/#/methodology"
              target="_blank"
              rel="noreferrer"
            >
              LiveBench 方法
            </a>
          </p>
        </article>
      </Drawer>
    </ConfigProvider>
  );
}
createRoot(document.getElementById("root")).render(<App />);
