import { NextResponse } from "next/server";
import { z } from "zod";
import { AspectRatioSchema } from "@/lib/schema/project";
import { MAX_AUDIO_BYTES, sniffAudio } from "@/lib/server/assets";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { hit } from "@/lib/server/rateLimit";
import { startShort } from "@/lib/server/shorts";
import { StorageError } from "@/lib/server/storage";

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
    footage: z.boolean().default(true),
  })
  .refine((o) => Boolean(o.topic || o.script), { message: "Enter a topic or your own script" });

/**
 * Start generating a short video. multipart/form-data: "options" (JSON, see Options) and an optional
 * "music" audio file. Returns a job to poll at /api/shorts/<id>.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const limit = hit(`shorts:${user.id}`, 10, 60 * 60_000);
    if (!limit.ok) throw new StorageError(`Too many videos generated; try again in ${limit.retryAfter}s`, 429);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES + 256 * 1024) throw new StorageError("Music file is larger than 25 MB", 413);
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
    const job = startShort(user.id, { ...parsed.data, music });
    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
