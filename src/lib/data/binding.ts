import type { Evidence, TextBinding } from "@/lib/schema/project";
import { renderTemplate } from "./format";

/** The number an evidence record contributes to text (series contribute their total). */
export function evidenceNumber(e: Evidence): number {
  return e.result.kind === "scalar" ? e.result.value : e.result.points.reduce((s, p) => s + p.value, 0);
}

/** String facts an evidence record exposes to {i:key} tokens. */
export function evidenceStrings(e: Evidence): Record<string, string> {
  const out: Record<string, string> = {};
  if (e.result.kind === "scalar") {
    if (e.result.label !== undefined) out.label = e.result.label;
    // Wording that depends on the sign of a change is derived here, so a data update can never leave it stale.
    if (e.calc.op === "trendChange") out.headline = e.result.value > 1 ? "On the rise" : e.result.value < -1 ? "Losing ground" : "Holding steady";
    for (const [k, v] of Object.entries(e.result.detail ?? {})) if (typeof v === "string") out[k] = v;
  } else if (e.result.points.length) {
    out.first = e.result.points[0].label;
    out.last = e.result.points[e.result.points.length - 1].label;
  }
  return out;
}

export function makeBinding(template: string, evidence: Evidence[], countUp = false): TextBinding {
  return {
    template,
    evidence: evidence.map((e) => e.id),
    values: evidence.map(evidenceNumber),
    formats: evidence.map((e) => e.format),
    units: evidence.map((e) => e.unit),
    strings: evidence.map(evidenceStrings),
    countUp,
  };
}

export function renderBinding(b: TextBinding): string {
  return renderTemplate(b.template, b.values, b.formats, (i) => b.units[i] ?? undefined, b.strings);
}
