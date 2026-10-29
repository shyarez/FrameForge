import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendExportMetric, readExportMetrics, type ExportMetric } from "@/lib/server/metrics";
import { StorageError } from "@/lib/server/storage";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ff-metrics-"));
  process.env.FF_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FF_DATA_DIR;
});

const metric = (i: number): ExportMetric => ({
  jobId: `exp_${i}`, at: "2026-01-01T00:00:00.000Z", width: 1280, height: 720, fps: 30, frames: 240,
  videoSec: 8, renderSec: 20, totalSec: 22, framesPerSec: 12, bytes: 100_000,
});

describe("export metrics log", () => {
  it("starts empty, appends in order and keeps only the last 50", async () => {
    expect(await readExportMetrics("prj_metrics01")).toEqual([]);
    for (let i = 0; i < 55; i++) await appendExportMetric("prj_metrics01", metric(i));
    const list = await readExportMetrics("prj_metrics01");
    expect(list).toHaveLength(50);
    expect(list[0].jobId).toBe("exp_5");
    expect(list.at(-1)!.jobId).toBe("exp_54");
  });

  it("refuses unsafe project ids", async () => {
    await expect(appendExportMetric("../x", metric(1))).rejects.toBeInstanceOf(StorageError);
  });
});
