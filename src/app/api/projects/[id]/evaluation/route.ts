import { NextResponse } from "next/server";
import { auditProject } from "@/lib/data/audit";
import type { Table } from "@/lib/data/profile";
import { loadDataset } from "@/lib/server/datasets";
import { errorResponse } from "@/lib/server/http";
import { readExportMetrics } from "@/lib/server/metrics";
import { assertId, loadProject } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string }> };

/** Evaluate the saved project: claim reproducibility, evidence coverage, consistency, updates and exports. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const project = await loadProject(assertId(id));
    // Load every dataset version the claims reference up front; the audit itself is synchronous.
    const tables = new Map<string, Table | null>();
    for (const e of project.evidence) {
      const key = `${e.datasetId}@${e.datasetVersion}`;
      if (tables.has(key)) continue;
      tables.set(key, await loadDataset(id, e.datasetId, e.datasetVersion).then((r) => r.table, () => null));
    }
    const audit = auditProject(project, (datasetId, version) => tables.get(`${datasetId}@${version}`) ?? null);
    const exports = await readExportMetrics(id);
    return NextResponse.json({ audit, exports });
  } catch (err) {
    return errorResponse(err);
  }
}
