import { NextResponse } from "next/server";
import { MAX_AUDIO_BYTES, sniffAudio } from "@/lib/server/assets";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { hit } from "@/lib/server/rateLimit";
import { StorageError } from "@/lib/server/storage";
import { cloneVoice } from "@/lib/server/voice";

/** multipart/form-data: "name", "file" (a short voice sample), optional "text" (what the sample says). */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const limit = hit(`clone:${user.id}`, 10, 60 * 60_000);
    if (!limit.ok) throw new StorageError(`Too many voices created; try again in ${limit.retryAfter}s`, 429);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES + 64 * 1024) throw new StorageError("Sample is larger than 25 MB", 413);
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const name = String(form?.get("name") ?? "").trim().slice(0, 80);
    const text = String(form?.get("text") ?? "").trim().slice(0, 2000);
    if (!name) throw new StorageError("Give the voice a name", 400);
    if (!file || typeof file === "string") throw new StorageError('Expected a "file" field', 400);
    if (file.size > MAX_AUDIO_BYTES) throw new StorageError("Sample is larger than 25 MB", 413);
    const data = new Uint8Array(await file.arrayBuffer());
    const kind = sniffAudio(data);
    if (!kind) throw new StorageError("Upload the sample as MP3, WAV or OGG", 415);
    const voice = await cloneVoice(name, data, `sample.${kind}`, text || undefined);
    return NextResponse.json({ voice }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
