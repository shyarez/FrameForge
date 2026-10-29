"use client";

import { animate, AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, MinusCircle, RefreshCw, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { UpdateReport } from "@/lib/data/update";
import { evaluateScene, sceneRestTime } from "@/lib/engine/evaluate";
import { CANVAS_SIZES, type Project, type Scene } from "@/lib/schema/project";
import { SceneView } from "@/components/render/SceneView";
import { Sprite } from "@/components/pixel/Sprite";
import { ArcadeLabel, Button, IconButton, PixelProgress, cx } from "@/components/ui/primitives";
import { useEditor } from "@/store/editor";

function Thumb({ project, scene, width }: { project: Project; scene: Scene; width: number }) {
  const logical = CANVAS_SIZES[project.aspectRatio];
  const scale = width / logical.width;
  const state = useMemo(() => ({ sceneIndex: 0, sceneStartMs: 0, localMs: 0, layers: [{ state: evaluateScene(scene, sceneRestTime(scene)), opacity: 1, translateX: 0 }] }), [scene]);
  return (
    <div style={{ width, height: logical.height * scale }} className="overflow-hidden">
      <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        <SceneView state={state} width={logical.width} height={logical.height} projectId={project.id} />
      </div>
    </div>
  );
}

/** Before/after of one scene: a wipe slider that sweeps across once on open, then follows the user. */
function BeforeAfter({ before, after, beforeScene, afterScene }: { before: Project; after: Project; beforeScene: Scene; afterScene: Scene }) {
  const [pos, setPos] = useState(0);
  const width = 420;
  useEffect(() => {
    const controls = animate(0, 55, { duration: 1.4, ease: "easeInOut", onUpdate: (v) => setPos(v) });
    return () => controls.stop();
  }, []);
  return (
    <div className="flex flex-col gap-2">
      <div className="px-box-flat relative overflow-hidden bg-black" style={{ width }}>
        <Thumb project={before} scene={beforeScene} width={width} />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
          <Thumb project={after} scene={afterScene} width={width} />
        </div>
        <div aria-hidden className="pointer-events-none absolute top-0 bottom-0 w-[3px] bg-yellow" style={{ left: `${pos}%` }} />
        <span className="absolute top-1.5 left-1.5 bg-ink/85 px-1.5 py-1"><ArcadeLabel className="text-[8px] text-paper">Before</ArcadeLabel></span>
        <span className="absolute top-1.5 right-1.5 bg-ink/85 px-1.5 py-1"><ArcadeLabel className="text-[8px] text-yellow-ink">After</ArcadeLabel></span>
      </div>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label={`Compare before and after for ${afterScene.name}`} className="px-range" style={{ width }} />
    </div>
  );
}

function Delta({ pct, kind }: { pct: number | null; kind: "relative" | "points" }) {
  if (pct === null || pct === 0) return null;
  const up = pct > 0;
  return (
    <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 14, delay: 0.3 }}
      className={cx("ml-2 inline-block px-1.5 py-0.5 font-mono text-[11px]", up ? "bg-mint/20 text-mint-ink" : "bg-coral/20 text-coral-ink")}>
      {up ? "▲" : "▼"} {Math.abs(pct)}{kind === "points" ? " pts" : "%"}
    </motion.span>
  );
}

type Step = { kind: "pick" } | { kind: "busy"; label: string } | { kind: "identical"; version: number } | { kind: "review"; next: Project; report: UpdateReport } | { kind: "error"; message: string };

export function UpdateDialog({ datasetId, onClose }: { datasetId: string | null; onClose: () => void }) {
  const project = useEditor((s) => s.project)!;
  const replaceProject = useEditor((s) => s.replaceProject);
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (datasetId !== openFor) {
    setOpenFor(datasetId);
    setStep({ kind: "pick" });
  }
  const ref = project.datasets.find((d) => d.id === datasetId);

  const planFor = async () => {
    setStep({ kind: "busy", label: "Recomputing evidence…" });
    const { project: next, report } = await api.planDatasetUpdate(useEditor.getState().project!, datasetId!);
    setStep({ kind: "review", next, report });
  };

  const upload = async (file: File) => {
    if (!datasetId) return;
    try {
      setStep({ kind: "busy", label: "Uploading new version…" });
      const { identical, dataset } = await api.uploadDatasetVersion(project.id, datasetId, file);
      // An identical file only needs a plan if the project is still on an older version.
      if (identical && dataset.ref.version === ref?.version) return setStep({ kind: "identical", version: dataset.ref.version });
      await planFor();
    } catch (e) {
      setStep({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const apply = () => {
    if (step.kind !== "review") return;
    replaceProject(step.next);
    onClose();
  };

  const busy = step.kind === "busy";
  return (
    <AnimatePresence>
      {datasetId && ref && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="update-title"
            className="px-box scroll-thin flex max-h-[90vh] w-full max-w-5xl flex-col overflow-y-auto bg-panel p-7"
            initial={{ y: 30, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 30, scale: 0.95 }} transition={{ type: "spring", stiffness: 400, damping: 26 }}
            onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="px-box-flat flex size-14 items-center justify-center bg-yellow [--px-c:var(--color-edge)]">
                  <RefreshCw className={cx("size-6 text-onaccent", busy && "animate-spin")} />
                </span>
                <div>
                  <ArcadeLabel className="text-aqua-ink">Update data</ArcadeLabel>
                  <h2 id="update-title" className="mt-1.5 font-display text-2xl font-bold">{ref.name}</h2>
                  <p className="mt-0.5 font-mono text-[11px] text-mute">Currently v{ref.version} · {ref.rowCount.toLocaleString()} rows · sha256 {ref.hash.slice(0, 12)}…</p>
                </div>
              </div>
              <IconButton label="Close" onClick={onClose} disabled={busy}><X className="size-4" /></IconButton>
            </div>

            {step.kind === "pick" && (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <Sprite name="database" scale={4} className="animate-bob" />
                <p className="max-w-md text-sm text-mute">
                  Upload a new version of this CSV. Every claim from it is recomputed, only the scenes that show changed numbers are refreshed, and you review the result before anything changes.
                </p>
                <Button variant="primary" onClick={() => input.current?.click()}><Upload className="size-4" /> Choose new CSV version</Button>
                {(project.datasets.find((d) => d.id === datasetId)?.version ?? 0) > 0 && (
                  <button type="button" onClick={() => void planFor().catch((e) => setStep({ kind: "error", message: String(e?.message ?? e) }))} className="text-xs text-aqua-ink underline-offset-2 hover:underline">
                    Or re-check scenes against the latest stored version
                  </button>
                )}
              </div>
            )}
            <input ref={input} type="file" accept=".csv,text/csv" hidden aria-label="Upload new CSV version"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }} />

            {step.kind === "busy" && (
              <div className="flex flex-col gap-3 py-8" aria-live="polite">
                <p className="text-center font-display text-lg">{step.label}</p>
                <PixelProgress value={0.6} color="bg-aqua" />
              </div>
            )}
            {step.kind === "identical" && (
              <p className="px-box-flat bg-mint/10 p-4 text-sm text-mint-ink [--px-c:var(--color-mint)]" role="status">
                This file is identical to version {step.version} (same sha256). Nothing to update.
              </p>
            )}
            {step.kind === "error" && <p className="px-box-flat bg-coral/10 p-4 text-sm text-coral-ink [--px-c:var(--color-coral)]" role="alert">{step.message}</p>}

            {step.kind === "review" && <Review report={step.report} before={project} after={step.next} />}

            <div className="mt-6 flex justify-end gap-4">
              {step.kind === "review" ? (
                <>
                  <span className="mr-auto self-center text-[11px] text-mute">
                    Keeping the current scenes leaves this project on v{step.report.fromVersion}; v{step.report.toVersion} stays stored for later.
                  </span>
                  <Button onClick={onClose}>Keep current scenes</Button>
                  <Button variant="primary" onClick={apply}>
                    Apply update ▶
                  </Button>
                </>
              ) : (
                <Button onClick={onClose} disabled={busy}>Close</Button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Review({ report, before, after }: { report: UpdateReport; before: Project; after: Project }) {
  const c = report.counts;
  const metrics: [string, number, string][] = [
    ["Claims changed", c.evidenceChanged, "text-yellow-ink"],
    ["Claims unchanged", c.evidenceUnchanged, "text-mint-ink"],
    ["Claims broken", c.evidenceBroken, "text-coral-ink"],
    ["Scenes refreshed", c.scenesUpdated, "text-aqua-ink"],
    ["Scenes stale", c.scenesStale, "text-coral-ink"],
    ["Scenes preserved", c.scenesPreserved, "text-mute"],
  ];
  const shown = report.scenes.filter((s) => s.status !== "unchanged");
  return (
    <div className="flex flex-col gap-6" aria-live="polite">
      <p className="font-display text-lg">
        v{report.fromVersion} <ArrowRight className="inline size-4" /> v{report.toVersion}
        <span className="ml-3 text-sm text-mute">
          {c.elementsUpdated} element{c.elementsUpdated === 1 ? "" : "s"} refreshed in {report.durationMs} ms
        </span>
      </p>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {metrics.map(([label, n, tint], i) => (
          <motion.li key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="px-box-flat bg-ink p-3 text-center">
            <p className={cx("font-display text-3xl font-bold", tint)}>{n}</p>
            <p className="text-[11px] text-mute">{label}</p>
          </motion.li>
        ))}
      </ul>

      <section>
        <h3 className="mb-2 font-display text-lg font-semibold">Claims</h3>
        <ul className="flex flex-col gap-2">
          {report.evidence.map((e) => (
            <li key={e.id} className={cx("px-box-flat flex flex-wrap items-center gap-x-3 gap-y-1 bg-ink px-3 py-2 text-sm", e.status === "unchanged" && "opacity-70")}>
              {e.status === "changed" && <RefreshCw className="size-4 shrink-0 text-yellow-ink" />}
              {e.status === "unchanged" && <CheckCircle2 className="size-4 shrink-0 text-mint-ink" />}
              {e.status === "broken" && <AlertTriangle className="size-4 shrink-0 text-coral-ink" />}
              <span className="min-w-48 flex-1 font-semibold">{e.label}</span>
              <span className="font-mono text-xs">
                {e.status === "changed" ? (
                  <>
                    <span className="text-mute line-through">{e.before}</span> <ArrowRight className="inline size-3" /> <span className="text-yellow-ink">{e.after}</span>
                    <Delta pct={e.deltaPct} kind={e.deltaKind} />
                  </>
                ) : e.status === "broken" ? (
                  <span className="text-coral-ink">{e.error}</span>
                ) : (
                  <span className="text-mute">{e.before}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 font-display text-lg font-semibold">Affected scenes</h3>
        {shown.length === 0 ? (
          <p className="text-sm text-mute">No scene content changes.</p>
        ) : (
          <ul className="flex flex-col gap-5">
            {shown.map((s) => {
              const b = before.scenes.find((x) => x.id === s.sceneId)!;
              const a = after.scenes.find((x) => x.id === s.sceneId)!;
              return (
                <li key={s.sceneId} className="px-box-flat flex flex-wrap gap-5 bg-night p-4">
                  <BeforeAfter before={before} after={after} beforeScene={b} afterScene={a} />
                  <div className="min-w-60 flex-1">
                    <p className="flex items-center gap-2 font-display text-lg font-semibold">
                      {s.name}
                      <span className={cx("px-1.5 py-1", s.status === "stale" ? "bg-coral/20 text-coral-ink" : "bg-aqua/20 text-aqua-ink")}>
                        <ArcadeLabel>{s.status === "stale" ? "Stale" : "Refreshed"}</ArcadeLabel>
                      </span>
                    </p>
                    <ul className="mt-2 flex flex-col gap-1.5 text-xs">
                      {s.elements.map((el) => (
                        <li key={el.elementId}>
                          <span className="font-semibold">{el.name}:</span> <span className="text-mute line-through">{el.before}</span> <ArrowRight className="inline size-3" /> <span>{el.after}</span>
                        </li>
                      ))}
                      {s.reasons.map((r) => (
                        <li key={r} className="flex gap-1.5 text-coral-ink"><MinusCircle className="mt-0.5 size-3 shrink-0" />{r}</li>
                      ))}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="flex items-start gap-2 text-[11px] text-mute">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Scene <strong className="mx-0.5">content</strong> is updated selectively: styling, layout, animation and unrelated scenes are untouched. Video export still re-renders every frame — cached segment re-rendering is not implemented.
      </p>
    </div>
  );
}
