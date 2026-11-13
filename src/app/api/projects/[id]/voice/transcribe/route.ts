import { NextResponse } from "next/server";
import { z } from "zod";
import { alignToScript, captionCues } from "@/lib/engine/narration";
import { assertAssetName, isAudioKind, readAsset } from "@/lib/server/assets";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { hit } from "@/lib/server/rateLimit";
import { assertId, StorageError } from "@/lib/server/storage";
import { transcribe } from "@/lib/server/voice";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ asset: z.string().max(100), language: z.string().max(40).optional(), script: z.string().max(4096).optional() });

/** Transcribe one of the project's audio assets with timings and return caption cues. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new StorageError("Expected { asset }", 400);
    const name = assertAssetName(parsed.data.asset.replace(/^asset:/, ""));
    if (!isAudioKind(name.split(".").pop()!)) throw new StorageError("Not an audio asset", 400);
    const limit = hit(`transcribe:${user.id}`, 30, 60_000);
    if (!limit.ok) throw new StorageError(`Too many requests; try again in ${limit.retryAfter}s`, 429);
    // readAsset resolves inside this user's folder only, so another user's audio is a 404.
    const { data } = await readAsset(user.id, assertId(id), name);
    const transcript = await transcribe(new Uint8Array(data), name, parsed.data.language);
    // With the script known, captions use its exact wording and the engine's timings.
    const aligned = parsed.data.script ? alignToScript(transcript, parsed.data.script) : transcript;
    return NextResponse.json({ transcript, cues: captionCues(aligned) });
  } catch (err) {
    return errorResponse(err);
  }
}
