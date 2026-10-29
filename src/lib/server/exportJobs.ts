import "server-only";
import { promises as fs } from "node:fs";
import { nanoid } from "nanoid";
import type { Project } from "@/lib/schema/project";
import { probeVideo, renderProjectToMp4, type ProbeResult } from "./render";
import { appendExportMetric } from "./metrics";
import { exportFile } from "./storage";

export type ExportStatus = "queued" | "launching" | "rendering" | "encoding" | "verifying" | "done" | "error";

export interface ExportJob {
  id: string;
  projectId: string;
  projectName: string;
  status: ExportStatus;
  frame: number;
  totalFrames: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  probe?: ProbeResult;
}

// Kept on globalThis so jobs survive dev-server module reloads.
const g = globalThis as unknown as { __ffJobs?: Map<string, ExportJob>; __ffQueue?: Promise<void> };
const jobs = (g.__ffJobs ??= new Map());

/** Exports run one at a time: each owns a Chromium instance and an FFmpeg process. */
export function startExport(project: Project, origin: string): ExportJob {
  const job: ExportJob = {
    id: `exp_${nanoid(12)}`,
    projectId: project.id,
    projectName: project.name,
    status: "queued",
    frame: 0,
    totalFrames: 0,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  const run = async () => {
    job.startedAt = Date.now();
    try {
      const out = exportFile(job.id);
      await renderProjectToMp4({
        project,
        origin,
        outFile: out,
        onProgress: (p) => {
          job.status = p.phase;
          job.frame = p.frame;
          job.totalFrames = p.totalFrames;
        },
      });
      const renderedAt = Date.now();
      job.status = "verifying";
      job.probe = await probeVideo(out);
      if (!job.probe.decodedOk) throw new Error("Output failed decode verification");
      job.status = "done";
      // Record measured performance for the evaluation panel; a metrics failure never fails the export.
      const renderSec = (renderedAt - job.startedAt) / 1000;
      const bytes = (await fs.stat(out).catch(() => null))?.size ?? 0;
      await appendExportMetric(project.id, {
        jobId: job.id,
        at: new Date().toISOString(),
        width: job.probe.width,
        height: job.probe.height,
        fps: job.probe.fps,
        frames: job.totalFrames,
        videoSec: job.probe.durationSec,
        renderSec: Math.round(renderSec * 100) / 100,
        totalSec: Math.round(((Date.now() - job.startedAt) / 1000) * 100) / 100,
        framesPerSec: renderSec > 0 ? Math.round((job.totalFrames / renderSec) * 10) / 10 : 0,
        bytes,
      }).catch(() => undefined);
    } catch (err) {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
    } finally {
      job.finishedAt = Date.now();
    }
  };
  g.__ffQueue = (g.__ffQueue ?? Promise.resolve()).then(run, run);
  return job;
}

export const getJob = (id: string) => jobs.get(id);
