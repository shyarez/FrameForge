import { NextResponse } from "next/server";
import { deleteAsset, readAsset } from "@/lib/server/assets";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { rangeResponse } from "@/lib/server/range";
import { assertId } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string; file: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id, file } = await params;
    const { data, mime } = await readAsset(user.id, assertId(id), file);
    return rangeResponse(req, data, {
      "Content-Type": mime,
      // Names are content-addressed by a random id and never reused.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id, file } = await params;
    await deleteAsset(user.id, assertId(id), file);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
