import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertId, safePath } from "./storage";

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
const file = (projectId: string) => safePath("metrics", `${assertId(projectId)}.json`);

export async function readExportMetrics(projectId: string): Promise<ExportMetric[]> {
  const raw = await fs.readFile(file(projectId), "utf8").catch(() => null);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendExportMetric(projectId: string, m: ExportMetric): Promise<void> {
  const list = [...(await readExportMetrics(projectId)), m].slice(-KEEP);
  const f = file(projectId);
  await fs.mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2));
  await fs.rename(tmp, f);
}

export async function deleteExportMetrics(projectId: string): Promise<void> {
  await fs.rm(file(projectId), { force: true });
}
