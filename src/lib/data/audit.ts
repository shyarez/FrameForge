import type { Project, UpdateRecord } from "@/lib/schema/project";
import { renderBinding } from "./binding";
import type { Table } from "./profile";
import { computeCalc } from "./stats";

/**
 * Project evaluation: measurable checks of the evidence system on a saved project.
 * Pure — dataset tables are supplied by the caller (the server loads stored versions).
 */

export interface AuditReport {
  evidence: {
    total: number;
    /** Recomputed from the exact dataset version it records and matched bit-for-bit. */
    reproduced: number;
    mismatched: { id: string; label: string; reason: string }[];
    unavailable: { id: string; label: string; reason: string }[];
  };
  claims: {
    /** Text elements that display at least one digit. */
    numericTexts: number;
    linkedTexts: number;
    unlinkedTexts: { scene: string; element: string; text: string }[];
    charts: number;
    linkedCharts: number;
    unlinkedCharts: { scene: string; element: string }[];
  };
  consistency: {
    boundTexts: number;
    /** Displayed text equals what its evidence renders to. */
    consistent: number;
    drifted: { scene: string; element: string; shown: string; expected: string }[];
  };
  scenes: { total: number; generated: number; stale: { scene: string; reasons: string[] }[] };
  updates: {
    count: number;
    history: UpdateRecord[];
    avgDurationMs: number | null;
    /** Mean share of all elements an update touched (lower = more selective). */
    avgElementsRefreshedPct: number | null;
    avgScenesPreservedPct: number | null;
  };
}

/** Loads a dataset version as a table; returns null if it is not stored. */
export type TableLoader = (datasetId: string, version: number) => Table | null;

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

export function auditProject(project: Project, loadTable: TableLoader): AuditReport {
  // Evidence reproducibility.
  const mismatched: AuditReport["evidence"]["mismatched"] = [];
  const unavailable: AuditReport["evidence"]["unavailable"] = [];
  let reproduced = 0;
  for (const e of project.evidence) {
    let table: Table | null;
    try {
      table = loadTable(e.datasetId, e.datasetVersion);
    } catch (err) {
      table = null;
      unavailable.push({ id: e.id, label: e.label, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (!table) {
      unavailable.push({ id: e.id, label: e.label, reason: `Dataset version v${e.datasetVersion} is not stored` });
      continue;
    }
    try {
      const again = computeCalc(table, e.calc);
      if (JSON.stringify(again) === JSON.stringify(e.result)) reproduced++;
      else mismatched.push({ id: e.id, label: e.label, reason: "Recomputed value differs from the stored value" });
    } catch (err) {
      mismatched.push({ id: e.id, label: e.label, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  // Evidence coverage of numbers on screen, and binding consistency.
  const unlinkedTexts: AuditReport["claims"]["unlinkedTexts"] = [];
  const unlinkedCharts: AuditReport["claims"]["unlinkedCharts"] = [];
  const drifted: AuditReport["consistency"]["drifted"] = [];
  let numericTexts = 0;
  let linkedTexts = 0;
  let charts = 0;
  let linkedCharts = 0;
  let boundTexts = 0;
  for (const sc of project.scenes) {
    for (const el of sc.elements) {
      if (el.type === "text") {
        if (el.binding) {
          boundTexts++;
          const expected = renderBinding(el.binding);
          if (expected !== el.text) drifted.push({ scene: sc.name, element: el.name, shown: el.text, expected });
        }
        if (/\d/.test(el.text)) {
          numericTexts++;
          if (el.binding) linkedTexts++;
          else unlinkedTexts.push({ scene: sc.name, element: el.name, text: el.text.slice(0, 120) });
        }
      } else if (el.type === "chart") {
        charts++;
        if (el.binding) linkedCharts++;
        else unlinkedCharts.push({ scene: sc.name, element: el.name });
      }
    }
  }

  const history = project.updates ?? [];
  return {
    evidence: { total: project.evidence.length, reproduced, mismatched, unavailable },
    claims: { numericTexts, linkedTexts, unlinkedTexts, charts, linkedCharts, unlinkedCharts },
    consistency: { boundTexts, consistent: boundTexts - drifted.length, drifted },
    scenes: {
      total: project.scenes.length,
      generated: project.scenes.filter((s) => s.generated).length,
      stale: project.scenes.filter((s) => s.stale).map((s) => ({ scene: s.name, reasons: s.stale!.reasons })),
    },
    updates: {
      count: history.length,
      history,
      avgDurationMs: mean(history.map((u) => u.durationMs)),
      avgElementsRefreshedPct: mean(history.flatMap((u) => (u.elementsTotal ? [pct(u.elementsUpdated, u.elementsTotal)!] : []))),
      avgScenesPreservedPct: mean(history.flatMap((u) => (u.scenesTotal ? [pct(u.scenesPreserved, u.scenesTotal)!] : []))),
    },
  };
}
