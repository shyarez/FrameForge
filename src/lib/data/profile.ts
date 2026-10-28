/**
 * Column typing and profiling. Deterministic rules, documented here so results are explainable:
 * - Missing: "", NA, N/A, null, none, nan, "-" (case-insensitive).
 * - numeric: ≥ 95% of non-missing values parse as numbers ("1,234.5", "$12", "45%" allowed).
 * - date:    ≥ 95% match YYYY-MM-DD, YYYY/MM/DD, YYYY-MM or YYYY/MM.
 * - categorical: otherwise, if distinct values ≤ max(20, 5% of rows); else free text.
 */

export type ColumnType = "numeric" | "date" | "categorical" | "text";

export interface ColumnProfile {
  name: string;
  index: number;
  type: ColumnType;
  missing: number;
  distinct: number;
  min?: number;
  max?: number;
  /** Earliest/latest normalised date for date columns. */
  first?: string;
  last?: string;
  /** Numeric column that looks like an identifier (unique integers or an "id" name) — not a good measure. */
  likelyId: boolean;
  /** Can order rows in time (dates, or integer year/month/week/period columns). */
  ordered: boolean;
  /** Unit hint detected from values, e.g. "$" or "%". */
  unit?: string;
  samples: string[];
}

export interface Table {
  headers: string[];
  rowCount: number;
  columns: { profile: ColumnProfile; raw: string[]; num: (number | null)[]; date: (string | null)[] }[];
}

const MISSING = new Set(["", "na", "n/a", "null", "none", "nan", "-"]);
export const isMissing = (v: string) => MISSING.has(v.trim().toLowerCase());

const NUM_RE = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;
const GROUPED_RE = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;

/** Parse a numeric cell. Returns null for anything that is not unambiguously a number. */
export function parseNumber(v: string): { value: number; unit?: string } | null {
  let s = v.trim();
  let unit: string | undefined;
  const cur = /^[$€£₹¥]/.exec(s);
  if (cur) {
    unit = cur[0];
    s = s.slice(1).trim();
  }
  if (s.endsWith("%")) {
    unit = "%";
    s = s.slice(0, -1).trim();
  }
  if (GROUPED_RE.test(s)) s = s.replace(/,/g, "");
  if (!NUM_RE.test(s)) return null;
  const value = Number(s);
  return Number.isFinite(value) ? { value, unit } : null;
}

const DATE_RE = /^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/;

/** Normalise a date cell to a sortable "YYYY-MM-DD" (or "YYYY-MM") string. */
export function parseDate(v: string): string | null {
  const m = DATE_RE.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  if (month < 1 || month > 12) return null;
  if (d === undefined) return `${y}-${mo.padStart(2, "0")}`;
  const day = Number(d);
  const daysInMonth = new Date(Date.UTC(Number(y), month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

const ORDER_NAME_RE = /^(year|yr|month|week|day|quarter|period|time|date|fy)\b/i;
const ID_NAME_RE = /(^id$|_id$|^id_|\bid\b|uuid|code$)/i;

export function profileTable(headers: string[], rows: string[][]): Table {
  const rowCount = rows.length;
  const columns = headers.map((name, index) => {
    const raw = rows.map((r) => r[index] ?? "");
    const present = raw.filter((v) => !isMissing(v));
    const missing = rowCount - present.length;
    const distinct = new Set(present).size;

    const nums = raw.map((v) => (isMissing(v) ? null : parseNumber(v)));
    const numOk = nums.filter((n) => n !== null).length;
    const dates = raw.map((v) => (isMissing(v) ? null : parseDate(v)));
    const dateOk = dates.filter((d) => d !== null).length;

    let type: ColumnType;
    if (present.length > 0 && dateOk / present.length >= 0.95) type = "date";
    else if (present.length > 0 && numOk / present.length >= 0.95) type = "numeric";
    else if (distinct <= Math.max(20, rowCount * 0.05)) type = "categorical";
    else type = "text";

    const num = type === "numeric" ? nums.map((n) => (n ? n.value : null)) : raw.map(() => null);
    const date = type === "date" ? dates : raw.map(() => null);
    const values = num.filter((n): n is number => n !== null);
    const unitCounts = new Map<string, number>();
    if (type === "numeric") for (const n of nums) if (n?.unit) unitCounts.set(n.unit, (unitCounts.get(n.unit) ?? 0) + 1);
    const unit = [...unitCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    const integers = values.length > 0 && values.every((v) => Number.isInteger(v));
    // Unnamed id columns: unique, consecutive integers (1..n). Unique integers alone (e.g. scores) are not enough.
    const consecutive = integers && values.length > 0 && distinct === present.length && values.reduce((a, b) => (b > a ? b : a)) - values.reduce((a, b) => (b < a ? b : a)) + 1 === values.length;
    const likelyId = type === "numeric" && (ID_NAME_RE.test(name) || (consecutive && present.length > 20 && !ORDER_NAME_RE.test(name)));
    const ordered = type === "date" || (type === "numeric" && integers && ORDER_NAME_RE.test(name));
    const sortedDates = date.filter((d): d is string => d !== null).sort();

    const profile: ColumnProfile = {
      name,
      index,
      type,
      missing,
      distinct,
      // Loops rather than Math.min(...values): spreading 50k arguments can overflow the stack.
      min: values.length ? values.reduce((a, b) => (b < a ? b : a)) : undefined,
      max: values.length ? values.reduce((a, b) => (b > a ? b : a)) : undefined,
      first: sortedDates[0],
      last: sortedDates[sortedDates.length - 1],
      likelyId,
      ordered,
      unit,
      samples: [...new Set(present)].slice(0, 3),
    };
    return { profile, raw, num, date };
  });
  return { headers, rowCount, columns };
}

export function column(table: Table, name: string) {
  const c = table.columns.find((x) => x.profile.name === name);
  if (!c) throw new Error(`Unknown column "${name}"`);
  return c;
}
