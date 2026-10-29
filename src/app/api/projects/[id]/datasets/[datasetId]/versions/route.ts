import { NextResponse } from "next/server";
import { CSV_LIMITS } from "@/lib/data/csv";
import { addDatasetVersion } from "@/lib/server/datasets";
import { errorResponse } from "@/lib/server/http";
import { assertId, StorageError } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string; datasetId: string }> };

/** Upload a replacement CSV as the next version of this dataset (multipart "file" field). */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id, datasetId } = await params;
    if (Number(req.headers.get("content-length") ?? 0) > CSV_LIMITS.maxBytes + 64 * 1024) throw new StorageError("CSV is larger than 5 MB", 413);
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") throw new StorageError('Expected a "file" field', 400);
    if (file.size > CSV_LIMITS.maxBytes) throw new StorageError("CSV is larger than 5 MB", 413);
    const text = new TextDecoder("utf-8").decode(await file.arrayBuffer());
    const { view, identical } = await addDatasetVersion(assertId(id), assertId(datasetId), text);
    return NextResponse.json({ dataset: view, identical }, { status: identical ? 200 : 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
