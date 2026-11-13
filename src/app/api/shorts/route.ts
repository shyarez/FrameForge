import { NextResponse } from "next/server";
import { z } from "zod";
import { AspectRatioSchema } from "@/lib/schema/project";
import { MAX_AUDIO_BYTES, MAX_VIDEO_BYTES, sniffAudio, sniffVideo } from "@/lib/server/assets";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { hit } from "@/lib/server/rateLimit";
import { startShort } from "@/lib/server/shorts";
import { StorageError } from "@/lib/server/storage";

/** At most this many of your own clips per video, and this much upload in total. */
const MAX_CLIPS = 12;
const MAX_REQUEST_BYTES = 300 * 1024 * 1024;

const Options = z
  .object({
    name: z.string().trim().max(120).optional(),
    topic: z.string().trim().max(500).optional(),
    script: z.string().trim().max(6000).optional(),
    language: z.string().trim().max(40).optional(),
    style: z.string().trim().max(200).optional(),
    scenes: z.number().int().min(2).max(12).default(6),
    aspectRatio: AspectRatioSchema.default("9:16"),
    voice: z.string().max(200).nullable().default("default"),
    speed: z.number().min(0.5).max(2).default(1),
    captions: z.boolean().default(true),
    footage: z.enum(["stock", "mine", "none"]).default("stock"),
  })
  .refine((o) => Boolean(o.topic || o.script), { message: "Enter a topic or your own script" });

/**
 * Start generating a short video. multipart/form-data: "options" (JSON, see Options), an optional
 * "music" audio file, and for footage "mine" one or more "clips" video files in scene order.
 * Returns a job to poll at /api/shorts/<id>.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const limit = hit(`shorts:${user.id}`, 10, 60 * 60_000);
    if (!limit.ok) throw new StorageError(`Too many videos generated; try again in ${limit.retryAfter}s`, 429);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) throw new StorageError("Upload is larger than 300 MB in total", 413);
    const form = await req.formData().catch(() => null);
    if (!form) throw new StorageError("Expected multipart form data", 400);
    let raw: unknown;
    try {
      raw = JSON.parse(String(form.get("options") ?? "{}"));
    } catch {
      throw new StorageError("Invalid options", 400);
    }
    const parsed = Options.safeParse(raw);
    if (!parsed.success) throw new StorageError(parsed.error.issues[0]?.message ?? "Invalid options", 400);

    let music: Uint8Array | undefined;
    const file = form.get("music");
    if (file && typeof file !== "string" && file.size > 0) {
      if (file.size > MAX_AUDIO_BYTES) throw new StorageError("Music file is larger than 25 MB", 413);
      music = new Uint8Array(await file.arrayBuffer());
      if (!sniffAudio(music)) throw new StorageError("Music must be an MP3, WAV or OGG file", 415);
    }

    const myClips: Uint8Array[] = [];
    if (parsed.data.footage === "mine") {
      const files = form.getAll("clips").filter((f): f is File => typeof f !== "string" && f.size > 0);
      if (!files.length) throw new StorageError("Add at least one video clip, or choose stock footage", 400);
      if (files.length > MAX_CLIPS) throw new StorageError(`Use at most ${MAX_CLIPS} clips`, 400);
      for (const [i, f] of files.entries()) {
        if (f.size > MAX_VIDEO_BYTES) throw new StorageError(`Clip ${i + 1} is larger than 100 MB`, 413);
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (!sniffVideo(bytes)) throw new StorageError(`Clip ${i + 1} must be an MP4 or WebM video`, 415);
        myClips.push(bytes);
      }
    }
    const job = startShort(user.id, { ...parsed.data, music, myClips });
    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
