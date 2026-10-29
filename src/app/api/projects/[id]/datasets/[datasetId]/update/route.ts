import { NextResponse } from "next/server";
import { z } from "zod";
import { planUpdate } from "@/lib/data/update";
import { ProjectSchema } from "@/lib/schema/project";
import { loadDataset } from "@/lib/server/datasets";
import { errorResponse } from "@/lib/server/http";
import { assertId, StorageError } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string; datasetId: string }> };

const Body = z.object({ project: ProjectSchema });

/**
 * Plan an evidence-aware update of the given project against the dataset's current stored version.
 * The project comes from the editor (it may have unsaved edits); every number is recomputed here
 * from the stored CSV. Nothing is saved: the editor shows the report and applies it as one undo step.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id, datasetId } = await params;
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new StorageError("Invalid update request", 400);
    if (body.data.project.id !== assertId(id)) throw new StorageError("Project id mismatch", 400);
    const { meta, table, version, hash } = await loadDataset(id, assertId(datasetId));
    const v = meta.versions.find((x) => x.version === version)!;
    const { project, report } = planUpdate(body.data.project, datasetId, table, { version, hash, rowCount: v.rowCount, columnCount: v.columnCount }, new Date().toISOString());
    return NextResponse.json({ project, report });
  } catch (err) {
    if (err instanceof Error && err.message === "Dataset is not attached to this project") return errorResponse(new StorageError(err.message, 404));
    return errorResponse(err);
  }
}
