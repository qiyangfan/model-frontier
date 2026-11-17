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
import { costFormat, money, NAMES, colorFor } from "./presentation.mjs";
import {
  dominationZoneVisible,
  isZoomed,
  scaledRange,
  wheelZoomGate,
} from "./chartNav.mjs";
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
  ["国产前沿", "cn"],
];
// 图例标记样式查找表：原 .legend-marker 及 .open/.closed/.global/.frontier 变体内联。
// 点身颜色已让位给厂商身份色，开放/闭源改由「形状」编码——图例用中性描边的
// 空心菱形/圆圈对应，不再宣示任何实色；前沿三类仍是线段样式。
const LEGEND_MARKERS = {
  open: "relative inline-block mx-[1px] h-[8px] w-[8px] shrink-0 rotate-45 border-[1.5px] border-[#657b8b]",
  closed:
    "relative inline-block h-[10px] w-[10px] shrink-0 rounded-full border-[1.5px] border-[#657b8b]",
  global:
    "relative inline-block h-0 w-[19px] shrink-0 [border-top:2px_dashed_#3267b8]",
  frontier:
    "relative inline-block h-0 w-[19px] shrink-0 [border-top:2px_solid_#128574]",
  cn: "relative inline-block h-0 w-[19px] shrink-0 [border-top:2px_solid_#9a1c36]",
};
// 六位 hex 转 rgba：描边阴影等半透明样式统一从这里出，避免散落 8 位 hex
// （zrender 对 #RRGGBBAA 的支持不一致，rgba() 是全版本可靠写法）。
const withAlpha = (hex, alpha) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};
// 点位符号半径：闭源圆点 symbolSize 10、开放权重菱形 symbolSize 13 的一半。
// 悬浮浮层的「同点位重叠」判定与顶层补点尺寸都以此为基准。
const symbolRadius = (r) => (r.openWeights === true ? 6.5 : 5);

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
                      { xAxis: Math.log10(row.cost), yAxis: context.yMin ?? 0 },
                      {
                        xAxis: Math.log10(context.axisMax),
                        yAxis: row.composite,
                      },
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
      // 非「全部模型」范围（仅开放权重/仅国产）都不绘制依附全球前沿的支配区域：
      // 该区域只对全量口径有意义，子集视图下「被支配」会指向筛选外的模型
      openOnly: !dominationZoneVisible(focus),
    };
    paintedZone.current = null;
    const point = (r) => ({
      id: r.id,
      name: r.name,
      // x 轴数据取 log10 编码（轴为 value 轴）：dataZoom 的 percent 域是线性
      // value 域，log 轴的视觉是 log 域，直接喂原始值会让平移/缩放在视觉上
      // 变速变宽；编码后所有交互都落在 log 域，比例尺恒定。
      value: [Math.log10(r.cost), r.composite],
      row: r,
      label: {
        // 命中模型的底层名牌让位给环层的厂商色标注牌（point 定义在前、调用在后，
        // highlightedIds 初始化完成前不会有任何 point 调用，无时序问题）
        show:
          (r.frontier || r.openFrontier || r.cnFrontier) &&
          !highlightedIds?.has(r.id),
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
        // 点身即厂商身份色（开放/闭源改由形状编码：圆点 vs 菱形），与 chip、
        // 搜索描边、浮层标记同一映射；白描边负责在厂商色相近或点位重叠时勾缝。
        color: colorFor(r.creator),
        borderColor: "#fff",
        borderWidth: 2,
        shadowBlur: r.openFrontier ? 9 : 0,
        shadowColor: withAlpha(colorFor(r.creator), 0.15),
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
    const highlightedIds = new Set(highlighted.map((r) => r.id));
    // 搜索命中双层渲染：描边环按厂商专属色画出（z=10，不拦截事件，只做视觉强调），
    // 内层再补一个同点位、同形状的实心点（z=11，可点击、可悬浮）——被邻近大点
    // 盖住的命中模型靠这层重新露出，无需去够那条月牙边。
    const highlight = highlighted.map((r) => {
      const base = point(r);
      const color = colorFor(r.creator);
      return {
        ...base,
        symbolSize: 21,
        itemStyle: {
          color: "transparent",
          borderColor: color,
          borderWidth: 3,
          shadowBlur: 6,
          shadowColor: withAlpha(color, 0.35),
        },
        label: {
          ...base.label,
          // 命中标注牌全量接管（含前沿命中——其底层名牌已让位，见 point()）：
          // 重叠簇里如果唯一可读的名字是非命中邻居的，高亮归属会被误读
          show: true,
          position: "right",
          color: "#274354",
          backgroundColor: "#fff",
          borderColor: color,
          borderWidth: 1,
          fontWeight: 650,
        },
      };
    });
    const highlightDot = highlighted.map((r) => {
      const open = r.openWeights === true;
      const base = point(r);
      return {
        ...base,
        symbol: open ? "diamond" : "circle",
        symbolSize: open ? 13 : 10,
        // 名称牌交给底层原点（前沿）或描边环（非前沿，挂右侧），顶层补点不再出牌
        label: { ...base.label, show: false },
        itemStyle: {
          ...base.itemStyle,
          shadowBlur: 6,
          shadowColor: withAlpha(colorFor(r.creator), 0.35),
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
            ? `模型成本与 PK 主积分散点图，搜索命中 ${highlightIds?.size ?? 0} 个模型，图中 ${highlight.length} 个点位已按厂商专属色描边标注；全部 ${plot.length} 个点位保留。悬浮全球前沿模型可标出它支配的区域。`
            : "模型成本与 PK 主积分散点图，左上方代表更低成本与更高 BT 强度。悬浮全球前沿模型可标出它支配的区域；点位重叠时悬浮浮层会列出同位置的全部模型；下方表格提供相同数据。",
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
            // 同点位重叠检测：把命中点与全部点位换算成像素，圆心距小于两半径之和
            // 加 2px 视觉容差的视为重叠，在浮层点名——两个点几乎叠成一团时，「图上
            // 只剩上层一个点」会造成模型消失的误读。dataZoom 缩放后换算随动，列表
            // 自动收缩；图例关闭的系列不列入（图上看不见的才需要点名）。
            const [px, py] = chart.convertToPixel("grid", p.value);
            const overlaps = plot
              .filter(
                (o) =>
                  o.id !== r.id &&
                  visibility[
                    o.openWeights === true ? "开放权重" : "闭源 / 未确认"
                  ] !== false,
              )
              .map((o) => {
                const [x, y] = chart.convertToPixel("grid", [
                  Math.log10(o.cost),
                  o.composite,
                ]);
                return { row: o, d: Math.hypot(x - px, y - py) };
              })
              .filter(
                ({ row: o, d }) => d < symbolRadius(r) + symbolRadius(o) + 2,
              )
              .sort((a, b) => a.d - b.d);
            const shown = overlaps.slice(0, 5);
            const overlapHtml = overlaps.length
              ? `<div class="mx-[18px] border-t border-t-[#edf1f4] pt-[10px] text-[10px] leading-[1.9] text-[#4b6573] whitespace-normal [overflow-wrap:anywhere]">此点位与其他 ${overlaps.length} 个模型几乎重叠：${shown
                  .map(
                    ({ row: o }) =>
                      `<b style="color:${colorFor(o.creator)}">${
                        o.openWeights === true ? "◆" : "●"
                      }</b> ${esc(o.name)}`,
                  )
                  .join(
                    "、",
                  )}${overlaps.length > shown.length ? " 等" : ""}；可在搜索框输入名称，以厂商专属色描边定位</div>`
              : "";
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
            return `<div class="border-b border-b-[#edf1f4] pt-[17px] px-[18px] pb-[13px]"><div class="mb-[6px] text-[10px] text-[#178571]">${r.openWeights === true ? "开放权重" : "闭源 / 开放状态未确认"}</div><strong class="block text-[14px] font-semibold text-[#274354]">${esc(r.name)}</strong><span class="mt-[5px] block text-[10px] text-[#91a1ac]">${esc(r.creator)}</span></div>${overlapHtml}<div class="grid grid-cols-[1fr_1fr] gap-[25px] p-[15px_18px] max-760:gap-[18px]"><div><small class="mb-[6px] block text-[10px] text-[#8c9ca6]">PK 主积分（Elo）</small><b class="text-[19px] font-semibold tabular-nums text-[#244755] max-760:text-[17px]">${r.composite.toFixed(1)}<em class="text-[10px] font-normal not-italic text-[#9babb4]"> · 中位 1000</em></b></div><div><small class="mb-[6px] block text-[10px] text-[#8c9ca6]">${isRelative ? "相对基准成本" : "每次任务成本"}</small><b class="text-[19px] font-semibold tabular-nums text-[#244755] max-760:text-[17px]">${costFormat(r.cost, costSource)}</b></div></div><div class="mx-[18px] border-t border-t-[#edf1f4] py-[11px]"><div class="mb-[8px] text-[9px] text-[#9aabb5]">三站真实任务成本 · USD</div>${dollars}</div>${dominated}<div class="flex flex-wrap justify-between gap-[9px] bg-[#f7faf9] px-[18px] py-[11px] text-[9px] text-[#8a9e96]"><span>有效评分 ${r.available.length} 榜 · 成本 ${r.costCoverage}/3 来源</span><strong class="font-medium text-[#21816a]">${r.frontier ? "全球前沿" : r.openFrontier ? "开放权重前沿" : r.cnFrontier ? "国产前沿" : "非前沿"}</strong><small class="block w-full text-[9px] text-[#a2b0a9]">点击模型查看配置与原始数据</small></div>`;
          },
        },
        legend: {
          show: false,
          data: LEGEND.map(([name]) => name),
          selected: visibility,
        },
        xAxis: {
          // log10 编码域（见 point()）：端点与刻度都按 10**v 反解成原始成本
          type: "value",
          name: isRelative ? "相对成本（基准 1 倍）" : "每次任务成本（USD）",
          nameLocation: "middle",
          nameGap: 29,
          nameTextStyle: { color: "#657b8b", fontSize: 11 },
          axisLabel: {
            formatter: (v) => {
              const raw = 10 ** v;
              return isRelative
                ? `${Number((raw / 100).toPrecision(2))} 倍`
                : `$${Number(raw.toPrecision(2))}`;
            },
            color: "#81929f",
            fontSize: 10,
            hideOverlap: true,
          },
          splitLine: { lineStyle: { color: "#edf1f5", type: "dashed" } },
          minorTick: { show: false },
          axisTick: { show: false },
          axisLine: { lineStyle: { color: "#dce5eb" } },
          min: plot.length
            ? Math.log10(Math.min(...plot.map((r) => r.cost)) * 0.6)
            : -2,
          max: Math.log10(axisMax),
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
            (r) => focus !== "openOnly" && focus !== "cnOnly" && r.frontier,
            "#3267b8",
            true,
            "global-frontier",
          ),
          line(
            "开放权重前沿",
            // 全部模型视图也常驻（可开关）：点的厂商色名牌已宣示子集前沿身份，
            // 线不画会让「有标记无线」自相矛盾；约束视图仍是各自子集的权威线
            (r) => focus !== "cnOnly" && r.openFrontier,
            "#128574",
            false,
          ),
          line(
            "国产前沿",
            // 线色避开全部厂商色（旧赭橙与 Meta 橙感知距离仅 12.3，owner 实测
            // 「颜色纯为区分」后按同一算法重选酒红）
            (r) => focus !== "openOnly" && r.cnFrontier,
            "#9a1c36",
            false,
          ),
          {
            name: "闭源 / 未确认",
            type: "scatter",
            data: closed.map(point),
            symbolSize: 10,
            // 点色由每个点的 itemStyle 按厂商给出（见 point()），系列层只管透明度
            itemStyle: { opacity: 1 },
            labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
            emphasis: { scale: 1.5, itemStyle: { opacity: 1 } },
            z: 3,
          },
          {
            name: "开放权重",
            type: "scatter",
            data: open.map(point),
            symbol: "diamond",
            symbolSize: 13,
            itemStyle: { opacity: 0.94 },
            labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
            emphasis: { scale: 1.5 },
            z: 4,
          },
          {
            name: "搜索命中",
            type: "scatter",
            data: highlight,
            symbolSize: 21,
            itemStyle: {
              color: "transparent",
            },
            // 命中标注牌是「谁被高亮」的唯一权威标识，永不隐藏；
            // 与邻居名牌相撞时由 shiftY 垂直挪开，而不是把命中名藏掉
            labelLayout: { hideOverlap: false, moveOverlap: "shiftY" },
            silent: true,
            z: 10,
            tooltip: { show: false },
          },
          {
            // 顶层补点：让被邻近点盖住的命中模型重新可见、可直接悬浮与点击打开详情；
            // 悬浮时走全局 item 浮层，显示的是命中模型自己的完整卡片。
            name: "搜索命中点",
            type: "scatter",
            data: highlightDot,
            labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
            z: 11,
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
          {LEGEND.filter(([, kind]) => {
            // 图例只列真正在画的线/点：范围视图（仅开放权重/仅国产）里全球前沿线
            // 不绘制（对其余点算前沿不成立），子集前沿线在全部模型视图也常驻。
            // 注意默认 focus 是 openFirst（图表口径等同全部模型），不是字面量 "all"
            if (kind === "global") {
              return focus !== "openOnly" && focus !== "cnOnly";
            }
            if (kind === "frontier") return focus !== "cnOnly";
            if (kind === "cn") return focus !== "openOnly";
            if (kind === "closed") return focus !== "openOnly";
            return true;
          }).map(([name, kind]) => (
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
          主积分支配的区域；点位挤在一起时，悬浮浮层会点名同位置的全部模型；拖动平移，⌘/Ctrl
          + 滚轮缩放，滚轮用于页面滚动
        </span>
      </div>
    </div>
  );
}
