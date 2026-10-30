import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertId, exportFile, userPath } from "./storage";

/** Measured performance of one finished export, kept per project for the evaluation panel. */
export interface ExportMetric {
  jobId: string;
  at: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  /** Length of the produced video. */
  videoSec: number;
  /** Wall time spent capturing frames and encoding. */
  renderSec: number;
  /** Wall time including the full-decode verification pass. */
  totalSec: number;
  /** Frames captured per second of wall time. */
  framesPerSec: number;
  bytes: number;
}

const KEEP = 50;
const file = (owner: string, projectId: string) => userPath(owner, "metrics", `${assertId(projectId)}.json`);

export async function readExportMetrics(owner: string, projectId: string): Promise<ExportMetric[]> {
  const raw = await fs.readFile(file(owner, projectId), "utf8").catch(() => null);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendExportMetric(owner: string, projectId: string, m: ExportMetric): Promise<void> {
  const list = [...(await readExportMetrics(owner, projectId)), m].slice(-KEEP);
  const f = file(owner, projectId);
  await fs.mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2));
  await fs.rename(tmp, f);
}

export async function deleteExportMetrics(owner: string, projectId: string): Promise<void> {
  await fs.rm(file(owner, projectId), { force: true });
}

/** Remove the MP4 files of every recorded export of a project (call before deleting the project). */
export async function deleteProjectExports(owner: string, projectId: string): Promise<number> {
  let removed = 0;
  for (const m of await readExportMetrics(owner, projectId)) {
    try {
      await fs.rm(exportFile(owner, m.jobId), { force: true });
      removed++;
    } catch {
      // A malformed job id is skipped rather than blocking project deletion.
    }
  }
  return removed;
}
