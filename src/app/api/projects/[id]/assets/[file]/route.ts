import { NextResponse } from "next/server";
import { deleteAsset, readAsset } from "@/lib/server/assets";
import { errorResponse } from "@/lib/server/http";
import { assertId } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string; file: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id, file } = await params;
    const { data, mime } = await readAsset(assertId(id), file);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(data.length),
        // Names are content-addressed by a random id and never reused.
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id, file } = await params;
    await deleteAsset(assertId(id), file);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
