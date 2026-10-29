"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Gauge, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { AuditReport } from "@/lib/data/audit";
import type { ExportMetric } from "@/lib/server/metrics";
import { ArcadeLabel, IconButton, PixelProgress, cx } from "@/components/ui/primitives";
import { useEditor } from "@/store/editor";

const ratio = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 1000) / 10}%`);

function Score({ label, value, detail, good }: { label: string; value: string; detail: string; good: boolean | null }) {
  return (
    <li className="px-box-flat flex flex-col gap-1 bg-ink p-4">
      <ArcadeLabel className="text-mute">{label}</ArcadeLabel>
      <p className={cx("font-display text-3xl font-bold", good === null ? "text-paper" : good ? "text-mint-ink" : "text-coral-ink")}>{value}</p>
      <p className="text-[11px] text-mute">{detail}</p>
    </li>
  );
}

function Issues({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="px-box-flat bg-coral/10 p-3 text-xs text-coral-ink [--px-c:var(--color-coral)]">
      <p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" />{title}</p>
      <ul className="list-disc pl-5">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}

export function EvaluationDialog({ open, onClose, save }: { open: boolean; onClose: () => void; save: () => Promise<boolean> }) {
  const projectId = useEditor((s) => s.project!.id);
  const [data, setData] = useState<{ audit: AuditReport; exports: ExportMetric[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        // Evaluate exactly what is on disk, so save pending edits first.
        if (!(await save())) throw new Error("Could not save the project before evaluating");
        const res = await api.getEvaluation(projectId);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      setData(null);
      setError(null);
    };
  }, [open, projectId, save]);

  const a = data?.audit;
  const ex = data?.exports ?? [];
  const avgFps = ex.length ? Math.round((ex.reduce((s, e) => s + e.framesPerSec, 0) / ex.length) * 10) / 10 : null;
  const avgCost = ex.length ? Math.round((ex.reduce((s, e) => s + e.renderSec / Math.max(e.videoSec, 0.001), 0) / ex.length) * 10) / 10 : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="eval-title"
            className="px-box scroll-thin flex max-h-[90vh] w-full max-w-5xl flex-col overflow-y-auto bg-panel p-7"
            initial={{ y: 30, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 30, scale: 0.95 }} transition={{ type: "spring", stiffness: 400, damping: 26 }}
            onKeyDown={(e) => e.key === "Escape" && onClose()}>
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="px-box-flat flex size-14 items-center justify-center bg-mint [--px-c:var(--color-edge)]"><Gauge className="size-6 text-onaccent" /></span>
                <div>
                  <ArcadeLabel className="text-aqua-ink">Evaluation</ArcadeLabel>
                  <h2 id="eval-title" className="mt-1.5 font-display text-2xl font-bold">How trustworthy is this video?</h2>
                  <p className="mt-0.5 text-[11px] text-mute">Measured on the saved project: every claim is recomputed from the dataset version it records.</p>
                </div>
              </div>
              <IconButton label="Close" onClick={onClose}><X className="size-4" /></IconButton>
            </div>

            {!a && !error && <PixelProgress value={0.5} color="bg-mint" />}
            {error && <p className="px-box-flat bg-coral/10 p-3 text-sm text-coral-ink [--px-c:var(--color-coral)]" role="alert">{error}</p>}

            {a && (
              <div className="flex flex-col gap-6" aria-live="polite">
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Score label="Claims reproduced" value={a.evidence.total ? `${a.evidence.reproduced}/${a.evidence.total}` : "—"}
                    detail="Recomputed from stored data, matched exactly" good={a.evidence.total ? a.evidence.reproduced === a.evidence.total : null} />
                  <Score label="Numbers linked" value={ratio(a.claims.linkedTexts, a.claims.numericTexts)}
                    detail={`${a.claims.linkedTexts} of ${a.claims.numericTexts} texts with numbers have evidence`} good={a.claims.numericTexts ? a.claims.linkedTexts === a.claims.numericTexts : null} />
                  <Score label="Charts linked" value={ratio(a.claims.linkedCharts, a.claims.charts)}
                    detail={`${a.claims.linkedCharts} of ${a.claims.charts} charts come from a dataset`} good={a.claims.charts ? a.claims.linkedCharts === a.claims.charts : null} />
                  <Score label="Text consistent" value={a.consistency.boundTexts ? `${a.consistency.consistent}/${a.consistency.boundTexts}` : "—"}
                    detail="Displayed text matches its evidence" good={a.consistency.boundTexts ? a.consistency.consistent === a.consistency.boundTexts : null} />
                </ul>

                <div className="flex flex-col gap-3">
                  <Issues title="Claims that did not reproduce" items={a.evidence.mismatched.map((m) => `${m.label}: ${m.reason}`)} />
                  <Issues title="Claims whose dataset version is missing" items={a.evidence.unavailable.map((m) => `${m.label}: ${m.reason}`)} />
                  <Issues title="Numbers without evidence (typed by hand)" items={a.claims.unlinkedTexts.map((t) => `${t.scene} › ${t.element}: “${t.text}”`)} />
                  <Issues title="Charts with manual data" items={a.claims.unlinkedCharts.map((c) => `${c.scene} › ${c.element}`)} />
                  <Issues title="Text that no longer matches its evidence" items={a.consistency.drifted.map((d) => `${d.scene} › ${d.element}: shows “${d.shown}”, evidence says “${d.expected}”`)} />
                  <Issues title="Stale scenes" items={a.scenes.stale.map((s) => `${s.scene}: ${s.reasons.join("; ")}`)} />
                  {a.evidence.mismatched.length + a.evidence.unavailable.length + a.consistency.drifted.length + a.scenes.stale.length === 0 && (
                    <p className="flex items-center gap-2 text-sm text-mint-ink"><CheckCircle2 className="size-4" /> No integrity problems found.</p>
                  )}
                </div>

                <section>
                  <h3 className="mb-2 font-display text-lg font-semibold">Dataset updates</h3>
                  {a.updates.count === 0 ? (
                    <p className="text-sm text-mute">No dataset updates applied yet.</p>
                  ) : (
                    <>
                      <p className="mb-3 text-sm text-mute">
                        {a.updates.count} update{a.updates.count === 1 ? "" : "s"} · on average {a.updates.avgElementsRefreshedPct}% of elements refreshed, {a.updates.avgScenesPreservedPct}% of scenes preserved, {a.updates.avgDurationMs} ms to plan
                      </p>
                      <div className="px-box-flat scroll-thin overflow-x-auto bg-ink">
                        <table className="w-full text-left font-mono text-xs">
                          <thead className="bg-raised"><tr>{["Version", "Claims changed", "Broken", "Elements refreshed", "Scenes preserved", "Plan time"].map((h) => <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
                          <tbody>
                            {a.updates.history.map((u, i) => (
                              <tr key={i} className="border-t border-line/50">
                                <td className="px-3 py-1.5">v{u.fromVersion} → v{u.toVersion}</td>
                                <td className="px-3 py-1.5">{u.evidenceChanged}/{u.evidenceChanged + u.evidenceUnchanged + u.evidenceBroken}</td>
                                <td className="px-3 py-1.5">{u.evidenceBroken}</td>
                                <td className="px-3 py-1.5">{u.elementsUpdated}/{u.elementsTotal}</td>
                                <td className="px-3 py-1.5">{u.scenesPreserved}/{u.scenesTotal}</td>
                                <td className="px-3 py-1.5">{u.durationMs} ms</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </section>

                <section>
                  <h3 className="mb-2 font-display text-lg font-semibold">Export performance</h3>
                  {ex.length === 0 ? (
                    <p className="text-sm text-mute">No exports recorded yet. Export an MP4 to measure rendering.</p>
                  ) : (
                    <>
                      <p className="mb-3 text-sm text-mute">
                        {ex.length} export{ex.length === 1 ? "" : "s"} · {avgFps} frames captured per second on average · {avgCost} s of rendering per second of video
                      </p>
                      <div className="px-box-flat scroll-thin overflow-x-auto bg-ink">
                        <table className="w-full text-left font-mono text-xs">
                          <thead className="bg-raised"><tr>{["When", "Output", "Frames", "Video", "Render", "Frames/s", "Size"].map((h) => <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
                          <tbody>
                            {[...ex].reverse().slice(0, 10).map((e) => (
                              <tr key={e.jobId} className="border-t border-line/50">
                                <td className="px-3 py-1.5 whitespace-nowrap">{new Date(e.at).toLocaleString()}</td>
                                <td className="px-3 py-1.5">{e.width}×{e.height} @ {e.fps}</td>
                                <td className="px-3 py-1.5">{e.frames}</td>
                                <td className="px-3 py-1.5">{e.videoSec.toFixed(1)} s</td>
                                <td className="px-3 py-1.5">{e.renderSec.toFixed(1)} s</td>
                                <td className="px-3 py-1.5">{e.framesPerSec}</td>
                                <td className="px-3 py-1.5">{(e.bytes / 1024).toFixed(0)} KB</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  <p className="mt-2 text-[11px] text-mute">Every export renders all frames; selective re-rendering of changed scenes is not implemented.</p>
                </section>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
