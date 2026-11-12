import "server-only";
import { promises as fs } from "node:fs";
import { nanoid } from "nanoid";
import { audioPlan, hasAudio } from "@/lib/engine/audio";
import type { Project } from "@/lib/schema/project";
import { assetPath } from "./assets";
import { probeVideo, renderProjectToMp4, type ProbeResult } from "./render";
import { inlineAssets } from "./inlineAssets";
import { appendExportMetric } from "./metrics";
import { exportFile } from "./storage";

export type ExportStatus = "queued" | "launching" | "rendering" | "encoding" | "mixing" | "verifying" | "done" | "error";

export interface ExportJob {
  id: string;
  /** The user who started the export; only they can see its status or download it. */
  ownerId: string;
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
export function startExport(owner: string, project: Project, origin: string): ExportJob {
  const job: ExportJob = {
    id: `exp_${nanoid(12)}`,
    ownerId: owner,
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
      const out = exportFile(owner, job.id);
      // Images are embedded so the render browser never needs the user's session.
      const renderable = await inlineAssets(owner, project);
      // Audio is read straight from the owner's asset folder by FFmpeg; the browser never sees it.
      const plan = audioPlan(project);
      const files: Record<string, string> = {};
      for (const src of [...plan.narration.map((c) => c.src), ...(plan.music ? [plan.music.src] : [])]) {
        files[src] = assetPath(owner, project.id, src.slice("asset:".length));
      }
      await renderProjectToMp4({
        project: renderable,
        origin,
        outFile: out,
        audio: { plan, files },
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
      if (hasAudio(plan) && !job.probe.audio) throw new Error("Output is missing its audio track");
      job.status = "done";
      // Record measured performance for the evaluation panel; a metrics failure never fails the export.
      const renderSec = (renderedAt - job.startedAt) / 1000;
      const bytes = (await fs.stat(out).catch(() => null))?.size ?? 0;
      await appendExportMetric(owner, project.id, {
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

/** A job, only if it belongs to this user (anything else is reported as not found). */
export const getJob = (owner: string, id: string): ExportJob | undefined => {
  const job = jobs.get(id);
  return job && job.ownerId === owner ? job : undefined;
};
