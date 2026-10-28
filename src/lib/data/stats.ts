import { z } from "zod";
import { column, type Table } from "./profile";

/**
 * Deterministic statistics. Every number in a generated story is produced by evaluating one of
 * these serialisable calculation specs against a stored dataset version, so it can be shown as
 * evidence and recomputed when the data changes. Missing values are excluded from numeric
 * aggregates (and counted separately); row order is the file order, so float sums are reproducible.
 */

export const AggSchema = z.enum(["sum", "mean", "count", "min", "max"]);
export type Agg = z.infer<typeof AggSchema>;

export const CalcSpecSchema = z.discriminatedUnion("op", [
  /** Number of data rows. */
  z.object({ op: z.literal("rowCount") }),
  /** Aggregate one numeric column (count = non-missing values). */
  z.object({ op: z.literal("aggregate"), agg: AggSchema, column: z.string() }),
  /** Aggregate a measure per category (or count rows per category when measure is omitted). */
  z.object({
    op: z.literal("groupBy"),
    by: z.string(),
    measure: z.string().optional(),
    agg: AggSchema,
    sort: z.enum(["desc", "asc", "label"]),
    limit: z.number().int().min(1).max(50),
  }),
  /** Largest group's share of the total, in percent. */
  z.object({ op: z.literal("topShare"), by: z.string(), measure: z.string().optional() }),
  /** Measure aggregated along an ordered column (dates bucketed to keep ≤ 24 points). */
  z.object({ op: z.literal("trend"), x: z.string(), measure: z.string().optional(), agg: AggSchema }),
  /** Percent change from the first to the last trend point. */
  z.object({ op: z.literal("trendChange"), x: z.string(), measure: z.string().optional(), agg: AggSchema }),
  /** Equal-width histogram of a numeric column. */
  z.object({ op: z.literal("histogram"), column: z.string(), bins: z.number().int().min(2).max(20) }),
]);
export type CalcSpec = z.infer<typeof CalcSpecSchema>;

export const PointSchema = z.object({ label: z.string().max(200), value: z.number() });
export type Point = z.infer<typeof PointSchema>;

export const CalcResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("scalar"),
    value: z.number(),
    /** Label attached to the value, e.g. the leading group. */
    label: z.string().optional(),
    detail: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  }),
  z.object({ kind: z.literal("series"), points: z.array(PointSchema).max(200) }),
]);
export type CalcResult = z.infer<typeof CalcResultSchema>;

/** Round away float noise so equal inputs always serialise identically. */
export const clean = (v: number) => (Number.isFinite(v) ? Math.round(v * 1e10) / 1e10 : 0);

export function aggregate(values: number[], agg: Agg): number {
  if (agg === "count") return values.length;
  if (values.length === 0) return 0;
  switch (agg) {
    case "sum":
      return clean(values.reduce((a, b) => a + b, 0));
    case "mean":
      return clean(values.reduce((a, b) => a + b, 0) / values.length);
    case "min":
      return values.reduce((a, b) => (b < a ? b : a));
    case "max":
      return values.reduce((a, b) => (b > a ? b : a));
  }
}

function numericValues(t: Table, name: string): number[] {
  const c = column(t, name);
  if (c.profile.type !== "numeric") throw new Error(`Column "${name}" is not numeric`);
  return c.num.filter((v): v is number => v !== null);
}

/** Group rows by a key, aggregating the measure (or counting rows) per group, in first-seen order. */
function grouped(t: Table, keyOf: (row: number) => string | null, measure: string | undefined, agg: Agg): Point[] {
  const m = measure ? column(t, measure) : null;
  if (m && m.profile.type !== "numeric") throw new Error(`Column "${measure}" is not numeric`);
  const groups = new Map<string, number[]>();
  for (let r = 0; r < t.rowCount; r++) {
    const key = keyOf(r);
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    if (!m) groups.get(key)!.push(1);
    else if (m.num[r] !== null) groups.get(key)!.push(m.num[r] as number);
  }
  return [...groups.entries()].map(([label, vals]) => ({ label, value: m ? aggregate(vals, agg) : vals.length }));
}

function categoryKey(t: Table, by: string) {
  const c = column(t, by);
  return (r: number) => {
    const v = c.raw[r].trim();
    return v === "" || ["na", "n/a", "null", "none", "nan", "-"].includes(v.toLowerCase()) ? null : v;
  };
}

/** Ordered-axis key with automatic bucketing: day → month → year so a trend has ≤ 24 points. */
function trendPoints(t: Table, x: string, measure: string | undefined, agg: Agg): Point[] {
  const c = column(t, x);
  if (!c.profile.ordered) throw new Error(`Column "${x}" is not an ordered (date/period) column`);
  const keyFor = (slice: number) => (r: number) => {
    if (c.profile.type === "date") return c.date[r] ? c.date[r]!.slice(0, slice) : null;
    return c.num[r] === null ? null : String(c.num[r]);
  };
  let points: Point[] = [];
  for (const slice of c.profile.type === "date" ? [10, 7, 4] : [0]) {
    points = grouped(t, keyFor(slice), measure, agg);
    if (points.length <= 24) break;
  }
  const sorted = c.profile.type === "date" ? points.sort((a, b) => a.label.localeCompare(b.label)) : points.sort((a, b) => Number(a.label) - Number(b.label));
  return sorted.slice(-24);
}

export function computeCalc(t: Table, spec: CalcSpec): CalcResult {
  switch (spec.op) {
    case "rowCount":
      return { kind: "scalar", value: t.rowCount };
    case "aggregate":
      return { kind: "scalar", value: aggregate(numericValues(t, spec.column), spec.agg) };
    case "groupBy": {
      const pts = grouped(t, categoryKey(t, spec.by), spec.measure, spec.agg);
      const sorted =
        spec.sort === "label"
          ? pts.sort((a, b) => a.label.localeCompare(b.label))
          : pts.sort((a, b) => (spec.sort === "desc" ? b.value - a.value : a.value - b.value) || a.label.localeCompare(b.label));
      return { kind: "series", points: sorted.slice(0, spec.limit) };
    }
    case "topShare": {
      const pts = grouped(t, categoryKey(t, spec.by), spec.measure, "sum").sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
      const total = pts.reduce((s, p) => s + p.value, 0);
      if (!pts.length || total === 0) return { kind: "scalar", value: 0 };
      return { kind: "scalar", value: clean((pts[0].value / total) * 100), label: pts[0].label, detail: { groupValue: pts[0].value, total: clean(total), groups: pts.length } };
    }
    case "trend":
      return { kind: "series", points: trendPoints(t, spec.x, spec.measure, spec.agg) };
    case "trendChange": {
      const pts = trendPoints(t, spec.x, spec.measure, spec.agg);
      if (pts.length < 2) return { kind: "scalar", value: 0, detail: { points: pts.length } };
      const first = pts[0];
      const last = pts[pts.length - 1];
      const pct = first.value === 0 ? 0 : clean(((last.value - first.value) / Math.abs(first.value)) * 100);
      return { kind: "scalar", value: pct, detail: { from: first.label, to: last.label, fromValue: first.value, toValue: last.value } };
    }
    case "histogram": {
      const vals = numericValues(t, spec.column);
      if (!vals.length) return { kind: "series", points: [] };
      const min = vals.reduce((a, b) => (b < a ? b : a));
      const max = vals.reduce((a, b) => (b > a ? b : a));
      const width = (max - min) / spec.bins || 1;
      const counts = new Array(spec.bins).fill(0);
      for (const v of vals) counts[Math.min(spec.bins - 1, Math.floor((v - min) / width))]++;
      const fmt = (v: number) => String(Math.round(v * 100) / 100);
      return { kind: "series", points: counts.map((n, i) => ({ label: `${fmt(min + i * width)}–${fmt(min + (i + 1) * width)}`, value: n })) };
    }
  }
}

/** Sturges' rule, clamped to a readable range. */
export const histogramBins = (n: number) => Math.min(12, Math.max(5, Math.ceil(Math.log2(Math.max(1, n)) + 1)));
