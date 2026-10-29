import { useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "antd";
import {
  AimOutlined,
  DownloadOutlined,
  DragOutlined,
  ExpandOutlined,
  FullscreenExitOutlined,
  InfoCircleOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@ant-design/icons";
import * as echarts from "echarts/core";
import { ScatterChart, LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  AriaComponent,
  MarkLineComponent,
  MarkAreaComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { costFormat, money, NAMES } from "./presentation.mjs";
import { isZoomed, scaledRange, wheelZoomGate } from "./chartNav.mjs";
echarts.use([
  ScatterChart,
  LineChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  AriaComponent,
  MarkLineComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);
const LEGEND = [
  ["开放权重", "open"],
  ["闭源 / 未确认", "closed"],
  ["全球前沿", "global"],
  ["开放权重前沿", "frontier"],
];
// 图例标记样式查找表：原 .legend-marker 及 .open/.closed/.global/.frontier 变体内联
const LEGEND_MARKERS = {
  open: "relative inline-block mx-[1px] h-[8px] w-[8px] shrink-0 rotate-45 bg-[#128574]",
  closed:
    "relative inline-block h-[10px] w-[10px] shrink-0 rounded-full bg-[#3267b8]",
  global:
    "relative inline-block h-0 w-[19px] shrink-0 [border-top:2px_dashed_#3267b8]",
  frontier:
    "relative inline-block h-0 w-[19px] shrink-0 [border-top:2px_solid_#128574]",
};
export default function Chart({
  rows,
  focus,
  onSelect,
  chartRef,
  costSource,
  costProfile,
  highlightIds,
  searchActive,
}) {
  const element = useRef(),
    container = useRef(),
    callback = useRef(onSelect),
    // 悬浮斩杀区的绘制上下文：第二个副作用每次重算后刷新，事件闭包经它取最新数据
    zoneContext = useRef(null),
    // 当前已绘制区域的锚点 id：口径重算会整表重建并抹掉区域，必须随之作废重绘
    paintedZone = useRef(null);
  // 图表事件闭包经 ref 取最新 onSelect；渲染期不写 ref，统一放到副作用阶段
  useEffect(() => {
    callback.current = onSelect;
  });
  const [expanded, setExpanded] = useState(false),
    [visibility, setVisibility] = useState({}),
    [zoomed, setZoomed] = useState(false);
  const plotCount = rows.filter((r) => r.plottable).length;
  useEffect(() => {
    const node = element.current;
    const chart = echarts.init(node);
    chartRef.current = chart;
    // ECharts 6 给每个坐标系挂共享 RoamController，滚轮一到绘图区就先 stop()
    // 再按 per-zoom 标志取舍，悬停图表时页面滚动会被吞掉。滚轮分工在边界处分流：
    // 普通滚轮拦在边界外保页面原生滚动（绝不 preventDefault）；⌘/Ctrl + 滚轮与
    // 触控板捏合（合成 Ctrl 滚轮）preventDefault 接管浏览器页面缩放后放行，
    // 由 inside dataZoom 的 zoomOnMouseWheel 触发双轴缩放。
    const onWheel = (e) => {
      if (wheelZoomGate(e) === "zoom") e.preventDefault();
      else e.stopPropagation();
    };
    node.addEventListener("wheel", onWheel, { capture: true, passive: false });
    chart.on("click", (p) => {
      if (p.data?.id) callback.current(p.data.id);
    });
    // 斩杀区跟随鼠标：悬浮全球前沿模型即画出它支配的右下方矩形（该模型右上→轴缘），
    // 并注明其中模型数；悬浮非前沿模型或离开画布时撤下。矩形挂在「全球前沿」系列上，
    // 随该图例一起显隐，不拦截指向散点的事件（markArea 为 silent）。
    // 以 mousemove 而非 mouseover 驱动：zrender 的 _hovered 在指针离开画布时并不重置，
    // 重新进入并停在同一元素上不会补发 mouseover，区域会「消失后不再回来」。
    // painted 去重：mousemove 高频触发，只有锚点变化时才写 option。
    // 任何新的绘制意图都要取消待执行的撤下：zrender 单次 mousemove 内先派发旧点的
    // mouseout 再派发新点的 mousemove，若不清定时器，60ms 后会连同新区域一起抹掉。
    let retract = 0;
    const paintZone = (row) => {
      clearTimeout(retract);
      const id = row?.id ?? null;
      if (id === paintedZone.current) return;
      paintedZone.current = id;
      const context = zoneContext.current;
      const killed =
        row && context
          ? context.plot.filter(
              (o) => o.id !== row.id && o.dominatedBy?.includes(row.name),
            )
          : [];
      chart.setOption({
        animation: false,
        series: [
          {
            id: "global-frontier",
            markArea: killed.length
              ? {
                  silent: true,
                  itemStyle: { color: "rgba(224,101,79,.08)" },
                  label: {
                    show: true,
                    position: "insideBottomRight",
                    distance: 10,
                    color: "#b0584a",
                    fontSize: 10,
                    formatter: `被 ${row.name} 支配 · ${killed.length} 个模型`,
                  },
                  data: [
                    [
                      { xAxis: row.cost, yAxis: context.yMin ?? 0 },
                      { xAxis: context.axisMax, yAxis: row.composite },
                    ],
                  ],
                }
              : { silent: true, data: [] },
          },
        ],
      });
    };
    // 移到画布空白处若没有 mousemove 事件兜底，由 mouseout 延迟撤下；
    // 60ms 窗口留给紧随新点的 mousemove 取消。
    chart.on("mousemove", (p) =>
      paintZone(
        !zoneContext.current?.openOnly && p.data?.row?.frontier
          ? p.data.row
          : null,
      ),
    );
    chart.on("mouseout", () => {
      clearTimeout(retract);
      retract = setTimeout(() => paintZone(null), 60);
    });
    chart.on("globalout", () => paintZone(null));
    chart.on("datazoom", () =>
      setZoomed(isZoomed(chart.getOption()?.dataZoom)),
    );
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element.current);
    const fullscreen = () =>
      setExpanded(document.fullscreenElement === container.current);
    document.addEventListener("fullscreenchange", fullscreen);
    return () => {
      clearTimeout(retract);
      node.removeEventListener("wheel", onWheel, true);
      observer.disconnect();
      document.removeEventListener("fullscreenchange", fullscreen);
      chart.dispose();
      chartRef.current = null;
    };
  }, [chartRef]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const plot = rows.filter((r) => r.plottable),
      isRelative = costSource === "composite";
    const axisMax = plot.length
      ? Math.max(...plot.map((r) => r.cost)) * 1.4
      : 100;
    // Elo 等级分围绕 1000 分布；纵轴按当前样本自适应，保留 50 分刻度对齐。
    const scores = plot.map((r) => r.composite).filter(Number.isFinite);
    const scoreMin = scores.length ? Math.min(...scores) : 1000;
    const scoreMax = scores.length ? Math.max(...scores) : 1000;
    const scorePadding = Math.max(25, (scoreMax - scoreMin) * 0.08);
    const yMin = Math.floor((scoreMin - scorePadding) / 50) * 50;
    const yMax = Math.max(
      yMin + 100,
      Math.ceil((scoreMax + scorePadding) / 50) * 50,
    );
    const yInterval = Math.max(50, Math.ceil((yMax - yMin) / 8 / 50) * 50);
    zoneContext.current = {
      plot,
      axisMax,
      yMin,
      openOnly: focus === "openOnly",
    };
    paintedZone.current = null;
    const point = (r) => ({
      id: r.id,
      name: r.name,
      value: [r.cost, r.composite],
      row: r,
      label: {
        show: r.frontier || r.openFrontier,
        formatter: r.name,
        position: "top",
        distance: 10,
        fontSize: 11,
        fontWeight: 500,
        color: r.openWeights === true ? "#0b7565" : "#234e91",
        backgroundColor: "rgba(255,255,255,.94)",
        borderColor: r.openWeights === true ? "#d8ebe6" : "#e4e9ef",
        borderWidth: 1,
        borderRadius: 5,
        padding: [4, 7],
      },
      itemStyle: {
        borderColor: "#fff",
        borderWidth: 2,
        shadowBlur: r.openFrontier ? 9 : 0,
        shadowColor: "rgba(14,120,102,.15)",
      },
    });
    const open = plot.filter((r) => r.openWeights === true),
      closed = plot.filter((r) => r.openWeights !== true);
    // 搜索命中点单独一层描边，保证在全部点位上可见；关闭对应图例时一并隐藏。
    const highlighted = searchActive
      ? plot.filter(
          (r) =>
            highlightIds?.has(r.id) &&
            visibility[
              r.openWeights === true ? "开放权重" : "闭源 / 未确认"
            ] !== false,
        )
      : [];
    const highlight = highlighted.map((r) => {
      const base = point(r);
      return {
        ...base,
        symbolSize: 21,
        itemStyle: {
          color: "transparent",
          borderColor: "#d98a2b",
          borderWidth: 3,
          shadowBlur: 6,
          shadowColor: "rgba(217,138,43,.35)",
        },
        label: {
          ...base.label,
          show: !(r.frontier || r.openFrontier),
          color: "#8a4b00",
          backgroundColor: "#fff8ec",
          borderColor: "#e9b56a",
          borderWidth: 1,
          fontWeight: 650,
        },
      };
    });
    const line = (name, filter, color, dashed, id) => ({
      id,
      name,
      type: "line",
      data: plot
        .filter(filter)
        .sort((a, b) => a.cost - b.cost)
        .map((r) => ({ ...point(r), label: { show: false } })),
      symbol: "none",
      lineStyle: {
        color,
        width: dashed ? 1.8 : 2.5,
        type: dashed ? "dashed" : "solid",
      },
      itemStyle: { color },
      tooltip: { show: false },
      z: 2,
      silent: true,
    });
    const esc = echarts.format.encodeHTML;
    // [0]=横轴、[1]=纵轴缩放窗口；滑块在 [2]，随横轴联动不需保存
    const previous = chart.getOption()?.dataZoom?.[0],
      previousY = chart.getOption()?.dataZoom?.[1];
    chart.setOption(
      {
        animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
        animationDuration: 250,
        backgroundColor: "#fff",
        textStyle: {
          fontFamily: "Inter, -apple-system, PingFang SC, sans-serif",
        },
        aria: {
          enabled: true,
          description: searchActive
            ? `模型成本与 PK 主积分散点图，搜索命中 ${highlightIds?.size ?? 0} 个模型，图中 ${highlight.length} 个点位已用橙色描边标注；全部 ${plot.length} 个点位保留。悬浮全球前沿模型可标出它支配的区域。`
            : "模型成本与 PK 主积分散点图，左上方代表更低成本与更高 BT 强度。悬浮全球前沿模型可标出它支配的区域；下方表格提供相同数据。",
        },
        grid: { left: 55, right: 35, top: 44, bottom: 78 },
        tooltip: {
          trigger: "item",
          confine: true,
          borderWidth: 0,
          padding: 0,
          backgroundColor: "#fff",
          className: "frontier-tooltip",
          extraCssText:
            "box-shadow:0 10px 40px rgba(31,52,67,.16);border-radius:12px;overflow:hidden;max-width:340px;",
          formatter: (p) => {
            const r = p.data?.row;
            if (!r) return "";
            const dollars = ["aa", "vals", "livebench"]
              .map(
                (s) =>
                  `<div class="flex justify-between py-[4px] text-[11px] text-[#8295a2]"><span>${esc(NAMES[s])}</span><b class="font-medium tabular-nums text-[#4b6573]">${money(r.representatives[s]?.costTask)}</b></div>`,
              )
              .join("");
            // 被支配模型在 tooltip 里直接点名支配者，与图上跟随鼠标的斩杀区互为反向查询
            const dominated = r.dominatedBy?.length
              ? `<div class="mx-[18px] border-t border-t-[#edf1f4] py-[10px] text-[10px] leading-[1.7] text-[#a9635a] whitespace-normal [overflow-wrap:anywhere]">被 ${esc(r.dominatedBy.slice(0, 2).join("、"))}${r.dominatedBy.length > 2 ? ` 等 ${r.dominatedBy.length} 个前沿模型` : ""}同时以更低成本、更高 PK 主积分支配</div>`
              : "";
            return `<div class="border-b border-b-[#edf1f4] pt-[17px] px-[18px] pb-[13px]"><div class="mb-[6px] text-[10px] text-[#178571]">${r.openWeights === true ? "开放权重" : "闭源 / 开放状态未确认"}</div><strong class="block text-[14px] font-semibold text-[#274354]">${esc(r.name)}</strong><span class="mt-[5px] block text-[10px] text-[#91a1ac]">${esc(r.creator)}</span></div><div class="grid grid-cols-[1fr_1fr] gap-[25px] p-[15px_18px] max-760:gap-[18px]"><div><small class="mb-[6px] block text-[10px] text-[#8c9ca6]">PK 主积分（Elo）</small><b class="text-[19px] font-semibold tabular-nums text-[#244755] max-760:text-[17px]">${r.composite.toFixed(1)}<em class="text-[10px] font-normal not-italic text-[#9babb4]"> · 中位 1000</em></b></div><div><small class="mb-[6px] block text-[10px] text-[#8c9ca6]">${isRelative ? "相对基准成本" : "每次任务成本"}</small><b class="text-[19px] font-semibold tabular-nums text-[#244755] max-760:text-[17px]">${costFormat(r.cost, costSource)}</b></div></div><div class="mx-[18px] border-t border-t-[#edf1f4] py-[11px]"><div class="mb-[8px] text-[9px] text-[#9aabb5]">三站真实任务成本 · USD</div>${dollars}</div>${dominated}<div class="flex flex-wrap justify-between gap-[9px] bg-[#f7faf9] px-[18px] py-[11px] text-[9px] text-[#8a9e96]"><span>有效评分 ${r.available.length} 榜 · 成本 ${r.costCoverage}/3 来源</span><strong class="font-medium text-[#21816a]">${r.frontier ? "全球前沿" : r.openFrontier ? "开放权重前沿" : "非前沿"}</strong><small class="block w-full text-[9px] text-[#a2b0a9]">点击模型查看配置与原始数据</small></div>`;
          },
        },
        legend: {
          show: false,
          data: LEGEND.map(([name]) => name),
          selected: visibility,
        },
        xAxis: {
          type: "log",
          name: isRelative ? "相对成本（基准 1 倍）" : "每次任务成本（USD）",
          nameLocation: "middle",
          nameGap: 29,
          nameTextStyle: { color: "#657b8b", fontSize: 11 },
          axisLabel: {
            formatter: (v) =>
              isRelative
                ? `${Number((v / 100).toPrecision(2))} 倍`
                : `$${Number(v.toPrecision(2))}`,
            color: "#81929f",
            fontSize: 10,
            hideOverlap: true,
          },
          splitLine: { lineStyle: { color: "#edf1f5", type: "dashed" } },
          minorTick: { show: false },
          axisTick: { show: false },
          axisLine: { lineStyle: { color: "#dce5eb" } },
          min: plot.length ? Math.min(...plot.map((r) => r.cost)) * 0.6 : 0.01,
          max: axisMax,
        },
        yAxis: {
          type: "value",
          min: yMin,
          max: yMax,
          name: "PK 主积分（Elo）",
          nameTextStyle: {
            color: "#657b8b",
            fontSize: 11,
            padding: [0, 0, 7, 0],
          },
          interval: yInterval,
          axisLabel: { color: "#81929f", fontSize: 10 },
          splitLine: { lineStyle: { color: "#edf1f5" } },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        dataZoom: [
          {
            type: "inside",
            xAxisIndex: 0,
            filterMode: "none",
            // 滚轮缩放的修饰键门控在 Chart.jsx 边界监听完成，这里放行即可
            zoomOnMouseWheel: true,
            moveOnMouseWheel: false,
            moveOnMouseMove: true,
            preventDefaultMouseMove: true,
            start: previous?.start ?? 0,
            end: previous?.end ?? 100,
          },
          {
            type: "inside",
            yAxisIndex: 0,
            filterMode: "none",
            zoomOnMouseWheel: true,
            moveOnMouseWheel: false,
            moveOnMouseMove: true,
            preventDefaultMouseMove: true,
            start: previousY?.start ?? 0,
            end: previousY?.end ?? 100,
          },
          {
            type: "slider",
            xAxisIndex: 0,
            bottom: 3,
            height: 19,
            filterMode: "none",
            borderColor: "transparent",
            backgroundColor: "#f3f6f8",
            dataBackground: {
              lineStyle: { color: "#cbdad8" },
              areaStyle: { color: "#e1ece9" },
            },
            fillerColor: "rgba(14,120,102,.07)",
            handleSize: "90%",
            handleStyle: {
              color: "#fff",
              borderColor: "#74aa9c",
              shadowBlur: 2,
              shadowColor: "#c1d7d0",
            },
            moveHandleSize: 0,
            showDetail: false,
            brushSelect: false,
          },
        ],
        series: [
          line(
            "全球前沿",
            (r) => focus !== "openOnly" && r.frontier,
            "#3267b8",
            true,
            "global-frontier",
          ),
          line(
            "开放权重前沿",
            (r) => focus === "openOnly" && r.openFrontier,
            "#128574",
            false,
          ),
          {
            name: "闭源 / 未确认",
            type: "scatter",
            data: closed.map(point),
            symbolSize: 10,
            itemStyle: {
              color: "#3267b8",
              opacity: 1,
            },
            labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
            emphasis: {
              scale: 1.5,
              itemStyle: { opacity: 1, color: "#234e91" },
            },
            z: 3,
          },
          {
            name: "开放权重",
            type: "scatter",
            data: open.map(point),
            symbol: "diamond",
            symbolSize: 13,
            itemStyle: { color: "#128574", opacity: 0.94 },
            labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
            emphasis: { scale: 1.5, itemStyle: { color: "#065f50" } },
            z: 4,
          },
          {
            name: "搜索命中",
            type: "scatter",
            data: highlight,
            symbolSize: 21,
            itemStyle: {
              color: "transparent",
              borderColor: "#d98a2b",
              borderWidth: 3,
            },
            labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
            silent: true,
            z: 10,
            tooltip: { show: false },
          },
        ],
      },
      true,
    );
  }, [
    rows,
    focus,
    chartRef,
    costSource,
    visibility,
    highlightIds,
    searchActive,
  ]);
  // 不带 dataZoomIndex 的 dataZoom 动作命中全部缩放组件（含纵轴）
  const reset = () =>
    chartRef.current?.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
  const zoom = (direction) => {
    const chart = chartRef.current;
    if (!chart) return;
    const batch = (chart.getOption()?.dataZoom ?? [])
      .slice(0, 2)
      .map((z, i) => {
        const [start, end] = scaledRange(
          z?.start ?? 0,
          z?.end ?? 100,
          direction === "in" ? 0.7 : 1.4,
        );
        return { dataZoomIndex: i, start, end };
      });
    if (batch.length) chart.dispatchAction({ type: "dataZoom", batch });
  };
  const save = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const a = document.createElement("a");
    a.download = "model-frontier.png";
    a.href = chart.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: "#fff",
    });
    a.click();
  };
  const fullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await container.current?.requestFullscreen?.();
  };
  return (
    <div ref={container} className="chart-stage" data-chart-points={plotCount}>
      <div className="flex items-center justify-between gap-[12px] pt-[8px] pb-[5px] max-1180:flex-wrap max-1180:gap-[5px] max-760:gap-[8px] max-760:px-[3px] max-760:pt-[9px]">
        <div className="chart-legend">
          {LEGEND.filter(([, kind]) =>
            focus === "openOnly"
              ? kind === "open" || kind === "frontier"
              : kind !== "frontier",
          ).map(([name, kind]) => (
            <button
              key={name}
              className={
                "flex items-center gap-[7px] border-0 bg-transparent px-0 py-[4px] cursor-pointer text-[10px] text-[#6c8291] whitespace-nowrap max-760:text-[9px] " +
                (visibility[name] === false ? "opacity-[0.35]" : "")
              }
              aria-pressed={visibility[name] !== false}
              onClick={() =>
                setVisibility((v) => ({ ...v, [name]: v[name] === false }))
              }
            >
              <span className={LEGEND_MARKERS[kind]} aria-hidden="true" />
              {name}
            </button>
          ))}
        </div>
        <div className="chart-actions">
          <Tooltip title="放大">
            <Button
              aria-label="放大图表"
              type="text"
              icon={<ZoomInOutlined aria-hidden="true" />}
              onClick={() => zoom("in")}
            />
          </Tooltip>
          <Tooltip title="缩小">
            <Button
              aria-label="缩小图表"
              type="text"
              icon={<ZoomOutOutlined aria-hidden="true" />}
              onClick={() => zoom("out")}
            />
          </Tooltip>
          <Tooltip title="重置缩放">
            <Button
              aria-label="重置图表"
              type="text"
              disabled={!zoomed}
              icon={<AimOutlined aria-hidden="true" />}
              onClick={reset}
            />
          </Tooltip>
          <Tooltip title={expanded ? "退出全屏" : "全屏查看"}>
            <Button
              aria-label="切换图表全屏"
              type="text"
              icon={
                expanded ? (
                  <FullscreenExitOutlined aria-hidden="true" />
                ) : (
                  <ExpandOutlined aria-hidden="true" />
                )
              }
              onClick={fullscreen}
            />
          </Tooltip>
          <Tooltip title="下载图表 PNG">
            <Button
              aria-label="下载图表"
              type="text"
              icon={<DownloadOutlined aria-hidden="true" />}
              onClick={save}
            />
          </Tooltip>
        </div>
      </div>
      <div className="plot-frame">
        <div
          ref={element}
          className="chart h-[448px] w-full overflow-hidden min-[1600px]:h-[490px] max-1180:h-[465px] max-760:h-[420px] [.chart-stage:fullscreen_&]:h-full [.chart-stage:fullscreen_&]:min-h-0"
          role="img"
          aria-label="PK 主积分与任务成本交互图"
        />
      </div>
      {costSource === "composite" && (
        <div className="cost-reference">
          <div className="flex flex-row items-center justify-start gap-[8px] min-w-0 text-[#7c9b90] max-1180:col-span-full">
            <InfoCircleOutlined aria-hidden="true" className="text-[15px]" />
            <span className="text-[11px] text-[#557e70] max-760:text-[10px]">
              1 倍成本基准
              <small className="block text-[9px] text-[#92a69e] mt-[5px] whitespace-nowrap max-1180:inline max-1180:ml-[8px] max-760:text-[8px] max-760:ml-[7px]">
                {costProfile?.sources?.length ?? 3} 源共同样本中位数
              </small>
            </span>
          </div>
          {["aa", "vals", "livebench"].map((source) => (
            <div
              key={source}
              className="flex flex-col justify-center gap-[5px] min-w-0 border-l border-l-[#e5edeb] pl-[17px] max-1180:[&:nth-child(2)]:border-l-0 max-1180:[&:nth-child(2)]:pl-0 max-760:pl-[10px]"
            >
              <span className="text-[10px] text-[#7d918a] max-760:text-[8px]">
                {NAMES[source]}
              </span>
              <strong className="text-[13px] font-[550] tabular-nums text-[#3e665b] max-760:text-[11px]">
                {money(costProfile?.medians[source])}
                <small className="text-[9px] font-normal text-[#9aaba5] max-760:text-[8px]">
                  {" "}
                  / 任务
                </small>
              </strong>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-center gap-[7px] text-[9px] text-[#9aabb5] mt-[12px] leading-[1.7] max-760:text-[8px] max-760:gap-[5px] max-760:mt-[11px] max-760:mx-[4px] max-760:leading-[1.8]">
        <DragOutlined aria-hidden="true" className="text-[12px]" />
        <span>
          左上方更优。悬浮任一全球前沿模型，即标出它同时以更低成本、更高 PK
          主积分支配的区域；拖动平移，⌘/Ctrl + 滚轮缩放，滚轮用于页面滚动
        </span>
      </div>
    </div>
  );
}
