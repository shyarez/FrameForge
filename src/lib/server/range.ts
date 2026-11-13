import "server-only";

/** A single "bytes=a-b" / "bytes=a-" / "bytes=-n" range; multi-range requests are served whole. */
export function parseRange(header: string | null, size: number): [number, number] | "invalid" | null {
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

/** Serve a file's bytes with byte-range support (browsers need it to seek audio and video). */
export function rangeResponse(req: Request, data: Buffer, headers: Record<string, string>): Response {
  const base = { ...headers, "Accept-Ranges": "bytes" };
  const range = parseRange(req.headers.get("range"), data.length);
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${data.length}` } });
  if (range) {
    const [start, end] = range;
    return new Response(new Uint8Array(data.subarray(start, end + 1)), {
      status: 206,
      headers: { ...base, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${data.length}` },
    });
  }
  return new Response(new Uint8Array(data), { headers: { ...base, "Content-Length": String(data.length) } });
}
