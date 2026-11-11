import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Input,
  Progress,
  Select,
  Segmented,
  Table,
  Tag,
  Tooltip,
} from "antd";
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  ExportOutlined,
  SearchOutlined,
  SwapOutlined,
  TrophyOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { NAMES, COSTS, costFormat, money } from "./presentation.mjs";
import {
  adjustedScores,
  certifyNoBrainer,
  codingIndices,
  csvExport,
  valueRanking,
} from "./analysis.mjs";
import {
  compareNullableScores,
  coverageSummary,
  evidenceDepth,
  filterModels,
  nativeCsvExport,
  nativeRanking,
  rankedModels,
  applyBudget,
  budgetSummary,
  livebenchSuiteKeys,
  vendorChipCounts,
  SOURCE_IDS,
} from "./portal.mjs";
import CompareChart from "./CompareChart.jsx";
import { majorityMatch } from "./analysis.mjs";
import {
  ArenaEvidence,
  ConfigurationDetails,
  EvidenceBadges,
  SourceQuality,
  QualityNote,
  HistorySummary,
} from "./Evidence.jsx";
import { sourceHealth } from "./evidence.mjs";
const number = (v) => (Number.isFinite(v) ? v.toFixed(1) : "未披露");
// 四来源徽标配色（原 .source-aa/.source-vals/.source-livebench，键与 SOURCE_IDS 对应）
const SOURCE_TONE = {
  aa: "bg-[#e7eef9] text-[#416795]",
  vals: "bg-[#eeeaf7] text-[#7e60a7]",
  livebench: "bg-[#e5f3ef] text-[#137964]",
  arena: "bg-[#f2eafa] text-[#76559a]",
};
const stateTag = (r) => (
  <Tag color={r.openWeights === true ? "green" : "default"}>
    {r.openConflict
      ? "开放状态有分歧"
      : r.openWeights === true
        ? "开放权重"
        : r.openWeights === false
          ? "闭源"
          : "未确认"}
  </Tag>
);
const scoreCell = (v) =>
  Number.isFinite(v) ? (
    <span className="block max-w-[90px] font-[650] tabular-nums text-[#106e61]">
      {v.toFixed(1)}
    </span>
  ) : (
    <span className="text-[10px] leading-[1.85] text-[#6b818f]">未评分</span>
  );
const compareComposite = compareNullableScores((r) => r.composite);
const compareAuxiliary = compareNullableScores((r) => r.auxiliary);
const nameCell = (r, onSelect, id = r.id) => (
  <button className="model-link" onClick={() => onSelect(id)}>
    <span>
      {r.name}
      <small>{r.creator}</small>
    </span>
  </button>
);
// 厂商快捷筛选行：chip 与「排行榜厂商」下拉同源（creator 字段），再次点击取消；
// 计数口径与下拉一致（当前视图完整行池），0 命中置灰避免点出空表；但激活态永不置灰——
// 已选中的筛选必须始终可取消（切换源站后某厂商记录归零时该状态可达），禁用只针对未激活的空 chip。
// 只改变显示，不影响分数、名次与前沿成员。
export function CreatorChips({ chips, creator, onChange, className = "" }) {
  return (
    <div
      className={
        "creator-chips flex flex-wrap items-center gap-[7px] " + className
      }
      role="group"
      aria-label="厂商快捷筛选"
    >
      <span className="text-[10px] font-[650] tracking-[0.06em] text-[#7b958d]">
        厂商快捷筛选
      </span>
      {chips.map((chip) => {
        const active = creator === chip.value;
        const empty = chip.count === 0;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={active}
            disabled={empty && !active}
            title={
              `厂商 ${chip.value}` +
              (chip.note ? ` · ${chip.note}` : "") +
              " · 完整列表见「全部厂商」下拉" +
              (active || !empty
                ? "；再次点击取消筛选"
                : "；当前视图暂无该厂商配置")
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
            onClick={() => onChange(active ? undefined : chip.value)}
          >
            {chip.label}
            <small className="text-[9px] font-normal tabular-nums opacity-70">
              {chip.count}
            </small>
          </button>
        );
      })}
      <span className="text-[9px] text-[#9aabb5]">
        只改变显示 · 完整列表见厂商下拉
      </span>
    </div>
  );
}

export function Overview({
  models,
  analysis,
  data,
  costSource,
  onNavigate,
  onSelect,
  onQuickCompare,
  includeEstimated,
  onOpenHistory,
}) {
  const ranked = useMemo(
    () => rankedModels(analysis.rows).filter((r) => r.rank != null),
    [analysis.rows],
  );
  const open = rankedModels(ranked.filter((r) => r.openWeights === true));
  const coverage = useMemo(
    () => coverageSummary(models, { includeEstimated }),
    [models, includeEstimated],
  );
  const verdict = useMemo(() => {
    const scored = adjustedScores(analysis.rows);
    return {
      scored,
      cert: certifyNoBrainer(scored),
      hasInput: scored.rows.some((r) => Number.isFinite(r.adjusted)),
    };
  }, [analysis.rows]);
  // 编程优先视图（ADR-0022）：LiveBench 编程/长程代理/浏览器三轴均分百分位。
  // 视图切换不持久化——纯显示状态，与成本口径（跨会话语义）不同层级。
  const [valueView, setValueView] = useState("composite");
  const codingMap = useMemo(
    () => codingIndices(analysis.rows),
    [analysis.rows],
  );
  const ranking = useMemo(
    () => valueRanking(verdict.scored, { view: valueView, coding: codingMap }),
    [verdict, valueView, codingMap],
  );
  // 加冕条件与 ADR-0019 单条推荐期一致：认证通过（λ 全区间 argmax 唯一）或池中仅剩
  // 唯一候选。未认证时榜单照常展示但第 1 名不加冕（ADR-0020：排序是信息展示，加冕才需要认证）。
  const crowned = verdict.cert.certified || verdict.cert.poolSize === 1;
  const sweepRuns = useMemo(() => {
    // 连续同选档合并为区间。调整分对 λ 线性，上包络顶线更替随 λ 单调，
    // 同一模型不可能两次登顶，故 runs 按 pick 天然唯一。
    const runs = [];
    for (const s of verdict.cert.sweep) {
      const last = runs[runs.length - 1];
      if (last && last.pick === s.pick) last.to = s.lambda;
      else runs.push({ pick: s.pick, from: s.lambda, to: s.lambda });
    }
    return runs;
  }, [verdict]);
  const leaders = (items, label, icon) => (
    <section className="min-w-0 rounded-[13px] border border-line bg-surface p-[24px] shadow-card max-1180:p-[20px] max-760:p-[20px]">
      <div className="portal-section-heading">
        <div>
          <span className="text-[9px] font-[650] tracking-[0.16em] text-[#668c86] max-760:text-[8px]">
            {label === "综合能力领先"
              ? "OVERALL LEADERS"
              : "OPEN WEIGHT LEADERS"}
          </span>
          <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
            {icon}
            {label}
          </h2>
        </div>
        <Button
          type="text"
          onClick={() => onNavigate("rankings")}
          icon={<ArrowRightOutlined aria-hidden="true" />}
        >
          完整榜单
        </Button>
      </div>
      {items.length ? (
        items.slice(0, 5).map((r) => (
          <div className="leader-row" key={r.id}>
            <span className={"rank-badge " + (r.rank === 1 ? "first" : "")}>
              {r.rank}
            </span>
            {nameCell(r, onSelect)}
            <div className="leader-score">
              <b>{number(r.composite)}</b>
              <small>
                {r.available.length}/{analysis.sources.length} 榜
              </small>
            </div>
          </div>
        ))
      ) : (
        <Empty description="当前评分口径下没有候选模型" />
      )}
      <p className="mt-[16px] mb-0 text-[11px] leading-[1.9] text-[#627987] max-760:text-[10px]">
        {label === "综合能力领先"
          ? `按 Bradley-Terry 强度（Elo 尺度）排序，不要求成本已披露；主榜至少两榜准入且至少 ${analysis.requiredOpponents} 个有效对手，票数不足的对决不计入战绩。`
          : "在开放权重模型内排序；分数保持全球样本口径。"}{" "}
        并列分数无严格先后。
      </p>
    </section>
  );
  return (
    <div className="min-w-0">
      <section className="portal-hero">
        <div>
          <div className="text-[9px] font-[650] tracking-[0.16em] text-[#668c86] max-760:text-[8px]">
            FOUR SOURCES. ONE WORKSPACE.
          </div>
          <h2 className="mt-[14px] mb-[10px] text-[28px] font-semibold leading-[1.45] tracking-[-0.04em] text-[#203e3b] max-1180:text-[25px] max-760:text-[24px]">
            从榜单，到你的模型选择
          </h2>
          <p className="m-0 max-w-[600px] text-[13px] leading-[1.95] text-[#5f7c77] max-760:text-[12px]">
            先看能力排名，再核对任务表现、价格与配置。四个来源的证据并排呈现，每一个综合结论都能回到原始数据。
          </p>
          <div className="hero-actions">
            <Button
              type="primary"
              onClick={() => onNavigate("rankings")}
              icon={<TrophyOutlined aria-hidden="true" />}
            >
              探索融合排行榜
            </Button>
            <Button
              onClick={() => onQuickCompare(open.slice(0, 3).map((r) => r.id))}
              disabled={open.length < 2}
              icon={<SwapOutlined aria-hidden="true" />}
            >
              对比开放权重领先模型
            </Button>
          </div>
        </div>
        <div className="hero-source-stack">
          {SOURCE_IDS.map((s, i) => (
            <div
              key={s}
              className="flex items-center gap-[12px] rounded-[9px] border border-[#e1ebe7] bg-[#ffffffc9] px-[16px] py-[13px] max-760:p-[12px]"
            >
              <span className={"source-symbol " + (SOURCE_TONE[s] ?? "")}>
                {["AA", "V", "LB", "AR"][i]}
              </span>
              <div className="flex-1">
                <b className="block text-[12px] font-semibold">{NAMES[s]}</b>
                <small className="mt-[5px] block text-[10px] text-[#617b77]">
                  {data?.sources[s]?.metric}
                </small>
              </div>
              <Tag
                color={
                  data?.sources[s]?.stale
                    ? "orange"
                    : data?.sources[s]?.count
                      ? "green"
                      : "default"
                }
              >
                {data?.sources[s]?.stale
                  ? "历史缓存"
                  : data?.sources[s]?.count
                    ? "已同步"
                    : "待获取"}
              </Tag>
            </div>
          ))}
        </div>
      </section>
      <SourceQuality sources={data?.sources} />
      <QualityNote />
      <HistorySummary history={data?.history} onOpen={onOpenHistory} />
      <div className="mb-[20px] grid grid-cols-[1fr_1fr] gap-[20px] max-1180:gap-[16px] max-760:grid-cols-[minmax(0,1fr)]">
        {leaders(ranked, "综合能力领先", <TrophyOutlined aria-hidden="true" />)}
        {leaders(open, "开放权重领先", <UnlockOutlined aria-hidden="true" />)}
        {/* ADR-0020：整卡占满一行——完整榜单 + 未入池尾表比双列卡更长，并排会失衡 */}
        <section className="value-pick-card col-span-2 max-760:col-span-1 min-w-0 rounded-[13px] border border-line bg-surface p-[24px] shadow-card max-1180:p-[20px] max-760:p-[20px]">
          <div className="portal-section-heading">
            <div>
              <span className="text-[9px] font-[650] tracking-[0.16em] text-[#668c86] max-760:text-[8px]">
                PERFORMANCE × COST
              </span>
              <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
                性价比首选
              </h2>
            </div>
            <Segmented
              value={valueView}
              onChange={setValueView}
              aria-label="性价比排序口径"
              options={[
                { label: "综合性价比", value: "composite" },
                { label: "编程优先", value: "coding" },
              ]}
            />
          </div>
          {/* 调整分公式锚定综合相对成本指数（ADR-0019：costIndex 即 ADR-0003
              三站中位比几何平均）；单站成本口径下 r.cost 是原始美元价，
              log2(cost/100) 量纲错误，故仅综合口径出结论，其余口径如实说明。 */}
          {costSource !== "composite" ? (
            <Empty
              description={`调整分按综合相对成本指数（100=池中位）计算，「${COSTS[costSource]}」单站成本口径不适用。`}
            />
          ) : verdict.cert.poolSize > 0 ? (
            <>
              {valueView === "coding" ? (
                <p className="m-0 mb-[10px] text-[12px] leading-[1.9] text-[#627987] max-760:text-[11px]">
                  按编程实测排序：LiveBench「编程 / 长程代理 /
                  浏览器操作」三轴均分百分位，成本倍数并排展示；缺编程实测的模型排在末尾、以「—」标注。编程口径暂无市场斜率校准，不产出调整分——认证与「首选」仅在综合性价比排序。
                </p>
              ) : (
                <p className="m-0 mb-[10px] text-[12px] leading-[1.9] text-[#627987] max-760:text-[11px]">
                  性能与成本的综合权衡（帕累托式），不是纯能力榜：每贵一倍须明显更强才不亏；实测不全的模型按缺榜数扣分（每缺一榜扣
                  15 分，罚值经历史快照校准），覆盖见行内标注。
                </p>
              )}
              {valueView === "composite" &&
                (verdict.cert.poolSize === 1 ? (
                  <p className="m-0 mb-[12px] text-[12px] leading-[1.9] text-[#3d5a55] max-760:text-[11px]">
                    唯一通过四榜全量实测的候选，作为默认首选。
                  </p>
                ) : verdict.cert.certified ? (
                  <p className="m-0 mb-[12px] text-[12px] leading-[1.9] text-[#3d5a55] max-760:text-[11px]">
                    认证通过：「每贵一倍扣几分」从 0 调到
                    40，首选都是同一个——即通过筛选的候选中综合能力最强者，对各种预算观感都稳健。
                  </p>
                ) : (
                  <>
                    <p className="m-0 mb-[8px] text-[12px] leading-[1.9] text-[#8a6a1f] max-760:text-[11px]">
                      未认证：「每贵一倍扣几分」取值不同，首选就会不同——预算观感决定选择，不伪造单一答案；榜单第
                      1 名不加首选标记。
                    </p>
                    <div className="mb-[12px]">
                      {sweepRuns.map((run, i) => {
                        const row = verdict.scored.rows.find(
                          (r) => r.id === run.pick,
                        );
                        return (
                          <div
                            key={i}
                            className="flex items-center justify-between gap-[8px] text-[12px] leading-[1.9] max-760:text-[11px]"
                          >
                            <span className="text-[#627987]">
                              每贵一倍扣{" "}
                              {run.from === run.to
                                ? run.from
                                : `${run.from}–${run.to}`}{" "}
                              分
                            </span>
                            {row ? nameCell(row, onSelect) : <b>{run.pick}</b>}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ))}
              {ranking.ranked.map((r, i) => (
                <div className="leader-row" key={r.id}>
                  <span
                    className={
                      "rank-badge " +
                      (i === 0 && crowned && valueView === "composite"
                        ? "first"
                        : "")
                    }
                  >
                    {i + 1}
                  </span>
                  {nameCell(r, onSelect)}
                  {i === 0 && crowned && valueView === "composite" ? (
                    <span className="flex-shrink-0 rounded-full border border-[#cfe6df] bg-[#e2f3ec] px-[9px] py-[2px] text-[10px] font-[650] text-[#0c806e]">
                      首选
                    </span>
                  ) : null}
                  <div className="leader-score">
                    <b>
                      {valueView === "coding"
                        ? (codingMap.get(r.id)?.toFixed(0) ?? "—")
                        : (r.adjusted?.toFixed(0) ?? "—")}
                    </b>
                    <small>
                      综合分 {number(r.composite)} · 成本{" "}
                      {costFormat(r.cost, "composite")}
                      {r.covered < analysis.sources.length
                        ? ` · ${r.covered}/${analysis.sources.length} 榜`
                        : ""}
                    </small>
                  </div>
                </div>
              ))}
              {ranking.excludedCount > 0 ? (
                <p className="mt-[10px] mb-0 text-[11px] leading-[1.9] text-[#627987] max-760:text-[10px]">
                  其余 {ranking.excludedCount}{" "}
                  个模型实测不足两榜或综合成本不足两源，暂无法评估性价比；源站补齐实测后自动入榜。
                </p>
              ) : null}
              {valueView === "composite" ? (
                <p className="mt-[12px] mb-0 text-[11px] leading-[1.9] text-[#627987] max-760:text-[10px]">
                  调整分 = 综合分 − 10·log2(成本指数/100) −
                  15×缺榜数（缺榜罚分经历史快照校准）。
                </p>
              ) : null}
            </>
          ) : (
            <Empty
              description={
                verdict.hasInput
                  ? "无候选同时满足：四榜全部有有效实测分"
                  : "无模型同时具备综合分与综合成本，未产生调整分"
              }
            />
          )}
        </section>
      </div>
      <div className="mb-[20px] grid grid-cols-[1fr_1fr] gap-[20px] max-1180:gap-[16px] max-760:grid-cols-[minmax(0,1fr)]">
        <section className="min-w-0 rounded-[13px] border border-line bg-surface p-[24px] shadow-card max-1180:p-[20px] max-760:p-[20px]">
          <div className="portal-section-heading">
            <div>
              <span className="text-[9px] font-[650] tracking-[0.16em] text-[#668c86] max-760:text-[8px]">
                EVIDENCE COVERAGE
              </span>
              <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
                模型覆盖与证据
              </h2>
            </div>
            <Tag>覆盖不加分</Tag>
          </div>
          <div className="coverage-distribution">
            {[4, 3, 2, 1, 0].map((n) => (
              <div key={n}>
                <span className="text-[11px] text-[#627c87]">
                  {n} 榜有效分数
                </span>
                <b className="mt-[8px] mb-[5px] block text-[25px] font-semibold tabular-nums">
                  {coverage.groups[n]}
                  <small className="text-[10px] font-normal text-[#708790]">
                    {" "}
                    个模型族
                  </small>
                </b>
                <Progress
                  percent={
                    models.length
                      ? (coverage.groups[n] / models.length) * 100
                      : 0
                  }
                  showInfo={false}
                  strokeColor={
                    n === 4 ? "#0c806e" : n === 2 ? "#557daa" : "#a5b5c4"
                  }
                />
              </div>
            ))}
          </div>
          <p className="mt-[16px] mb-0 text-[11px] leading-[1.9] text-[#627987] max-760:text-[10px]">
            按当前质量排除与估算开关统计四站有效分数，与权重无关。仅一榜或无有效分数的模型仍可在模型库中检索。
          </p>
        </section>
        <section className="min-w-0 rounded-[13px] border border-line bg-surface p-[24px] shadow-card max-1180:p-[20px] max-760:p-[20px]">
          <div className="portal-section-heading">
            <div>
              <span className="text-[9px] font-[650] tracking-[0.16em] text-[#668c86] max-760:text-[8px]">
                EXPLORE WITH CONTEXT
              </span>
              <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
                换个视角看模型
              </h2>
            </div>
          </div>
          {[
            {
              tab: "compare",
              title: "模型对比",
              text: "并排核对原始分、能力侧重与真实价格",
              icon: <SwapOutlined />,
            },
            {
              tab: "explore",
              title: "成本与帕累托",
              text: "找到不同能力与预算下的不可支配选项",
              icon: <ArrowRightOutlined />,
            },
            {
              tab: "sources",
              title: "数据与采集状态",
              text: "查看成功获取时间、来源协议和错误记录",
              icon: <CheckCircleOutlined />,
            },
          ].map((x) => (
            <button
              className="path-link group"
              key={x.tab}
              onClick={() => onNavigate(x.tab)}
            >
              <span
                className="grid h-[35px] w-[35px] shrink-0 place-items-center rounded-[9px] bg-[#f0f6f5] text-[17px] text-[#397f72]"
                aria-hidden="true"
              >
                {x.icon}
              </span>
              <span className="flex-1">
                <b className="block text-[13px] font-[550] group-hover:text-green">
                  {x.title}
                </b>
                <small className="mt-[6px] block text-[11px] leading-[1.7] text-[#68808e]">
                  {x.text}
                </small>
              </span>
              <ArrowRightOutlined aria-hidden="true" />
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}

export function Rankings({
  models,
  analysis,
  controls,
  costSource,
  onSelect,
  selection,
  onSelectionChange,
  onExport,
  excludeStale,
  sources,
  ranking,
  onRanking,
  budget,
  exportMeta,
}) {
  const {
    view,
    query,
    creator,
    openness,
    scoredOnly,
    coverageMaskId,
    nativeEstimates,
    nativeHistorical,
    showSuites,
  } = ranking;
  const ranked = useMemo(() => rankedModels(analysis.rows), [analysis.rows]);
  // 证据深度：融合榜两两证据有多厚。纯展示衍生，随“允许估算”等质量开关实时变化，不参与任何评分。
  const depth = useMemo(
    () => evidenceDepth(analysis.rows, models.length),
    [analysis.rows, models.length],
  );
  const coverageCohorts = analysis.coverageCohorts ?? [];
  const selectedCoverage =
    (coverageMaskId
      ? coverageCohorts.find(({ id }) => id === coverageMaskId)
      : coverageCohorts[0]) ?? null;
  const coverageSelectionAvailable = coverageCohorts.some(
    ({ id }) => id === coverageMaskId,
  );
  const unavailableCoverageOption =
    coverageMaskId && !coverageSelectionAvailable
      ? [
          {
            value: coverageMaskId,
            label: `${coverageMaskId
              .split("+")
              .map((source) => (source === "aa" ? "AA" : NAMES[source]))
              .join(" + ")} · 当前无可比样本`,
            disabled: true,
          },
        ]
      : [];
  const coverageRanked = useMemo(
    () => rankedModels(selectedCoverage?.rows ?? []),
    [selectedCoverage],
  );
  const coverageDiagnosticRows = useMemo(() => {
    const currentRows = new Map(ranked.map((row) => [row.id, row]));
    return filterModels(coverageRanked, {
      query,
      creator,
      openness,
      scoredOnly,
    }).map((row) => {
      const current = currentRows.get(row.id);
      return {
        ...row,
        currentRank: current?.rank ?? null,
        currentComposite: current?.composite ?? null,
      };
    });
  }, [ranked, coverageRanked, query, creator, openness, scoredOnly]);
  const native = useMemo(
    () =>
      view === "fusion"
        ? []
        : nativeRanking(models, view, {
            includeEstimated: nativeEstimates,
            includeHistorical: nativeHistorical,
          }),
    [models, view, nativeEstimates, nativeHistorical],
  );
  const pool = view === "fusion" ? ranked : native;
  // chip 计数与厂商下拉同口径：当前视图完整行池，不被搜索 / 开放状态提前裁剪。
  const chips = useMemo(() => vendorChipCounts(pool), [pool]);
  // 预算筛选只作用于融合总榜：单榜视图保留源站全部配置作原始证据，不参与预算截断。
  const budgeted = useMemo(
    () => (view === "fusion" ? applyBudget(pool, budget) : pool),
    [pool, budget, view],
  );
  const budgetNote = useMemo(
    () => (view === "fusion" ? budgetSummary(pool, budget) : null),
    [pool, budget, view],
  );
  // 预算来源被质量排除时该源不产生任何代表配置，整表隐藏；必须点破原因，避免被误读为预算设低了。
  // 前置条件是「排除过期 / 失败缓存」开关开启：开关关闭时超期来源的代表配置保留，预算照常按真实成本过滤。
  const budgetExcluded =
    view === "fusion" &&
    excludeStale &&
    budget?.budgetSource &&
    budget.budgetSource !== "none" &&
    sourceHealth(sources?.[budget.budgetSource]).excluded;
  const filtered = filterModels(budgeted, {
    query,
    creator,
    openness,
    scoredOnly: view === "fusion" && scoredOnly,
  });
  const suiteKeys = useMemo(
    () => (view === "fusion" && showSuites ? livebenchSuiteKeys(models) : []),
    [models, showSuites, view],
  );
  const suiteColumns = suiteKeys.map((key) => ({
    title: (
      <Tooltip
        title={`LiveBench「${SUITES[key] ?? key}」分类原始分（0–100）。仅 LiveBench 提供能力维度；AA、Vals 无对应数据，缺失保持空白。排序只改变显示顺序，不改变 PK 主积分与名次。`}
      >
        <span className="inline-flex items-baseline gap-[5px]">
          {SUITES[key] ?? key}
          <small className="text-[8px] font-medium text-[#8aa0b4]">LB</small>
        </span>
      </Tooltip>
    ),
    key: "suite-" + key,
    width: 92,
    sorter: (a, b) =>
      (a.representatives.livebench?.suites?.[key] ?? -Infinity) -
      (b.representatives.livebench?.suites?.[key] ?? -Infinity),
    render: (_, r) => {
      const v = r.representatives.livebench?.suites?.[key];
      return Number.isFinite(v) ? (
        <span className="number">{v.toFixed(1)}</span>
      ) : (
        <span className="text-[10px] leading-[1.85] text-[#6b818f]">—</span>
      );
    },
  }));
  const coverageColumns = [
    {
      title: "模型",
      width: 220,
      render: (_, row) => nameCell(row, onSelect),
    },
    {
      title: "主榜名次",
      dataIndex: "currentRank",
      width: 105,
      render: (rank) => (rank == null ? "未排名" : rank),
    },
    {
      title: "主榜 PK 积分",
      dataIndex: "currentComposite",
      width: 120,
      render: scoreCell,
    },
    {
      title: "对照名次",
      dataIndex: "rank",
      width: 130,
      render: (rank) => (rank == null ? "未排名" : rank),
    },
    {
      title: "对照 PK 积分",
      dataIndex: "composite",
      width: 130,
      render: scoreCell,
    },
    {
      title: "本组对手数",
      width: 120,
      render: (_, row) => row.record?.opponents ?? "—",
    },
  ];
  const sourceColumns = SOURCE_IDS.map((s) => ({
    title: (
      <Tooltip
        title={
          s === "livebench"
            ? "LiveBench 分类分数的等权均分；源站 Overall 可能采用不同权重。"
            : "源站原始总分；不同榜单量纲不同，不直接相加"
        }
      >
        {NAMES[s]}
      </Tooltip>
    ),
    key: s,
    width: 145,
    sorter: (a, b) =>
      (a.representatives[s]?.score ?? -Infinity) -
      (b.representatives[s]?.score ?? -Infinity),
    render: (_, r) => {
      const raw = r.representatives[s];
      return (
        <div className="source-score">
          <b>{number(raw?.score)}</b>
          <small>
            {raw?.estimated ? "估算 · " : ""}
            {r.percentiles[s] != null
              ? `${"样本内位置（不计主积分）"} ${number(r.percentiles[s])}`
              : "未参与当前评分"}
          </small>
        </div>
      );
    },
  }));
  const columns =
    view === "fusion"
      ? [
          {
            title: "综合名次",
            dataIndex: "rank",
            width: 80,
            fixed: "left",
            render: (v) =>
              v == null ? (
                "未排名"
              ) : (
                <span className={"rank-badge " + (v === 1 ? "first" : "")}>
                  {v}
                </span>
              ),
          },
          {
            title: "模型",
            width: 220,
            fixed: "left",
            render: (_, r) => nameCell(r, onSelect),
          },
          { title: "开放状态", width: 130, render: (_, r) => stateTag(r) },
          {
            title: (
              <Tooltip title="Bradley-Terry 强度，Elo 尺度：中位模型 1000，400 分差约等于 10∶1 预测胜率。它是相对强度，不是实测胜率或能力百分比。">
                <span className="cursor-help underline decoration-dotted">
                  PK 主积分
                </span>
              </Tooltip>
            ),
            dataIndex: "composite",
            width: 115,
            sorter: (a, b, sortOrder) =>
              compareComposite(a, b, sortOrder) ||
              compareAuxiliary(a, b, sortOrder),
            render: (value, row) => (
              <div>
                {value == null &&
                row.rankEligible === false &&
                row.record?.opponents > 0 ? (
                  <Tooltip title={row.reason}>
                    <span className="block max-w-[90px] text-[10px] leading-[1.85] text-[#6b818f]">
                      证据不足
                    </span>
                  </Tooltip>
                ) : (
                  scoreCell(value)
                )}
                {row.record?.opponents > 0 && (
                  <small className="block text-[10px] text-[#627987]">
                    {row.record.wins} 胜 / {row.record.draws} 平 /{" "}
                    {row.record.losses} 负 ·{" "}
                    <Tooltip
                      title={
                        <div>
                          <div>
                            对局覆盖按双方都存在有效分的评分榜数量统计：
                          </div>
                          {[2, 3, 4].map((count) => (
                            <div key={count}>
                              双方共有 {count} 个有效评分榜：
                              {row.record.opponentsBySharedSources?.[count] ??
                                0}
                              场
                            </div>
                          ))}
                          <div>
                            这里只说明对局样本；BT 按对手强度给每场对局加权。
                          </div>
                        </div>
                      }
                    >
                      <span className="cursor-help underline decoration-dotted">
                        {row.record.opponents} 个对手
                      </span>
                    </Tooltip>
                  </small>
                )}
              </div>
            ),
          },
          ...[
            {
              title: (
                <Tooltip title="各有效评分来源在当前样本内的排名百分位等权平均。它来自与 PK 主积分相同的来源数据，只在 PK 同分时排序；不作为第五票，不与 PK 主积分合并，也不参与帕累托判断。">
                  榜单位次均值
                </Tooltip>
              ),
              dataIndex: "auxiliary",
              width: 135,
              render: number,
            },
          ],
          ...sourceColumns,
          ...suiteColumns,
          {
            title: "评分覆盖",
            width: 110,
            render: (_, r) => (
              <Tooltip
                title={
                  r.available.map((s) => NAMES[s]).join(" / ") ||
                  "没有有效评分来源"
                }
              >
                <Tag color={r.complete ? "green" : "default"}>
                  {r.available.length}/{analysis.sources.length} 榜
                  {r.complete ? "" : " · 部分"}
                </Tag>
              </Tooltip>
            ),
          },
          {
            title: COSTS[costSource],
            width: 170,
            render: (_, r) => costFormat(r.cost, costSource),
          },
        ]
      : [
          {
            title: "源站名次",
            dataIndex: "rank",
            width: 80,
            fixed: "left",
            render: (v) => v ?? "未排名",
          },
          {
            title: "模型配置",
            width: 300,
            fixed: "left",
            render: (_, r) => (
              <div>
                {nameCell({ ...r, name: r.configuration }, onSelect, r.modelId)}
                {r.estimated && <Tag color="orange">估算</Tag>}
                {r.deprecated && <Tag>历史</Tag>}
              </div>
            ),
          },
          { title: "开放状态", width: 130, render: (_, r) => stateTag(r) },
          {
            title: view === "livebench" ? "分类等权均分" : "原始总分",
            dataIndex: "score",
            width: 120,
            sorter: (a, b) => (a.score ?? -Infinity) - (b.score ?? -Infinity),
            render: (value, row) => (
              <div>
                {number(value)}
                {view === "arena" && <ArenaEvidence record={row} />}
              </div>
            ),
          },
          {
            title: "任务成本 USD",
            dataIndex: "costTask",
            width: 150,
            render: money,
          },
          {
            title:
              view === "vals"
                ? "输入 / 输出参考单价 USD 每百万 token"
                : "输入 / 输出 USD 每百万 token",
            width: 240,
            render: (_, r) =>
              view === "vals" && r.priceUrl ? (
                <span>
                  {money(r.priceInput)} / {money(r.priceOutput)}{" "}
                  <a href={r.priceUrl} target="_blank" rel="noreferrer">
                    来源
                  </a>
                </span>
              ) : (
                `${money(r.priceInput)} / ${money(r.priceOutput)}`
              ),
          },
          {
            title: "源站",
            width: 90,
            render: (_, r) => (
              <a href={r.url} target="_blank" rel="noreferrer">
                查看 <ExportOutlined aria-hidden="true" />
              </a>
            ),
          },
        ];
  return (
    <div className="min-w-0">
      <section className="ranking-intro rounded-[13px] border border-line bg-surface shadow-card">
        <div className="portal-section-heading">
          <div>
            <span className="text-[9px] font-[650] tracking-[0.16em] text-[#668c86] max-760:text-[8px]">
              BENCHMARK EXPLORER
            </span>
            <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
              融合排行榜与完整模型库
            </h2>
            <p className="mt-[6px] mb-0 text-[12px] leading-[1.9] text-[#657d8b] max-760:text-[11px]">
              综合能力不以成本披露为门槛。单榜视图保留每条源配置，便于回到原始证据。
            </p>
          </div>
          <Button
            icon={<DownloadOutlined aria-hidden="true" />}
            onClick={() =>
              onExport(
                view === "fusion"
                  ? csvExport(filtered, exportMeta)
                  : nativeCsvExport(filtered, {
                      fetchedAt: sources?.[view]?.fetchedAt,
                      sourceDate: sources?.[view]?.sourceDate,
                    }),
                view === "fusion" ? "model-ranking.csv" : `${view}-ranking.csv`,
              )
            }
          >
            导出当前榜单
          </Button>
        </div>
        <Segmented
          block
          aria-label="排行榜来源"
          value={view}
          onChange={(v) => onRanking({ view: v, creator: undefined })}
          options={[
            { value: "fusion", label: "融合总榜" },
            ...SOURCE_IDS.map((value) => ({ value, label: NAMES[value] })),
          ]}
        />
        <SourceQuality compact sources={sources} />
        <QualityNote />
        {view === "fusion" && (
          <p className="evidence-depth mt-[10px] mb-0 text-[11px] leading-[1.9] text-[#657d8b]">
            <span className="font-[650] tracking-[0.1em] text-[#668c86]">
              证据深度
            </span>
            {" · "}
            {depth.rankedCount === 0 ? (
              <>
                当前没有模型进入融合排名（需至少两榜共同有效且至少{" "}
                {analysis.requiredOpponents} 个有效对手）。
              </>
            ) : (
              <>
                <span className="font-semibold text-[#365d58]">
                  {depth.rankedCount}
                </span>
                {` / ${depth.totalModels} 个模型进入融合排名（${Math.round(
                  depth.rankedShare * 100,
                )}%，需至少 ${analysis.requiredOpponents} 个有效对手）；对决 `}
                <span className="font-semibold text-[#365d58]">
                  {Math.round(depth.twoBoardPct)}%
                </span>
                {" 仅由 2 榜裁决、"}
                <span className="font-semibold text-[#365d58]">
                  {Math.round(depth.richBoardPct)}%
                </span>
                {
                  " 达 3 榜以上。切换「允许估算」会同时改变样本与单场票数；名次请结合战绩与实际对手数阅读。"
                }
              </>
            )}
          </p>
        )}
      </section>
      <div
        className={
          "mb-[22px] grid items-start gap-[19px] max-1180:gap-[16px] max-760:flex max-760:flex-col max-760:gap-[16px] " +
          (view !== "fusion"
            ? "grid-cols-[minmax(0,1fr)]"
            : "grid-cols-[235px_minmax(0,1fr)] max-1180:grid-cols-[215px_minmax(0,1fr)]")
        }
      >
        {view === "fusion" && controls}
        <section className="ranking-table rounded-[13px] border border-line bg-surface shadow-card">
          <CreatorChips
            chips={chips}
            creator={creator}
            onChange={(value) => onRanking({ creator: value })}
            className="px-[21px] pt-[20px] pb-[10px] max-760:px-[15px]"
          />
          <div className="ranking-filters flex flex-wrap items-center gap-[10px] px-[21px] pt-[10px] pb-[12px] max-760:gap-[9px] max-760:px-[15px] max-760:pt-[13px]">
            <Input
              aria-label="排行榜搜索"
              prefix={<SearchOutlined aria-hidden="true" />}
              value={query}
              onChange={(e) => onRanking({ query: e.target.value })}
              placeholder="搜索模型、配置或厂商"
              allowClear
            />
            <Select
              virtual={false}
              aria-label="排行榜开放状态"
              value={openness}
              onChange={(v) => onRanking({ openness: v })}
              options={[
                { value: "all", label: "全部开放状态" },
                { value: "open", label: "开放权重" },
                { value: "closed", label: "闭源" },
                { value: "unknown", label: "未确认" },
              ]}
            />
            <Select
              virtual={false}
              aria-label="排行榜厂商"
              allowClear
              placeholder="全部厂商"
              value={creator}
              onChange={(v) => onRanking({ creator: v })}
              options={[...new Set(pool.map((r) => r.creator).filter(Boolean))]
                .sort()
                .map((value) => ({ value, label: value }))}
            />
            {view === "fusion" ? (
              <>
                <Checkbox
                  checked={scoredOnly}
                  onChange={(e) => onRanking({ scoredOnly: e.target.checked })}
                >
                  仅看有效 PK 主积分
                </Checkbox>
                <Checkbox
                  checked={showSuites}
                  onChange={(e) => onRanking({ showSuites: e.target.checked })}
                >
                  LiveBench 能力维度
                </Checkbox>
              </>
            ) : (
              <>
                <Checkbox
                  checked={nativeEstimates}
                  onChange={(e) =>
                    onRanking({ nativeEstimates: e.target.checked })
                  }
                >
                  包含估算配置
                </Checkbox>
                <Checkbox
                  checked={nativeHistorical}
                  onChange={(e) =>
                    onRanking({ nativeHistorical: e.target.checked })
                  }
                >
                  包含历史配置
                </Checkbox>
              </>
            )}
          </div>
          <div className="flex flex-wrap justify-between gap-[8px] px-[21px] pb-[16px] text-[10px] leading-[1.8] text-[#627b89] max-760:px-[15px] max-760:pb-[14px]">
            <span>
              {filtered.length} 条{view === "fusion" ? "模型族" : "源配置"} ·
              名次基于筛选前的{view === "fusion" ? "综合评分" : "单榜样本"}
              ，筛选不重算
            </span>
            {budgetNote && view === "fusion" && (
              <span className="budget-note">
                预算筛选隐藏 {budgetNote.hidden} 个模型族（{budgetNote.missing}{" "}
                个未披露或不可核对该来源成本）
                {budgetExcluded
                  ? "；该来源当前被质量排除，暂无可核对的真实成本"
                  : ""}
              </span>
            )}
            {view === "fusion" && <span>勾选 2–4 个模型加入对比</span>}
          </div>
          {view === "fusion" && (
            <Alert
              className="ranking-alert"
              type="info"
              showIcon
              title={`单一全局榜：至少两榜参赛，每对共同有效榜单不足两个不比赛；主榜还要求至少 ${analysis.requiredOpponents} 个有效对手。BT 按对手强度校正赛程；不同模型的对手集合仍可能不同，请结合战绩与对手数阅读。`}
            />
          )}
          {view === "fusion" && !analysis.btConnected && (
            <Alert
              className="ranking-alert"
              type="warning"
              showIcon
              title={`对局图分为 ${analysis.btComponents} 个互不相连的组，无法给出单一全局 BT 排名。请检查来源覆盖或质量排除设置；这里不回退到旧公式。`}
            />
          )}
          {view === "fusion" && (
            <details className="coverage-cohort-diagnostic mx-[21px] my-[14px] rounded-[10px] border border-[#dce9e5] bg-[#f8fbfa] px-[14px] py-[11px] max-760:mx-[15px]">
              <summary className="cursor-pointer text-[12px] font-medium leading-[1.8] text-[#365d58]">
                同一组榜单下重算 · {selectedCoverage?.count ?? 0} 个模型
              </summary>
              <div className="pt-[10px]">
                <div className="mb-[10px] flex flex-wrap items-center gap-[8px]">
                  <label
                    htmlFor="coverage-mask-select"
                    className="text-[11px] text-[#627987]"
                  >
                    参与重算的榜单
                  </label>
                  <Select
                    id="coverage-mask-select"
                    aria-label="同一组榜单对照"
                    virtual={false}
                    className="w-full max-w-[420px]"
                    disabled={coverageCohorts.length === 0}
                    value={coverageMaskId || selectedCoverage?.id}
                    onChange={(value) => onRanking({ coverageMaskId: value })}
                    options={[
                      ...unavailableCoverageOption,
                      ...coverageCohorts.map(({ id, sources, count }) => ({
                        value: id,
                        label: `${sources
                          .map((source) =>
                            source === "aa" ? "AA" : NAMES[source],
                          )
                          .join(" + ")} · ${count} 个模型`,
                      })),
                    ]}
                  />
                </div>
                <p className="mb-[10px] text-[11px] leading-[1.85] text-[#627987]">
                  只纳入所选榜单都有有效分的模型，并只用这些榜单在这组模型中重算
                  BT。榜单和对手范围都可能与主榜不同；各对照组的 Elo
                  以该组中位模型为
                  1000，积分只在该组内比较，不能与主榜数值直接相减。本表是诊断层，不套用主榜的{" "}
                  {analysis.requiredOpponents}{" "}
                  个有效对手门槛；组内对手数见列。本表用于观察比较范围变化时排名是否稳定，不能单独说明某个来源的影响，也不代表能力百分比。主榜不变；搜索和筛选只隐藏行，不参与重算。
                </p>
                {!selectedCoverage ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      coverageMaskId
                        ? "分享链接指定的榜单组合当前无法比较；请选择当前可用组合"
                        : "当前没有至少两个模型拥有相同的两榜以上有效数据，无法计算对照"
                    }
                  />
                ) : (
                  <Table
                    className="coverage-cohort-table"
                    rowKey="id"
                    columns={coverageColumns}
                    dataSource={coverageDiagnosticRows}
                    size="small"
                    scroll={{ x: 825 }}
                    pagination={{
                      defaultPageSize: 10,
                      showSizeChanger: true,
                      pageSizeOptions: [10, 20, 50],
                      showTotal: (count) => `${count} 个模型`,
                    }}
                  />
                )}
              </div>
            </details>
          )}
          {view !== "fusion" && (
            <p className="mt-[8px] mb-0 px-[21px] pt-0 pb-[18px] text-[11px] leading-[1.9] text-[#627987] max-760:text-[10px]">
              {NAMES[view]}{" "}
              {view === "arena"
                ? "文本总榜原始偏好评分；票数、区间与发布日期直接来自源站，不是融合置信度。该来源不提供任务成本。"
                : view === "livebench"
                  ? "分类分数的等权均分与原生任务成本；源站 Overall 可能采用不同权重。"
                  : "的原始总分与原生任务成本。不同任务协议和推理配置不能视为统一实验。"}
            </p>
          )}
          <Table
            className="ranking-main-table"
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            size="middle"
            scroll={{
              x: view === "fusion" ? (suiteKeys.length ? 2180 : 1520) : 1120,
            }}
            rowSelection={
              view === "fusion"
                ? {
                    hideSelectAll: true,
                    selectedRowKeys: selection,
                    preserveSelectedRowKeys: true,
                    onChange: onSelectionChange,
                    getCheckboxProps: (r) => ({
                      disabled:
                        selection.length >= 4 && !selection.includes(r.id),
                    }),
                  }
                : undefined
            }
            pagination={{
              defaultPageSize: 20,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100],
              showTotal: (n) => `${n} 条记录`,
            }}
          />
          <p className="mt-[8px] mb-0 px-[21px] pt-0 pb-[18px] text-[11px] leading-[1.9] text-[#627987] max-760:text-[10px]">
            {view === "fusion"
              ? `PK 主积分来自四榜多数对决的 Bradley-Terry 强度（平局半胜，Gamma(2,1) 弱先验），以 Elo 尺度展示：中位模型 1000，400 分差约等于 10∶1 预测胜率。它是相对强度，不是实测胜率或能力百分比；主榜只给至少 ${analysis.requiredOpponents} 个有效对手的模型名次，低样本模型保留原始战绩但不参与主榜与前沿；对局图不连通时不给出全局名次。榜单位次均值由同一批来源的排名百分位等权平均，只在 PK 同分时排序。现行 Copeland 胜率与名次作为诊断保留在模型对比和 CSV 中，不进入主榜、前沿或分享参数。`
              : view === "livebench"
                ? "名次按当前纳入配置的分类等权均分计算，并列同名次；与源站 Overall 排名可能不同。"
                : "源站名次由当前纳入配置按原始总分计算，并列同名次；不复刻源站的置信区间排名。"}
          </p>
        </section>
      </div>
    </div>
  );
}

const SUITES = {
  design_layout: "设计与布局",
  research: "研究",
  browser: "浏览器任务",
  coding: "编程",
  long_horizon: "长程任务",
  data_analysis: "数据分析",
  reasoning: "推理",
};
export function Comparison({
  models,
  analysis,
  selection,
  onSelectionChange,
  onSelect,
  costSource,
  onNavigate,
  sources,
}) {
  const selected = useMemo(
    () =>
      selection
        .map((id) => analysis.rows.find((r) => r.id === id))
        .filter(Boolean),
    [selection, analysis.rows],
  );
  const matches = selected.flatMap((left, i) =>
    selected.slice(i + 1).map((right) => ({
      id: `${left.id}:${right.id}`,
      left,
      right,
      ...majorityMatch(left, right, {
        includeEstimated: analysis.includeEstimated,
      }),
    })),
  );
  const columns = [
    { title: "指标 / 来源", dataIndex: "label", fixed: "left", width: 185 },
    ...selected.map((r) => ({
      title: (
        <button className="model-link" onClick={() => onSelect(r.id)}>
          {r.name}
        </button>
      ),
      key: r.id,
      width: 235,
      render: (_, metric) => metric.values[r.id],
    })),
  ];
  const metric = (key, label, get) => ({
    key,
    label,
    values: Object.fromEntries(selected.map((r) => [r.id, get(r)])),
  });
  const facts = [
    metric("creator", "厂商", (r) => r.creator),
    metric("openness", "开放状态", stateTag),
    metric("composite", "PK 主积分（BT / Elo）", (r) => number(r.composite)),
    metric("theta", "BT 强度 θ", (r) =>
      r.theta == null ? "未排名" : r.theta.toFixed(4),
    ),
    ...[
      metric("record", "PK 战绩（胜 / 平 / 负）", (r) =>
        r.record?.opponents > 0
          ? `${r.record.wins} / ${r.record.draws} / ${r.record.losses}（${r.record.opponents} 个对手）${r.composite == null ? " · 未获主榜名次" : ""}`
          : "未参加正式排名",
      ),
    ],
    ...[
      metric("auxiliary", "榜单位次均值（仅 PK 同分排序）", (r) =>
        number(r.auxiliary),
      ),
    ],
    metric(
      "coverage",
      "有效榜单覆盖",
      (r) =>
        `${r.available.length}/${analysis.sources.length} 榜${r.complete ? "" : " · 部分覆盖"}`,
    ),
    metric("cost", COSTS[costSource], (r) => costFormat(r.cost, costSource)),
    ...SOURCE_IDS.flatMap((s) => [
      metric(
        s + "score",
        `${NAMES[s]} · ${s === "livebench" ? "分类等权均分" : "原始分"}`,
        (r) => number(r.representatives[s]?.score),
      ),
      metric(s + "percentile", `${NAMES[s]} · 排名分`, (r) =>
        r.percentiles[s] == null ? "未参与评分" : number(r.percentiles[s]),
      ),
      metric(s + "cost", `${NAMES[s]} · USD/任务`, (r) =>
        money(r.representatives[s]?.costTask),
      ),
      metric(s + "config", `${NAMES[s]} · 配置`, (r) => (
        <span className="text-[11px] leading-[1.8] text-[#5e7783] [overflow-wrap:anywhere]">
          {r.representatives[s]?.configuration ?? "未覆盖"}
          {r.representatives[s]?.estimated && <Tag color="orange">估算</Tag>}
          {r.representatives[s]?.deprecated && <Tag>历史</Tag>}
        </span>
      )),
    ]),
    metric(
      "arena-votes",
      "Arena · 投票数",
      (r) => r.representatives.arena?.voteCount ?? "未披露",
    ),
    metric("arena-interval", "Arena · 源站评分区间", (r) => {
      const a = r.representatives.arena;
      return a ? `${number(a.scoreLower)} – ${number(a.scoreUpper)}` : "未披露";
    }),
    metric(
      "arena-date",
      "Arena · 榜单发布日期",
      (r) => r.representatives.arena?.publishedAt ?? "未披露",
    ),
    metric("input", "AA · 输入 USD/百万 token", (r) =>
      money(r.representatives.aa?.priceInput),
    ),
    metric("output", "AA · 输出 USD/百万 token", (r) =>
      money(r.representatives.aa?.priceOutput),
    ),
    metric("speed", "AA · 输出速度 token/s", (r) =>
      number(r.representatives.aa?.speed),
    ),
    metric("latency", "AA · 首 token 延迟秒", (r) =>
      number(r.representatives.aa?.latency),
    ),
  ];
  const suites = [
    ...new Set(
      selected.flatMap((r) =>
        Object.keys(r.representatives.livebench?.suites ?? {}),
      ),
    ),
  ];
  return (
    <div className="min-w-0">
      <section className="compare-selector rounded-[13px] border border-line bg-surface shadow-card">
        <div className="portal-section-heading">
          <div>
            <span className="text-[9px] font-[650] tracking-[0.16em] text-[#668c86] max-760:text-[8px]">
              SIDE BY SIDE
            </span>
            <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
              模型对比
            </h2>
            <p className="mt-[6px] mb-0 text-[12px] leading-[1.9] text-[#657d8b] max-760:text-[11px]">
              保留各站的独立任务与计价口径；最多选择 4
              个模型，选择会保存在本机。
            </p>
          </div>
          <Button
            onClick={() => onSelectionChange([])}
            disabled={!selection.length}
          >
            清空对比
          </Button>
        </div>
        <Select
          mode="multiple"
          maxCount={4}
          showSearch
          optionFilterProp="label"
          virtual={false}
          aria-label="选择对比模型"
          placeholder="搜索并选择 2–4 个模型"
          value={selection}
          onChange={onSelectionChange}
          options={models.map((m) => ({
            value: m.id,
            label: `${m.name} · ${m.creator}`,
          }))}
        />
      </section>
      {selected.length < 2 ? (
        <section className="mb-[20px] rounded-[13px] border border-line bg-surface px-[20px] py-[65px] shadow-card">
          <Empty
            description={
              selected.length
                ? "再选择一个模型开始对比"
                : "从排行榜勾选模型，或在上方搜索添加"
            }
          >
            <Button type="primary" onClick={() => onNavigate("rankings")}>
              去排行榜选模型
            </Button>
          </Empty>
        </section>
      ) : (
        <>
          <section className="mb-[20px] rounded-[13px] border border-line bg-surface px-[25px] py-[23px] shadow-card max-760:px-[16px] max-760:py-[20px]">
            <div className="portal-section-heading">
              <div>
                <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
                  配置一致性与数据提示
                </h2>
                <p className="mt-[6px] mb-0 text-[12px] leading-[1.9] text-[#657d8b] max-760:text-[11px]">
                  先核对每个模型在不同源站的配置，再阅读综合结果。已排除的来源不参与下方评分与成本计算，原始配置仍可在详情与单榜中查看。
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-[15px] max-1000:grid-cols-1">
              {selected.map((r) => (
                <div key={r.id}>
                  <ConfigurationDetails model={r} />
                  <EvidenceBadges model={r} sources={sources} />
                </div>
              ))}
            </div>
            <SourceQuality sources={sources} />
            <QualityNote />
          </section>
          <section className="mb-[20px] rounded-[13px] border border-line bg-surface p-[25px] shadow-card max-760:px-[16px] max-760:py-[20px]">
            <div className="portal-section-heading">
              <div>
                <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
                  各榜相对位置
                </h2>
                <p className="mt-[6px] mb-0 text-[12px] leading-[1.9] text-[#657d8b] max-760:text-[11px]">
                  0–100 为当前评分样本内的相对位置，越高越靠前。各榜位次均值只在
                  PK 主积分相同时排序；缺分或未启用的榜单不画条形。
                </p>
              </div>
              <Tag>同一综合评分样本</Tag>
            </div>
            <CompareChart rows={selected} />
            <p className="mt-[16px] mb-0 text-[11px] leading-[1.9] text-[#627987] max-760:text-[10px]">
              原始分量纲不同，因此图中只比较各榜相对位置；下表完整保留原始分。PK
              主积分使用逐榜多数胜负拟合的 Bradley-Terry 强度；各榜位次均值只在
              PK
              同分时辅助排序，两者不再次合并。不足当前覆盖门槛的模型不参加正式排名。
            </p>
          </section>
          {
            <section className="majority-comparison mb-[20px] rounded-[13px] border border-line bg-surface p-[20px] shadow-card">
              <h2 className="text-[17px]">两两 PK 结果与同榜原始分差</h2>
              <p className="text-[11px] leading-[1.9] text-[#627987]">
                每榜各一票。下表每行以左侧模型为参照，列出共同有效榜数；分差只在同一榜内计算，不跨榜相加，也不混入
                PK 主积分。共同有效榜单不足 {analysis.required} 个不判胜负。
              </p>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ x: 1000 }}
                dataSource={matches}
                columns={[
                  {
                    title: "对阵（左 / 右）",
                    width: 200,
                    render: (_, r) => `${r.left.name} / ${r.right.name}`,
                  },
                  {
                    title: "共同有效榜",
                    width: 120,
                    render: (_, r) =>
                      `${r.sharedSources}/${analysis.sources.length} 榜 · ${r.complete ? "计入 PK" : "不计 PK"}`,
                  },
                  ...SOURCE_IDS.map((source) => ({
                    title: NAMES[source],
                    width: 200,
                    render: (_, r) => {
                      const ballot = r.ballots.find((b) => b.source === source);
                      return (
                        <span>
                          {number(r.left.representatives[source]?.score)} /{" "}
                          {number(r.right.representatives[source]?.score)}
                          <br />
                          {ballot.vote === null
                            ? "未计票"
                            : `差 ${ballot.difference > 0 ? "+" : ""}${number(ballot.difference)} · ${ballot.vote > 0 ? "左胜" : ballot.vote < 0 ? "右胜" : "平票"}`}
                        </span>
                      );
                    },
                  })),
                  {
                    title: "PK 票数与结果",
                    width: 180,
                    render: (_, r) =>
                      !r.complete
                        ? "共同有效榜单不足，不判胜负"
                        : `${r.leftWins}∶${r.rightWins}（${r.tied} 平票）· ${r.result > 0 ? "左方获胜" : r.result < 0 ? "右方获胜" : "对决平局"}`,
                  },
                ]}
              />
            </section>
          }
          <section className="method-comparison mb-[20px] rounded-[13px] border border-line bg-surface p-[20px] shadow-card">
            <h2 className="text-[17px]">方法对照：BT 与现行 Copeland 胜率</h2>
            <p className="text-[11px] leading-[1.9] text-[#627987]">
              两列来自同一批对局。BT 按对手强度估计单一全局相对强度，主榜只使用
              BT；Copeland
              是原始胜率的诊断值。两者分歧不代表谁对：低覆盖或对手集合不同的模型，差异通常更大。主榜名次只给至少{" "}
              {analysis.requiredOpponents}{" "}
              个有效对手的模型；低样本模型显示“未排名”，但仍展示原始胜率与对手数。名次差
              = Copeland 名次 − BT 名次。
            </p>
            {!analysis.btConnected && (
              <Alert
                type="warning"
                showIcon
                title="对局图不连通，BT 全局名次不可用；下表只保留原始胜率诊断。"
              />
            )}
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ x: 820 }}
              dataSource={selected}
              columns={[
                { title: "模型", width: 180, render: (_, r) => r.name },
                {
                  title: "BT 名次",
                  dataIndex: "btRank",
                  width: 90,
                  render: (v) => v ?? "未排名",
                },
                {
                  title: "PK 主积分（Elo）",
                  width: 145,
                  render: (_, r) =>
                    r.composite == null ? "未排名" : number(r.composite),
                },
                {
                  title: "现行 Copeland 名次",
                  dataIndex: "copelandRank",
                  width: 155,
                  render: (v) => v ?? "未排名",
                },
                {
                  title: "现行 Copeland 胜率",
                  width: 155,
                  render: (_, r) =>
                    r.winRate == null ? "未排名" : number(r.winRate),
                },
                {
                  title: "名次差",
                  width: 90,
                  render: (_, r) =>
                    r.copelandRank != null && r.btRank != null
                      ? r.copelandRank - r.btRank
                      : "—",
                },
                {
                  title: "对手数",
                  width: 90,
                  render: (_, r) => r.record?.opponents ?? "—",
                },
                {
                  title: "有效榜覆盖",
                  width: 110,
                  render: (_, r) =>
                    `${r.available.length}/${analysis.sources.length}`,
                },
              ]}
            />
          </section>
          <section className="compare-facts rounded-[13px] border border-line bg-surface shadow-card">
            <div className="portal-section-heading">
              <div>
                <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
                  能力、成本与配置明细
                </h2>
                <p className="mt-[6px] mb-0 text-[12px] leading-[1.9] text-[#657d8b] max-760:text-[11px]">
                  不同源的美元任务成本分别展示；不相加，也不折算成统一生产账单。
                </p>
              </div>
            </div>
            <Table
              rowKey="key"
              columns={columns}
              dataSource={facts}
              pagination={false}
              size="middle"
              scroll={{ x: 185 + 235 * selected.length }}
            />
          </section>
          <section className="compare-facts rounded-[13px] border border-line bg-surface shadow-card">
            <div className="portal-section-heading">
              <div>
                <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
                  LiveBench 分类能力
                </h2>
                <p className="mt-[6px] mb-0 text-[12px] leading-[1.9] text-[#657d8b] max-760:text-[11px]">
                  直接使用 LiveBench 各 suite
                  的原始分，不将分类能力外推到其他榜单。
                </p>
              </div>
            </div>
            {suites.length ? (
              <Table
                rowKey="key"
                columns={columns}
                dataSource={suites.map((s) =>
                  metric(s, SUITES[s] ?? s, (r) =>
                    number(r.representatives.livebench?.suites?.[s]),
                  ),
                )}
                pagination={false}
                scroll={{ x: 185 + 235 * selected.length }}
              />
            ) : (
              <Empty description="所选模型没有可用的 LiveBench 分类分" />
            )}
          </section>
        </>
      )}
    </div>
  );
}
