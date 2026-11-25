import { useEffect, useMemo, useState } from "react";
import { Alert, Drawer, Empty, Select, Spin, Table, Tag } from "antd";
import { NAMES, formatTime, money } from "./presentation.mjs";
import {
  emptySearch,
  matchesSearchText,
  searchOptions,
  searchTermsOf,
} from "./portal.mjs";
import SearchChipInput from "./SearchChipInput.jsx";
const TYPES = {
  added: "新增收录",
  removed: "不再列出",
  updated: "指标 / 状态更新",
};
const FIELDS = {
  name: "名称",
  configuration: "配置",
  rawId: "源站标识",
  score: "原始总分",
  costTask: "任务成本",
  priceInput: "输入价格",
  priceOutput: "输出价格",
  speed: "速度",
  latency: "延迟",
  suites: "分类分",
  estimated: "估算标记",
  deprecated: "历史标记",
  openWeights: "开放状态",
  voteCount: "盲测投票数",
  scoreLower: "评分区间下限",
  scoreUpper: "评分区间上限",
  publishedAt: "榜单发布日期",
};
const raw = (v) => (v == null ? "未披露" : String(v));
function changeValue(item, key, isMoney = false) {
  const format = isMoney ? money : raw;
  return (
    <div className="history-values">
      <span className="block text-[11px] tabular-nums text-[#778c98]">
        {item.before ? format(item.before[key]) : "无此配置"}
      </span>
      <b className="mt-[6px] block text-[11px] font-medium tabular-nums text-[#255d55] before:content-['→_'] before:text-[#819a93]">
        {item.after ? format(item.after[key]) : "不再列出"}
      </b>
    </div>
  );
}
export default function HistoryDrawer({
  open,
  onClose,
  modelId,
  modelName,
  lastRefresh,
}) {
  const [data, setData] = useState(null),
    [recordId, setRecordId] = useState(),
    [search, setSearch] = useState(() => emptySearch()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null);
  // 仅在打开时重置：关闭瞬间清空内容会让抽屉在滑出动画中闪成空状态。
  /* eslint-disable react-hooks/set-state-in-effect -- 打开瞬间重置是有意行为，见上注释 */
  useEffect(() => {
    if (!open) return;
    setRecordId(undefined);
    setSearch(emptySearch());
    setData(null);
  }, [open, modelId]);
  /* eslint-enable react-hooks/set-state-in-effect */
  /* eslint-disable react-hooks/set-state-in-effect -- 仅置忙是同步的，取数结果都在回调中落地 */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    const search = new URLSearchParams();
    if (recordId) search.set("record", recordId);
    if (modelId) search.set("model", modelId);
    fetch("/api/history?" + search)
      .then(async (r) => {
        if (!r.ok) throw new Error("无法读取历史记录");
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, modelId, recordId, lastRefresh]);
  const selected = data?.selected;
  const searchTerms = searchTermsOf(search);
  const historyOptions = useMemo(
    () =>
      searchOptions(
        (selected?.items ?? []).map((i) => ({
          name: i.name,
          configuration: i.after?.configuration ?? i.before?.configuration,
        })),
        { includeCreator: false },
      ),
    [selected?.items],
  );
  const items = (selected?.items ?? []).filter((i) =>
    matchesSearchText(
      `${i.name} ${i.after?.configuration ?? i.before?.configuration ?? ""}`,
      searchTerms,
    ),
  );
  const columns = [
    {
      title: "来源",
      dataIndex: "source",
      width: 130,
      filters: Object.entries(NAMES).map(([value, text]) => ({ value, text })),
      onFilter: (v, r) => r.source === v,
      render: (s) => NAMES[s],
    },
    {
      title: "变化",
      dataIndex: "type",
      width: 115,
      filters: Object.entries(TYPES).map(([value, text]) => ({ value, text })),
      onFilter: (v, r) => r.type === v,
      render: (t) => (
        <Tag
          color={t === "added" ? "green" : t === "removed" ? "default" : "blue"}
        >
          {TYPES[t]}
        </Tag>
      ),
    },
    {
      title: "源配置",
      width: 240,
      render: (_, r) => (
        <span>
          {r.after?.configuration ?? r.before?.configuration ?? r.name}
          <small className="mt-[6px] block text-[10px] text-[#6a8190]">
            {r.fields.map((f) => FIELDS[f] ?? f).join("、")}
          </small>
        </span>
      ),
    },
    {
      title: "原始分 · 前 / 后",
      width: 150,
      render: (_, r) => changeValue(r, "score"),
    },
    {
      title: "USD/任务 · 前 / 后",
      width: 170,
      render: (_, r) => changeValue(r, "costTask", true),
    },
    {
      title: "输入 / 输出单价 · 前 / 后",
      width: 230,
      render: (_, r) => (
        <div className="history-values">
          <span className="block text-[11px] tabular-nums text-[#778c98]">
            {r.before
              ? `${money(r.before.priceInput)} / ${money(r.before.priceOutput)}`
              : "无此配置"}
          </span>
          <b className="mt-[6px] block text-[11px] font-medium tabular-nums text-[#255d55] before:content-['→_'] before:text-[#819a93]">
            {r.after
              ? `${money(r.after.priceInput)} / ${money(r.after.priceOutput)}`
              : "不再列出"}
          </b>
        </div>
      ),
    },
  ];
  return (
    <Drawer
      title={
        modelId ? `${modelName ?? modelId} · 真实历史` : "历史快照与更新记录"
      }
      open={open}
      onClose={onClose}
      width={1100}
    >
      <div className="history-drawer">
        <Alert
          type="info"
          showIcon
          title="历史从首次本地归档开始，起始快照可以来自已有缓存。记录时间、成功获取时间与源站版本分别保留，不推断更早的变化。"
        />
        {(error || data?.error) && (
          <Alert type="warning" showIcon title={error ?? data.error} />
        )}
        <div className="flex gap-[12px] my-[20px] max-760:flex-col">
          <Select
            className="w-[55%] max-760:w-full"
            virtual={false}
            aria-label="历史快照"
            placeholder="选择历史快照"
            value={recordId ?? selected?.id}
            onChange={setRecordId}
            options={(data?.records ?? []).map((r) => ({
              value: r.id,
              label: `${formatTime(r.at)} · ${r.kind === "baseline" ? "起始快照" : `${r.counts.added + r.counts.removed + r.counts.updated} 条变化`}`,
            }))}
          />
          <SearchChipInput
            className="min-w-0 flex-1"
            ariaLabel="搜索历史配置"
            value={search}
            onChange={setSearch}
            options={historyOptions}
            placeholder="搜索变化中的模型或配置（回车或点选可多选）"
          />
        </div>
        {busy ? (
          <div className="p-[70px] text-center">
            <Spin />
          </div>
        ) : !selected ? (
          <Empty description="尚无历史快照" />
        ) : (
          <>
            <div className="my-[15px] text-[11px] text-[#647e8d]">
              累计记录始于 {formatTime(data.startedAt)}；当前保留{" "}
              {data.recordCount} 份，最多 {data.limit} 份变化快照。
            </div>
            <div className="history-source-times">
              {Object.entries(selected.sources).map(([s, v]) => (
                <div
                  key={s}
                  className="min-w-0 rounded-[8px] border border-[#dfe8ed] bg-white p-[13px]"
                >
                  <b className="mb-[7px] block text-[11px] [overflow-wrap:anywhere]">
                    {NAMES[s]} · {v.count} 条配置
                  </b>
                  <span className="block text-[10px] leading-[1.9] text-[#657e8c] [overflow-wrap:anywhere]">
                    成功获取：{formatTime(v.fetchedAt)}
                  </span>
                  <span className="block text-[10px] leading-[1.9] text-[#657e8c] [overflow-wrap:anywhere]">
                    源站版本 / 更新标签：{v.sourceDate ?? "未披露"}
                  </span>
                </div>
              ))}
            </div>
            <h3 className="mt-[24px] mb-[10px] text-[14px] font-semibold">
              {selected.kind === "baseline"
                ? "起始快照"
                : "相对于前一份快照的变化"}
            </h3>
            <p className="text-[11px] leading-[1.9]">
              {selected.kind === "baseline"
                ? "起始快照只建立基准，不将已有配置记为新发布或新增收录。"
                : "新增 / 移除指源表中的配置收录变化，不代表模型发布或下线。各配置独立比较，不连接不同 effort 的价格或分数。"}
            </p>
            {selected.sourceChanges?.length > 0 &&
              selected.kind !== "baseline" && (
                <p className="text-[11px] leading-[1.9]">
                  源站版本标签发生变化：
                  {selected.sourceChanges.map((s) => NAMES[s]).join("、")}。
                </p>
              )}
            <Table
              rowKey="id"
              columns={columns}
              dataSource={items}
              size="small"
              scroll={{ x: 1050 }}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              locale={{
                emptyText:
                  selected.kind === "baseline"
                    ? "起始快照暂无可比较的前序记录"
                    : modelId
                      ? "该快照中此模型没有源配置变化"
                      : "该快照仅有版本标签变化，没有配置指标变化",
              }}
            />
            {modelId && (
              <>
                <h3 className="mt-[24px] mb-[10px] text-[14px] font-semibold">
                  此快照中的原始配置
                </h3>
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={selected.observations ?? []}
                  scroll={{ x: 650 }}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  columns={[
                    {
                      title: "来源",
                      dataIndex: "source",
                      width: 130,
                      render: (s) => NAMES[s],
                    },
                    {
                      title: "配置",
                      render: (_, r) => r.configuration ?? r.name,
                      width: 250,
                    },
                    { title: "原始分", dataIndex: "score", render: raw },
                    { title: "USD/任务", dataIndex: "costTask", render: money },
                  ]}
                />
              </>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
