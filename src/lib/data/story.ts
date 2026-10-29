import { anim, createChart, createScene, createShape, createText, newId, PALETTE } from "@/lib/schema/factory";
import { CANVAS_SIZES, type AspectRatio, type Evidence, type NumberFormatSchema, type Scene, type TextElement } from "@/lib/schema/project";
import type { z } from "zod";
import { makeBinding, renderBinding } from "./binding";
import { humanize } from "./format";
import type { ColumnProfile, Table } from "./profile";
import { computeCalc, histogramBins, type CalcSpec } from "./stats";

/**
 * Deterministic data-story generator. Builds 3–5 editable scenes from a profiled dataset.
 * Rules:
 * - A scene is included only when the data supports it; skipped scenes carry a reason.
 * - Every number shown is produced by a CalcSpec evaluated here and stored as Evidence;
 *   narrative text is a template whose numbers are filled from that evidence.
 */

type Format = z.infer<typeof NumberFormatSchema>;
export type StoryKind = NonNullable<Scene["generated"]>["kind"];

export interface StoryRoles {
  /** Numeric column to measure (sum/mean). Without one, stories count rows. */
  measure?: string;
  /** Categorical column to compare groups. */
  category?: string;
  /** Date or period column for the trend. */
  order?: string;
}

export interface DatasetInfo {
  id: string;
  name: string;
  version: number;
  hash: string;
}

export interface StoryPlanItem {
  kind: StoryKind;
  included: boolean;
  reason: string;
}

export interface Story {
  scenes: Scene[];
  evidence: Evidence[];
  plan: StoryPlanItem[];
  roles: StoryRoles;
}

/** Measure-name keywords in priority order: money first, then volumes, then generic scores. */
const MEASURE_KEYWORDS = ["revenue", "sales", "amount", "profit", "income", "total", "value", "spend", "cost", "price", "quantity", "qty", "units", "visits", "users", "count", "score"];
const measureRank = (name: string) => {
  const i = MEASURE_KEYWORDS.findIndex((k) => name.toLowerCase().includes(k));
  return i < 0 ? MEASURE_KEYWORDS.length : i;
};

/** Pick sensible default roles; the user can override them before generating. */
export function suggestRoles(t: Table): StoryRoles {
  const cols = t.columns.map((c) => c.profile);
  const measures = cols.filter((c) => c.type === "numeric" && !c.likelyId && !c.ordered && c.missing < t.rowCount);
  // Stable sort keeps file order among equally ranked columns.
  const measure = [...measures].sort((a, b) => measureRank(a.name) - measureRank(b.name))[0];
  const cats = cols.filter((c) => c.type === "categorical" && c.distinct >= 2);
  const category = cats.find((c) => c.distinct <= 12) ?? cats[0];
  const order = cols.find((c) => c.type === "date") ?? cols.find((c) => c.ordered);
  return { measure: measure?.name, category: category?.name, order: order?.name };
}

/** Validate user-chosen roles against the profile; returns problems (empty when valid). */
export function validateRoles(t: Table, roles: StoryRoles): string[] {
  const find = (n?: string) => (n ? t.columns.find((c) => c.profile.name === n)?.profile : undefined);
  const errs: string[] = [];
  const m = find(roles.measure);
  if (roles.measure && (!m || m.type !== "numeric")) errs.push(`"${roles.measure}" is not a numeric column`);
  const c = find(roles.category);
  if (roles.category && (!c || (c.type !== "categorical" && c.type !== "text"))) errs.push(`"${roles.category}" is not a category column`);
  const o = find(roles.order);
  if (roles.order && (!o || !o.ordered)) errs.push(`"${roles.order}" is not a date or period column`);
  return errs;
}

export function generateStory(
  t: Table,
  dataset: DatasetInfo,
  rolesIn: StoryRoles,
  aspect: AspectRatio,
  opts: { now: string; id?: (prefix: string) => string } = { now: new Date().toISOString() },
): Story {
  const id = opts.id ?? newId;
  const problems = validateRoles(t, rolesIn);
  if (problems.length) throw new Error(problems.join("; "));
  const roles = rolesIn;
  const prof = (n?: string): ColumnProfile | undefined => (n ? t.columns.find((c) => c.profile.name === n)?.profile : undefined);
  const measureP = prof(roles.measure);
  const unit = measureP?.unit ?? null;
  const measureName = roles.measure ? humanize(roles.measure) : "Records";
  const lowerMeasure = measureName.toLowerCase();

  const evidence: Evidence[] = [];
  const ev = (label: string, calc: CalcSpec, format: Format, evUnit: string | null = null): Evidence => {
    const e: Evidence = {
      id: id("ev"),
      datasetId: dataset.id,
      datasetVersion: dataset.version,
      datasetHash: dataset.hash,
      label,
      calc,
      result: computeCalc(t, calc),
      format,
      unit: evUnit,
      sceneIds: [],
      computedAt: opts.now,
    };
    evidence.push(e);
    return e;
  };

  // ---- layout helpers (logical canvas pixels) ----
  const { width: W, height: H } = CANVAS_SIZES[aspect];
  const portrait = H > W;
  const pad = Math.round(Math.min(W, H) * 0.09);
  const innerW = W - pad * 2;
  const s = Math.min(W, H) / 1080; // type scale

  const bound = (template: string, evs: Evidence[], partial: Partial<TextElement>, countUp = false): TextElement => {
    const binding = makeBinding(template, evs, countUp);
    return createText({ ...partial, text: renderBinding(binding), binding });
  };
  const label = (text: string, y: number, color: string = PALETTE.aqua) =>
    createText({ name: "Label", text: text.toUpperCase(), fontFamily: "arcade", fontSize: Math.round(26 * s), fontWeight: 400, color, x: pad, y, width: innerW, height: Math.round(50 * s), enter: anim("fade", 0, 500) });
  const title = (text: string, y: number) =>
    createText({ name: "Title", text, fontFamily: "pixel", fontSize: Math.round((portrait ? 96 : 84) * s), fontWeight: 700, x: pad, y, width: innerW, height: Math.round(110 * s), lineHeight: 1.05, enter: anim("slide-up", 150, 650) });
  const kindScene = (kind: StoryKind, name: string, background: string, transition: Scene["transition"], durationMs: number) => {
    const sc = createScene(name, { background, transition, durationMs, generated: { datasetId: dataset.id, kind } });
    sc.id = id("sc");
    return sc;
  };
  /** Register that a scene displays these evidence records (the dependency registry Day 4 uses). */
  const link = (sc: Scene, ...evs: Evidence[]) => evs.forEach((e) => e.sceneIds.includes(sc.id) || e.sceneIds.push(sc.id));
  const withIds = <T extends { id: string }>(el: T): T => ({ ...el, id: id("el") });

  const plan: StoryPlanItem[] = [];
  const scenes: Scene[] = [];
  const takeaways: { template: string; evs: Evidence[] }[] = [];

  // ---- 1. Intro (always) ----
  const rows = ev("Number of records", { op: "rowCount" }, "integer");
  {
    const sc = kindScene("intro", "Intro", PALETTE.ink, { type: "none", durationMs: 0 }, 4000);
    const displayName = humanize(dataset.name.replace(/\.csv$/i, ""));
    sc.elements = [
      createShape({ name: "Bubble", shape: "ellipse", fill: PALETTE.aqua, x: W - pad - Math.round(220 * s), y: pad, width: Math.round(220 * s), height: Math.round(220 * s), enter: anim("pop", 200, 800) }),
      createShape({ name: "Bar", fill: PALETTE.coral, x: pad, y: H - pad - Math.round(40 * s), width: Math.round(280 * s), height: Math.round(40 * s), radius: 0, enter: anim("slide-left", 500, 700) }),
      label("Data story", Math.round(H * 0.3)),
      createText({ name: "Dataset title", text: displayName, fontFamily: "pixel", fontSize: Math.round((portrait ? 120 : 130) * s), fontWeight: 700, color: PALETTE.yellow, x: pad, y: Math.round(H * 0.3 + 70 * s), width: innerW, height: Math.round(300 * s), lineHeight: 1, enter: anim("slide-up", 200, 800) }),
      bound("Told from {0} records", [rows], { name: "Record count", fontFamily: "sans", fontSize: Math.round(44 * s), fontWeight: 600, color: PALETTE.paper, x: pad, y: Math.round(H * 0.3 + 390 * s), width: innerW, height: Math.round(70 * s), enter: anim("fade", 800, 700) }),
    ].map(withIds);
    link(sc, rows);
    scenes.push(sc);
    plan.push({ kind: "intro", included: true, reason: `Introduces ${displayName}` });
  }

  // ---- 2. Key metric ----
  if (roles.measure) {
    const total = ev(`Sum of ${roles.measure}`, { op: "aggregate", agg: "sum", column: roles.measure }, "compact", unit);
    const mean = ev(`Mean of ${roles.measure}`, { op: "aggregate", agg: "mean", column: roles.measure }, "decimal", unit);
    const present = ev(`Records with a ${roles.measure} value`, { op: "aggregate", agg: "count", column: roles.measure }, "integer");
    const sc = kindScene("metric", "Key metric", PALETTE.night, { type: "fade", durationMs: 500 }, 5000);
    sc.elements = [
      label(`Total ${lowerMeasure}`, Math.round(H * 0.22)),
      bound("{0}", [total], { name: "Total", fontFamily: "pixel", fontSize: Math.round((portrait ? 230 : 260) * s), fontWeight: 700, color: PALETTE.yellow, x: pad, y: Math.round(H * 0.22 + 60 * s), width: innerW, height: Math.round(300 * s), lineHeight: 1, enter: anim("pop", 200, 1400) }, true),
      bound("That is {0} per record on average.", [mean], { name: "Average", fontFamily: "sans", fontSize: Math.round(46 * s), fontWeight: 600, x: pad, y: Math.round(H * 0.22 + 390 * s), width: innerW, height: Math.round(70 * s), enter: anim("fade", 900, 600) }),
      // One wording for every case, so it stays true when values are later filled in or go missing.
      bound("Based on {0} of {1} records.", [present, rows], { name: "Coverage", fontFamily: "sans", fontSize: Math.round(32 * s), fontWeight: 400, color: PALETTE.aqua, x: pad, y: Math.round(H * 0.22 + 480 * s), width: innerW, height: Math.round(60 * s), enter: anim("fade", 1200, 600) }),
    ].map(withIds);
    link(sc, total, mean, present, rows);
    scenes.push(sc);
    takeaways.push({ template: `Total ${lowerMeasure}: {0}`, evs: [total] });
    plan.push({ kind: "metric", included: true, reason: `Sum and mean of ${roles.measure}` });
  } else {
    plan.push({ kind: "metric", included: false, reason: "No numeric measure column" });
  }

  // ---- 3. Comparison ----
  const catP = prof(roles.category);
  if (roles.category && catP && catP.distinct >= 2) {
    const agg = roles.measure ? "sum" : "count";
    const groups = ev(
      roles.measure ? `Sum of ${roles.measure} by ${roles.category} (top 6)` : `Records per ${roles.category} (top 6)`,
      { op: "groupBy", by: roles.category, measure: roles.measure, agg, sort: "desc", limit: 6 },
      roles.measure ? "compact" : "integer",
      unit,
    );
    const share = ev(`Largest ${roles.category}'s share of ${roles.measure ? `total ${roles.measure}` : "records"}`, { op: "topShare", by: roles.category, measure: roles.measure }, "percent");
    const sc = kindScene("comparison", "Comparison", PALETTE.ink, { type: "slide", durationMs: 600 }, 6000);
    const chartTop = pad + Math.round(200 * s);
    const chart = createChart({
      name: "Comparison chart",
      chartType: "bar",
      data: groups.result.kind === "series" ? groups.result.points : [],
      colors: [PALETTE.aqua, PALETTE.blue, PALETTE.coral, PALETTE.yellow, PALETTE.mint, "#c9a7ff"],
      x: pad,
      y: chartTop,
      width: innerW,
      height: H - chartTop - pad - Math.round(110 * s),
      binding: { evidenceId: groups.id },
      enter: anim("fade", 300, 1500),
    });
    sc.elements = [
      label(`${measureName} by ${humanize(roles.category).toLowerCase()}`, pad),
      title(`Who leads?`, pad + Math.round(50 * s)),
      chart,
      bound("{0:label} leads with {0} of the total.", [share], { name: "Leader", fontFamily: "sans", fontSize: Math.round(40 * s), fontWeight: 600, color: PALETTE.paper, x: pad, y: H - pad - Math.round(80 * s), width: innerW, height: Math.round(70 * s), enter: anim("slide-up", 1500, 600) }),
    ].map(withIds);
    link(sc, groups, share);
    scenes.push(sc);
    takeaways.push({ template: `{0:label} is the top ${humanize(roles.category).toLowerCase()} with {0} of the total`, evs: [share] });
    plan.push({ kind: "comparison", included: true, reason: `${measureName} across ${catP.distinct} ${roles.category} groups` });
  } else {
    plan.push({ kind: "comparison", included: false, reason: roles.category ? `"${roles.category}" has fewer than 2 groups` : "No category column" });
  }

  // ---- 4. Trend, or distribution as a fallback ----
  if (roles.order) {
    const agg = roles.measure ? "sum" : "count";
    const series = ev(roles.measure ? `Sum of ${roles.measure} by ${roles.order}` : `Records by ${roles.order}`, { op: "trend", x: roles.order, measure: roles.measure, agg }, roles.measure ? "compact" : "integer", unit);
    const points = series.result.kind === "series" ? series.result.points : [];
    if (points.length >= 3) {
      const change = ev(`Change in ${roles.measure ?? "records"} from first to last ${roles.order}`, { op: "trendChange", x: roles.order, measure: roles.measure, agg }, "signedPercent");
      // Neutral wording with a signed value stays true whichever way the number moves.
      const changeText = `${measureName} changed {0} from {0:from} to {0:to}.`;
      const sc = kindScene("trend", "Trend", PALETTE.night, { type: "fade", durationMs: 500 }, 6000);
      const chartTop = pad + Math.round(200 * s);
      sc.elements = [
        label(`${measureName} over time`, pad),
        bound("{0:headline}", [change], title("", pad + Math.round(50 * s))),
        createChart({ name: "Trend chart", chartType: "line", data: points, colors: [PALETTE.yellow, PALETTE.coral], x: pad, y: chartTop, width: innerW, height: H - chartTop - pad - Math.round(110 * s), binding: { evidenceId: series.id }, enter: anim("fade", 300, 1800, "easeInOut") }),
        bound(changeText, [change], { name: "Change", fontFamily: "sans", fontSize: Math.round(40 * s), fontWeight: 600, x: pad, y: H - pad - Math.round(80 * s), width: innerW, height: Math.round(70 * s), enter: anim("slide-up", 1800, 600) }),
      ].map(withIds);
      link(sc, series, change);
      scenes.push(sc);
      takeaways.push({ template: `${measureName} changed {0} over the period`, evs: [change] });
      plan.push({ kind: "trend", included: true, reason: `${points.length} points along ${roles.order}` });
    } else {
      evidence.splice(evidence.indexOf(series), 1);
      plan.push({ kind: "trend", included: false, reason: `"${roles.order}" has only ${points.length} distinct points (need 3)` });
    }
  } else {
    plan.push({ kind: "trend", included: false, reason: "No date or period column" });
  }

  const hasTrend = scenes.some((x) => x.generated?.kind === "trend");
  if (!hasTrend && roles.measure && measureP && (measureP.distinct ?? 0) >= 5) {
    const hist = ev(`Distribution of ${roles.measure}`, { op: "histogram", column: roles.measure, bins: histogramBins(t.rowCount) }, "integer");
    const lo = ev(`Minimum of ${roles.measure}`, { op: "aggregate", agg: "min", column: roles.measure }, "decimal", unit);
    const hi = ev(`Maximum of ${roles.measure}`, { op: "aggregate", agg: "max", column: roles.measure }, "decimal", unit);
    const sc = kindScene("distribution", "Distribution", PALETTE.night, { type: "fade", durationMs: 500 }, 6000);
    const chartTop = pad + Math.round(200 * s);
    sc.elements = [
      label(`How ${lowerMeasure} is spread`, pad),
      title("The spread", pad + Math.round(50 * s)),
      createChart({ name: "Distribution chart", chartType: "bar", data: hist.result.kind === "series" ? hist.result.points : [], colors: [PALETTE.blue], x: pad, y: chartTop, width: innerW, height: H - chartTop - pad - Math.round(110 * s), binding: { evidenceId: hist.id }, enter: anim("fade", 300, 1500) }),
      bound(`Values range from {0} to {1}.`, [lo, hi], { name: "Range", fontFamily: "sans", fontSize: Math.round(40 * s), fontWeight: 600, x: pad, y: H - pad - Math.round(80 * s), width: innerW, height: Math.round(70 * s), enter: anim("slide-up", 1500, 600) }),
    ].map(withIds);
    link(sc, hist, lo, hi);
    scenes.push(sc);
    plan.push({ kind: "distribution", included: true, reason: `Histogram of ${roles.measure} (no time column for a trend)` });
  } else if (!hasTrend) {
    plan.push({ kind: "distribution", included: false, reason: roles.measure ? `"${roles.measure}" has too few distinct values` : "No numeric measure column" });
  }

  // ---- 5. Summary ----
  {
    const sc = kindScene("summary", "Summary", PALETTE.ink, { type: "slide", durationMs: 600 }, 6000);
    const items = takeaways.length ? takeaways.slice(0, 3) : [{ template: "{0} records analysed", evs: [rows] }];
    const lineH = Math.round((portrait ? 150 : 110) * s);
    const top = pad + Math.round(220 * s);
    sc.elements = [
      label("Summary", pad),
      title("Key takeaways", pad + Math.round(50 * s)),
      ...items.flatMap((it, i) => [
        createShape({ name: `Bullet ${i + 1}`, fill: [PALETTE.aqua, PALETTE.coral, PALETTE.yellow][i], radius: 0, x: pad, y: top + i * lineH + Math.round(14 * s), width: Math.round(24 * s), height: Math.round(24 * s), enter: anim("pop", 400 + i * 450, 500) }),
        bound(it.template, it.evs, { name: `Takeaway ${i + 1}`, fontFamily: "sans", fontSize: Math.round(44 * s), fontWeight: 600, x: pad + Math.round(50 * s), y: top + i * lineH, width: innerW - Math.round(50 * s), height: lineH, lineHeight: 1.15, enter: anim("slide-left", 400 + i * 450, 600) }),
      ]),
      // Provenance in the video itself; the record count is bound so it refreshes with the data.
      bound(`Source: ${dataset.name} · {0} records`, [rows], { name: "Source", fontFamily: "mono", fontSize: Math.round(26 * s), fontWeight: 400, color: PALETTE.aqua, x: pad, y: H - pad - Math.round(50 * s), width: innerW, height: Math.round(50 * s), enter: anim("fade", 1800, 600) }),
    ].map(withIds);
    items.forEach((it) => link(sc, ...it.evs));
    link(sc, rows);
    scenes.push(sc);
    plan.push({ kind: "summary", included: true, reason: `${items.length} takeaway${items.length === 1 ? "" : "s"} reusing the evidence above` });
  }

  return { scenes, evidence, plan, roles };
}
