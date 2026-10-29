import type { ChartElement, DatasetRef, Evidence, Project, TextElement } from "@/lib/schema/project";
import { makeBinding, renderBinding } from "./binding";
import { formatValue } from "./format";
import type { Table } from "./profile";
import { computeCalc, type CalcResult } from "./stats";

/**
 * Evidence-aware scene update engine. Given a project and a new version of one of its datasets:
 *  1. recompute every evidence record from that dataset;
 *  2. classify each as unchanged / changed / broken (the calculation can no longer run);
 *  3. find affected scenes through each record's sceneIds (the dependency registry);
 *  4. refresh only data-bound content: bound text (text + cached values) and bound chart data.
 *     Styling, layout and animation are never touched, and unrelated scenes are left as they are;
 *  5. mark scenes stale when a claim they show is broken, instead of guessing;
 *  6. return the new project and a report.
 * Pure and deterministic: no I/O, and `now` is passed in.
 */

export type EvidenceStatus = "unchanged" | "changed" | "broken";

export interface EvidenceChange {
  id: string;
  label: string;
  status: EvidenceStatus;
  before: string;
  after: string | null;
  /**
   * Change for scalar claims (null when not meaningful). Relative percent for ordinary values;
   * percentage points for claims that are themselves percentages (a share going 34% → 51% is +17 pts, not +49%).
   */
  deltaPct: number | null;
  deltaKind: "relative" | "points";
  error?: string;
}

export interface ElementChange {
  elementId: string;
  name: string;
  kind: "text" | "chart";
  before: string;
  after: string;
}

export interface SceneChange {
  sceneId: string;
  name: string;
  status: "updated" | "stale" | "unchanged";
  reasons: string[];
  elements: ElementChange[];
}

export interface UpdateReport {
  datasetId: string;
  datasetName: string;
  fromVersion: number;
  toVersion: number;
  identical: boolean;
  evidence: EvidenceChange[];
  /** Only scenes that depend on this dataset; every other scene is preserved untouched. */
  scenes: SceneChange[];
  counts: {
    evidenceTotal: number;
    evidenceChanged: number;
    evidenceUnchanged: number;
    evidenceBroken: number;
    scenesTotal: number;
    scenesDependent: number;
    scenesUpdated: number;
    scenesStale: number;
    scenesPreserved: number;
    elementsUpdated: number;
  };
  durationMs: number;
}

export interface NewVersion {
  version: number;
  hash: string;
  rowCount: number;
  columnCount: number;
}

/** Short human summary of a calculation result in the evidence's own format. */
export function describeResult(e: Pick<Evidence, "format" | "unit">, r: CalcResult): string {
  const unit = e.unit ?? undefined;
  if (r.kind === "scalar") return `${formatValue(r.value, e.format, unit)}${r.label !== undefined ? ` (${r.label})` : ""}`;
  const shown = r.points.slice(0, 4).map((p) => `${p.label}: ${formatValue(p.value, e.format, unit)}`);
  return `${r.points.length} points — ${shown.join(", ")}${r.points.length > 4 ? ", …" : ""}`;
}

const sameResult = (a: CalcResult, b: CalcResult) => JSON.stringify(a) === JSON.stringify(b);

const isPercent = (e: Pick<Evidence, "format">) => e.format === "percent" || e.format === "signedPercent";

/** Delta between two results: percentage points for percentage claims, relative percent otherwise. */
export function evidenceDelta(e: Pick<Evidence, "format">, before: CalcResult, after: CalcResult): number | null {
  if (before.kind !== "scalar" || after.kind !== "scalar") return null;
  if (isPercent(e)) return Math.round((after.value - before.value) * 10) / 10;
  if (before.value === 0) return null;
  return Math.round(((after.value - before.value) / Math.abs(before.value)) * 1000) / 10;
}

const chartSummary = (el: ChartElement) => el.data.map((d) => `${d.label} ${+d.value.toFixed(2)}`).join(", ");

export function planUpdate(project: Project, datasetId: string, table: Table, next: NewVersion, now: string): { project: Project; report: UpdateReport } {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const out: Project = structuredClone(project);
  const ref = out.datasets.find((d) => d.id === datasetId);
  if (!ref) throw new Error("Dataset is not attached to this project");
  const fromVersion = ref.version;
  const identical = ref.hash === next.hash;

  // 1–2. Recompute evidence.
  const changes = new Map<string, EvidenceChange>();
  const evidence = out.evidence.filter((e) => e.datasetId === datasetId);
  for (const e of evidence) {
    const before = describeResult(e, e.result);
    try {
      const result = computeCalc(table, e.calc);
      const changed = !sameResult(result, e.result);
      if (changed) e.previous = { datasetVersion: e.datasetVersion, result: e.result, computedAt: e.computedAt };
      changes.set(e.id, {
        id: e.id,
        label: e.label,
        status: changed ? "changed" : "unchanged",
        before,
        after: describeResult(e, result),
        deltaPct: changed ? evidenceDelta(e, e.result, result) : 0,
        deltaKind: isPercent(e) ? "points" : "relative",
      });
      e.result = result;
      e.datasetVersion = next.version;
      e.datasetHash = next.hash;
      e.computedAt = now;
    } catch (err) {
      // Keep the last good value; the scenes that show it are marked stale below.
      changes.set(e.id, { id: e.id, label: e.label, status: "broken", before, after: null, deltaPct: null, deltaKind: isPercent(e) ? "points" : "relative", error: err instanceof Error ? err.message : String(err) });
    }
  }
  const byId = new Map(out.evidence.map((e) => [e.id, e]));
  const mine = (id: string) => byId.get(id)?.datasetId === datasetId;

  // 3–5. Refresh dependent scenes.
  const sceneChanges: SceneChange[] = [];
  for (const sc of out.scenes) {
    const bound = sc.elements.filter(
      (el): el is TextElement | ChartElement =>
        (el.type === "text" && !!el.binding?.evidence.some(mine)) || (el.type === "chart" && !!el.binding && mine(el.binding.evidenceId)),
    );
    if (!bound.length) continue;
    const elements: ElementChange[] = [];
    const reasons: string[] = [];
    for (const el of bound) {
      const ids = el.type === "text" ? el.binding!.evidence : [el.binding!.evidenceId];
      const broken = ids.map((id) => changes.get(id)).filter((c) => c?.status === "broken");
      if (broken.length) {
        for (const b of broken) reasons.push(`"${el.name}" shows "${b!.label}", which can't be recomputed: ${b!.error}`);
        continue;
      }
      if (el.type === "text") {
        const evs = el.binding!.evidence.map((id) => byId.get(id)).filter((e): e is Evidence => !!e);
        const binding = makeBinding(el.binding!.template, evs, el.binding!.countUp);
        const text = renderBinding(binding);
        if (text !== el.text || JSON.stringify(binding) !== JSON.stringify(el.binding)) {
          if (text !== el.text) elements.push({ elementId: el.id, name: el.name, kind: "text", before: el.text, after: text });
          el.text = text;
          el.binding = binding;
        }
      } else {
        const e = byId.get(el.binding!.evidenceId)!;
        if (e.result.kind === "series" && JSON.stringify(e.result.points) !== JSON.stringify(el.data)) {
          const before = chartSummary(el);
          el.data = e.result.points.map((p) => ({ ...p }));
          elements.push({ elementId: el.id, name: el.name, kind: "chart", before, after: chartSummary(el) });
        }
      }
    }
    if (reasons.length) sc.stale = { datasetId, version: next.version, reasons };
    else if (sc.stale?.datasetId === datasetId) delete sc.stale;
    sceneChanges.push({ sceneId: sc.id, name: sc.name, status: reasons.length ? "stale" : elements.length ? "updated" : "unchanged", reasons, elements });
  }

  Object.assign(ref, { version: next.version, hash: next.hash, rowCount: next.rowCount, columnCount: next.columnCount } satisfies Partial<DatasetRef>);

  const ev = [...changes.values()];
  const report: UpdateReport = {
    datasetId,
    datasetName: ref.name,
    fromVersion,
    toVersion: next.version,
    identical,
    evidence: ev,
    scenes: sceneChanges,
    counts: {
      evidenceTotal: ev.length,
      evidenceChanged: ev.filter((c) => c.status === "changed").length,
      evidenceUnchanged: ev.filter((c) => c.status === "unchanged").length,
      evidenceBroken: ev.filter((c) => c.status === "broken").length,
      scenesTotal: out.scenes.length,
      scenesDependent: sceneChanges.length,
      scenesUpdated: sceneChanges.filter((s) => s.status === "updated").length,
      scenesStale: sceneChanges.filter((s) => s.status === "stale").length,
      scenesPreserved: out.scenes.length - sceneChanges.filter((s) => s.status !== "unchanged").length,
      elementsUpdated: sceneChanges.reduce((n, s) => n + s.elements.length, 0),
    },
    durationMs: Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) * 100) / 100,
  };
  return { project: out, report };
}
