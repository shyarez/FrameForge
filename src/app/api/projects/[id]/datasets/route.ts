import { NextResponse } from "next/server";
import { CSV_LIMITS } from "@/lib/data/csv";
import { createDataset } from "@/lib/server/datasets";
import { errorResponse } from "@/lib/server/http";
import { assertId, loadProject, StorageError } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string }> };

/** multipart/form-data with a single "file" field containing a CSV. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await loadProject(assertId(id));
    if (Number(req.headers.get("content-length") ?? 0) > CSV_LIMITS.maxBytes + 64 * 1024) throw new StorageError("CSV is larger than 5 MB", 413);
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") throw new StorageError('Expected a "file" field', 400);
    if (file.size > CSV_LIMITS.maxBytes) throw new StorageError("CSV is larger than 5 MB", 413);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(await file.arrayBuffer());
    return NextResponse.json({ dataset: await createDataset(id, file.name, text) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
