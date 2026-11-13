import { NextResponse } from "next/server";
import { listAssets, MAX_UPLOAD_BYTES, saveAsset } from "@/lib/server/assets";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { assertId, loadProject, StorageError } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    await loadProject(user.id, assertId(id));
    return NextResponse.json({ assets: await listAssets(user.id, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** multipart/form-data with a single "file" field. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    await loadProject(user.id, assertId(id));
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) throw new StorageError("File is larger than 100 MB", 413);
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") throw new StorageError('Expected a "file" field', 400);
    // Per-type limits (8 MB images, 25 MB audio, 100 MB video) are enforced by saveAsset from the file's content.
    if (file.size > MAX_UPLOAD_BYTES) throw new StorageError("File is larger than 100 MB", 413);
    const asset = await saveAsset(user.id, id, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
