import "server-only";
import { nanoid } from "nanoid";
import type { Project } from "@/lib/schema/project";
import { probeVideo, renderProjectToMp4, type ProbeResult } from "./render";
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
      job.status = "verifying";
      job.probe = await probeVideo(out);
      if (!job.probe.decodedOk) throw new Error("Output failed decode verification");
      job.status = "done";
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
