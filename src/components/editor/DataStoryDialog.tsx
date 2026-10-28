"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Calendar, CheckCircle2, Hash, MinusCircle, Tag, Type, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ColumnProfile } from "@/lib/data/profile";
import type { Story, StoryRoles } from "@/lib/data/story";
import type { DatasetView } from "@/lib/server/datasets";
import { Sprite } from "@/components/pixel/Sprite";
import { ArcadeLabel, Button, Field, IconButton, PixelProgress, Select, cx } from "@/components/ui/primitives";
import { useEditor } from "@/store/editor";

const TYPE_ICON = { numeric: Hash, date: Calendar, categorical: Tag, text: Type } as const;
const TYPE_TINT = { numeric: "text-yellow-ink", date: "text-aqua-ink", categorical: "text-coral-ink", text: "text-mute" } as const;

function ColumnChip({ c }: { c: ColumnProfile }) {
  const Icon = TYPE_ICON[c.type];
  return (
    <li className="px-box-flat flex min-w-0 flex-col gap-1 bg-ink px-2.5 py-2">
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className={cx("size-3.5 shrink-0", TYPE_TINT[c.type])} />
        <span className="truncate" title={c.name}>{c.name}</span>
      </span>
      <span className="text-[11px] text-mute">
        {c.type}
        {c.likelyId ? " · id" : ""}
        {c.unit ? ` · ${c.unit}` : ""} · {c.distinct} distinct
        {c.missing ? <span className="text-coral-ink"> · {c.missing} missing</span> : null}
      </span>
    </li>
  );
}

/** Preview a dataset, pick roles, generate a story and insert it. */
export function DataStoryDialog({ datasetId, initial, onClose }: { datasetId: string | null; initial?: DatasetView; onClose: () => void }) {
  const project = useEditor((s) => s.project)!;
  const insertStory = useEditor((s) => s.insertStory);
  const [view, setView] = useState<DatasetView | null>(null);
  const [roles, setRoles] = useState<StoryRoles>({});
  const [story, setStory] = useState<Story | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Reset when a different dataset is opened (adjust-state-during-render, no effect).
  if (datasetId !== loadedFor) {
    setLoadedFor(datasetId);
    setStory(null);
    setError(null);
    setView(initial && initial.ref.id === datasetId ? initial : null);
    setRoles(initial && initial.ref.id === datasetId ? initial.suggested : {});
  }

  useEffect(() => {
    if (!datasetId || view) return;
    let cancelled = false;
    api
      .getDataset(project.id, datasetId)
      .then(({ dataset }) => {
        if (cancelled) return;
        setView(dataset);
        setRoles(dataset.suggested);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [datasetId, view, project.id]);

  const generate = async () => {
    if (!datasetId) return;
    setBusy(true);
    setError(null);
    try {
      const { story } = await api.generateStory(project.id, datasetId, roles, project.aspectRatio);
      setStory(story);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const insert = () => {
    if (!story) return;
    insertStory(story);
    onClose();
  };

  const cols = view?.columns ?? [];
  const measures = cols.filter((c) => c.type === "numeric" && !c.ordered);
  const categories = cols.filter((c) => c.type === "categorical" || c.type === "text");
  const orders = cols.filter((c) => c.ordered);
  const setRole = (k: keyof StoryRoles, v: string) => {
    setStory(null);
    setRoles((r) => ({ ...r, [k]: v || undefined }));
  };

  return (
    <AnimatePresence>
      {datasetId && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="story-title"
            className="px-box scroll-thin flex max-h-[90vh] w-full max-w-5xl flex-col overflow-y-auto bg-panel p-7"
            initial={{ y: 30, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 30, scale: 0.95 }} transition={{ type: "spring", stiffness: 400, damping: 26 }}
            onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="px-box-flat flex size-14 items-center justify-center bg-mint [--px-c:var(--color-edge)]">
                  <Sprite name="database" scale={3} className={busy ? "animate-bob" : undefined} />
                </span>
                <div>
                  <ArcadeLabel className="text-aqua-ink">Data story</ArcadeLabel>
                  <h2 id="story-title" className="mt-1.5 font-display text-2xl font-bold">{view?.ref.name ?? "Loading dataset…"}</h2>
                  {view && (
                    <p className="mt-0.5 font-mono text-[11px] text-mute">
                      {view.ref.rowCount.toLocaleString()} rows · {view.ref.columnCount} columns · v{view.ref.version} · sha256 {view.ref.hash.slice(0, 12)}…
                    </p>
                  )}
                </div>
              </div>
              <IconButton label="Close" onClick={onClose} disabled={busy}><X className="size-4" /></IconButton>
            </div>

            {!view && !error && <PixelProgress value={0.4} />}
            {error && <p className="px-box-flat mb-4 bg-coral/10 p-3 text-sm text-coral-ink [--px-c:var(--color-coral)]" role="alert">{error}</p>}

            {view && (
              <>
                {view.warnings.length > 0 && (
                  <ul className="px-box-flat mb-4 flex flex-col gap-1 bg-yellow/10 p-3 text-xs text-yellow-ink [--px-c:var(--color-yellow)]">
                    {view.warnings.map((w) => (
                      <li key={w} className="flex items-center gap-2"><AlertTriangle className="size-3.5 shrink-0" />{w}</li>
                    ))}
                  </ul>
                )}

                <h3 className="mb-2 font-display text-lg font-semibold">Columns</h3>
                <ul className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                  {view.columns.map((c) => <ColumnChip key={c.name} c={c} />)}
                </ul>

                <h3 className="mb-2 font-display text-lg font-semibold">Preview <span className="text-sm font-normal text-mute">(first {view.preview.length} rows)</span></h3>
                <div className="px-box-flat scroll-thin mb-6 max-h-56 overflow-auto bg-ink">
                  <table className="w-full border-collapse text-left font-mono text-xs">
                    <thead className="sticky top-0 bg-raised">
                      <tr>{view.headers.map((h) => <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {view.preview.map((row, i) => (
                        <tr key={i} className="border-t border-line/50">
                          {row.map((v, j) => (
                            <td key={j} className={cx("px-3 py-1.5 whitespace-nowrap", v === "" && "text-coral-ink")}>{v === "" ? "—" : v}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h3 className="mb-2 font-display text-lg font-semibold">What should the story be about?</h3>
                <div className="mb-5 grid gap-4 sm:grid-cols-3">
                  <Field label="Measure (numbers)">
                    <Select value={roles.measure ?? ""} onChange={(e) => setRole("measure", e.target.value)}>
                      <option value="">None — count records</option>
                      {measures.map((c) => <option key={c.name} value={c.name}>{c.name}{c.likelyId ? " (looks like an id)" : ""}</option>)}
                    </Select>
                  </Field>
                  <Field label="Compare by (category)">
                    <Select value={roles.category ?? ""} onChange={(e) => setRole("category", e.target.value)}>
                      <option value="">None</option>
                      {categories.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.distinct} groups)</option>)}
                    </Select>
                  </Field>
                  <Field label="Over time (date/period)">
                    <Select value={roles.order ?? ""} onChange={(e) => setRole("order", e.target.value)}>
                      <option value="">None</option>
                      {orders.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </Select>
                  </Field>
                </div>

                {story && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="px-box-flat mb-6 bg-night p-4" aria-live="polite">
                    <h3 className="mb-3 font-display text-lg font-semibold">
                      Storyboard: {story.scenes.length} scenes · {story.evidence.length} evidence records
                    </h3>
                    <ol className="flex flex-col gap-2">
                      {story.plan.map((p) => (
                        <li key={p.kind} className={cx("flex items-start gap-2 text-sm", !p.included && "text-mute")}>
                          {p.included ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-mint-ink" /> : <MinusCircle className="mt-0.5 size-4 shrink-0" />}
                          <span>
                            <span className="font-semibold capitalize">{p.kind}</span> — {p.included ? p.reason : `skipped: ${p.reason}`}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <p className="mt-3 text-[11px] text-mute">
                      Every number is calculated deterministically from the stored dataset version. Narration uses fixed templates (no AI key configured).
                    </p>
                  </motion.div>
                )}

                <div className="flex justify-end gap-4">
                  {story ? (
                    <>
                      <Button onClick={() => setStory(null)}>Change roles</Button>
                      <Button variant="primary" onClick={insert}>Insert {story.scenes.length} scenes ▶</Button>
                    </>
                  ) : (
                    <Button variant="primary" onClick={() => void generate()} disabled={busy}>
                      {busy ? "Crunching numbers…" : "Generate storyboard"}
                    </Button>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
