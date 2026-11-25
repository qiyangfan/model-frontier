import { selectRepresentative } from "../shared/representatives.mjs";
// Model-family keys remove inference settings, while preserving releases/dates.
// This is a name grammar, not a list of permitted models. Unknown families stay visible.
export function familyKey(name) {
  let s = String(name)
    .toLowerCase()
    .replace(/\bnonthinking\b|\bthinking\b(?=\))/g, "non-reasoning");
  s = s.replace(
    /\((?:max|xhigh|high|medium|low|minimal|reasoning|non-reasoning|nonthinking|thinking)(?:\s+with\s+fallback)?(?:[,\s]+\d+k)?\)/g,
    "",
  );
  s = s.replace(
    /[-\s](?:non-reasoning|nonthinking|thinking|xhigh|high|max|medium|low)(?:[-\s]\d+k)?$/g,
    "",
  );
  s = s
    .replace(/\(preview\)/g, "preview")
    .replace(/^wonder\b/, "muse wonder")
    .replace(/^muse[- ]wonder[- ]1\.0$/, "muse wonder");
  return s.replace(/[^a-z0-9]/g, "");
}
export function licenseState(license) {
  if (!license) return null;
  if (/proprietary|closed/i.test(license)) return false;
  if (
    /MIT|Apache|BSD|OpenMDW|Community License|Llama|Gemma|Qwen|Kimi|CC-BY|RAIL|OpenRAIL/i.test(
      license,
    )
  )
    return true;
  return null;
}
export function aggregate(sources) {
  const groups = new Map();
  for (const [source, snapshot] of Object.entries(sources))
    for (const row of snapshot.rows ?? []) {
      const key = familyKey(row.name);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { id: key, records: {} });
      const group = groups.get(key);
      (group.records[source] ??= []).push({ ...row, source });
    }
  return [...groups.values()]
    .map((g) => {
      const representatives = {};
      for (const [source, rows] of Object.entries(g.records)) {
        // Measured scores before estimates; active before deprecated; then best score.
        representatives[source] = selectRepresentative(rows);
      }
      const preferred =
        representatives.vals ??
        representatives.livebench ??
        representatives.aa ??
        representatives.arena ??
        representatives.modeldial ??
        // 上面五个覆盖 SCORE_SOURCES 全部；走到这里说明调用方传了清单外的来源
        // （aggregate 接受任意 sources map），取第一条兜底，避免 preferred 变
        // undefined 后在 preferred.name 处抛 TypeError。
        Object.values(representatives)[0];
      const all = Object.values(g.records).flat();
      const openness = all
        .map((r) => r.openWeights)
        .filter((v) => typeof v === "boolean");
      const conflicts = openness.includes(true) && openness.includes(false);
      const openWeights = conflicts
        ? null
        : openness.includes(true)
          ? true
          : openness.includes(false)
            ? false
            : null;
      return {
        ...g,
        name: preferred.name,
        creator:
          representatives.aa?.creator ??
          representatives.livebench?.creator ??
          representatives.arena?.creator ??
          "未披露",
        openWeights,
        openConflict: conflicts,
        licenses: [...new Set(all.map((r) => r.license).filter(Boolean))],
        representatives,
        coverage: Object.values(representatives).filter((r) =>
          Number.isFinite(r.score),
        ).length,
      };
    })
    .sort((a, b) => b.coverage - a.coverage || a.name.localeCompare(b.name));
}
