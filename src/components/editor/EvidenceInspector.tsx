"use client";

import { AlertTriangle, ArrowRight, Database, Link2 } from "lucide-react";
import { describeResult, evidenceDelta } from "@/lib/data/update";
import type { Evidence } from "@/lib/schema/project";
import { Sprite } from "@/components/pixel/Sprite";
import { ArcadeLabel, cx } from "@/components/ui/primitives";
import { findElement, useEditor } from "@/store/editor";

/** Elements that display a given evidence record. */
export function elementsShowing(evidenceId: string, scene: { elements: { id: string; type: string; binding?: unknown }[] }) {
  return scene.elements.filter((el) => {
    const b = el.binding as { evidence?: string[]; evidenceId?: string } | undefined;
    return !!b && (b.evidence?.includes(evidenceId) || b.evidenceId === evidenceId);
  });
}

const pointsFormat = (e: Evidence) => e.format === "percent" || e.format === "signedPercent";

function EvidenceCard({ e, focused }: { e: Evidence; focused: boolean }) {
  const project = useEditor((s) => s.project)!;
  const { selectScene, setHighlightEvidence } = useEditor.getState();
  const changed = !!e.previous && JSON.stringify(e.previous.result) !== JSON.stringify(e.result);
  const pct = e.previous ? evidenceDelta(e, e.previous.result, e.result) : null;
  // A claim is broken only if it could not be recomputed itself: it is still on an older dataset version
  // than the project. (A scene can be stale because of a different claim it also shows.)
  const datasetVersion = project.datasets.find((d) => d.id === e.datasetId)?.version ?? e.datasetVersion;
  const broken = e.datasetVersion < datasetVersion;
  return (
    <li
      onMouseEnter={() => setHighlightEvidence(e.id)}
      onMouseLeave={() => setHighlightEvidence(null)}
      onFocus={() => setHighlightEvidence(e.id)}
      onBlur={() => setHighlightEvidence(null)}
      className={cx("px-box-flat bg-ink p-3 text-xs transition-colors", focused && "[--px-c:var(--color-yellow)]")}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{e.label}</p>
        <span className="shrink-0 font-mono text-[10px] text-mute">v{e.datasetVersion}</span>
      </div>
      <p className="mt-1.5 font-mono text-[12px] break-words text-yellow-ink">= {describeResult(e, e.result)}</p>
      {changed && e.previous && (
        <p className="mt-1 font-mono text-[10px] break-words text-mute">
          v{e.previous.datasetVersion}: <span className="line-through">{describeResult(e, e.previous.result)}</span> <ArrowRight className="inline size-3" /> v{e.datasetVersion}
          {pct !== null && pct !== 0 && (
            <span className={cx("ml-1.5", pct >= 0 ? "text-mint-ink" : "text-coral-ink")}>
              {pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}
              {pointsFormat(e) ? " pts" : "%"}
            </span>
          )}
        </p>
      )}
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[10px] text-mute select-none">Calculation</summary>
        <code className="mt-1 block font-mono text-[10px] break-all text-mute">{JSON.stringify(e.calc)}</code>
        <p className="mt-1 font-mono text-[10px] break-all text-mute">sha256 {e.datasetHash.slice(0, 16)}… · {new Date(e.computedAt).toLocaleString()}</p>
      </details>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {e.sceneIds.map((id) => {
          const sc = project.scenes.find((s) => s.id === id);
          if (!sc) return null;
          const n = elementsShowing(e.id, sc).length;
          return (
            <button key={id} type="button" onClick={() => selectScene(id)} title={`Go to ${sc.name}`}
              className={cx("flex items-center gap-1 px-1.5 py-1 text-[10px]", sc.stale ? "bg-coral/20 text-coral-ink" : "bg-raised hover:bg-line")}>
              <Link2 className="size-3" /> {project.scenes.indexOf(sc) + 1}. {sc.name} · {n}
            </button>
          );
        })}
      </div>
      {broken && (
        <p className="mt-2 flex gap-1.5 text-[10px] text-coral-ink">
          <AlertTriangle className="size-3 shrink-0" /> Could not be recomputed from data v{datasetVersion} — shown value is from v{e.datasetVersion}.
        </p>
      )}
    </li>
  );
}

/** Every evidence-linked claim in the project, grouped by dataset. */
export function EvidenceInspector() {
  const project = useEditor((s) => s.project)!;
  const selectedElementId = useEditor((s) => s.selectedElementId);
  const highlight = useEditor((s) => s.highlightEvidenceId);
  const sel = findElement(project, selectedElementId)?.element;
  const selIds = new Set(sel?.type === "text" ? sel.binding?.evidence ?? [] : sel?.type === "chart" && sel.binding ? [sel.binding.evidenceId] : []);

  if (project.evidence.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <Sprite name="database" scale={4} className="animate-bob" />
        <p className="font-display text-lg font-semibold">No evidence yet</p>
        <p className="text-xs leading-relaxed text-mute">Generate a data story from the Data tab. Every number it shows will be listed here with its source calculation and the scenes that use it.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5 p-4">
      {sel && selIds.size > 0 && (
        <p className="text-[11px] text-mute">Highlighted: the claims shown by <span className="font-semibold text-paper">{sel.name}</span>.</p>
      )}
      {project.datasets.map((d) => {
        const evs = project.evidence.filter((e) => e.datasetId === d.id);
        if (!evs.length) return null;
        const changed = evs.filter((e) => e.previous && JSON.stringify(e.previous.result) !== JSON.stringify(e.result)).length;
        return (
          <section key={d.id}>
            <h3 className="mb-1 flex items-center gap-2 font-display text-[15px] font-semibold text-mint-ink">
              <Database className="size-4" /> <span className="truncate">{d.name}</span>
            </h3>
            <p className="mb-3 font-mono text-[10px] text-mute">
              v{d.version} · {d.rowCount.toLocaleString()} rows · {evs.length} claims{changed ? ` · ${changed} changed in last update` : ""}
            </p>
            <ul className="flex flex-col gap-2.5">
              {[...evs].sort((a, b) => Number(selIds.has(b.id)) - Number(selIds.has(a.id))).map((e) => (
                <EvidenceCard key={e.id} e={e} focused={selIds.has(e.id) || highlight === e.id} />
              ))}
            </ul>
          </section>
        );
      })}
      <ArcadeLabel className="text-center text-mute">Hover a claim to outline it on the canvas</ArcadeLabel>
    </div>
  );
}
