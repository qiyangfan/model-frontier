import { useEffect, useRef } from "react";
import { Select } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { matchesSearchText, splitSearchTerms } from "./portal.mjs";

/**
 * 统一多选 chip 搜索框：支持直接输入实时预览（草稿态）、回车 / 失焦 / 分隔符生成关键词 tag，
 * 也支持从下拉候选中点选具体模型、配置或厂商；多个 chip 按任一命中（OR）匹配。
 */
export default function SearchChipInput({
  value = { terms: [], draft: "" },
  onChange,
  options = [],
  placeholder,
  ariaLabel,
  className = "",
}) {
  const clearingRef = useRef(false);
  const terms = splitSearchTerms(value?.terms);
  const draft = typeof value?.draft === "string" ? value.draft : "";
  const latestRef = useRef({ terms, draft });

  useEffect(() => {
    latestRef.current = { terms, draft };
  }, [terms, draft]);

  const emit = (next) => {
    latestRef.current = next;
    onChange(next);
  };

  return (
    <Select
      mode="tags"
      showSearch
      allowClear
      virtual={false}
      maxTagCount="responsive"
      optionLabelProp="value"
      popupMatchSelectWidth={false}
      tokenSeparators={["|", ",", "，"]}
      prefix={<SearchOutlined aria-hidden="true" />}
      className={"search-chip-select " + className}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={terms}
      searchValue={draft}
      options={options}
      notFoundContent={null}
      filterOption={(input, option) =>
        matchesSearchText(
          option?.searchText ?? option?.label ?? option?.value ?? "",
          input,
        )
      }
      filterSort={(a, b, { searchValue: input = "" } = {}) => {
        const q = input.trim().toLowerCase();
        if (!q) return 0;
        const aExact = String(a?.value ?? "").toLowerCase() === q ? 0 : 1;
        const bExact = String(b?.value ?? "").toLowerCase() === q ? 0 : 1;
        return aExact - bExact;
      }}
      onSearch={(nextDraft) => {
        if (clearingRef.current && nextDraft === "") return;
        emit({ terms: latestRef.current.terms, draft: nextDraft });
      }}
      onSelect={(selected) => {
        // 新添项已由 onChange 原子更新 terms 与清空 draft；仅在重复提交已存在词条时补清草稿。
        const current = latestRef.current;
        if (current.draft !== "" && current.terms.includes(selected)) {
          emit({ terms: current.terms, draft: "" });
        }
      }}
      onChange={(next) => {
        if (clearingRef.current) {
          emit({ terms: [], draft: "" });
          return;
        }
        const current = latestRef.current;
        const nextTerms = splitSearchTerms(next);
        emit({
          terms: nextTerms,
          draft: nextTerms.length >= current.terms.length ? "" : current.draft,
        });
      }}
      onClear={() => {
        clearingRef.current = true;
        emit({ terms: [], draft: "" });
        queueMicrotask(() => {
          clearingRef.current = false;
        });
      }}
    />
  );
}
