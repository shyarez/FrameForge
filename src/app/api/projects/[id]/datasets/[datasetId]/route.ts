import { NextResponse } from "next/server";
import { deleteDataset, loadDataset } from "@/lib/server/datasets";
import { errorResponse } from "@/lib/server/http";
import { assertId } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string; datasetId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id, datasetId } = await params;
    const { view } = await loadDataset(assertId(id), datasetId);
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
