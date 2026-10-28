/** Display formatting for evidence values. Formatting never changes the stored value. */

export type NumberFormat = "integer" | "decimal" | "compact" | "percent" | "signedPercent";

export function formatValue(v: number, format: NumberFormat, unit?: string): string {
  const cur = unit && unit !== "%" ? unit : "";
  switch (format) {
    case "integer":
      return `${cur}${Math.round(v).toLocaleString("en-US")}`;
    case "decimal":
      return `${cur}${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}${unit === "%" ? "%" : ""}`;
    case "compact": {
      const abs = Math.abs(v);
      const [div, suf] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e4 ? [1e3, "K"] : [1, ""];
      const n = v / div;
      const digits = suf ? 1 : Number.isInteger(n) ? 0 : 2;
      return `${cur}${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suf}${unit === "%" ? "%" : ""}`;
    }
    case "percent":
      return `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
    case "signedPercent":
      return `${v > 0 ? "+" : ""}${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  }
}

/** Substitute {0}, {1}… with formatted values and {0:label}-style tokens with string facts. */
export function renderTemplate(
  template: string,
  values: number[],
  formats: NumberFormat[],
  unit?: (i: number) => string | undefined,
  strings?: Record<string, string>[],
): string {
  return template.replace(/\{(\d+)(?::(\w+))?\}/g, (m, i, key) => {
    const k = Number(i);
    if (key) return strings?.[k]?.[key] ?? m;
    return k < values.length ? formatValue(values[k], formats[k] ?? "decimal", unit?.(k)) : m;
  });
}

/** "total_revenue" → "Total revenue". */
export function humanize(name: string): string {
  const s = name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
