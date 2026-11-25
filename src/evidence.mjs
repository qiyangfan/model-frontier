import { NAMES } from "./presentation.mjs";
export const CACHE_MAX_AGE_HOURS = 24;
export function sourceHealth(source, now = Date.now()) {
  const timestamp = Date.parse(source?.fetchedAt ?? "");
  const overdue =
    Number.isFinite(timestamp) &&
    now - timestamp > CACHE_MAX_AGE_HOURS * 3600000;
  return {
    failed: !!source?.stale,
    overdue,
    unknown: !Number.isFinite(timestamp),
    excluded: !!source?.stale || overdue,
  };
}
export function applyEvidencePolicy(models, sources = {}, policy = {}) {
  if (!policy.excludeStale) return models;
  const excluded = new Set(
    Object.keys(sources).filter(
      (s) => sourceHealth(sources[s], policy.now).excluded,
    ),
  );
  if (!excluded.size) return models;
  return models.map((m) => {
    const records = Object.fromEntries(
      Object.entries(m.records).map(([s, rows]) => [
        s,
        excluded.has(s) ? [] : rows,
      ]),
    );
    const representatives = Object.fromEntries(
      Object.entries(m.representatives).filter(([s]) => !excluded.has(s)),
    );
    return {
      ...m,
      records,
      representatives,
      originalRepresentatives: m.representatives,
      originalRecords: m.records,
    };
  });
}
export function configurationAssessment(model) {
  const entries = Object.entries(model?.representatives ?? {})
    .filter(([s]) => Object.hasOwn(NAMES, s))
    .map(([source, r]) => {
      const configuration = r.configuration ?? r.name ?? "";
      const normalized = configuration.trim().toLowerCase();
      // 只解析设置括号、明确末尾设置或独立 effort 值，避免把模型名中的 High / Thinking 当作档位。
      const standalone =
        /^(?:xhigh|max|high|medium|low|minimal|reasoning|non-reasoning|thinking|nonthinking)$/.test(
          normalized,
        )
          ? normalized
          : "";
      const suffix =
        normalized.match(
          /[-\s](xhigh|max|high|medium|low|minimal|non-reasoning|reasoning|thinking|nonthinking)(?:[-\s]\d+k)?$/,
        )?.[1] ?? "";
      const text = [
        standalone,
        ...(normalized.match(/\([^)]*\)/g) ?? []),
        suffix,
      ].join(" ");
      const effort =
        text.match(
          /(?:^|[\s(,\-])(xhigh|max|high|medium|low|minimal)(?=$|[\s),\-])/,
        )?.[1] ?? null;
      const mode = /non[-\s]?reasoning|non[-\s]?thinking/.test(text)
        ? "non-reasoning"
        : /\breasoning\b|\bthinking\b/.test(text)
          ? "reasoning"
          : null;
      return {
        source,
        configuration,
        effort,
        mode,
        fallback: /\bfallback\b/.test(text),
      };
    });
  const efforts = [...new Set(entries.map((x) => x.effort).filter(Boolean))];
  const modes = [...new Set(entries.map((x) => x.mode).filter(Boolean))];
  if (efforts.length > 1 || modes.length > 1)
    return {
      status: "different",
      label: "配置不一致",
      entries,
      reason: "源站明确披露的推理档位或推理模式不同，综合分属于模型族比较。",
    };
  if (
    entries.length >= 2 &&
    entries.every((x) => x.effort) &&
    efforts.length === 1
  )
    return {
      status: "matched",
      label: "已披露档位相同",
      entries,
      reason:
        "仅 effort 标签相同；任务、工具、fallback 与测试协议仍可能不同，不代表统一实验。",
    };
  return {
    status: "unknown",
    label: "配置信息不足",
    entries,
    reason:
      entries.length < 2
        ? "不足两个来源的配置记录，无法比较。"
        : "至少一个来源的推理档位未能确认，不能据此判断配置一致。",
  };
}
export function evidenceFlags(model, sources = {}, now = Date.now()) {
  const representatives =
    model.originalRepresentatives ?? model.representatives ?? {};
  const flags = [];
  for (const [s, r] of Object.entries(representatives)) {
    const name = NAMES[s] ?? s;
    const health = sourceHealth(sources[s], now);
    if (health.failed)
      flags.push({
        key: s + "-cache",
        label: name + " 历史缓存",
        color: "orange",
      });
    else if (health.overdue)
      flags.push({
        key: s + "-overdue",
        label: name + " 超过24小时未获取",
        color: "orange",
      });
    if (r.estimated)
      flags.push({
        key: s + "-estimated",
        label: name + " 估算",
        color: "orange",
      });
    if (r.deprecated)
      flags.push({
        key: s + "-historical",
        label: name + " 历史配置",
        color: "default",
      });
    if (!model.representatives[s])
      flags.push({
        key: s + "-excluded",
        label: name + " 已排除",
        color: "default",
      });
  }
  return flags;
}
