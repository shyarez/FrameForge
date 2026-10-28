import { NextResponse } from "next/server";
import { listAssets, MAX_ASSET_BYTES, saveAsset } from "@/lib/server/assets";
import { errorResponse } from "@/lib/server/http";
import { assertId, loadProject, StorageError } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await loadProject(assertId(id));
    return NextResponse.json({ assets: await listAssets(id) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** multipart/form-data with a single "file" field. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await loadProject(assertId(id));
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_ASSET_BYTES + 64 * 1024) throw new StorageError("Image is larger than 8 MB", 413);
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") throw new StorageError('Expected a "file" field', 400);
    if (file.size > MAX_ASSET_BYTES) throw new StorageError("Image is larger than 8 MB", 413);
    const asset = await saveAsset(id, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
