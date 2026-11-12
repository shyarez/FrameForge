import { NextResponse } from "next/server";
import { deleteAsset, readAsset } from "@/lib/server/assets";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { assertId } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string; file: string }> };

/** A single "bytes=a-b" / "bytes=a-" / "bytes=-n" range; multi-range requests are served whole. */
function parseRange(header: string | null, size: number): [number, number] | "invalid" | null {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? "invalid" : [start, end];
}

export async function GET(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id, file } = await params;
    const { data, mime } = await readAsset(user.id, assertId(id), file);
    const headers: Record<string, string> = {
      "Content-Type": mime,
      // Names are content-addressed by a random id and never reused.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // Browsers need byte ranges to seek inside audio.
      "Accept-Ranges": "bytes",
    };
    const range = parseRange(req.headers.get("range"), data.length);
    if (range === "invalid") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${data.length}` } });
    if (range) {
      const [start, end] = range;
      return new Response(new Uint8Array(data.subarray(start, end + 1)), {
        status: 206,
        headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${data.length}` },
      });
    }
    return new Response(new Uint8Array(data), { headers: { ...headers, "Content-Length": String(data.length) } });
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
