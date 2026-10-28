"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { ExportJob } from "@/lib/server/exportJobs";
import { outputSize, projectDurationMs } from "@/lib/schema/project";
import { ArcadeLabel, Button, Field, IconButton, PixelProgress, Select } from "@/components/ui/primitives";
import { Sprite } from "@/components/pixel/Sprite";
import { useEditor } from "@/store/editor";

const STATUS_LABEL: Record<ExportJob["status"], string> = {
  queued: "Waiting in queue…",
  launching: "Starting headless renderer…",
  rendering: "Rendering frames",
  encoding: "Encoding H.264 video…",
  verifying: "Verifying the MP4 decodes cleanly…",
  done: "Export complete",
  error: "Export failed",
};

export function ExportDialog({ open, onClose, save }: { open: boolean; onClose: () => void; save: () => Promise<boolean> }) {
  const project = useEditor((s) => s.project)!;
  const commit = useEditor((s) => s.commit);
  const [job, setJob] = useState<ExportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);

  const settings = project.exportSettings;
  const size = outputSize(project.aspectRatio, settings.resolution);
  const busy = starting || (job !== null && job.status !== "done" && job.status !== "error");

  const start = async () => {
    setError(null);
    setJob(null);
    setStarting(true);
    try {
      // The server exports the saved document, so persist current edits first.
      if (!(await save())) throw new Error("Could not save the project before exporting");
      const { job } = await api.startExport(project.id);
      setJob(job);
      timer.current = setInterval(async () => {
        try {
          const { job: next } = await api.getExport(job.id);
          setJob(next);
          if (next.status === "done" || next.status === "error") clearInterval(timer.current!);
        } catch (e) {
          clearInterval(timer.current!);
          setError(e instanceof Error ? e.message : String(e));
        }
      }, 400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const pct = job && job.totalFrames ? Math.round((job.frame / job.totalFrames) * 100) : 0;
  const elapsed = job?.startedAt && job.finishedAt ? ((job.finishedAt - job.startedAt) / 1000).toFixed(1) : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="export-title"
            className="px-box w-full max-w-lg bg-panel p-7"
            initial={{ y: 30, scale: 0.9 }} animate={{ y: 0, scale: 1 }} exit={{ y: 30, scale: 0.9 }} transition={{ type: "spring", stiffness: 400, damping: 24 }}>
            <div className="mb-6 flex items-start justify-between">
              <div className="flex items-center gap-4">
                <span className="px-box-flat flex size-14 items-center justify-center bg-coral [--px-c:var(--color-edge)]">
                  <Sprite name="reel" scale={3} className={busy ? "animate-spin-steps" : undefined} />
                </span>
                <div>
                  <ArcadeLabel className="text-aqua-ink">Final level</ArcadeLabel>
                  <h2 id="export-title" className="mt-1.5 font-display text-2xl font-bold">Export MP4</h2>
                  <p className="mt-0.5 font-mono text-[11px] text-mute">{size.width}×{size.height} · {settings.fps} fps · {(projectDurationMs(project) / 1000).toFixed(1)}s · H.264</p>
                </div>
              </div>
              <IconButton label="Close" onClick={onClose} disabled={busy}><X className="size-4" /></IconButton>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-3">
              <Field label="Resolution">
                <Select value={settings.resolution} disabled={busy}
                  onChange={(e) => commit((d) => void (d.exportSettings.resolution = Number(e.target.value) as 720 | 1080))}>
                  <option value={720}>720p</option>
                  <option value={1080}>1080p</option>
                </Select>
              </Field>
              <Field label="Frame rate">
                <Select value={settings.fps} disabled={busy}
                  onChange={(e) => commit((d) => void (d.exportSettings.fps = Number(e.target.value) as 24 | 30))}>
                  <option value={24}>24 fps</option>
                  <option value={30}>30 fps</option>
                </Select>
              </Field>
            </div>

            {job && (
              <div className="px-box-flat mb-6 bg-night p-4" aria-live="polite">
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 font-display text-[15px] font-semibold">
                    {job.status === "done" && <CheckCircle2 className="size-4 text-mint-ink" />}
                    {job.status === "error" && <AlertTriangle className="size-4 text-coral-ink" />}
                    {STATUS_LABEL[job.status]}
                  </span>
                  <span className="font-mono text-xs text-mute">
                    {job.totalFrames ? `${job.frame}/${job.totalFrames}` : ""} {elapsed && `· ${elapsed}s`}
                  </span>
                </div>
                <PixelProgress value={job.status === "done" ? 1 : pct / 100} color={job.status === "error" ? "bg-coral" : job.status === "done" ? "bg-mint" : "bg-yellow"} />
                {job.status === "error" && <p className="mt-3 text-xs break-words text-coral-ink">{job.error}</p>}
                {job.status === "done" && job.probe && (
                  <>
                    <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 14 }}
                      className="mt-4 flex items-center justify-center gap-3">
                      <Sprite name="star" scale={3} className="animate-twinkle" />
                      <ArcadeLabel className="text-[11px] text-yellow-ink">Level clear!</ArcadeLabel>
                      <Sprite name="star" scale={3} className="animate-twinkle [animation-delay:0.6s]" />
                    </motion.div>
                    <video key={job.id} src={api.exportFileUrl(job.id)} controls className="px-box-flat mt-4 w-full bg-black" />
                    <p className="mt-2 font-mono text-[11px] text-mute">
                      Verified: {job.probe.codec} {job.probe.width}×{job.probe.height} @ {job.probe.fps}fps, {job.probe.durationSec.toFixed(2)}s, decoded without errors
                    </p>
                  </>
                )}
              </div>
            )}
            {error && <p className="px-box-flat mb-4 bg-coral/10 p-3 text-xs text-coral-ink [--px-c:var(--color-coral)]">{error}</p>}

            <div className="flex justify-end gap-4">
              {job?.status === "done" && (
                <a href={api.exportFileUrl(job.id, true)} className="px-btn inline-flex h-9 items-center gap-2 bg-mint px-3.5 font-display text-[15px] font-semibold text-onaccent">
                  <Download className="size-4" /> Download
                </a>
              )}
              <Button variant="primary" onClick={start} disabled={busy}>
                {busy ? "Rendering…" : job ? "Export again" : "Start export"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
