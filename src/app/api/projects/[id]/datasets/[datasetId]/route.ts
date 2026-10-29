import { NextResponse } from "next/server";
import { deleteDataset, loadDataset } from "@/lib/server/datasets";
import { errorResponse } from "@/lib/server/http";
import { assertId, StorageError } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string; datasetId: string }> };

/** ?version=N previews a specific stored version (the one the project is on); default is the latest. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id, datasetId } = await params;
    const v = new URL(req.url).searchParams.get("version");
    const version = v === null ? undefined : Number(v);
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) throw new StorageError("Invalid version", 400);
    const { view } = await loadDataset(assertId(id), datasetId, version);
    return NextResponse.json({ dataset: view });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id, datasetId } = await params;
    await deleteDataset(assertId(id), assertId(datasetId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
